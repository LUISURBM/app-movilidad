/**
 * Test de INTEGRACIÓN de Maintenance contra PostgreSQL real (vía PGlite/WASM). spec-012:
 *   1. RLS aísla por tenant (ADR-0008).
 *   2. Un Umbral por (tenant, vehículo) — UNIQUE.
 *   3. CHECK: debe definirse por km o por fecha (R1).
 * Corre 0001 (helper RLS + outbox + pgcrypto) y 0009 (maintenance) VERBATIM, rol sin BYPASSRLS.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_BASE = resolve(__dirname, "../../../../migrations/0001_init_compliance.sql");
const MIG_MNT = resolve(__dirname, "../../../../migrations/0009_init_maintenance.sql");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const VEH = "cccccccc-cccc-cccc-cccc-cccccccccccc";

async function nuevaBase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(readFileSync(MIG_BASE, "utf8"));
  await db.exec(readFileSync(MIG_MNT, "utf8"));
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

async function definirUmbral(db: PGlite, tenant: string, vehiculo: string, cadaKm: number): Promise<void> {
  await comoTenant(db, tenant, async () => {
    await db.query(
      `INSERT INTO umbral_mantenimiento (tenant_id, vehiculo_id, cada_km, base_km)
       VALUES ($1,$2,$3::int,140000)`,
      [tenant, vehiculo, cadaKm],
    );
  });
}

describe("integración Postgres — Maintenance (migración 0009 + RLS + unicidad)", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await nuevaBase();
  });

  it("la migración 0009 crea umbral_mantenimiento con su política RLS", async () => {
    const t = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename='umbral_mantenimiento'",
    );
    const p = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_policies WHERE tablename='umbral_mantenimiento'");
    expect(t.rows[0].n).toBe(1);
    expect(p.rows[0].n).toBe(1);
  });

  it("un Umbral por (tenant, vehículo): rechaza duplicado", async () => {
    await definirUmbral(db, TENANT_A, VEH, 10000);
    await expect(definirUmbral(db, TENANT_A, VEH, 10000)).rejects.toThrow();
  });

  it("RLS aísla: A no ve los Umbrales de B", async () => {
    await definirUmbral(db, TENANT_A, VEH, 10000);
    await definirUmbral(db, TENANT_B, VEH, 10000);
    const enA = await comoTenant(db, TENANT_A, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM umbral_mantenimiento"),
    );
    expect(enA.rows[0].n).toBe(1);
  });

  it("el CHECK exige criterio por km o por fecha (R1)", async () => {
    await expect(
      comoTenant(db, TENANT_A, async () => {
        await db.query(
          `INSERT INTO umbral_mantenimiento (tenant_id, vehiculo_id, base_km) VALUES ($1,$2,0)`,
          [TENANT_A, VEH],
        );
      }),
    ).rejects.toThrow();
  });
});
