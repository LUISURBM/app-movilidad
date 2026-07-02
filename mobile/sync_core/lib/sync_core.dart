/// sync_core — motor de sincronización offline-first del Conductor
/// (spec-010 cliente + docs/06-offline-first.md).
///
/// Dart puro, cero dependencias. La app Flutter implementa los puertos
/// ([ColaOutbox], [EspejoLocal], [EstadoSync], [SyncApi]) con Drift/SQLite
/// cifrado y `package:http`; el motor no cambia.
library sync_core;

export 'src/acciones_conductor.dart';
export 'src/adaptadores_memoria.dart';
export 'src/backoff.dart';
export 'src/mi_dia.dart';
export 'src/modelos.dart';
export 'src/puertos.dart';
export 'src/reloj.dart';
export 'src/sincronizador.dart';
export 'src/uuid.dart';
