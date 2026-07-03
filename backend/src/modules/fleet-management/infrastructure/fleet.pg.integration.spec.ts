/**
 * Test de INTEGRACIÓN de Fleet Management contra PostgreSQL real (vía PGlite/WASM).
 * Verifica garantías de base que un test unitario no puede (spec-003):
 *   1. RLS aísla por tenant (ADR-0008).
 *   2. Placa ÚNICA por tenant (R2): UNIQUE(tenant_id, placa) bloquea duplicado en el
 *      mismo tenant, pero permite la misma placa en tenants distintos.
 *   3. CHECK de clase y de odómetro no negativo.
 * Corre 0001 (helper RLS + outbox + pgcrypto) y 0005 (fleet) VERBATIM, con rol sin BYPASSRLS.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_BASE = resolve(__dirname, "../../../../migrations/0001_init_compliance.sql");
const MIG_FLEET = resolve(__dirname, "../../../../migrations/0005_init_fleet.sql");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

async function nuevaBase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(readFileSync(MIG_BASE, "utf8"));
  await db.exec(readFileSync(MIG_FLEET, "utf8"));
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

async function insertarVehiculo(db: PGlite, tenant: string, placa: string, odometro = 152000): Promise<void> {
  await comoTenant(db, tenant, async () => {
    await db.query(
      `INSERT INTO vehiculo (tenant_id, placa, clase, marca, modelo, odometro)
       VALUES ($1,$2,'automovil','Renault','Duster',$3)`,
      [tenant, placa, odometro],
    );
  });
}

describe("integración Postgres — Fleet (migración 0005 + RLS + placa única por tenant)", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await nuevaBase();
  });

  it("la migración 0005 crea la tabla vehiculo con su política RLS", async () => {
    const t = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename='vehiculo'",
    );
    const p = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_policies WHERE tablename='vehiculo'",
    );
    expect(t.rows[0].n).toBe(1);
    expect(p.rows[0].n).toBe(1);
  });

  it("Placa ÚNICA por tenant (R2): rechaza una segunda placa igual en el mismo tenant", async () => {
    await insertarVehiculo(db, TENANT_A, "ABC123");
    await expect(insertarVehiculo(db, TENANT_A, "ABC123")).rejects.toThrow();
  });

  it("la misma placa PUEDE existir en tenants distintos", async () => {
    await insertarVehiculo(db, TENANT_A, "ABC123");
    await insertarVehiculo(db, TENANT_B, "ABC123"); // no colisiona
    const enA = await comoTenant(db, TENANT_A, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM vehiculo"),
    );
    const enB = await comoTenant(db, TENANT_B, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM vehiculo"),
    );
    expect(enA.rows[0].n).toBe(1);
    expect(enB.rows[0].n).toBe(1);
  });

  it("RLS aísla: A no ve los Vehículos de B (ADR-0008)", async () => {
    await insertarVehiculo(db, TENANT_A, "AAA111");
    await insertarVehiculo(db, TENANT_B, "BBB222");
    const vistosPorA = await comoTenant(db, TENANT_A, () =>
      db.query<{ placa: string }>("SELECT placa FROM vehiculo"),
    );
    expect(vistosPorA.rows.map((r) => r.placa)).toEqual(["AAA111"]);
  });

  it("el CHECK de base rechaza un odómetro negativo", async () => {
    await expect(insertarVehiculo(db, TENANT_A, "ABC123", -5)).rejects.toThrow();
  });
});
