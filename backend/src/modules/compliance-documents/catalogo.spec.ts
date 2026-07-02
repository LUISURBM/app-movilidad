/**
 * Pruebas del CRUD del catálogo de Tipos (spec-005 R2/R10) y su efecto sobre el
 * Semáforo (I3) y el registro de Documentos (R10: tipo inactivo no admite nuevos).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { DateOnly, FixedClock, SequentialIdGenerator, TenantId } from "../../shared/kernel";
import { Semaforo, SujetoRef, TipoSujeto } from "./domain/value-objects";
import {
  InMemoryCatalogoTiposRepository,
  InMemoryDocumentoRepository,
  InMemoryEventPublisher,
} from "./application/in-memory.adapters";
import { ComplianceDeps, ConsultarSemaforo, RegistrarDocumento } from "./application/use-cases";
import {
  ActualizarTipoDocumento,
  AgregarTipoDocumento,
  ListarTiposDocumento,
} from "./application/catalogo.use-cases";

const TENANT = TenantId("tenant-duster");
const VEH = SujetoRef.vehiculo("veh-abc123");

function entorno() {
  const catalogo = new InMemoryCatalogoTiposRepository();
  const deps: ComplianceDeps = {
    documentos: new InMemoryDocumentoRepository(),
    catalogo,
    publisher: new InMemoryEventPublisher(),
    clock: new FixedClock(DateOnly.parse("2026-07-02")),
    ids: new SequentialIdGenerator("doc"),
  };
  return {
    catalogo,
    deps,
    agregar: new AgregarTipoDocumento(catalogo),
    actualizar: new ActualizarTipoDocumento(catalogo),
    listar: new ListarTiposDocumento(catalogo),
  };
}

describe("spec-005 R2/R10 — catálogo configurable por tenant", () => {
  let env: ReturnType<typeof entorno>;
  beforeEach(() => (env = entorno()));

  it("agrega un Tipo (activo por defecto) y lo lista", async () => {
    const r = await env.agregar.execute({ tenant: TENANT, codigo: "SOAT", aplicaA: TipoSujeto.Vehiculo });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.activo).toBe(true);
      expect(r.value.requerido).toBe(false);
    }
    const lista = await env.listar.execute(TENANT);
    expect(lista.map((t) => t.codigo)).toEqual(["SOAT"]);
  });

  it("rechaza el código duplicado en el MISMO tenant; en otro tenant es válido", async () => {
    await env.agregar.execute({ tenant: TENANT, codigo: "SOAT", aplicaA: TipoSujeto.Vehiculo });
    const dup = await env.agregar.execute({ tenant: TENANT, codigo: "SOAT", aplicaA: TipoSujeto.Vehiculo });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("tipo_documento_duplicado");

    const otro = await env.agregar.execute({ tenant: TenantId("tenant-otro"), codigo: "SOAT", aplicaA: TipoSujeto.Vehiculo });
    expect(otro.ok).toBe(true);
  });

  it("actualizar un Tipo inexistente devuelve tipo_no_encontrado", async () => {
    const r = await env.actualizar.execute({ tenant: TENANT, codigo: "NADA", activo: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("tipo_no_encontrado");
  });

  it("DESACTIVAR un Tipo impide registrar nuevos Documentos de ese Tipo (R10)", async () => {
    await env.agregar.execute({ tenant: TENANT, codigo: "SOAT", aplicaA: TipoSujeto.Vehiculo });
    await env.actualizar.execute({ tenant: TENANT, codigo: "SOAT", activo: false });

    const reg = await new RegistrarDocumento(env.deps).execute({
      tenant: TENANT,
      sujeto: VEH,
      tipoCodigo: "SOAT",
      emision: "2026-01-01",
      vencimiento: "2027-01-01",
    });
    expect(reg.ok).toBe(false);
    if (!reg.ok) expect(reg.error.code).toBe("tipo_documento_inactivo");
  });

  it("marcar/des-marcar REQUERIDO alimenta la invariante I3 del Semáforo", async () => {
    await env.agregar.execute({ tenant: TENANT, codigo: "RTM", aplicaA: TipoSujeto.Vehiculo, requerido: true });
    const consultar = new ConsultarSemaforo(env.deps);

    const rojo = await consultar.execute(TENANT, VEH);
    expect(rojo.semaforo).toBe(Semaforo.Vencido); // requerido ausente ⇒ rojo (I3)

    await env.actualizar.execute({ tenant: TENANT, codigo: "RTM", requerido: false });
    const verde = await consultar.execute(TENANT, VEH);
    expect(verde.semaforo).toBe(Semaforo.Vigente);
  });

  it("un Tipo requerido pero INACTIVO no cuenta para I3", async () => {
    await env.agregar.execute({ tenant: TENANT, codigo: "RTM", aplicaA: TipoSujeto.Vehiculo, requerido: true });
    await env.actualizar.execute({ tenant: TENANT, codigo: "RTM", activo: false });
    const r = await new ConsultarSemaforo(env.deps).execute(TENANT, VEH);
    expect(r.semaforo).toBe(Semaforo.Vigente);
  });
});
