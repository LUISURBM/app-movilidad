/// Adaptadores Drift de los puertos de `sync_core` (doc 06 §3).
///
/// ATOMICIDAD (doc 06 §6.1): cada acción del Conductor debe escribir espejo +
/// cola en UNA transacción. Como los tres adaptadores comparten la misma
/// [BaseLocal], basta envolver la llamada en `db.transaction(...)` — ver
/// [CapturaAtomica.enTransaccion].
library;

import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:sync_core/sync_core.dart' as nucleo;

import 'base_local.dart';

// ─────────────────────────── Cola outbox ───────────────────────────

class ColaOutboxDrift implements nucleo.ColaOutbox {
  ColaOutboxDrift(this.db);
  final BaseLocal db;

  @override
  Future<void> guardar(nucleo.CambioLocal cambio) async {
    await db.into(db.outboxCambios).insertOnConflictUpdate(
          OutboxCambiosCompanion.insert(
            id: cambio.id,
            entidad: cambio.entidad,
            operacion: cambio.operacion,
            payload: jsonEncode(cambio.payload),
            estado: cambio.estado.name,
            creadoEnMs: cambio.creadoEnMs,
            actualizadoEnMs: cambio.actualizadoEnMs,
            intentos: Value(cambio.intentos),
            proximoIntentoEnMs: Value(cambio.proximoIntentoEnMs),
            lastError: Value(cambio.lastError),
            tenantId: cambio.tenantId,
            ocurridoEnIso: Value(cambio.ocurridoEnIso),
            versionServidor: Value(cambio.versionServidor),
          ),
        );
  }

  @override
  Future<List<nucleo.CambioLocal>> listosParaEnviar(int ahoraMs) async {
    final filas = await (db.select(db.outboxCambios)
          ..where((t) =>
              t.estado.equals(nucleo.EstadoCambio.pendiente.name) &
              t.proximoIntentoEnMs.isSmallerOrEqualValue(ahoraMs))
          ..orderBy([(t) => OrderingTerm.asc(t.creadoEnMs)]))
        .get();
    return filas.map(_aDominio).toList();
  }

  @override
  Future<List<nucleo.CambioLocal>> enEstado(nucleo.EstadoCambio estado) async {
    final filas = await (db.select(db.outboxCambios)
          ..where((t) => t.estado.equals(estado.name)))
        .get();
    return filas.map(_aDominio).toList();
  }

  @override
  Future<List<nucleo.CambioLocal>> sinConfirmarDeServicio(String servicioId) async {
    final filas = await (db.select(db.outboxCambios)
          ..where((t) => t.estado.isNotValue(nucleo.EstadoCambio.confirmado.name)))
        .get();
    return filas
        .map(_aDominio)
        .where((c) => c.servicioId == servicioId)
        .toList();
  }

  @override
  Future<nucleo.CambioLocal?> porId(String id) async {
    final fila = await (db.select(db.outboxCambios)
          ..where((t) => t.id.equals(id)))
        .getSingleOrNull();
    return fila == null ? null : _aDominio(fila);
  }

  nucleo.CambioLocal _aDominio(OutboxCambio f) {
    final cambio = nucleo.CambioLocal(
      id: f.id,
      entidad: f.entidad,
      operacion: f.operacion,
      payload: (jsonDecode(f.payload) as Map<String, dynamic>)
          .map((k, v) => MapEntry(k, v as Object?)),
      tenantId: f.tenantId,
      creadoEnMs: f.creadoEnMs,
      ocurridoEnIso: f.ocurridoEnIso,
      estado: nucleo.EstadoCambio.values.byName(f.estado),
      actualizadoEnMs: f.actualizadoEnMs,
      intentos: f.intentos,
      proximoIntentoEnMs: f.proximoIntentoEnMs,
      lastError: f.lastError,
    );
    cambio.versionServidor = f.versionServidor;
    return cambio;
  }
}

// ─────────────────────────── Espejo local ───────────────────────────

class EspejoLocalDrift implements nucleo.EspejoLocal {
  EspejoLocalDrift(this.db);
  final BaseLocal db;

  @override
  Future<void> guardarServicio(nucleo.ServicioLocal s) async {
    await db.into(db.serviciosEspejo).insertOnConflictUpdate(
          ServiciosEspejoCompanion.insert(
            id: s.id,
            origen: s.origen,
            destino: s.destino,
            ventanaInicioIso: s.ventanaInicioIso,
            ventanaFinIso: s.ventanaFinIso,
            cliente: Value(s.cliente),
            vehiculoId: Value(s.vehiculoId),
            conductorId: Value(s.conductorId),
            estado: s.estado,
            inicioRealIso: Value(s.inicioRealIso),
            finRealIso: Value(s.finRealIso),
            version: Value(s.version),
          ),
        );
  }

