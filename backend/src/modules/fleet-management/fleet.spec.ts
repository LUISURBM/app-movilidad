/**
 * Pruebas del módulo Fleet Management (BC-2), DERIVADAS de los criterios Gherkin de
 * spec-003 (Registrar Vehículo con placa única por Tenant y odómetro monótono).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SequentialIdGenerator, TenantId } from "../../shared/kernel";
import {
  InMemoryEventPublisher,
  InMemoryVehiculoRepository,
} from "./application/in-memory.adapters";
import { ActualizarOdometro, FleetDeps, RegistrarVehiculo } from "./application/use-cases";

const TENANT = TenantId("tenant-duster"); // "Transporte Duster SAS"
const EMPRESA_A = TenantId("tenant-a");
const EMPRESA_B = TenantId("tenant-b");

function nuevoEntorno() {
  const vehiculos = new InMemoryVehiculoRepository();
  const publisher = new InMemoryEventPublisher();
  const deps: FleetDeps = { vehiculos, publisher, ids: new SequentialIdGenerator("veh") };
  return { vehiculos, publisher, deps };
}

const duster = (over: Partial<Parameters<RegistrarVehiculo["execute"]>[0]> = {}) => ({
  tenant: TENANT,
  placa: "ABC123",
  clase: "automovil",
  marca: "Renault",
  modelo: "Duster",
  odometroInicial: 152000,
  ...over,
});

describe("spec-003 — Registrar Vehículo (placa única por Tenant, odómetro monótono)", () => {
  let env: ReturnType<typeof nuevoEntorno>;
  beforeEach(() => (env = nuevoEntorno()));

  it("alta exitosa con odómetro inicial: registrado, lectura 152000, evento con placa ABC123", async () => {
    const r = await new RegistrarVehiculo(env.deps).execute(duster());
    expect(r.ok).toBe(true);
    const v = r.ok ? await env.vehiculos.findById(TENANT, r.value.vehiculoId) : null;
    expect(v!.odometro!.km).toBe(152000);
    const eventos = env.publisher.porTipo("VehiculoRegistrado");
    expect(eventos).toHaveLength(1);
    expect(eventos[0].placa).toBe("ABC123");
  });

  it("alta sin odómetro inicial: el Odómetro queda sin lectura", async () => {
    const r = await new RegistrarVehiculo(env.deps).execute(
      duster({ placa: "XYZ789", clase: "microbus", marca: "Chevrolet", modelo: "NPR", odometroInicial: undefined }),
    );
    expect(r.ok).toBe(true);
    const v = r.ok ? await env.vehiculos.findById(TENANT, r.value.vehiculoId) : null;
    expect(v!.odometro).toBeUndefined();
  });

  it("alta con Afiliación a empresa transportadora emite VehiculoAfiliado", async () => {
    const r = await new RegistrarVehiculo(env.deps).execute(
      duster({ placa: "DEF456", afiliacion: { empresaTransportadoraId: "emp-valle", desde: "2026-06-01" } }),
    );
    expect(r.ok).toBe(true);
    const afiliados = env.publisher.porTipo("VehiculoAfiliado");
    expect(afiliados).toHaveLength(1);
    expect(afiliados[0].empresaTransportadoraId).toBe("emp-valle");
    expect(afiliados[0].desde).toBe("2026-06-01");
  });

  it("rechazo por placa duplicada en el mismo Tenant (R2)", async () => {
    const reg = new RegistrarVehiculo(env.deps);
    expect((await reg.execute(duster())).ok).toBe(true);
    const r = await reg.execute(duster({ marca: "Otra" })); // misma placa ABC123
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("placa_duplicada");
  });

  it("la misma placa PUEDE existir en Tenants distintos (aislamiento R2)", async () => {
    const reg = new RegistrarVehiculo(env.deps);
    expect((await reg.execute(duster({ tenant: EMPRESA_A }))).ok).toBe(true);
    const r = await reg.execute(duster({ tenant: EMPRESA_B }));
    expect(r.ok).toBe(true); // ABC123 en Empresa B no colisiona con Empresa A
  });

  it("rechazo de actualización de Odómetro por monotonía (R6): 152000 -> 151500 se rechaza", async () => {
    const reg = await new RegistrarVehiculo(env.deps).execute(duster());
    const id = reg.ok ? reg.value.vehiculoId : "";
    const r = await new ActualizarOdometro(env.deps).execute({
      tenant: TENANT, vehiculoId: id, lectura: 151500, fuente: "manual",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("odometro_no_monotono");
    const v = await env.vehiculos.findById(TENANT, id);
    expect(v!.odometro!.km).toBe(152000); // la autoritativa NO retrocede
  });

  it("actualización de Odómetro monótona (>=) procede y emite OdometroActualizado", async () => {
    const reg = await new RegistrarVehiculo(env.deps).execute(duster());
    const id = reg.ok ? reg.value.vehiculoId : "";
    env.publisher.limpiar();
    const r = await new ActualizarOdometro(env.deps).execute({
      tenant: TENANT, vehiculoId: id, lectura: 152300, fuente: "tanqueo",
    });
    expect(r.ok).toBe(true);
    expect((await env.vehiculos.findById(TENANT, id))!.odometro!.km).toBe(152300);
    const ev = env.publisher.porTipo("OdometroActualizado");
    expect(ev).toHaveLength(1);
    expect(ev[0].fuente).toBe("tanqueo");
  });

  it("rechazo por placa con formato inválido (R2/contrato)", async () => {
    const r = await new RegistrarVehiculo(env.deps).execute(duster({ placa: "123" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("placa_invalida");
  });

  it("actualizar odómetro de un Vehículo inexistente da error", async () => {
    const r = await new ActualizarOdometro(env.deps).execute({
      tenant: TENANT, vehiculoId: "no-existe", lectura: 100, fuente: "manual",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("vehiculo_no_encontrado");
  });
});
