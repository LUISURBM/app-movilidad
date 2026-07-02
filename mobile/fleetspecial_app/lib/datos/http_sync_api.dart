/// Cliente HTTP del contrato `/v1/sync/*` (backend/contracts/openapi.yaml),
/// implementando el puerto [nucleo.SyncApi].
///
/// Taxonomía de errores (doc 06 §4.4): sin red / timeout / 5xx / 429 se
/// traducen a [nucleo.SinConexion] (el motor reintenta con backoff). Un 401
/// también se trata como transitorio aquí (token por renovar), para NUNCA
/// marcar como fallido permanente un lote válido por un problema de sesión.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:sync_core/sync_core.dart' as nucleo;

class HttpSyncApi implements nucleo.SyncApi {
  HttpSyncApi({
    required this.baseUrl, // p. ej. https://api.fleetspecial.co/v1
    required this.tokenActual, // provee el Bearer vigente del Conductor
    http.Client? cliente,
    this.timeout = const Duration(seconds: 20),
  }) : _http = cliente ?? http.Client();

  final String baseUrl;
  final Future<String> Function() tokenActual;
  final http.Client _http;
  final Duration timeout;

  Future<Map<String, String>> _headers() async => {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ${await tokenActual()}',
      };

  @override
  Future<List<nucleo.ResultadoCambioApi>> push(
      List<nucleo.CambioLocal> lote) async {
    final cuerpo = jsonEncode({
      'cambios': [
        for (final c in lote)
          {
            'clientId': c.id,
            'entidad': c.entidad,
            'operacion': c.operacion,
            'payload': c.payload,
            if (c.ocurridoEnIso != null) 'ocurridoEn': c.ocurridoEnIso,
          },
      ],
    });

    final respuesta = await _enviar(
      () async => _http.post(
        Uri.parse('$baseUrl/sync/push'),
        headers: await _headers(),
        body: cuerpo,
      ),
    );

    final json = jsonDecode(respuesta.body) as Map<String, dynamic>;
    final resultados = (json['resultados'] as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .map((r) => nucleo.ResultadoCambioApi(
              clientId: r['clientId'] as String,
              resultado: r['resultado'] as String,
              version: r['version'] as int?,
              problemaTipo: (r['problema'] as Map<String, dynamic>?)?['type'] as String?,
              problemaTitulo:
                  (r['problema'] as Map<String, dynamic>?)?['title'] as String?,
            ))
        .toList();
    return resultados;
  }

  @override
  Future<nucleo.RespuestaPull> pull(String? cursor) async {
    final uri = Uri.parse('$baseUrl/sync/pull').replace(
      queryParameters: {if (cursor != null) 'cursor': cursor},
    );
    final respuesta =
        await _enviar(() async => _http.get(uri, headers: await _headers()));

    final json = jsonDecode(respuesta.body) as Map<String, dynamic>;
    return nucleo.RespuestaPull(
      cursor: json['cursor'] as String,
      servicios: ((json['servicios'] as List<dynamic>?) ?? [])
          .cast<Map<String, dynamic>>()
          .map(_servicioDeJson)
          .toList(),
      documentos: ((json['documentos'] as List<dynamic>?) ?? [])
          .cast<Map<String, dynamic>>()
          .map(_documentoDeJson)
          .toList(),
    );
  }

  /// Ejecuta la llamada y aplica la taxonomía de errores del doc 06 §4.4.
  Future<http.Response> _enviar(
      Future<http.Response> Function() llamada) async {
    http.Response respuesta;
    try {
      respuesta = await llamada().timeout(timeout);
    } on SocketException catch (e) {
      throw nucleo.SinConexion('sin red: ${e.message}');
    } on TimeoutException {
      throw const nucleo.SinConexion('timeout');
    } on http.ClientException catch (e) {
      throw nucleo.SinConexion('cliente http: ${e.message}');
    }

    final codigo = respuesta.statusCode;
    if (codigo >= 500 || codigo == 429 || codigo == 401) {
      throw nucleo.SinConexion('HTTP $codigo'); // transitorio → backoff
    }
    if (codigo >= 400) {
      // Permanente a nivel de TRANSPORTE (p. ej. 400 de forma). Los conflictos
      // POR CAMBIO viajan dentro del 200 (contrato SyncPushResultado).
      throw StateError('HTTP $codigo: ${respuesta.body}');
    }
    return respuesta;
  }

  nucleo.ServicioLocal _servicioDeJson(Map<String, dynamic> s) {
    final asignacion = s['asignacion'] as Map<String, dynamic>?;
    final ventana = s['ventana'] as Map<String, dynamic>;
    return nucleo.ServicioLocal(
      id: s['id'] as String,
      origen: s['origen'] as String,
      destino: s['destino'] as String,
      ventanaInicioIso: ventana['inicio'] as String,
      ventanaFinIso: ventana['fin'] as String,
      cliente: s['cliente'] as String?,
      vehiculoId: asignacion?['vehiculoId'] as String?,
      conductorId: asignacion?['conductorId'] as String?,
      estado: s['estado'] as String,
      inicioRealIso: s['inicioReal'] as String?,
      finRealIso: s['finReal'] as String?,
      // El contrato Servicio no expone `version` aún; el motor usa 1 y adopta
      // la versión real cuando el push confirma. TODO(contrato): exponerla.
      version: (s['version'] as int?) ?? 1,
    );
  }

  nucleo.DocumentoLocal _documentoDeJson(Map<String, dynamic> d) =>
      nucleo.DocumentoLocal(
        id: (d['id'] as String?) ?? '',
        tipo: d['tipo'] as String,
        estado: d['estado'] as String,
        vencimientoIso: d['vencimiento'] as String?,
        diasRestantes: d['diasRestantes'] as int?,
      );
}
