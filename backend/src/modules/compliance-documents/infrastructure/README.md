# Infraestructura — Compliance & Documents

Implementación **real** de los puertos del módulo con PostgreSQL, respetando ADR-0008 (multi-tenant + RLS) y ADR-0004 (outbox). El dominio y la aplicación **no cambian**: solo se sustituyen los adaptadores (inversión de dependencias).

## Piezas

| Archivo | Rol |
|---|---|
| `entities.ts` | Entidades TypeORM (`documento`, `tipo_documento`, `outbox`). Detalle de persistencia; el dominio no las conoce. |
| `typeorm.repositories.ts` | `TypeOrmDocumentoRepository` y `TypeOrmCatalogoTiposRepository`: traducen entidad ⇄ agregado. |
| `outbox.publisher.ts` | `OutboxEventPublisher`: escribe los eventos de dominio en la tabla `outbox` (misma transacción que el cambio). |
| `tenant-datasource.ts` | `runInTenant()`: abre transacción y hace `SET LOCAL app.current_tenant` → activa RLS. |
| `../../../../migrations/0001_init_compliance.sql` | Esquema + índices + **políticas RLS** (deny-by-default por tenant). |

## Aislamiento por tenant (ADR-0008) — cómo funciona

Defensa en profundidad, dos capas:

1. **Código:** cada repo filtra por `tenant_id`.
2. **Base (RLS):** aunque el código olvide filtrar, las políticas de la migración solo dejan ver/escribir filas donde `tenant_id = app_current_tenant()`. El valor se fija por transacción con `runInTenant()`; `SET LOCAL` expira al terminar la transacción, evitando fugas entre requests que reusan conexión.

**Requisito operativo:** la app debe conectarse con un rol **sin** `BYPASSRLS` ni superusuario (ver notas al pie de la migración).

## Invariante I2 a nivel de base

Además de la validación en el caso de uso, la migración crea un **índice único parcial**:

```sql
CREATE UNIQUE INDEX uq_documento_vigente
  ON documento (tenant_id, sujeto_tipo, sujeto_id, tipo_codigo)
  WHERE vigente = true;
```

→ imposible tener dos Documentos vigentes del mismo Tipo para el mismo sujeto, aun ante carreras de concurrencia.

## Wiring de producción (reemplaza los adaptadores en memoria)

En `compliance-documents.module.ts`, sustituir los providers de puertos por:

```ts
{ provide: DOCUMENTO_REPOSITORY, inject: [DataSource], useFactory: (ds) => new TypeOrmDocumentoRepository(ds) },
{ provide: CATALOGO_TIPOS_REPOSITORY, inject: [DataSource], useFactory: (ds) => new TypeOrmCatalogoTiposRepository(ds) },
{ provide: EVENT_PUBLISHER, inject: [DataSource], useFactory: (ds) => new OutboxEventPublisher(ds) },
```

Y envolver la ejecución de cada caso de uso en `runInTenant(dataSource, tenant, ...)` (o hacerlo en un interceptor por request que fije el tenant del JWT). Los casos de uso y los controllers **no se tocan**.

## Aplicar la migración

```bash
psql "$DATABASE_URL" -f backend/migrations/0001_init_compliance.sql
```

## Verificación de integración (Postgres real) ✅

`compliance.pg.integration.spec.ts` corre contra **PostgreSQL real** usando **PGlite** (Postgres 16 compilado a WASM, con la extensión `pgcrypto`) — sin Docker ni servicio externo. Aplica la migración **verbatim** y prueba, bajo un rol de aplicación **sin `BYPASSRLS`** (como en producción):

- ✅ la migración crea las 3 tablas y 3 políticas RLS;
- ✅ **RLS aísla por tenant** en lectura (un tenant no ve datos de otro) y en escritura (`WITH CHECK` impide insertar en nombre de otro tenant);
- ✅ el **índice único parcial** hace cumplir la invariante **I2** (bloquea un segundo Documento vigente del mismo tipo+sujeto) y permite coexistir históricos no vigentes;
- ✅ el **CHECK** de base rechaza `vencimiento < emision` (spec-005 R4);
- ✅ la tabla **`outbox`** se escribe con su tenant y solo es visible para ese tenant (ADR-0004).

```bash
cd backend
pnpm install
pnpm test              # unit + integración (43 pruebas)
pnpm test:integration  # solo la integración Postgres
```

> **Por qué PGlite:** el sandbox no tiene Docker; PGlite es el **motor Postgres real** en WASM, así que prueba semántica auténtica de RLS/índices/constraints. En CI puede sustituirse por Postgres en contenedor o Testcontainers usando el **mismo** archivo de migración y las mismas aserciones.

## Siguiente paso

Test de integración que ejercite además los **repos TypeORM** (no solo SQL) contra Postgres, y el **worker del outbox** (marca `publicado`, reintentos con backoff).
