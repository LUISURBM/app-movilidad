/**
 * Test de INTEGRACIÓN contra PostgreSQL real (PGlite) para la migración 0003
 * (sincronización offline, spec-010):
 *   1. `servicio.version` existe con default 1 (control optimista R9).
 *   2. `idempotencia`: la PK (tenant, client_id) deduplica físicamente (R8) y
 *      ON CONFLICT DO NOTHING es inocuo en reintentos concurrentes.
 *   3. RLS aísla `idempotencia` y `bitacora_sync` por tenant (ADR-0008).
 *
 * Corre las migraciones 0001 + 0002 + 0003 VERBATIM.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRACIONES = ["0001_init_compliance.sql", "0002_init_scheduling.sql", "0003_sync_offline.sql"].map(
  (m) => resolve(__dirname, "../../../../migrations", m),
);

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const CLIENT_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

async function nuevaBase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
  for (const m of MIGRACIONES) await db.exec(readFileSync(m, "utf8"));
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

describe("integración Postgres — migración 0003: version + idempotencia + bitácora", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await nuevaBase();
  });

  it("servicio.version existe con default 1", async () => {
    await comoTenant(db, TENANT_A, async () => {
      await db.query(
        `INSERT INTO servicio (tenant_id, origen, destino, ventana_inicio, ventana_fin)
         VALUES ($1,'Bogotá','Tunja','2026-07-01T08:00:00Z','2026-07-01T11:00:00Z')`,
        [TENANT_A],
      );
    });
    const r = await comoTenant(db, TENANT_A, () =>
      db.query<{ version: number }>("SELECT version FROM servicio LIMIT 1"),
    );
    expect(r.rows[0].version).toBe(1);
  });

  it("idempotencia: la PK deduplica y ON CONFLICT DO NOTHING es inocuo (R8)", async () => {
    const insertar = () =>
      comoTenant(db, TENANT_A, async () => {
        await db.query(
          `INSERT INTO idempotencia (tenant_id, client_id, respuesta)
           VALUES ($1, $2, '{"estado":"Iniciado","version":3}')
           ON CONFLICT (tenant_id, client_id) DO NOTHING`,
          [TENANT_A, CLIENT_ID],
        );
      });
    await insertar();
    await insertar(); // reintento concurrente simulado: no falla, no duplica
    const n = await comoTenant(db, TENANT_A, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM idempotencia"),
    );
    expect(n.rows[0].n).toBe(1);

    // Sin ON CONFLICT, el duplicado directo viola la PK (dedupe físico).
    await expect(
      comoTenant(db, TENANT_A, () =>
        db.query(`INSERT INTO idempotencia (tenant_id, client_id, respuesta) VALUES ($1,$2,'{}')`, [
          TENANT_A,
          CLIENT_ID,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("el MISMO clientId en tenants distintos NO colisiona (aislamiento del dedupe)", async () => {
    for (const t of [TENANT_A, TENANT_B]) {
      await comoTenant(db, t, async () => {
        await db.query(
          `INSERT INTO idempotencia (tenant_id, client_id, respuesta) VALUES ($1, $2, '{}')`,
          [t, CLIENT_ID],
        );
      });
    }
    const n = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM idempotencia");
    expect(n.rows[0].n).toBe(2);
  });

  it("RLS: un tenant no ve la idempotencia ni la bitácora del otro (ADR-0008)", async () => {
    await comoTenant(db, TENANT_A, async () => {
      await db.query(`INSERT INTO idempotencia (tenant_id, client_id, respuesta) VALUES ($1,$2,'{}')`, [
        TENANT_A,
        CLIENT_ID,
      ]);
      await db.query(
        `INSERT INTO bitacora_sync (tenant_id, servicio_id, usuario_id, detalle)
         VALUES ($1, gen_random_uuid(), 'admin', 'intento de reabrir rechazado')`,
        [TENANT_A],
      );
    });
    const enB = await comoTenant(db, TENANT_B, async () => ({
      idem: (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM idempotencia")).rows[0].n,
      bitacora: (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM bitacora_sync")).rows[0].n,
    }));
    expect(enB.idem).toBe(0);
    expect(enB.bitacora).toBe(0);
  });
});