  @override
  Future<nucleo.ServicioLocal?> servicio(String id) async {
    final fila = await (db.select(db.serviciosEspejo)
          ..where((t) => t.id.equals(id)))
        .getSingleOrNull();
    return fila == null ? null : _servicioADominio(fila);
  }

  @override
  Future<List<nucleo.ServicioLocal>> servicios() async {
    final filas = await (db.select(db.serviciosEspejo)
          ..orderBy([(t) => OrderingTerm.asc(t.ventanaInicioIso)]))
        .get();
    return filas.map(_servicioADominio).toList();
  }

  @override
  Future<void> reemplazarDocumentos(List<nucleo.DocumentoLocal> documentos) async {
    await db.transaction(() async {
      await db.delete(db.documentosEspejo).go();
      for (final d in documentos) {
        await db.into(db.documentosEspejo).insert(
              DocumentosEspejoCompanion.insert(
                id: d.id,
                tipo: d.tipo,
                estado: d.estado,
                vencimientoIso: Value(d.vencimientoIso),
                diasRestantes: Value(d.diasRestantes),
              ),
            );
      }
    });
  }

  @override
  Future<List<nucleo.DocumentoLocal>> documentos() async {
    final filas = await db.select(db.documentosEspejo).get();
    return filas
        .map((f) => nucleo.DocumentoLocal(
              id: f.id,
              tipo: f.tipo,
              estado: f.estado,
              vencimientoIso: f.vencimientoIso,
              diasRestantes: f.diasRestantes,
            ))
        .toList();
  }

  nucleo.ServicioLocal _servicioADominio(ServiciosEspejoData f) =>
      nucleo.ServicioLocal(
        id: f.id,
        origen: f.origen,
        destino: f.destino,
        ventanaInicioIso: f.ventanaInicioIso,
        ventanaFinIso: f.ventanaFinIso,
        cliente: f.cliente,
        vehiculoId: f.vehiculoId,
        conductorId: f.conductorId,
        estado: f.estado,
        inicioRealIso: f.inicioRealIso,
        finRealIso: f.finRealIso,
        version: f.version,
      );
}

// ─────────────────────────── Estado de sync ───────────────────────────

class EstadoSyncDrift implements nucleo.EstadoSync {
  EstadoSyncDrift(this.db);
  final BaseLocal db;
  static const _filaUnica = 1;

  Future<SyncEstadoData?> _fila() => (db.select(db.syncEstado)
        ..where((t) => t.id.equals(_filaUnica)))
      .getSingleOrNull();

  @override
  Future<String?> cursor() async => (await _fila())?.cursor;

  @override
  Future<void> guardarCursor(String cursor) async {
    final actual = await _fila();
    await db.into(db.syncEstado).insertOnConflictUpdate(
          SyncEstadoCompanion.insert(
            // PK entera única = alias de rowid para Drift ⇒ opcional (Value).
            id: const Value(_filaUnica),
            cursor: Value(cursor),
            ultimaSyncMs: Value(actual?.ultimaSyncMs),
          ),
        );
  }

  @override
  Future<int?> ultimaSyncMs() async => (await _fila())?.ultimaSyncMs;

  @override
  Future<void> guardarUltimaSyncMs(int epochMs) async {
    final actual = await _fila();
    await db.into(db.syncEstado).insertOnConflictUpdate(
          SyncEstadoCompanion.insert(
            id: const Value(_filaUnica),
            cursor: Value(actual?.cursor),
            ultimaSyncMs: Value(epochMs),
          ),
        );
  }
}

// ─────────────────────────── Captura atómica ───────────────────────────

/// Envuelve una acción del Conductor en la transacción de la base (doc 06 §6.1):
/// espejo + cola quedan escritos completos o no quedan (crash-safe).
///
///   final cambio = await CapturaAtomica(db).enTransaccion(
///     () => acciones.iniciarServicio('srv-1', odometro: 152000),
///   );
class CapturaAtomica {
  CapturaAtomica(this.db);
  final BaseLocal db;

  Future<T> enTransaccion<T>(Future<T> Function() accion) =>
      db.transaction(accion);
}
