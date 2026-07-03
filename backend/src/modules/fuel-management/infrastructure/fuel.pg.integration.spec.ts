/**
 * Test de INTEGRACIÓN de Fuel Management contra PostgreSQL real (vía PGlite/WASM).
 *
 * Verifica las garantías de base que un test unitario NO puede probar (spec-011):
 *   1. Aislamiento por tenant vía RLS (ADR-0008).
 *   2. Idempotencia (R5): el UNIQUE (tenant_id, client_id) evita duplicar el Tanqueo.
 *   3. Monotonía del Odómetro (P8/R8): GREATEST no deja retroceder la lectura autoritativa.
 *   4. Escritura de `CombustibleRegistrado` en `outbox` respetando el tenant (ADR-0004).
 *
 * Corre las migraciones 0001 (helper RLS + outbox + pgcrypto) y 0004 (fuel) VERBATIM,
 * bajo un rol de aplicación SIN BYPASSRLS (como en producción).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_BASE = resolve(__dirname, "../../../../migrations/0001_init_compliance.sql");
const MIG_FUEL = resolve(__dirname, "../../../../migrations/0004_init_fuel.sql");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const VEH = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const CLIENT = "dddddddd-dddd-dddd-dddd-dddddddddddd";

async function nuevaBase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(readFileSync(MIG_BASE, "utf8"));
  await db.exec(readFileSync(MIG_FUEL, "utf8"));
  await db.exec(`
    CREATE ROLE fleetspecial_app NOSUPERUSER NOBYPASSRLS;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fleetspecial_app;
  `);
  return db;
}

async function comoTenant<T>(db: PGlite, tenant: string, work: () => Promise<T>): Promise<T> {
  await db.exec("SET ROLE fleetspecial_app;");
  await db.query("SELECT set_config('app.current_tenant', $1, false)", [tenant]);
  try {
    return await work();
  } finally {
    await db.exec("RESET ROLE;");
  }
}

async function insertarTanqueo(
  db: PGlite,
  tenant: string,
  opts: { clientId: string; odometro?: number; valorCop?: number },
): Promise<void> {
  await comoTenant(db, tenant, async () => {
    await db.query(
      `INSERT INTO tanqueo (tenant_id, client_id, vehiculo_id, cantidad, unidad, valor_cop, odometro, ocurrido_en)
       VALUES ($1,$2,$3,40,'litros',$4,$5, now())
       ON CONFLICT (tenant_id, client_id) DO NOTHING`,
      [tenant, opts.clientId, VEH, opts.valorCop ?? 260000, opts.odometro ?? 152300],
    );
  });
}

/** Réplica del upsert monótono del adaptador SqlOdometroVehiculo (GREATEST). */
async function aplicarOdometro(db: PGlite, tenant: string, km: number): Promise<number> {
  return comoTenant(db, tenant, async () => {
    const r = await db.query<{ lectura: number }>(
      `INSERT INTO odometro_vehiculo (tenant_id, vehiculo_id, lectura)
       VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, vehiculo_id)
       DO UPDATE SET lectura = GREATEST(odometro_vehiculo.lectura, EXCLUDED.lectura)
       RETURNING lectura`,
      [tenant, VEH, km],
    );
    return r.rows[0].lectura;
  });
}

describe("integración Postgres — Fuel (migración 0004 + RLS + idempotencia + odómetro)", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await nuevaBase();
  });

  it("la migración 0004 crea las tablas tanqueo y odometro_vehiculo con sus políticas RLS", async () => {
    const tablas = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('tanqueo','odometro_vehiculo')",
    );
    expect(tablas.rows.map((r) => r.tablename).sort()).toEqual(["odometro_vehiculo", "tanqueo"]);
    const pol = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_policies WHERE tablename IN ('tanqueo','odometro_vehiculo')",
    );
    expect(pol.rows[0].n).toBe(2);
  });

  it("idempotencia (R5): reinsertar el mismo (tenant, client_id) NO duplica el Tanqueo", async () => {
    await insertarTanqueo(db, TENANT_A, { clientId: CLIENT });
    await insertarTanqueo(db, TENANT_A, { clientId: CLIENT }); // reintento (confirmación perdida)
    const n = await comoTenant(db, TENANT_A, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM tanqueo"),
    );
    expect(n.rows[0].n).toBe(1);
  });

  it("RLS aísla los Tanqueos por tenant (A no ve los de B)", async () => {
    await insertarTanqueo(db, TENANT_A, { clientId: CLIENT });
    await insertarTanqueo(db, TENANT_B, { clientId: CLIENT }); // mismo client_id, otro tenant: OK
    const enA = await comoTenant(db, TENANT_A, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM tanqueo"),
    );
    const enB = await comoTenant(db, TENANT_B, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM tanqueo"),
    );
    expect(enA.rows[0].n).toBe(1);
    expect(enB.rows[0].n).toBe(1);
  });

  it("el CHECK de base rechaza un valor en COP no positivo (R6)", async () => {
    await expect(insertarTanqueo(db, TENANT_A, { clientId: CLIENT, valorCop: 0 })).rejects.toThrow();
  });

  it("monotonía del Odómetro (R8): una lectura menor NO retrocede la autoritativa", async () => {
    expect(await aplicarOdometro(db, TENANT_A, 152300)).toBe(152300);
    expect(await aplicarOdometro(db, TENANT_A, 152600)).toBe(152600); // avanza
    expect(await aplicarOdometro(db, TENANT_A, 151900)).toBe(152600); // anomalía: no retrocede
  });

  it("outbox: CombustibleRegistrado se escribe con su tenant y RLS lo aísla (ADR-0004)", async () => {
    await comoTenant(db, TENANT_A, async () => {
      await db.query(
        `INSERT INTO outbox (tenant_id, tipo_evento, aggregate_id, payload)
         VALUES ($1,'CombustibleRegistrado','tanq-1','{"litros":40,"valorCop":260000}')`,
        [TENANT_A],
      );
    });
    const enA = await comoTenant(db, TENANT_A, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM outbox WHERE tipo_evento='CombustibleRegistrado'"),
    );
    const enB = await comoTenant(db, TENANT_B, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM outbox"),
    );
    expect(enA.rows[0].n).toBe(1);
    expect(enB.rows[0].n).toBe(0);
  });
});
