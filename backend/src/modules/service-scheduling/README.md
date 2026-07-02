# Módulo `service-scheduling` — BC-5 Service Scheduling (CORE)

Implementa **spec-008** (crear Servicio + Asignación sin choques) y **spec-009**
(**regla de oro**: bloquear Asignación con Semáforo en rojo, vía ACL a Compliance).
Las transiciones S1/S2 del ciclo de vida quedan protegidas desde aquí; la ejecución
offline con idempotencia (spec-010) se añade sobre esta base.

## Estructura (Clean Architecture)

```
domain/          Servicio (AR), VentanaHoraria/Asignacion/Ruta (VOs),
                 agenda.service (choques S4), events
application/     CrearServicio, AsignarServicio (S4 + S3), CambiarEstadoServicio,
                 ports (ServicioRepository, CumplimientoGateway ←ACL, EventPublisher),
                 in-memory.adapters (tests/dev)
interface/       ServiciosController (REST del openapi.yaml), DTOs, mappers,
                 error-mapping (409 conflicto_horario | incumplimiento)
infrastructure/  compliance.acl (ACL real, in-process), entities TypeORM,
                 typeorm.repositories, outbox.publisher (SQL directo a `outbox`)
```

## Decisiones clave

- **Asignación embebida en Servicio (VO, no agregado).** El contrato openapi.yaml
  la modela 1:1 y sin identidad propia (`PUT /servicios/{id}/asignacion`); se sigue
  el contrato (API First) en lugar del boceto inicial de Fase 2 (Asignación como AR).
- **ACL (spec-009 R2):** `CumplimientoGateway.puedeOperar(vehiculoId, conductorId, ventana)`
  devuelve `permitido/advertencias` en lenguaje de Scheduling. La implementación
  (`ComplianceAcl`) consulta in-process el caso de uso `ConsultarSemaforo` de
  Compliance (monolito modular, ADR-0001); si el módulo se extrajera a otro proceso,
  solo esta clase cambia (pasaría al endpoint REST `/cumplimiento/...`).
- **Orden de verificación (spec-009 R7):** primero choque (S4), luego regla de oro (S3);
  ambos rechazos emiten `AsignacionRechazada { motivo }` al outbox.
- **S4 con defensa en profundidad:** detección en aplicación (`agenda.service`) +
  `EXCLUDE USING gist` con `tstzrange(..., '[)')` en la migración 0002 (semiabierto:
  ventanas consecutivas no chocan; carrera entre requests la frena la base).

## Invariantes

| Invariante | Dónde se protege |
|---|---|
| S1 (iniciar requiere Asignación) | `Servicio.iniciar()` |
| S2 (ciclo de vida) | `Servicio.iniciar/finalizar/cancelar()` |
| S3 (regla de oro) | `AsignarServicio` + `ComplianceAcl` (spec-009) |
| S4 (no double-booking) | `AsignarServicio`/`agenda.service` + EXCLUDE (0002) |

## Verificación

```bash
npm run test:unit          # escenarios Gherkin de spec-008/009 (+ ACL real sobre Compliance)
npm run test:integration   # migración 0002: RLS + EXCLUDE contra Postgres (PGlite)
```
