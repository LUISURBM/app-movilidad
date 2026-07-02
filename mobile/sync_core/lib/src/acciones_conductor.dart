/// Acciones del Conductor sobre SU día (spec-010 R3/R4): toda mutación se
/// ejecuta y persiste LOCALMENTE sin red, se confirma de inmediato en la UI y
/// se encola en el outbox del cliente con UUID + base_version.
///
/// NOTA de atomicidad (doc 06 §6.1): en la app real, cada acción envuelve
/// "actualizar espejo + insertar en cola" en UNA transacción Drift. Los puertos
/// en memoria son secuenciales, así que aquí basta el orden de llamadas.
library;

import 'modelos.dart';
import 'puertos.dart';
import 'reloj.dart';
import 'uuid.dart';

class ErrorAccion implements Exception {
  const ErrorAccion(this.codigo, this.mensaje);
  final String codigo;
  final String mensaje;

  @override
  String toString() => '$codigo: $mensaje';
}

class AccionesConductor {
  AccionesConductor({
    required this.cola,
    required this.espejo,
    required this.reloj,
    required this.tenantId,
    String Function()? generarId,
  }) : _generarId = generarId ?? uuidV4;

  final ColaOutbox cola;
  final EspejoLocal espejo;
  final Reloj reloj;
  final String tenantId;
  final String Function() _generarId;

  /// Marca el Servicio como INICIADO offline (registra inicioReal y odómetro).
  Future<CambioLocal> iniciarServicio(
    String servicioId, {
    int? odometro,
  }) async {
    final servicio = await _servicioLocal(servicioId);
    if (servicio.estado != 'Planificado') {
      throw ErrorAccion('transicion_invalida',
          'Solo un Servicio Planificado puede iniciarse (está ${servicio.estado}).');
    }

    final ahoraIso = reloj.ahora().toUtc().toIso8601String();
    // 1) Verdad local inmediata (la sync nunca bloquea la UX — doc 06 §1).
    servicio.estado = 'Iniciado';
    servicio.inicioRealIso = ahoraIso;
    await espejo.guardarServicio(servicio);

    // 2) Encolar con base_version (control optimista, spec-010 R6/R9).
    return _encolar(servicioId, 'iniciar', servicio.version, ahoraIso, odometro);
  }

  /// Marca el Servicio como FINALIZADO offline. Invariante S5 local:
  /// `finReal >= inicioReal` (falla rápida sin red).
  Future<CambioLocal> finalizarServicio(
    String servicioId, {
    int? odometro,
  }) async {
    final servicio = await _servicioLocal(servicioId);
    if (servicio.estado != 'Iniciado') {
      throw ErrorAccion('transicion_invalida',
          'Solo un Servicio Iniciado puede finalizarse (está ${servicio.estado}).');
    }

    final ahora = reloj.ahora().toUtc();
    final inicio = servicio.inicioRealIso == null
        ? null
        : DateTime.tryParse(servicio.inicioRealIso!);
    if (inicio != null && ahora.isBefore(inicio)) {
      throw ErrorAccion('fin_anterior_a_inicio',
          'El fin real no puede ser anterior al inicio real (Invariante S5).');
    }

    final ahoraIso = ahora.toIso8601String();
    servicio.estado = 'Finalizado';
    servicio.finRealIso = ahoraIso;
    await espejo.guardarServicio(servicio);

    return _encolar(servicioId, 'finalizar', servicio.version, ahoraIso, odometro);
  }

  Future<ServicioLocal> _servicioLocal(String servicioId) async {
    final servicio = await espejo.servicio(servicioId);
    if (servicio == null) {
      throw ErrorAccion('servicio_no_local',
          'El Servicio $servicioId no está en el espejo local; haga pull primero.');
    }
    return servicio;
  }

  Future<CambioLocal> _encolar(
    String servicioId,
    String accion,
    int baseVersion,
    String ocurridoEnIso,
    int? odometro,
  ) async {
    final cambio = CambioLocal(
      id: _generarId(),
      entidad: 'estado_servicio', // literal del CONTRATO (SyncCambio.entidad)
      operacion: 'actualizar', // literal del CONTRATO (SyncCambio.operacion)
      payload: <String, Object?>{
        'servicioId': servicioId,
        'accion': accion,
        if (odometro != null) 'odometro': odometro,
        'base_version': baseVersion,
      },
      tenantId: tenantId,
      creadoEnMs: reloj.ahoraMs(),
      ocurridoEnIso: ocurridoEnIso,
    );
    await cola.guardar(cambio);
    return cambio;
  }
}
