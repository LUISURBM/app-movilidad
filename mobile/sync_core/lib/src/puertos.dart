/// Puertos del motor (hexagonal, como el backend): el motor define QUÉ necesita;
/// la app Flutter implementa CÓMO (Drift/SQLite cifrado con SQLCipher, http).
library;

import 'modelos.dart';

/// La cola de cambios (doc 06 §3.2). En producción es una tabla Drift/SQLite
/// PERSISTENTE y cada operación de captura corre en una transacción junto con
/// la tabla espejo (doc 06 §6.1: atómico o nada).
abstract class ColaOutbox {
  Future<void> guardar(CambioLocal cambio);

  /// Cambios `pendiente` cuyo `proximo_intento_en <= ahora`, en orden FIFO
  /// por `creado_en` (doc 06 §3.2: se procesa en orden).
  Future<List<CambioLocal>> listosParaEnviar(int ahoraMs);

  Future<List<CambioLocal>> enEstado(EstadoCambio estado);

  /// Cambios aún no confirmados (pendiente|enviando|fallido|conflicto) que
  /// tocan un Servicio — para que el pull NO pise la verdad local (cat. C).
  Future<List<CambioLocal>> sinConfirmarDeServicio(String servicioId);

  Future<CambioLocal?> porId(String id);
}

/// Tablas espejo locales (doc 06 §3.1): lo re-descargable.
abstract class EspejoLocal {
  Future<void> guardarServicio(ServicioLocal servicio);
  Future<ServicioLocal?> servicio(String id);
  Future<List<ServicioLocal>> servicios();
  Future<void> reemplazarDocumentos(List<DocumentoLocal> documentos);
  Future<List<DocumentoLocal>> documentos();
}

/// Estado de sincronización del dispositivo (doc 06 §4.3): cursor opaco del
/// servidor + marca local de la última sync exitosa (para "datos de hace N min").
abstract class EstadoSync {
  Future<String?> cursor();
  Future<void> guardarCursor(String cursor);
  Future<int?> ultimaSyncMs();
  Future<void> guardarUltimaSyncMs(int epochMs);
}

// ---------- Transporte ----------

/// Fallo de transporte TRANSITORIO (sin red, timeout, 5xx, 429): el lote se
/// reintenta con backoff (doc 06 §4.4). El adaptador http traduce a esto.
class SinConexion implements Exception {
  const SinConexion([this.detalle]);
  final String? detalle;

  @override
  String toString() => 'SinConexion(${detalle ?? "sin red o error transitorio"})';
}

/// Cliente del contrato /sync/* (la app lo implementa con `package:http` +
/// el Bearer del conductor; aquí solo la forma).
abstract class SyncApi {
  /// `POST /sync/push`. Lanza [SinConexion] si el TRANSPORTE falla; si el
  /// servidor responde, devuelve el resultado POR CAMBIO (contrato).
  Future<List<ResultadoCambioApi>> push(List<CambioLocal> lote);

  /// `GET /sync/pull?cursor=...`. Lanza [SinConexion] si el transporte falla.
  Future<RespuestaPull> pull(String? cursor);
}
