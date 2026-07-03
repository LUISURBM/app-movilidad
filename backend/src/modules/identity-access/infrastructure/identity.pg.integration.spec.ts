/**
 * Test de INTEGRACIÓN de Identity & Access contra PostgreSQL real (vía PGlite/WASM).
 * Verifica garantías de base (spec-001 / spec-002):
 *   1. tenant: correo de registro ÚNICO global (R7).
 *   2. usuario: RLS aísla por tenant (ADR-0008).
 *   3. usuario: índice único parcial (tenant, correo) WHERE vigente — permite re-invitar
 *      tras remover/expirar.
 * Corre 0001 (helper RLS + outbox + pgcrypto) y 0007 (identity) VERBATIM, rol sin BYPASSRLS.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_BASE = resolve(__dirname, "../../../../migrations/0001_init_compliance.sql");
const MIG_ID = resolve(__dirname, "../../../../migrations/0007_init_identity.sql");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

async function nuevaBase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(readFileSync(MIG_BASE, "utf8"));
  await db.exec(readFileSync(MIG_ID, "utf8"));
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

async function crearTenant(db: PGlite, id: string, correo: string): Promise<void> {
  await db.query(
    `INSERT INTO tenant (id, razon_social, correo_registro, consentimiento_version, consentimiento_en, consentimiento_titular)
     VALUES ($1,'Empresa',$2,'v1.0', now(), $2)`,
    [id, correo],
  );
}

async function insertarUsuario(db: PGlite, tenant: string, correo: string, estado = "activo"): Promise<void> {
  await comoTenant(db, tenant, async () => {
    await db.query(
      `INSERT INTO usuario (tenant_id, nombre, correo, roles, estado)
       VALUES ($1,'X',$2, ARRAY['Operador'], $3)`,
      [tenant, correo, estado],
    );
  });
}

describe("integración Postgres — Identity (migración 0007 + RLS + unicidades)", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await nuevaBase();
  });

  it("la migración 0007 crea tenant + usuario y la política RLS de usuario", async () => {
    const t = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('tenant','usuario')",
    );
    expect(t.rows.map((r) => r.tablename).sort()).toEqual(["tenant", "usuario"]);
    const p = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_policies WHERE tablename='usuario'");
    expect(p.rows[0].n).toBe(1);
  });

  it("tenant: correo de registro ÚNICO global (R7)", async () => {
    await crearTenant(db, TENANT_A, "dup@x.co");
    await expect(crearTenant(db, TENANT_B, "dup@x.co")).rejects.toThrow();
  });

  it("usuario: RLS aísla por tenant (A no ve los de B)", async () => {
    await crearTenant(db, TENANT_A, "a@x.co");
    await crearTenant(db, TENANT_B, "b@x.co");
    await insertarUsuario(db, TENANT_A, "op-a@x.co");
    await insertarUsuario(db, TENANT_B, "op-b@x.co");
    const vistosPorA = await comoTenant(db, TENANT_A, () =>
      db.query<{ correo: string }>("SELECT correo FROM usuario"),
    );
    expect(vistosPorA.rows.map((r) => r.correo)).toEqual(["op-a@x.co"]);
  });

  it("usuario: único parcial por (tenant, correo) vigente; re-invitar tras remover funciona", async () => {
    await crearTenant(db, TENANT_A, "a@x.co");
    await insertarUsuario(db, TENANT_A, "op@x.co", "activo");
    // Segundo vigente con el mismo correo → rechazado.
    await expect(insertarUsuario(db, TENANT_A, "op@x.co", "invitado")).rejects.toThrow();
    // Tras marcar removido el primero, se puede volver a invitar el mismo correo.
    await comoTenant(db, TENANT_A, async () => {
      await db.query(`UPDATE usuario SET estado='removido' WHERE tenant_id=$1 AND correo='op@x.co'`, [TENANT_A]);
    });
    await insertarUsuario(db, TENANT_A, "op@x.co", "invitado"); // ahora sí
    const n = await comoTenant(db, TENANT_A, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM usuario WHERE correo='op@x.co'"),
    );
    expect(n.rows[0].n).toBe(2);
  });
});
