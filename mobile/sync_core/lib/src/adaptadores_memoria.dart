/// Adaptadores EN MEMORIA de los puertos — para el runner de verificación y
/// para desarrollo sin dispositivo. La app Flutter los sustituye por Drift
/// (SQLite + SQLCipher) e implementaciones http SIN tocar el motor.
library;

import 'modelos.dart';
import 'puertos.dart';

class ColaOutboxMemoria implements ColaOutbox {
  final Map<String, CambioLocal> _filas = {};

  @override
  Future<void> guardar(CambioLocal cambio) async {
    _filas[cambio.id] = cambio;
  }

  @override
  Future<List<CambioLocal>> listosParaEnviar(int ahoraMs) async {
    final lista = _filas.values
        .where((c) =>
            c.estado == EstadoCambio.pendiente &&
            c.proximoIntentoEnMs <= ahoraMs)
        .toList();
    lista.sort((a, b) => a.creadoEnMs.compareTo(b.creadoEnMs)); // FIFO
    return lista;
  }

  @override
  Future<List<CambioLocal>> enEstado(EstadoCambio estado) async =>
      _filas.values.where((c) => c.estado == estado).toList();

  @override
  Future<List<CambioLocal>> sinConfirmarDeServicio(String servicioId) async =>
      _filas.values
          .where((c) =>
              c.servicioId == servicioId &&
              c.estado != EstadoCambio.confirmado)
          .toList();

  @override
  Future<CambioLocal?> porId(String id) async => _filas[id];

  int get total => _filas.length;
}

class EspejoLocalMemoria implements EspejoLocal {
  final Map<String, ServicioLocal> _servicios = {};
  List<DocumentoLocal> _documentos = [];

  @override
  Future<void> guardarServicio(ServicioLocal servicio) async {
    _servicios[servicio.id] = servicio;
  }

  @override
  Future<ServicioLocal?> servicio(String id) async => _servicios[id];

  @override
  Future<List<ServicioLocal>> servicios() async {
    final lista = _servicios.values.toList();
    lista.sort((a, b) => a.ventanaInicioIso.compareTo(b.ventanaInicioIso));
    return lista;
  }

  @override
  Future<void> reemplazarDocumentos(List<DocumentoLocal> documentos) async {
    _documentos = List.of(documentos);
  }

  @override
  Future<List<DocumentoLocal>> documentos() async => List.of(_documentos);
}

class EstadoSyncMemoria implements EstadoSync {
  String? _cursor;
  int? _ultimaSyncMs;

  @override
  Future<String?> cursor() async => _cursor;

  @override
  Future<void> guardarCursor(String cursor) async {
    _cursor = cursor;
  }

  @override
  Future<int?> ultimaSyncMs() async => _ultimaSyncMs;

  @override
  Future<void> guardarUltimaSyncMs(int epochMs) async {
    _ultimaSyncMs = epochMs;
  }
}

/// API falsa PROGRAMABLE para el runner: encola respuestas o fallos por llamada
/// y captura los lotes enviados (para verificar orden e idempotencia).
class SyncApiFalsa implements SyncApi {
  final List<List<CambioLocal>> lotesRecibidos = [];
  final List<Object> _guionPush = []; // List<ResultadoCambioApi> | SinConexion
  RespuestaPull? respuestaPull;
  Object? fallaPull;
  int pullsRecibidos = 0;
  String? ultimoCursorRecibido;

  /// Los cambios ya "vistos" (simula el registro de idempotencia del servidor).
  final Set<String> _procesados = {};

  void programarPushOk() => _guionPush.add(const <ResultadoCambioApi>[]);

  void programarPush(List<ResultadoCambioApi> resultados) =>
      _guionPush.add(resultados);

  void programarFalloTransporte() => _guionPush.add(const SinConexion());

  /// Fallo REALISTA de confirmación perdida: el servidor SÍ procesa el lote
  /// (queda en su registro de idempotencia) pero la respuesta nunca llega.
  void programarConfirmacionPerdida() =>
      _guionPush.add(const _ConfirmacionPerdida());

  @override
  Future<List<ResultadoCambioApi>> push(List<CambioLocal> lote) async {
    lotesRecibidos.add(List.of(lote));
    final paso = _guionPush.isEmpty ? null : _guionPush.removeAt(0);

    if (paso is SinConexion) throw paso;
    if (paso is _ConfirmacionPerdida) {
      for (final c in lote) {
        _procesados.add(c.id); // el servidor lo aplicó...
      }
      throw const SinConexion('confirmación perdida'); // ...pero no respondió
    }
    if (paso is List<ResultadoCambioApi> && paso.isNotEmpty) return paso;

    // Comportamiento por defecto: confirmar, deduplicando por UUID como el
    // servidor real (spec-010 R8).
    return lote.map((c) {
      final duplicado = _procesados.contains(c.id);
      _procesados.add(c.id);
      return ResultadoCambioApi(
        clientId: c.id,
        resultado: duplicado ? 'duplicado' : 'confirmado',
        version: 99,
      );
    }).toList();
  }

  @override
  Future<RespuestaPull> pull(String? cursor) async {
    pullsRecibidos += 1;
    ultimoCursorRecibido = cursor;
    final falla = fallaPull;
    if (falla != null) {
      fallaPull = null;
      throw falla;
    }
    return respuestaPull ??
        const RespuestaPull(cursor: 'cursor-1', servicios: [], documentos: []);
  }
}

class _ConfirmacionPerdida {
  const _ConfirmacionPerdida();
}
