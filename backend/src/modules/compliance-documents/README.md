# Módulo: Compliance & Documents (CORE)

> Primer módulo implementado del monolito NestJS. Es el **núcleo (CORE)** del producto: documentos, vencimientos, **Semáforo** y alertas anticipadas — el dolor #1 validado (Fase 1). Implementado siguiendo **Clean Architecture** y **Spec Driven Development**.

## Alcance de esta entrega

Las **cuatro capas** de Clean Architecture del módulo CORE:

- **domain** — agregado, value objects, eventos, servicio de Semáforo (puro, sin framework).
- **application** — casos de uso + puertos + adaptadores en memoria.
- **interface** — DTOs (según `openapi.yaml`), mappers, controllers NestJS y wiring del módulo.
- **infrastructure** — entidades TypeORM, repos Postgres, outbox publisher y migración con **RLS** (ADR-0008). Ver [`infrastructure/README.md`](infrastructure/README.md).

**Verificado:** **43 pruebas en verde** — 36 unitarias (dominio + mappers) + **7 de integración contra PostgreSQL real** (PGlite/WASM: RLS, índice único I2, CHECK, outbox) — y typecheck TypeScript strict de todo el módulo (incluidos NestJS y TypeORM). Ver [`infrastructure/README.md`](infrastructure/README.md#verificación-de-integración-postgres-real-).

## Estructura (Clean Architecture)

```
compliance-documents/
  domain/                      # SIN dependencias de framework
    value-objects.ts           # Semaforo, Vencimiento, SujetoRef, TipoDocumento, umbrales 30/15/3
    events.ts                  # DocumentoRegistrado/PorVencer/Vencido/Renovado (= asyncapi.yaml)
    documento.aggregate.ts     # Agregado raíz: registro, renovación con histórico, evaluación
    semaforo.service.ts        # Cálculo del Semáforo (peor estado + requerido-ausente)
  application/                 # Casos de uso (orquestan dominio + puertos)
    ports.ts                   # Interfaces: DocumentoRepository, CatalogoTipos, EventPublisher
    in-memory.adapters.ts      # Implementaciones en memoria (tests/dev)
    use-cases.ts               # RegistrarDocumento, RenovarDocumento, ConsultarSemaforo, EvaluarVencimientos
  compliance.spec.ts           # 25 pruebas derivadas de spec-005/006/007 (+ multi-tenant)
  README.md
```

El **kernel compartido** (`src/shared/kernel.ts`) aporta `Result`, `DomainError`, `DateOnly`, `Clock` (inyectable para pruebas deterministas) e `IdGenerator`.

## Trazabilidad spec → implementación → prueba

| Spec | Regla clave | Dónde vive | Prueba |
|---|---|---|---|
| spec-005 | Vencimiento ≥ emisión (R4) | `Documento.registrar` | "rechaza Vencimiento anterior a la emisión" |
| spec-005 | I2: un vigente por Tipo+sujeto (R6) | `RegistrarDocumento` (`existsVigenteDelTipo`) | "rechaza un segundo Documento vigente" |
| spec-005 | Tipo debe aplicar al sujeto | `Documento.registrar` | "rechaza un Tipo que no aplica" |
| spec-006 | Estados por días (>30 / ≤30 / <0) | `Vencimiento.estadoDesde` | esquema de 7 filas (45…-10) |
| spec-006 | "vence hoy" = amarillo (R3) | `Vencimiento.estadoDesde` (dias 0) | "vence hoy exactamente está Por vencer" |
| spec-006 | Alertas 30/15/3 (R4) | `Documento.evaluar` | "emite DocumentoPorVencer(N)" |
| spec-006 | Una alerta por umbral (R5) | `Documento` (`_umbralesNotificados`) | "cada umbral notifica una sola vez" |
| spec-006 | Peor estado (R1) | `calcularSemaforo` / `peorEstado` | "el Semáforo toma el peor estado" |
| spec-006 | Requerido ausente = rojo (I3) | `calcularSemaforo` | "requerido ausente cuenta como Vencido" |
| spec-007 | Histórico inmutable + 1 vigente (I4/I2) | `Documento.renovar` | "renovación exitosa… histórico" |
| spec-007 | Renovar vencido rehabilita | `Documento.renovar` | "renovar un Documento vencido lo rehabilita" |
| ADR-0008 | Aislamiento por Tenant | claves `tenant::id` en repos | "Aislamiento multi-tenant" |

Los eventos emitidos coinciden con `backend/contracts/asyncapi.yaml`; los casos de uso son los que expondrán los endpoints de `backend/contracts/openapi.yaml`.

## Cómo ejecutar

```bash
cd backend
pnpm install          # o npm install
pnpm test             # vitest run  → 25 pruebas
pnpm typecheck        # tsc --noEmit (strict)
```

## Siguientes pasos (no incluidos aquí)

1. **Infraestructura:** implementar `DocumentoRepository`/`CatalogoTiposRepository` con TypeORM + PostgreSQL, políticas **RLS** por `tenant_id` (ADR-0008) y `EventPublisher` sobre el **outbox** transaccional (ADR-0004).
2. **Interface (REST):** controllers NestJS que cumplan `openapi.yaml` (`POST /documentos`, `POST /documentos/{id}/renovaciones`, `GET /cumplimiento/*`, `GET /cumplimiento/alertas`).
3. **Job diario:** programar `EvaluarVencimientos` como tarea diaria (reloj de dominio, spec-006 R8).
4. **Wiring NestJS:** `compliance-documents.module.ts` que inyecte los adaptadores reales.
