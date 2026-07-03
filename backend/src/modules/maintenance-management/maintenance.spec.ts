/**
 * Pruebas del módulo Maintenance Management (BC-7), DERIVADAS de los criterios Gherkin de
 * spec-012 (Programar Mantenimiento preventivo por Umbral de Odómetro/fecha).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { DateOnly, FixedClock, SequentialIdGenerator, TenantId } from "../../shared/kernel";
import { InMemoryEventPublisher, InMemoryUmbralRepository } from "./application/in-memory.adapters";
import {
  DefinirUmbral,
  EvaluarUmbralPorOdometro,
  EvaluarVencimientosPorFecha,
  MaintenanceDeps,
  RegistrarCorrectivo,
  RegistrarEjecucion,
} from "./application/use-cases";

const TENANT = TenantId("tenant-duster");
const VEH = "veh-abc123";

function nuevoEntorno() {
  const umbrales = new InMemoryUmbralRepository();
  const publisher = new InMemoryEventPublisher();
  const deps: MaintenanceDeps = {
    umbrales, publisher,
    clock: new FixedClock(DateOnly.parse("2026-07-01")),
    ids: new SequentialIdGenerator("mnt"),
  };
  return { umbrales, publisher, deps };
}

describe("spec-012 — Mantenimiento preventivo por Umbral de Odómetro/fecha", () => {
  let env: ReturnType<typeof nuevoEntorno>;
  beforeEach(() => (env = nuevoEntorno()));

  it("programa un preventivo al superar el Umbral de km (P6)", async () => {
    await new DefinirUmbral(env.deps).execute({ tenant: TENANT, vehiculoId: VEH, cadaKm: 10000, baseKm: 140000 });
    const r = await new EvaluarUmbralPorOdometro(env.deps).execute({ tenant: TENANT, vehiculoId: VEH, lectura: 152000 });
    expect(r.ok && r.value.programado).toBe(true);
    const ev = env.publisher.porTipo("MantenimientoProgramado");
    expect(ev).toHaveLength(1);
    expect(ev[0].dispararPor).toBe("km");
  });

  it("el Umbral alcanzado EXACTAMENTE dispara la programación", async () => {
    await new DefinirUmbral(env.deps).execute({ tenant: TENANT, vehiculoId: VEH, cadaKm: 10000, baseKm: 140000 });
    const r = await new EvaluarUmbralPorOdometro(env.deps).execute({ tenant: TENANT, vehiculoId: VEH, lectura: 150000 });
    expect(r.ok && r.value.programado).toBe(true);
  });

  it("programación por fecha objetivo emite MantenimientoVencido (P7)", async () => {
    await new DefinirUmbral(env.deps).execute({ tenant: TENANT, vehiculoId: VEH, cadaMeses: 6, baseFecha: "2026-01-01" });
    const r = await new EvaluarVencimientosPorFecha(env.deps).execute(TENANT); // hoy = 2026-07-01
    expect(r.vencidos).toBe(1);
    expect(env.publisher.porTipo("MantenimientoVencido")).toHaveLength(1);
  });

  it("no duplica un preventivo ya programado para el mismo Umbral (R8)", async () => {
    await new DefinirUmbral(env.deps).execute({ tenant: TENANT, vehiculoId: VEH, cadaKm: 10000, baseKm: 140000 });
    const evaluar = new EvaluarUmbralPorOdometro(env.deps);
    expect((await evaluar.execute({ tenant: TENANT, vehiculoId: VEH, lectura: 152000 })).ok).toBe(true);
    const r2 = await evaluar.execute({ tenant: TENANT, vehiculoId: VEH, lectura: 160000 });
    expect(r2.ok && r2.value.programado).toBe(false); // ya pendiente
    expect(env.publisher.porTipo("MantenimientoProgramado")).toHaveLength(1);
  });

  it("registrar la ejecución reinicia el ciclo desde la nueva base (R6)", async () => {
    await new DefinirUmbral(env.deps).execute({ tenant: TENANT, vehiculoId: VEH, cadaKm: 10000, baseKm: 140000 });
    await new EvaluarUmbralPorOdometro(env.deps).execute({ tenant: TENANT, vehiculoId: VEH, lectura: 152000 });
    env.publisher.limpiar();
    const rej = await new RegistrarEjecucion(env.deps).execute({ tenant: TENANT, vehiculoId: VEH, odometro: 152000, costoCop: 350000 });
    expect(rej.ok).toBe(true);
    const reg = env.publisher.porTipo("MantenimientoRegistrado");
    expect(reg).toHaveLength(1);
    expect(reg[0].costoCop).toBe(350000);
    // Nueva base 152000: 155000 aún no dispara; 162000 sí.
    const evaluar = new EvaluarUmbralPorOdometro(env.deps);
    expect((await evaluar.execute({ tenant: TENANT, vehiculoId: VEH, lectura: 155000 })).ok && env.publisher.porTipo("MantenimientoProgramado")).toHaveLength(0);
    const r = await evaluar.execute({ tenant: TENANT, vehiculoId: VEH, lectura: 162000 });
    expect(r.ok && r.value.programado).toBe(true);
  });

  it("registrar un Mantenimiento correctivo reactivo emite MantenimientoRegistrado", async () => {
    const r = await new RegistrarCorrectivo(env.deps).execute({ tenant: TENANT, vehiculoId: VEH, odometro: 152400, costoCop: 480000 });
    expect(r.ok).toBe(true);
    const reg = env.publisher.porTipo("MantenimientoRegistrado");
    expect(reg).toHaveLength(1);
    expect(reg[0].tipoMantenimiento).toBe("correctivo");
    expect(reg[0].costoCop).toBe(480000);
  });

  it("mantenimiento vencido queda marcado (advierte, no bloquea en el MVP)", async () => {
    await new DefinirUmbral(env.deps).execute({ tenant: TENANT, vehiculoId: VEH, cadaMeses: 6, baseFecha: "2026-01-01" });
    await new EvaluarVencimientosPorFecha(env.deps).execute(TENANT);
    const umbral = await env.umbrales.findByVehiculo(TENANT, VEH);
    expect(umbral!.vencido).toBe(true); // el estado queda consultable para advertir
  });

  it("rechaza definir un Umbral sin criterio (ni km ni fecha)", async () => {
    const r = await new DefinirUmbral(env.deps).execute({ tenant: TENANT, vehiculoId: VEH });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("umbral_sin_criterio");
  });
});
