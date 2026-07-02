/**
 * Test de INTEGRACIÓN contra PostgreSQL real (vía PGlite, Postgres compilado a WASM).
 *
 * Verifica las garantías de la capa de base que ADR-0008 / ADR-0004 prometen y que un
 * test unitario NO puede probar:
 *   1. Aislamiento por tenant vía Row Level Security (un tenant no ve datos de otro).
 *   2. La invariante I2 (un único Documento vigente por tenant+sujeto+tipo) impuesta por
 *      el índice único parcial de la migración.
 *   3. Escritura en la tabla `outbox` respetando el tenant (ADR-0004).
 *
 * Corre la migración `0001_init_compliance.sql` VERBATIM (incluye pgcrypto).
 * El aislamiento RLS se prueba bajo un rol de aplicación SIN BYPASSRLS (como en prod).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(__dirname, "../../../../migrations/0001_init_compliance.sql");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const SUJETO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

async function nuevaBase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  // Migración de producción, sin modificar.
  await db.exec(readFileSync(MIGRATION, "utf8"));
  // Rol de aplicación como en producción: SIN superuser, SIN bypassrls.
  await db.exec(`
    CREATE ROLE fleetspecial_app NOSUPERUSER NOBYPASSRLS;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fleetspecial_app;
  `);
  return db;
}

/** Ejecuta trabajo bajo el rol de app y con el tenant fijado (SET LOCAL vía set_config). */
async function comoTenant<T>(
  db: PGlite,
  tenant: string,
  work: () => Promise<T>,
): Promise<T> {
  await db.exec("SET ROLE fleetspecial_app;");
  await db.query("SELECT set_config('app.current_tenant', $1, false)", [tenant]);
  try {
    return await work();
  } finally {
    await db.exec("RESET ROLE;");
  }
}

async function insertarDocumento(
  db: PGlite,
  tenant: string,
  opts: { tipo: string; venc: string; vigente?: boolean },
): Promise<void> {
  await comoTenant(db, tenant, async () => {
    await db.query(
      `INSERT INTO documento (tenant_id, sujeto_tipo, sujeto_id, tipo_codigo, emision, vencimiento, vigente)
       VALUES ($1,'vehiculo',$2,$3,'2020-01-01',$4,$5)`,
      [tenant, SUJETO, opts.tipo, opts.venc, opts.vigente ?? true],
    );
  });
}

describe("integración Postgres — migración + RLS + I2 + outbox", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await nuevaBase();
  });

  it("la migración crea 3 tablas y 3 políticas RLS", async () => {
    const t = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'",
    );
    const p = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public'",
    );
    expect(t.rows[0].n).toBe(3); // tipo_documento, documento, outbox
    expect(p.rows[0].n).toBe(3);
  });

  it("RLS aísla por tenant: A no ve los Documentos de B (ADR-0008)", async () => {
    await insertarDocumento(db, TENANT_A, { tipo: "SOAT", venc: "2027-01-01" });
    await insertarDocumento(db, TENANT_B, { tipo: "SOAT", venc: "2027-01-01" });

    const vistosPorA = await comoTenant(db, TENANT_A, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM documento"),
    );
    const vistosPorB = await comoTenant(db, TENANT_B, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM documento"),
    );
    expect(vistosPorA.rows[0].n).toBe(1);
    expect(vistosPorB.rows[0].n).toBe(1);
  });

  it("RLS impide INSERTar en nombre de otro tenant (WITH CHECK)", async () => {
    await expect(
      comoTenant(db, TENANT_A, async () => {
        // current_tenant = A, pero intento escribir una fila de B → viola WITH CHECK.
        await db.query(
          `INSERT INTO documento (tenant_id, sujeto_tipo, sujeto_id, tipo_codigo, emision, vencimiento)
           VALUES ($1,'vehiculo',$2,'SOAT','2020-01-01','2027-01-01')`,
          [TENANT_B, SUJETO],
        );
      }),
    ).rejects.toThrow();
  });

  it("Invariante I2: el índice único parcial bloquea un segundo Documento vigente del mismo tipo+sujeto", async () => {
    await insertarDocumento(db, TENANT_A, { tipo: "SOAT", venc: "2027-01-01", vigente: true });
    await expect(
      insertarDocumento(db, TENANT_A, { tipo: "SOAT", venc: "2028-01-01", vigente: true }),
    ).rejects.toThrow();
  });

  it("I2 permite coexistir uno vigente + históricos no vigentes del mismo tipo", async () => {
    await insertarDocumento(db, TENANT_A, { tipo: "SOAT", venc: "2025-01-01", vigente: false });
    await insertarDocumento(db, TENANT_A, { tipo: "SOAT", venc: "2026-01-01", vigente: false });
    await insertarDocumento(db, TENANT_A, { tipo: "SOAT", venc: "2027-01-01", vigente: true });
    const n = await comoTenant(db, TENANT_A, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM documento"),
    );
    expect(n.rows[0].n).toBe(3);
  });

  it("el CHECK de base rechaza vencimiento anterior a emisión (spec-005 R4)", async () => {
    await expect(
      comoTenant(db, TENANT_A, async () => {
        await db.query(
          `INSERT INTO documento (tenant_id, sujeto_tipo, sujeto_id, tipo_codigo, emision, vencimiento)
           VALUES ($1,'vehiculo',$2,'SOAT','2027-01-01','2020-01-01')`,
          [TENANT_A, SUJETO],
        );
      }),
    ).rejects.toThrow();
  });

  it("outbox: los eventos se escriben con su tenant y solo son visibles para ese tenant", async () => {
    await comoTenant(db, TENANT_A, async () => {
      await db.query(
        `INSERT INTO outbox (tenant_id, tipo_evento, aggregate_id, payload)
         VALUES ($1,'DocumentoRegistrado','doc-1','{"x":1}')`,
        [TENANT_A],
      );
    });
    const enA = await comoTenant(db, TENANT_A, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM outbox WHERE estado='pendiente'"),
    );
    const enB = await comoTenant(db, TENANT_B, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM outbox"),
    );
    expect(enA.rows[0].n).toBe(1);
    expect(enB.rows[0].n).toBe(0); // RLS: B no ve el outbox de A
  });
});
