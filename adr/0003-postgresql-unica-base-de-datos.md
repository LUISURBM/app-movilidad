# ADR 0003 — PostgreSQL como única base de datos

- **Estado:** Aceptada
- **Fecha:** 2026-06-24
- **Decisores:** Equipo de arquitectura

## Contexto y problema

FleetSpecial maneja un dominio **altamente relacional y transaccional**: un servicio referencia un vehículo, un conductor y la vigencia de sus documentos; el cumplimiento depende de fechas de vencimiento; el combustible y el mantenimiento se ligan al odómetro de un vehículo. Necesitamos decidir la **estrategia de persistencia del backend**: ¿una sola base de datos, o varias especializadas (relacional + documental + serie temporal + cola)? ¿Y de qué tipo?

El contexto es bootstrapping con equipo de 1–3 personas, multi-tenant (varias empresas en la misma plataforma, ver [ADR-0008](0008-multi-tenant-shared-db-rls.md)), eventos asíncronos por outbox ([ADR-0004](0004-eventos-outbox-pattern-sin-broker.md)) y la necesidad de **integridad de datos fuerte** sin pagar costo operativo de una constelación de motores.

## Drivers de decisión

- **Integridad transaccional** (ACID, foreign keys) sobre un dominio muy relacional.
- **No sobreingeniería**: evitar consistencia eventual y operación de múltiples motores sin necesidad real.
- **Costo de bootstrapping**: un motor que tenga **planes gratuitos** en todos los PaaS y sea trivial de correr en Docker localmente.
- **Multi-tenancy nativo**: soporte de aislamiento a nivel de base (Row Level Security).
- **Flexibilidad puntual**: poder guardar datos semiestructurados (catálogos configurables) sin un motor aparte.
- **Portabilidad** (independencia de nube): que no ate a un proveedor.

## Opciones consideradas

1. **PostgreSQL como única DB — elegida.** Relacional ACID, con RLS nativo para multi-tenant, JSONB para datos flexibles, full-text search, y la tabla `outbox` para eventos.
2. **Políglota desde el día 1.** Postgres para relacional + MongoDB para documentos + InfluxDB/Timescale para series GPS + Redis/Kafka para colas/eventos.
3. **MySQL/MariaDB como única DB.** Relacional maduro y popular, pero sin un equivalente real a RLS y con JSON menos potente que JSONB.
4. **Event sourcing completo.** Almacenar el sistema como un log de eventos como fuente de verdad.

## Decisión

Adoptamos **PostgreSQL como la única base de datos** del backend para todo el MVP y la fase comercial temprana.

Postgres cubre, **con un solo motor**, todo lo que necesitamos hoy:

- **Núcleo relacional ACID** con foreign keys para la integridad del dominio.
- **Multi-tenant** con **Row Level Security** nativo (aislamiento por `tenant_id` aplicado en la base, ver [ADR-0008](0008-multi-tenant-shared-db-rls.md)).
- **Eventos** mediante la tabla **`outbox`** en la misma transacción que las entidades (ver [ADR-0004](0004-eventos-outbox-pattern-sin-broker.md)).
- **Datos flexibles** (catálogo de tipos de documento *configurable sin redeploy*, que pide la Fase 1) con **JSONB**.
- **Traza GPS** del MVP (captura offline, envío al reconectar) como filas normales; **no** necesitamos una base de series temporales hasta tener GPS en tiempo real (upsell V2).
- **Búsquedas** con índices e incluso full-text si hace falta.

Los **archivos** (documentos, fotos) **no** van en la DB: van a almacenamiento S3-compatible; en Postgres solo el metadato y la referencia.

## Consecuencias (positivas y negativas)

**Positivas:**

- **Integridad gratis**: foreign keys y transacciones evitan estados inconsistentes que, con múltiples DBs, habría que reconciliar a mano.
- **Operación mínima**: un motor que respaldar, monitorear, migrar y restaurar — crítico para un equipo de 1–3 personas.
- **Costo bajísimo**: plan gratuito disponible en todos los PaaS y trivial en Docker local; sin licencias.
- **Transacciones que cruzan contextos** sin sagas (encaja con el monolito modular, [ADR-0001](0001-monolito-modular-vs-microservicios.md)).
- **Portabilidad** total: Postgres corre en cualquier nube o VPS (independencia, [ADR-0006](0006-independencia-de-nube-contenedores-iac.md)).
- **Un solo mecanismo de aislamiento** (RLS) protege datos personales entre tenants (Habeas Data).

**Negativas (honestas):**

- **Punto único de presión**: toda la carga pega en una DB. *Mitigación:* índices por `tenant_id`, réplica de lectura cuando aplique, escalado vertical (barato hasta cierto punto) y, llegado el caso, mover un tenant grande a su propio esquema/DB **sin reescribir el dominio**.
- **No es el motor "óptimo" para cada caso**: una base de series temporales sería mejor para GPS de alta frecuencia, y una documental para datos muy dinámicos. *Mitigación:* JSONB cubre lo flexible hoy; el GPS de alta frecuencia es V2 y entonces se evaluará Timescale **como complemento**, no como reemplazo.
- **Riesgo de "todo a JSONB"**: abusar de columnas JSON erosiona la integridad relacional. *Mitigación:* JSONB solo para catálogos/config; el núcleo transaccional, normalizado.

## Alternativas descartadas y por qué

- **Persistencia políglota desde el día 1 — descartada.** Es **sobreingeniería** clásica: multiplica costo, operación y complejidad (consistencia eventual entre motores, más backups, más expertise) para resolver problemas de escala que **no tenemos** con 1–30 vehículos por tenant. Postgres hace todo eso "suficientemente bien" hoy.
- **MySQL/MariaDB — descartada.** Maduro y popular, pero **carece de un equivalente sólido a RLS** (clave para multi-tenant seguro, [ADR-0008](0008-multi-tenant-shared-db-rls.md)) y su soporte JSON es inferior a JSONB. Postgres gana justo en los ejes que más nos importan.
- **Event sourcing completo — descartada.** Potente para auditoría y reconstrucción de estado, pero **enorme sobrecarga de complejidad** (proyecciones, versionado de eventos, *replay*) para un MVP. La auditoría que necesitamos se cubre con una **bitácora append-only** y el outbox; el event sourcing total se mantiene fuera (explícitamente vetado en Fase 1 §5).

> **Principio que respeta:** *No sobreingeniería* y *Bootstrapping*. Una sola DB relacional da integridad y multi-tenancy seguro con costo y operación mínimos, justo lo que el README exige ("Postgres antes que 5 bases de datos").
