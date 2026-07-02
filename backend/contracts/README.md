# Contratos — API First

> El **contrato antecede al código** (Spec Driven Development + API First). De estos archivos se generan el SDK del portal web, los *mocks* para que web y móvil avancen en paralelo, y la validación de requests en runtime. Si el código y el contrato discrepan, **gana el contrato** (o se corrige el contrato explícitamente).

## Archivos

| Archivo | Estándar | Qué define |
|---|---|---|
| [`openapi.yaml`](openapi.yaml) | OpenAPI 3.1 | API **REST** síncrona: recursos, endpoints, esquemas, errores, seguridad. |
| [`asyncapi.yaml`](asyncapi.yaml) | AsyncAPI 3.0 | **Eventos de dominio** publicados por el outbox (ADR-0004). |

Ambos derivan de las **specs aprobadas** (Fase 3) y del **modelo de dominio** (Fase 2). Son la entrada para implementar los módulos del backend (Fase 9) empezando por el CORE.

## Convenciones (Fase 5, ADRs)

- **Versionado** por prefijo de ruta: `/v1`. Cambios incompatibles → `/v2`; aditivos → misma versión.
- **Multi-tenant:** el `tenant_id` se deriva del **JWT** (claim), nunca del body/query. En base se refuerza con **Row Level Security** (ADR-0008).
- **Idempotencia:** los `POST` que el móvil reintenta tras una caída aceptan `Idempotency-Key` (UUID del dispositivo). Cubre `sync/push`, `combustible`, `odometro`, `estado` de servicio y `novedades` (offline-first, Fase 6).
- **Dinero** siempre en **COP** (entero, sin decimales) — esquema `Money`.
- **Errores** con forma RFC 7807 (`Problem`); el campo `type` discrimina causas (p. ej. `conflicto_horario`, `incumplimiento`).
- **Semáforo** = `Vigente | PorVencer | Vencido` (verde/amarillo/rojo), coherente con el VO `EstadoCumplimiento` de la Fase 2.

## Trazabilidad spec → REST → eventos

| Spec (Fase 3) | Endpoints REST principales | Eventos emitidos |
|---|---|---|
| spec-001 Onboarding tenant | `POST /tenants` | `SuscripcionActivada` (Free) |
| spec-002 Usuarios y roles | `POST /usuarios`, `PATCH /usuarios/{id}` | `UsuarioInvitado` |
| spec-003 Vehículo + odómetro | `POST /vehiculos`, `POST /vehiculos/{id}/odometro` | `VehiculoRegistrado`, `OdometroActualizado` |
| spec-004 Conductor | `POST /conductores` | `ConductorRegistrado` |
| spec-005 Documento | `POST /documentos`, `PUT /documentos/{id}/adjunto` | `DocumentoRegistrado` |
| spec-006 Semáforo / alertas | `GET /cumplimiento/*`, `GET /cumplimiento/alertas` | `DocumentoPorVencer`, `DocumentoVencido` |
| spec-007 Renovación | `POST /documentos/{id}/renovaciones` | `DocumentoRenovado` |
| spec-008 Servicio + asignación | `POST /servicios`, `PUT /servicios/{id}/asignacion` | `ServicioCreado`, `ServicioAsignado` |
| spec-009 Regla de oro | `PUT /servicios/{id}/asignacion` → `409 incumplimiento` | `AsignacionRechazada` |
| spec-010 Conductor offline | `POST /servicios/{id}/estado`, `GET /sync/pull`, `POST /sync/push` | `ServicioIniciado`, `ServicioFinalizado` |
| spec-011 Tanqueo offline | `POST /combustible` (`Idempotency-Key`) | `CombustibleRegistrado` |
| spec-012 Mantenimiento *(Draft)* | *(pendiente de aprobar la spec)* | `MantenimientoProgramado/Vencido/Registrado` |
| spec-014 Novedad offline *(Draft)* | `POST /servicios/{id}/novedades` | `NovedadReportada` |

> Las specs **012, 013 y 014** están en `Draft`; sus endpoints/eventos se incluyen de forma preliminar y se consolidan al aprobarlas.

## Cómo se usa (siguiente paso de implementación)

Estos contratos habilitan, sin acoplarse a un proveedor:

1. **Generar el SDK TypeScript del portal web** desde `openapi.yaml` (p. ej. `openapi-typescript` / `openapi-generator`), que el front importa en `frontend/shared/api/` — el front **no inventa tipos**.
2. **Levantar un mock server** desde `openapi.yaml` (p. ej. Prism) para que móvil y web trabajen antes de existir el backend.
3. **Validar requests/responses** en runtime contra el esquema en el backend NestJS.
4. **Compartir el esquema de eventos** (`asyncapi.yaml`) entre productores y consumidores del outbox y con los agentes IA (Fase 8).

> Los comandos concretos y la pila de generación se fijarán cuando arranque la implementación; el contrato es agnóstico de la herramienta (independencia de framework/proveedor).

## Validación

Ambos archivos se validan con linters estándar (Redocly/Spectral para OpenAPI; AsyncAPI CLI para eventos). Ver el estado en la tarea de verificación del proyecto. Un cambio de comportamiento se hace **editando primero la spec y el contrato**, y de ahí se propaga a código y pruebas.
