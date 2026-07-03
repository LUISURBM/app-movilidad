/**
 * Test de INTEGRACIÓN de Driver Management contra PostgreSQL real (vía PGlite/WASM).
 * Verifica garantías de base (spec-004):
 *   1. RLS aísla por tenant (ADR-0008).
 *   2. Documento de identidad ÚNICO por tenant (R9): UNIQUE(tenant_id, documento).
 *   3. La misma cédula puede existir en tenants distintos.
 * Corre 0001 (helper RLS + outbox + pgcrypto) y 0006 (driver) VERBATIM, rol sin BYPASSRLS.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_BASE = resolve(__dirname, "../../../../migrations/0001_init_compliance.sql");
const MIG_DRIVER = resolve(__dirname, "../../../../migrations/0006_init_driver.sql");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

async function nuevaBase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(readFileSync(MIG_BASE, "utf8"));
  await db.exec(readFileSync(MIG_DRIVER, "utf8"));
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

async function insertarConductor(db: PGlite, tenant: string, documento: string): Promise<void> {
  await comoTenant(db, tenant, async () => {
    await db.query(
      `INSERT INTO conductor (tenant_id, nombre, documento, licencia_numero, licencia_categoria, licencia_vencimiento)
       VALUES ($1,'Juan Pérez',$2,'LIC-001','C1','2027-03-15')`,
      [tenant, documento],
    );
  });
}

describe("integración Postgres — Driver (migración 0006 + RLS + documento único por tenant)", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await nuevaBase();
  });

  it("la migración 0006 crea la tabla conductor con su política RLS", async () => {
    const t = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename='conductor'",
    );
    const p = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_policies WHERE tablename='conductor'",
    );
    expect(t.rows[0].n).toBe(1);
    expect(p.rows[0].n).toBe(1);
  });

  it("Documento ÚNICO por tenant (R9): rechaza una segunda cédula igual en el mismo tenant", async () => {
    await insertarConductor(db, TENANT_A, "1098765432");
    await expect(insertarConductor(db, TENANT_A, "1098765432")).rejects.toThrow();
  });

  it("la misma cédula PUEDE existir en tenants distintos", async () => {
    await insertarConductor(db, TENANT_A, "1098765432");
    await insertarConductor(db, TENANT_B, "1098765432");
    const enA = await comoTenant(db, TENANT_A, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM conductor"),
    );
    const enB = await comoTenant(db, TENANT_B, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM conductor"),
    );
    expect(enA.rows[0].n).toBe(1);
    expect(enB.rows[0].n).toBe(1);
  });

  it("RLS aísla: A no ve los Conductores de B (ADR-0008)", async () => {
    await insertarConductor(db, TENANT_A, "111");
    await insertarConductor(db, TENANT_B, "222");
    const vistosPorA = await comoTenant(db, TENANT_A, () =>
      db.query<{ documento: string }>("SELECT documento FROM conductor"),
    );
    expect(vistosPorA.rows.map((r) => r.documento)).toEqual(["111"]);
  });
});
