/**
 * Integración RLS E1 (Postgres real vía PGlite): con un rol SIN BYPASSRLS, los
 * ADAPTADORES reales quedan confinados a su tenant por la BASE (no solo por el
 * WHERE del código), y el worker de plataforma solo ve el outbox con su ámbito.
 *
 * Corre 0001 + 0005 + 0011 VERBATIM, crea `fleetspecial_app` (NOSUPERUSER,
 * NOBYPASSRLS) ANTES de 0011 (los GRANT condicionales aplican) y opera toda la
 * sesión con `SET ROLE fleetspecial_app`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { DataSource } from "typeorm";
import {
  SqlFleetEventPublisher,
  SqlVehiculoRepository,
} from "../modules/fleet-management/infrastructure/sql-adapters";
import { Vehiculo } from "../modules/fleet-management/domain/vehiculo.aggregate";
import { Placa, parseClase } from "../modules/fleet-management/domain/value-objects";
import { SqlOutboxStore } from "./outbox.sql-store";
import { enTenant } from "./tenant-sql";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG = (n: string) => readFileSync(resolve(__dirname, `../../migrations/${n}`), "utf8");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const VEH = "33333333-3333-3333-3333-333333333333";

/** DataSource mínimo sobre PGlite: los adaptadores solo usan query/transaction. */
function dsSobrePglite(db: PGlite): DataSource {
  const manager = {
    query: async (sql: string, params?: unknown[]) =>
      (await db.query(sql, (params ?? []) as never[])).rows,
    getRepository: () => {
      throw new Error("este spec no cubre repos TypeORM (ver nota al final)");
    },
  };
  return {
    query: manager.query,
    transaction: async (cb: (m: typeof manager) => Promise<unknown>) => {
      await db.exec("BEGIN");
      try {
        const r = await cb(manager);
        await db.exec("COMMIT");
        return r;
      } catch (e) {
        await db.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as DataSource;
}

function vehiculoDePrueba(): Vehiculo {
  return Vehiculo.rehidratar({
    id: VEH,
    placa: Placa.de("ABC123"),
    clase: parseClase("camioneta"),
    marca: "Renault",
    modelo: "Duster",
    estado: "activo",
  });
}

async function nuevaBase(): Promise<{ db: PGlite; ds: DataSource }> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(MIG("0001_init_compliance.sql"));
  await db.exec(MIG("0005_init_fleet.sql"));
  // El rol existe ANTES de 0011 para que sus GRANT condicionales apliquen.
  await db.exec(`CREATE ROLE fleetspecial_app NOSUPERUSER NOBYPASSRLS;`);
  await db.exec(MIG("0011_rls_rol_app.sql"));
  await db.exec("SET ROLE fleetspecial_app;"); // TODA la sesión como el rol de la API
  return { db, ds: dsSobrePglite(db) };
}

describe("integración RLS E1 — rol sin bypass + adaptadores reales", () => {
  let db: PGlite;
  let ds: DataSource;

  beforeEach(async () => {
    ({ db, ds } = await nuevaBase());
  });

  it("el adaptador escribe y lee EN su tenant; otro tenant no ve nada", async () => {
    const repo = new SqlVehiculoRepository(ds);
    await repo.save(TENANT_A as never, vehiculoDePrueba());

    expect((await repo.findById(TENANT_A as never, VEH))?.placa.valor).toBe("ABC123");
    expect(await repo.findById(TENANT_B as never, VEH)).toBeNull();
    expect(await repo.list(TENANT_B as never)).toHaveLength(0);
  });

  it("la BASE confina aunque el código olvide el WHERE (defensa en profundidad)", async () => {
    const repo = new SqlVehiculoRepository(ds);
    await repo.save(TENANT_A as never, vehiculoDePrueba());

    // Query deliberadamente SIN filtro por tenant, dentro del ámbito de B:
    const filas = await enTenant(ds, TENANT_B, (m) =>
      m.query("SELECT count(*)::int AS n FROM vehiculo"),
    );
    expect(filas[0].n).toBe(0); // RLS: B no ve las filas de A ni sin WHERE

    const propias = await enTenant(ds, TENANT_A, (m) =>
      m.query("SELECT count(*)::int AS n FROM vehiculo"),
    );
    expect(propias[0].n).toBe(1);
  });

  it("sin ámbito de tenant NO se ve nada (falla cerrado, sin excepción)", async () => {
    const repo = new SqlVehiculoRepository(ds);
    await repo.save(TENANT_A as never, vehiculoDePrueba());
    const filas = (await db.query("SELECT count(*)::int AS n FROM vehiculo")).rows as Array<{
      n: number;
    }>;
    expect(filas[0].n).toBe(0);
  });

  it("el outbox se escribe en el tenant y el worker de PLATAFORMA lo despacha", async () => {
    const publisher = new SqlFleetEventPublisher(ds);
    await publisher.publish(TENANT_A as never, [
      { tipo: "OdometroActualizado", ocurridoEn: new Date().toISOString(), vehiculoId: VEH, lectura: 1000, fuente: "manual" },
    ]);

    // Sin ámbito: invisible (política de tenant + plataforma, ninguna aplica).
    const directo = (await db.query("SELECT count(*)::int AS n FROM outbox")).rows as Array<{ n: number }>;
    expect(directo[0].n).toBe(0);

    // Con ámbito de plataforma (SqlOutboxStore): visible y despachable.
    const store = new SqlOutboxStore(ds);
    const pendientes = await store.tomarPendientes(10, new Date());
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0].tenantId).toBe(TENANT_A);
    expect(pendientes[0].tipoEvento).toBe("OdometroActualizado");

    await store.marcarPublicado(pendientes[0].id);
    expect(await store.tomarPendientes(10, new Date())).toHaveLength(0);
  });

  it("un tenant no puede pisar la fila de otro ni vía upsert (WITH CHECK + USING)", async () => {
    const repo = new SqlVehiculoRepository(ds);
    await repo.save(TENANT_A as never, vehiculoDePrueba());

    // Mismo id, tenant B: el ON CONFLICT no puede VER (ni actualizar) la fila de A
    // y el INSERT viola la PK → la base lo rechaza. A queda intacto.
    await expect(repo.save(TENANT_B as never, vehiculoDePrueba())).rejects.toThrow();
    const intacto = await repo.findById(TENANT_A as never, VEH);
    expect(intacto?.marca).toBe("Renault");
  });
});

// NOTA: los repos TypeORM (Documento/Tipo/Servicio) usan getRepository(Entity) y
// no se pueden ejercitar con este shim; su confinamiento usa el MISMO enTenant
// (conRepo) y las políticas ya probadas aquí y en los specs de integración por
// módulo. El ensayo end-to-end completo es el compose del runbook (§3).
