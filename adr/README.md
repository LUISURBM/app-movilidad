# Architecture Decision Records (ADR) — FleetSpecial

> Registro de las **decisiones de arquitectura** transversales del blueprint. Acompaña a la [Fase 5 — Arquitectura Técnica](../docs/05-arquitectura-tecnica.md).

## ¿Qué es un ADR?

Un **Architecture Decision Record** es un documento corto e inmutable que captura **una** decisión de arquitectura significativa: el **contexto** en que se tomó, las **opciones** evaluadas, la **decisión** y sus **consecuencias** (buenas y malas). El objetivo no es documentar todo, sino dejar **memoria del porqué**: dentro de un año, cuando alguien (humano o agente IA) pregunte "¿por qué un monolito y no microservicios?", la respuesta está aquí, con el contexto de la época.

Principios de un buen ADR:

- **Inmutable.** Un ADR no se edita para cambiar la decisión; si la decisión cambia, se escribe un **nuevo** ADR que *supersede* al anterior y se marca el viejo como `Reemplazada por NNNN`.
- **Una decisión por ADR.** Granular y enlazable.
- **Honesto.** Documenta los trade-offs y lo que se sacrifica, no solo las ventajas.
- **Conectado al negocio.** Cada decisión se ata a un **principio rector** (bootstrapping, independencia, no sobreingeniería, etc.).

## Formato

Usamos una variante de **MADR** (Markdown Architecture Decision Records) combinada con el formato clásico de **Michael Nygard**. Cada ADR sigue exactamente esta estructura:

```text
# ADR NNNN — Título
- Estado: Propuesta | Aceptada | Reemplazada por NNNN | Obsoleta
- Fecha: AAAA-MM-DD
- Decisores: ...
## Contexto y problema
## Drivers de decisión
## Opciones consideradas
## Decisión
## Consecuencias (positivas y negativas)
## Alternativas descartadas y por qué
```

**Estados posibles:**

| Estado | Significado |
|---|---|
| **Propuesta** | En discusión, aún no adoptada. |
| **Aceptada** | Decisión vigente y en efecto. |
| **Reemplazada por NNNN** | Superada por un ADR posterior. |
| **Obsoleta** | Ya no aplica (la necesidad desapareció). |

## Índice de ADRs

| # | Decisión | Estado | Principio rector | Fase relacionada |
|---|---|---|---|---|
| [0001](0001-monolito-modular-vs-microservicios.md) | **Monolito modular** en vez de microservicios | Aceptada | No sobreingeniería · DDD | [Fase 5](../docs/05-arquitectura-tecnica.md) |
| [0002](0002-stack-backend.md) | **Backend en NestJS/TypeScript** | Aceptada | Time-to-market · Independencia de framework | [Fase 5](../docs/05-arquitectura-tecnica.md) |
| [0003](0003-postgresql-unica-base-de-datos.md) | **PostgreSQL como única base de datos** | Aceptada | No sobreingeniería · Bootstrapping | [Fase 5](../docs/05-arquitectura-tecnica.md) · [Fase 7](../docs/07-saas-multitenant.md) |
| [0004](0004-eventos-outbox-pattern-sin-broker.md) | **Eventos asíncronos vía outbox pattern** (sin broker) | Aceptada | No sobreingeniería · Cloud Native | [Fase 5](../docs/05-arquitectura-tecnica.md) |
| [0005](0005-offline-first-sqlite-sync.md) | **Offline-first con SQLite (Drift) + sync** | Aceptada | Offline First | [Fase 6](../docs/06-offline-first.md) |
| [0006](0006-independencia-de-nube-contenedores-iac.md) | **Independencia de nube vía contenedores + IaC** | Aceptada | Cloud Native · Independencia de nube | [Fase 5](../docs/05-arquitectura-tecnica.md) |
| [0007](0007-independencia-de-proveedor-ia-capa-abstraccion.md) | **Independencia de proveedor de IA** (capa de abstracción) | Aceptada | AI Agent Friendly · Independencia de IA | [Fase 8](../agents/README.md) |
| [0008](0008-multi-tenant-shared-db-rls.md) | **Multi-tenant: shared DB + tenant_id + RLS** | Aceptada | Bootstrapping · Cumplimiento | [Fase 7](../docs/07-saas-multitenant.md) |
| [0009](0009-gestor-paquetes-pnpm.md) | **pnpm como gestor de paquetes del monorepo** | Aceptada | Bootstrapping · No sobreingeniería · Cumplimiento | [Fase 9](../docs/09-estructura-repositorio.md) |

## Cómo añadir un ADR

1. Copia el formato de arriba en `NNNN-titulo-en-kebab-case.md` (número correlativo).
2. Rellena todas las secciones; sé honesto en consecuencias y alternativas.
3. Conéctalo a un principio rector y a la fase relevante.
4. Añádelo a la tabla de este índice.
5. Si supersede a otro, marca el anterior como `Reemplazada por NNNN`.
