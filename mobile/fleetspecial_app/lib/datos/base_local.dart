/// Base local Drift/SQLite (doc 06 §3): tablas espejo re-descargables + la cola
/// `outbox_cambios` (lo único irreemplazable del dispositivo) + estado de sync.
///
/// El esquema de la cola es el del doc 06 §3.2, columna por columna.
/// Generación de código: `dart run build_runner build` (el CI lo hace).
library;

import 'package:drift/drift.dart';

part 'base_local.g.dart';

/// Cola de cambios del cliente (doc 06 §3.2). PK = UUID v4 del cambio.
class OutboxCambios extends Table {
  TextColumn get id => text()();
  TextColumn get entidad => text()();
  TextColumn get operacion => text()();
  TextColumn get payload => text()(); // JSON autocontenido
  TextColumn get estado => text()(); // pendiente|enviando|confirmado|fallido|conflicto|escalado
  IntColumn get creadoEnMs => integer()();
  IntColumn get actualizadoEnMs => integer()();
  IntColumn get intentos => integer().withDefault(const Constant(0))();
  IntColumn get proximoIntentoEnMs => integer().withDefault(const Constant(0))();
  TextColumn get lastError => text().nullable()();
  TextColumn get tenantId => text()();
  TextColumn get ocurridoEnIso => text().nullable()();
  IntColumn get versionServidor => integer().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

/// Tabla espejo de Servicios ("mi día"). Categoría A para planificación,
/// C para la ejecución (estado/inicioReal/finReal).
class ServiciosEspejo extends Table {
  TextColumn get id => text()();
  TextColumn get origen => text()();
  TextColumn get destino => text()();
  TextColumn get ventanaInicioIso => text()();
  TextColumn get ventanaFinIso => text()();
  TextColumn get cliente => text().nullable()();
  TextColumn get vehiculoId => text().nullable()();
  TextColumn get conductorId => text().nullable()();
  TextColumn get estado => text()();
  TextColumn get inicioRealIso => text().nullable()();
  TextColumn get finRealIso => text().nullable()();
  IntColumn get version => integer().withDefault(const Constant(1))();

  @override
  Set<Column> get primaryKey => {id};
}

/// Tabla espejo de Documentos del Vehículo (categoría A: server gana siempre).
class DocumentosEspejo extends Table {
  TextColumn get id => text()();
  TextColumn get tipo => text()();
  TextColumn get estado => text()(); // Vigente|PorVencer|Vencido
  TextColumn get vencimientoIso => text().nullable()();
  IntColumn get diasRestantes => integer().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

/// Estado de sincronización (doc 06 §4.3): una sola fila (id = 1).
class SyncEstado extends Table {
  IntColumn get id => integer()();
  TextColumn get cursor => text().nullable()();
  IntColumn get ultimaSyncMs => integer().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

@DriftDatabase(tables: [OutboxCambios, ServiciosEspejo, DocumentosEspejo, SyncEstado])
class BaseLocal extends _$BaseLocal {
  BaseLocal(super.executor);

  @override
  int get schemaVersion => 1;
}
