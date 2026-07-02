# `fleetspecial_app` — app del Conductor (offline-first)

**Fase 2a (esta entrega): capa de datos.** Implementa los puertos de
[`sync_core`](../sync_core/README.md) con infraestructura real:

| Puerto | Adaptador | Detalle |
|---|---|---|
| `ColaOutbox`, `EspejoLocal`, `EstadoSync` | `adaptadores_drift.dart` | Drift/SQLite, esquema del doc 06 §3.2 |
| `SyncApi` | `http_sync_api.dart` | `/v1/sync/*` con Bearer; sin red/timeout/5xx/429/401 ⇒ `SinConexion` (backoff) |
| Triggers (doc 06 §4.5) | `disparadores_sync.dart` | conectividad, periódico, manual, foreground — serializados |
| Composición | `composicion.dart` | `CapaDatos.produccion(...)` / `.enMemoria(...)`; captura atómica (§6.1) vía transacción |

**Fase 2b (incluida): UI demo-ready.** `main.dart` (configuración URL/token con
shared_preferences) + `ui/mi_dia_screen.dart`: semáforo del vehículo, banner de
frescura "datos de hace N min", tarjetas de servicio con Iniciar/Finalizar
(diálogo de odómetro), pull-to-refresh y badges de cola ("N por subir" / "en
conflicto"). Guion completo del demo: [docs/DEMO-APK.md](../../docs/DEMO-APK.md).

## Primer uso en tu máquina

```bash
cd mobile/fleetspecial_app
flutter create . --platforms android   # genera android/ (no está commiteado)
flutter pub get
dart run build_runner build            # genera lib/datos/base_local.g.dart
flutter analyze
flutter test                           # la misma suite que corre el CI
```

## Deudas registradas

- **SQLCipher (doc 06 §3.4):** la base arranca SIN cifrar para el dogfooding
  con datos propios; cambiar a `sqlcipher_flutter_libs` + clave en
  Keystore/Keychain ANTES de datos de terceros (Habeas Data).
- **`Servicio.version` en el contrato:** `/sync/pull` aún no expone la versión;
  el motor usa 1 y adopta la real al confirmar el push. Añadirla al openapi.
- Blobs de fotos (spec-014) y tanqueos (spec-011): fases siguientes.
