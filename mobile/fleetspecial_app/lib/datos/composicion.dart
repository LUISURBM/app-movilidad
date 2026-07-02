/// Composición de la capa de datos (fase 2a): arma el motor de sync_core con
/// los adaptadores reales. La UI (fase 2b) solo consume [CapaDatos].
library;

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:sync_core/sync_core.dart' as nucleo;

import 'adaptadores_drift.dart';
import 'base_local.dart';
import 'disparadores_sync.dart';
import 'http_sync_api.dart';

class CapaDatos {
  CapaDatos._({
    required this.db,
    required this.cola,
    required this.espejo,
    required this.estadoSync,
    required this.acciones,
    required this.sincronizador,
    required this.disparadores,
  });

  final BaseLocal db;
  final ColaOutboxDrift cola;
  final EspejoLocalDrift espejo;
  final EstadoSyncDrift estadoSync;
  final nucleo.AccionesConductor acciones;
  final nucleo.Sincronizador sincronizador;
  final DisparadoresSync disparadores;

  /// Fábrica de producción: base en el directorio de la app (drift_flutter).
  /// TODO(Habeas Data): pasar a SQLCipher + clave en Keystore antes de datos
  /// de terceros (doc 06 §3.4).
  factory CapaDatos.produccion({
    required String baseUrl,
    required Future<String> Function() tokenActual,
    required String tenantId,
  }) {
    final db = BaseLocal(driftDatabase(name: 'fleetspecial'));
    return CapaDatos._armar(
      db: db,
      api: HttpSyncApi(baseUrl: baseUrl, tokenActual: tokenActual),
      tenantId: tenantId,
    );
  }

  /// Fábrica para pruebas: base en memoria y API inyectable.
  factory CapaDatos.enMemoria({
    required QueryExecutor executor,
    required nucleo.SyncApi api,
    String tenantId = 'tenant-dev',
    nucleo.Reloj reloj = const nucleo.RelojSistema(),
  }) {
    return CapaDatos._armar(
      db: BaseLocal(executor),
      api: api,
      tenantId: tenantId,
      reloj: reloj,
    );
  }

  factory CapaDatos._armar({
    required BaseLocal db,
    required nucleo.SyncApi api,
    required String tenantId,
    nucleo.Reloj reloj = const nucleo.RelojSistema(),
  }) {
    final cola = ColaOutboxDrift(db);
    final espejo = EspejoLocalDrift(db);
    final estadoSync = EstadoSyncDrift(db);

    final acciones = nucleo.AccionesConductor(
      cola: cola,
      espejo: espejo,
      reloj: reloj,
      tenantId: tenantId,
    );
    final sincronizador = nucleo.Sincronizador(
      cola: cola,
      espejo: espejo,
      estadoSync: estadoSync,
      api: api,
      reloj: reloj,
    );
    return CapaDatos._(
      db: db,
      cola: cola,
      espejo: espejo,
      estadoSync: estadoSync,
      acciones: acciones,
      sincronizador: sincronizador,
      disparadores: DisparadoresSync(sincronizador: sincronizador),
    );
  }

  /// Acción del Conductor con la garantía de atomicidad del doc 06 §6.1.
  Future<nucleo.CambioLocal> iniciarServicio(String servicioId,
          {int? odometro}) =>
      CapturaAtomica(db).enTransaccion(
          () => acciones.iniciarServicio(servicioId, odometro: odometro));

  Future<nucleo.CambioLocal> finalizarServicio(String servicioId,
          {int? odometro}) =>
      CapturaAtomica(db).enTransaccion(
          () => acciones.finalizarServicio(servicioId, odometro: odometro));

  Future<nucleo.MiDia> miDia() => nucleo.cargarMiDia(espejo, estadoSync);

  Future<void> cerrar() async {
    disparadores.detener();
    await db.close();
  }
}
