/**
 * Pruebas del módulo Fuel Management (BC-6), DERIVADAS de los criterios Gherkin de
 * spec-011 (Registrar Tanqueo OFFLINE append-only con idempotencia).
 * Cada `it` refleja un Escenario de la spec.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SequentialIdGenerator, TenantId } from "../../shared/kernel";
import {
  InMemoryEventPublisher,
  InMemoryOdometroVehiculo,
  InMemoryTanqueoRepository,
} from "./application/in-memory.adapters";
import { FuelDeps, RegistrarTanqueo } from "./application/use-cases";
import { UnidadCombustible } from "./domain/value-objects";

const TENANT = TenantId("tenant-duster");
const OTRO_TENANT = TenantId("tenant-otro");
const VEH_ABC123 = "veh-abc123"; // Vehículo "ABC123"

function nuevoEntorno() {
  const tanqueos = new InMemoryTanqueoRepository();
  const odometro = new InMemoryOdometroVehiculo();
  const publisher = new InMemoryEventPublisher();
  const deps: FuelDeps = {
    tanqueos,
    odometro,
    publisher,
    ids: new SequentialIdGenerator("tanq"),
  };
  return { tanqueos, odometro, publisher, deps };
}

/** Entrada base de un Tanqueo de 40 L por $260.000 con Odómetro 152300. */
const tanqueoBase = (over: Partial<Parameters<RegistrarTanqueo["execute"]>[0]> = {}) => ({
  tenant: TENANT,
  clientId: "uuid-tanqueo-001",
  vehiculoId: VEH_ABC123,
  cantidad: 40,
  unidad: UnidadCombustible.Litros,
  valorCop: 260000,
  odometro: 152300,
  ...over,
});

