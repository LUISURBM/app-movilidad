/**
 * Test de INTEGRACIÓN contra PostgreSQL real (vía PGlite) para la migración 0002.
 *
 * Verifica las garantías de base que el unit test NO puede probar:
 *   1. RLS aísla los Servicios por tenant (ADR-0008).
 *   2. Invariante S4 física: EXCLUDE USING gist impide solapar Asignaciones ACTIVAS
 *      del mismo Vehículo/Conductor, con semántica SEMIABIERTA `[inicio, fin)`.
 *   3. Los estados terminales (Cancelado/Finalizado) LIBERAN la agenda.
 *   4. CHECKs: ventana válida y asignación completa (vehículo y conductor juntos).
 *
 * Corre las migraciones 0001 (helper RLS + outbox) y 0002 VERBATIM.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_0001 = resolve(__dirname, "../../../../migrations/0001_init_compliance.sql");
const MIGRATION_0002 = resolve(__dirname, "../../../../migrations/0002_init_scheduling.sql");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const VEHICULO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CONDUCTOR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OTRO_VEHICULO = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const OTRO_CONDUCTOR = "dddddddd-dddd-dddd-dddd-dddddddddddd";

async function nuevaBase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
  await db.exec(readFileSync(MIGRATION_0001, "utf8"));
  await db.exec(readFileSync(MIGRATION_0002, "utf8"));
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

/** Inserta un Servicio con Asignación; horas del 2026-07-01 en UTC. */
async function insertarServicio(
  db: PGlite,
  tenant: string,
  opts: {
    desde: number;
    hasta: number;
    vehiculo?: string | null;
    conductor?: string | null;
    estado?: string;
  },
): Promise<void> {
  const h = (n: number) => `2026-07-01T${String(n).padStart(2, "0")}:00:00Z`;
  await comoTenant(db, tenant, async () => {
    await db.query(
      `INSERT INTO servicio (tenant_id, origen, destino, ventana_inicio, ventana_fin, vehiculo_id, conductor_id, estado)
       VALUES ($1,'Bogotá','Tunja',$2,$3,$4,$5,$6)`,
      [
        tenant,
        h(opts.desde),
        h(opts.hasta),
        opts.vehiculo === undefined ? VEHICULO : opts.vehiculo,
        opts.conductor === undefined ? CONDUCTOR : opts.conductor,
        opts.estado ?? "Planificado",
      ],
    );
  });
}

describe("integración Postgres — migración 0002: RLS + EXCLUDE (S4) + CHECKs", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await nuevaBase();
  });

  it("la migración crea la tabla servicio con su política RLS", async () => {
    const t = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename='servicio'",
    );
    const p = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_policies WHERE tablename='servicio'",
    );
    expect(t.rows[0].n).toBe(1);
    expect(p.rows[0].n).toBe(1);
  });

  it("RLS aísla por tenant: A no ve los Servicios de B (ADR-0008)", async () => {
    await insertarServicio(db, TENANT_A, { desde: 8, hasta: 11 });
    await insertarServicio(db, TENANT_B, { desde: 8, hasta: 11 });
    const enA = await comoTenant(db, TENANT_A, () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM servicio"),
    );
    expect(enA.rows[0].n).toBe(1);
  });

  it("S4 física: dos Asignaciones ACTIVAS solapadas del mismo VEHÍCULO son imposibles", async () => {
    await insertarServicio(db, TENANT_A, { desde: 8, hasta: 11 });
    await expect(
      insertarServicio(db, TENANT_A, { desde: 10, hasta: 12, conductor: OTRO_CONDUCTOR }),
    ).rejects.toThrow(/excl_vehiculo_sin_solape/);
  });

  it("S4 física: dos Asignaciones ACTIVAS solapadas del mismo CONDUCTOR son imposibles", async () => {
    await insertarServicio(db, TENANT_A, { desde: 8, hasta: 11 });
    await expect(
      insertarServicio(db, TENANT_A, { desde: 9, hasta: 10, vehiculo: OTRO_VEHICULO }),
    ).rejects.toThrow(/excl_conductor_sin_solape/);
  });

  it("ventanas CONSECUTIVAS no chocan: la semántica es semiabierta `[inicio, fin)` (R5)", async () => {
    await insertarServicio(db, TENANT_A, { desde: 8, hasta: 10 });
    await expect(
      insertarServicio(db, TENANT_A, { desde: 10, hasta: 12 }),
    ).resolves.toBeUndefined();
  });

  it("recursos de Empresas DISTINTAS nunca chocan entre sí (R12)", async () => {
    await insertarServicio(db, TENANT_A, { desde: 8, hasta: 11 });
    await expect(
      insertarServicio(db, TENANT_B, { desde: 9, hasta: 10 }),
    ).resolves.toBeUndefined();
  });

  it("un Servicio CANCELADO libera la agenda (el EXCLUDE solo aplica a activos)", async () => {
    await insertarServicio(db, TENANT_A, { desde: 8, hasta: 11, estado: "Cancelado" });
    await expect(
      insertarServicio(db, TENANT_A, { desde: 9, hasta: 10 }),
    ).resolves.toBeUndefined();
  });

  it("CHECK: rechaza una ventana inválida (fin <= inicio)", async () => {
    await expect(
      insertarServicio(db, TENANT_A, { desde: 11, hasta: 8 }),
    ).rejects.toThrow(/chk_ventana_valida/);
  });

  it("CHECK: la Asignación es completa — vehículo sin conductor es imposible", async () => {
    await expect(
      insertarServicio(db, TENANT_A, { desde: 8, hasta: 11, conductor: null }),
    ).rejects.toThrow(/chk_asignacion_completa/);
  });

  it("un Servicio SIN Asignación (ambos null) es válido y no ocupa agenda", async () => {
    await insertarServicio(db, TENANT_A, { desde: 8, hasta: 11, vehiculo: null, conductor: null });
    await expect(
      insertarServicio(db, TENANT_A, { desde: 9, hasta: 10 }),
    ).resolves.toBeUndefined();
  });
});
