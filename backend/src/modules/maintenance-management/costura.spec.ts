/**
 * Pruebas de la COSTURA P6 (spec-012 R2): el evento `OdometroActualizado` de
 * Fleet dispara `EvaluarUmbralPorOdometro` de Maintenance vía la suscripción
 * in-process, sin que Fleet conozca a Maintenance.
 *
 * Escenario Gherkin cubierto de punta a punta (nivel aplicación):
 *   "el Vehículo pasa de 149.000 a 152.000 km vía Tanqueos y se programa un
 *    preventivo al superar 150.000" — aquí el avance entra por el CASO DE USO
 *    de Fleet (ActualizarOdometro), no invocando a Maintenance directamente.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { DateOnly, FixedClock, SequentialIdGenerator, TenantId } from "../../shared/kernel";
import {
  InMemoryEventPublisher as FleetPublisher,
  InMemoryVehiculoRepository,
} from "../fleet-management/application/in-memory.adapters";
import {
  ActualizarOdometro,
  FleetDeps,
  RegistrarVehiculo,
} from "../fleet-management/application/use-cases";
import {
  InMemoryEventPublisher as MaintenancePublisher,
  InMemoryUmbralRepository,
} from "./application/in-memory.adapters";
import {
  DefinirUmbral,
  EvaluarUmbralPorOdometro,
  MaintenanceDeps,
} from "./application/use-cases";
import { CosturaOdometroMantenimiento } from "./infrastructure/costura-odometro";

const TENANT = TenantId("tenant-duster");

function nuevoEntorno() {
  // Lado Fleet (BC-2).
  const vehiculos = new InMemoryVehiculoRepository();
  const publicadorFleet = new FleetPublisher();
  const fleetDeps: FleetDeps = {
    vehiculos,
    publisher: publicadorFleet,
    ids: new SequentialIdGenerator("veh"),
  };

  // Lado Maintenance (BC-7).
  const umbrales = new InMemoryUmbralRepository();
  const publicadorMnt = new MaintenancePublisher();
  const mntDeps: MaintenanceDeps = {
    umbrales,
    publisher: publicadorMnt,
    clock: new FixedClock(DateOnly.parse("2026-07-06")),
    ids: new SequentialIdGenerator("mnt"),
  };

  // La costura, como la cablea MaintenanceManagementModule.
  new CosturaOdometroMantenimiento(publicadorFleet, new EvaluarUmbralPorOdometro(mntDeps));

  return { vehiculos, publicadorFleet, fleetDeps, umbrales, publicadorMnt, mntDeps };
}

describe("spec-012 costura P6 — OdometroActualizado dispara la evaluación del Umbral", () => {
  let env: ReturnType<typeof nuevoEntorno>;
  let vehiculoId: string;

  beforeEach(async () => {
    env = nuevoEntorno();
    const r = await new RegistrarVehiculo(env.fleetDeps).execute({
      tenant: TENANT,
      placa: "ABC123",
      clase: "camioneta",
      odometroInicial: 149000,
    });
    if (!r.ok) throw new Error("no se pudo registrar el vehículo de prueba");
    vehiculoId = r.value.vehiculoId;
  });

  it("un avance del odómetro que supera el Umbral programa el preventivo (P6/R2)", async () => {
    await new DefinirUmbral(env.mntDeps).execute({
      tenant: TENANT,
      vehiculoId,
      cadaKm: 10000,
      baseKm: 140000,
    });

    // El avance entra por FLEET (como lo haría un Tanqueo vía la ACL de Fuel).
    const r = await new ActualizarOdometro(env.fleetDeps).execute({
      tenant: TENANT,
      vehiculoId,
      lectura: 152000,
      fuente: "tanqueo",
    });
    expect(r.ok).toBe(true);

    const umbral = await env.umbrales.findByVehiculo(TENANT, vehiculoId);
    expect(umbral?.pendiente).toBe(true);
    expect(env.publicadorMnt.porTipo("MantenimientoProgramado")).toHaveLength(1);
  });

  it("sin Umbral definido, el avance no programa nada (y no falla)", async () => {
    const r = await new ActualizarOdometro(env.fleetDeps).execute({
      tenant: TENANT,
      vehiculoId,
      lectura: 155000,
      fuente: "manual",
    });
    expect(r.ok).toBe(true);
    expect(env.publicadorMnt.publicados).toHaveLength(0);
  });

  it("re-superar el mismo Umbral con otro avance NO duplica el preventivo (R8)", async () => {
    await new DefinirUmbral(env.mntDeps).execute({
      tenant: TENANT,
      vehiculoId,
      cadaKm: 10000,
      baseKm: 140000,
    });

    const actualizar = new ActualizarOdometro(env.fleetDeps);
    await actualizar.execute({ tenant: TENANT, vehiculoId, lectura: 151000, fuente: "tanqueo" });
    await actualizar.execute({ tenant: TENANT, vehiculoId, lectura: 153000, fuente: "servicio" });

    expect(env.publicadorMnt.porTipo("MantenimientoProgramado")).toHaveLength(1);
  });

  it("un suscriptor que falla NO tumba el comando de Fleet (aislamiento de la costura)", async () => {
    env.publicadorFleet.suscribir(async () => {
      throw new Error("suscriptor roto");
    });

    const r = await new ActualizarOdometro(env.fleetDeps).execute({
      tenant: TENANT,
      vehiculoId,
      lectura: 150500,
      fuente: "manual",
    });

    expect(r.ok).toBe(true); // el odómetro avanzó pese al suscriptor roto
    expect(env.publicadorFleet.porTipo("OdometroActualizado")).toHaveLength(1);
  });

  it("el aislamiento por tenant se respeta: el evento de un tenant no toca umbrales de otro", async () => {
    const OTRO = TenantId("tenant-otro");
    // Umbral del MISMO vehiculoId pero en OTRO tenant.
    await new DefinirUmbral(env.mntDeps).execute({
      tenant: OTRO,
      vehiculoId,
      cadaKm: 1000,
      baseKm: 0,
    });

    await new ActualizarOdometro(env.fleetDeps).execute({
      tenant: TENANT,
      vehiculoId,
      lectura: 152000,
      fuente: "manual",
    });

    const umbralOtro = await env.umbrales.findByVehiculo(OTRO, vehiculoId);
    expect(umbralOtro?.pendiente).toBe(false); // intacto: el evento fue del TENANT A
  });
});