describe("spec-011 — Registrar Tanqueo offline, append-only e idempotente", () => {
  let env: ReturnType<typeof nuevoEntorno>;
  beforeEach(() => {
    env = nuevoEntorno();
    // Antecedentes: última lectura autoritativa del Odómetro de ABC123 = 152000.
    env.odometro.seed(TENANT, VEH_ABC123, 152000);
  });

  it("registra un Tanqueo y al sincronizar emite CombustibleRegistrado y actualiza el Odómetro", async () => {
    const r = await new RegistrarTanqueo(env.deps).execute(tanqueoBase());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.duplicado).toBe(false);
      expect(r.value.anomaliaOdometro).toBe(false);
    }
    const eventos = env.publisher.porTipo("CombustibleRegistrado");
    expect(eventos).toHaveLength(1);
    expect(eventos[0].litros).toBe(40);
    expect(eventos[0].valorCop).toBe(260000);
    expect(eventos[0].odometro).toBe(152300);
    // El Odómetro autoritativo del Vehículo se actualiza a 152300 (R8).
    expect(await env.odometro.lecturaActual(TENANT, VEH_ABC123)).toBe(152300);
  });

  it("registra varios Tanqueos en orden: el Odómetro queda en la última lectura", async () => {
    const registrar = new RegistrarTanqueo(env.deps);
    await registrar.execute(tanqueoBase({ clientId: "t1", odometro: 152300 }));
    await registrar.execute(tanqueoBase({ clientId: "t2", odometro: 152600 }));
    expect(await env.odometro.lecturaActual(TENANT, VEH_ABC123)).toBe(152600);
    expect(await env.tanqueos.listByVehiculo(TENANT, VEH_ABC123)).toHaveLength(2);
    expect(env.publisher.porTipo("CombustibleRegistrado")).toHaveLength(2);
  });

  it("registra el Tanqueo en galones: se conserva la unidad y el evento lleva litros convertidos", async () => {
    const r = await new RegistrarTanqueo(env.deps).execute(
      tanqueoBase({ cantidad: 10, unidad: UnidadCombustible.Galones }),
    );
    expect(r.ok).toBe(true);
    const evento = env.publisher.porTipo("CombustibleRegistrado")[0];
    // 10 galones (US) → 37.854 litros (canónico en el evento, R7).
    expect(evento.litros).toBeCloseTo(37.854, 3);
    const registrados = await env.tanqueos.listByVehiculo(TENANT, VEH_ABC123);
    expect(registrados[0].cantidad.unidad).toBe(UnidadCombustible.Galones);
    expect(registrados[0].cantidad.valor).toBe(10);
  });

  it("reintento del mismo UUID no duplica: deduplica y queda un solo Tanqueo (R5)", async () => {
    const registrar = new RegistrarTanqueo(env.deps);
    const r1 = await registrar.execute(tanqueoBase({ clientId: "uuid-tanqueo-001" }));
    const r2 = await registrar.execute(tanqueoBase({ clientId: "uuid-tanqueo-001" })); // confirmación perdida
    expect(r1.ok && !r1.value.duplicado).toBe(true);
    expect(r2.ok && r2.value.duplicado).toBe(true);
    if (r1.ok && r2.ok) expect(r2.value.tanqueoId).toBe(r1.value.tanqueoId); // mismo registro
    expect(await env.tanqueos.listByVehiculo(TENANT, VEH_ABC123)).toHaveLength(1);
    expect(env.publisher.porTipo("CombustibleRegistrado")).toHaveLength(1); // UN solo evento
  });

  it("append-only: dos Tanqueos del mismo Vehículo coexisten sin conflicto (R10)", async () => {
    const registrar = new RegistrarTanqueo(env.deps);
    const a = await registrar.execute(tanqueoBase({ clientId: "disp-A", odometro: 152300 }));
    const b = await registrar.execute(tanqueoBase({ clientId: "disp-B", odometro: 152400 }));
    expect(a.ok && b.ok).toBe(true);
    expect(await env.tanqueos.listByVehiculo(TENANT, VEH_ABC123)).toHaveLength(2);
  });

  it("Odómetro menor a la lectura autoritativa: anomalía, no retrocede, pero el Tanqueo se conserva (R8)", async () => {
    env.odometro.seed(TENANT, VEH_ABC123, 152300);
    const r = await new RegistrarTanqueo(env.deps).execute(tanqueoBase({ odometro: 151900 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.anomaliaOdometro).toBe(true);
    // La lectura autoritativa NO retrocede.
    expect(await env.odometro.lecturaActual(TENANT, VEH_ABC123)).toBe(152300);
    // El hecho del Tanqueo se conserva igual.
    expect(await env.tanqueos.listByVehiculo(TENANT, VEH_ABC123)).toHaveLength(1);
    // Y el evento se emite igual (R7).
    expect(env.publisher.porTipo("CombustibleRegistrado")).toHaveLength(1);
  });

  it("rechazo por valor en COP no positivo (R6): error de dominio, sin registrar ni emitir", async () => {
    const r = await new RegistrarTanqueo(env.deps).execute(tanqueoBase({ valorCop: 0 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("valor_cop_no_positivo");
    expect(await env.tanqueos.listByVehiculo(TENANT, VEH_ABC123)).toHaveLength(0);
    expect(env.publisher.porTipo("CombustibleRegistrado")).toHaveLength(0);
  });

  it("rechazo por cantidad no positiva (R6)", async () => {
    const r = await new RegistrarTanqueo(env.deps).execute(tanqueoBase({ cantidad: 0 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("cantidad_no_positiva");
  });

  it("aislamiento multi-tenant: el mismo clientId en OTRO Tenant es un registro distinto", async () => {
    const registrar = new RegistrarTanqueo(env.deps);
    await registrar.execute(tanqueoBase({ clientId: "uuid-x", odometro: 152300 }));
    const otro = await registrar.execute(
      tanqueoBase({ tenant: OTRO_TENANT, clientId: "uuid-x", odometro: 500 }),
    );
    expect(otro.ok && !otro.value.duplicado).toBe(true); // no colisiona entre tenants
    expect(await env.tanqueos.listByVehiculo(OTRO_TENANT, VEH_ABC123)).toHaveLength(1);
  });
});
