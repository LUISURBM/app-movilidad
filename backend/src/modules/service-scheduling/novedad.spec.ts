/**
 * Pruebas de spec-014 (Registrar Novedad OFFLINE append-only), DERIVADAS de sus Gherkin.
 * La Novedad vive en BC-5 (Scheduling); se registra vía RegistrarNovedad y se enruta desde
 * SincronizarCambios (entidad "novedad"). La foto en dos pasos es del cliente; el servidor
 * acepta un `fotoRef` opcional.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { DateOnly, FixedClock, SequentialIdGenerator, TenantId } from "../../shared/kernel";
import {
  InMemoryBitacoraSync,
  InMemoryEventPublisher,
  InMemoryIdempotencyStore,
  InMemoryNovedadRepository,
  InMemoryServicioRepository,
  StubCumplimientoGateway,
} from "./application/in-memory.adapters";
import {
  CrearServicio,
  RegistrarNovedad,
  SchedulingDeps,
  SincronizarCambios,
} from "./application/use-cases";
import { RegistradorTanqueo } from "./application/ports";

const TENANT = TenantId("tenant-duster");
const COND_JUAN = "cond-juan";
const tanqueoStub: RegistradorTanqueo = { async registrar() { return { resultado: "error" as const }; } };

function nuevoEntorno() {
  const servicios = new InMemoryServicioRepository();
  const publisher = new InMemoryEventPublisher();
  const novedades = new InMemoryNovedadRepository();
  const deps: SchedulingDeps = {
    servicios,
    cumplimiento: new StubCumplimientoGateway(),
    publisher,
    idempotencia: new InMemoryIdempotencyStore(),
    bitacora: new InMemoryBitacoraSync(),
    tanqueo: tanqueoStub,
    novedades,
    clock: new FixedClock(DateOnly.parse("2026-07-01")),
    ids: new SequentialIdGenerator("srv"),
  };
  return { servicios, publisher, novedades, deps };
}

async function crearServicio(deps: SchedulingDeps): Promise<string> {
  const r = await new CrearServicio(deps).execute({
    tenant: TENANT, origen: "Bogotá", destino: "Tunja",
    ventanaInicio: "2026-07-01T08:00:00Z", ventanaFin: "2026-07-01T11:00:00Z",
  });
  if (!r.ok) throw r.error;
  return r.value.servicioId;
}

describe("spec-014 — Registrar Novedad offline, append-only e idempotente", () => {
  let env: ReturnType<typeof nuevoEntorno>;
  let servicioId: string;
  beforeEach(async () => {
    env = nuevoEntorno();
    servicioId = await crearServicio(env.deps);
    env.publisher.limpiar();
  });

  it("reporta una Novedad con foto para un Servicio existente y emite NovedadReportada", async () => {
    const r = await new RegistrarNovedad(env.deps).execute({
      tenant: TENANT, clientId: "uuid-novedad-001", servicioId,
      tipo: "incidente", descripcion: "pinchazo en la vía", fotoRef: "blob-123",
    });
    expect(r.ok).toBe(true);
    const ev = env.publisher.porTipo("NovedadReportada");
    expect(ev).toHaveLength(1);
    expect(ev[0].servicioId).toBe(servicioId);
    expect(ev[0].tipoNovedad).toBe("incidente");
    expect(ev[0].fotoRef).toBe("blob-123");
  });

  it("reporta una Novedad SIN foto: NovedadReportada sin fotoRef", async () => {
    const r = await new RegistrarNovedad(env.deps).execute({
      tenant: TENANT, clientId: "n-sin-foto", servicioId, tipo: "retraso", descripcion: "trancón",
    });
    expect(r.ok).toBe(true);
    expect(env.publisher.porTipo("NovedadReportada")[0].fotoRef).toBeUndefined();
  });

  it("varias Novedades del mismo Servicio coexisten (append-only)", async () => {
    const reg = new RegistrarNovedad(env.deps);
    await reg.execute({ tenant: TENANT, clientId: "n1", servicioId, tipo: "retraso", descripcion: "a" });
    await reg.execute({ tenant: TENANT, clientId: "n2", servicioId, tipo: "incidente", descripcion: "b" });
    expect(await env.novedades.listByServicio(TENANT, servicioId)).toHaveLength(2);
  });

  it("reintento con el mismo UUID no duplica (R7)", async () => {
    const reg = new RegistrarNovedad(env.deps);
    const r1 = await reg.execute({ tenant: TENANT, clientId: "uuid-novedad-001", servicioId, tipo: "retraso", descripcion: "x" });
    const r2 = await reg.execute({ tenant: TENANT, clientId: "uuid-novedad-001", servicioId, tipo: "retraso", descripcion: "x" });
    expect(r1.ok && !r1.value.duplicado).toBe(true);
    expect(r2.ok && r2.value.duplicado).toBe(true);
    expect(await env.novedades.listByServicio(TENANT, servicioId)).toHaveLength(1);
  });

  it("rechazo de Novedad para un Servicio inexistente (R1)", async () => {
    const r = await new RegistrarNovedad(env.deps).execute({
      tenant: TENANT, clientId: "n-huerfana", servicioId: "no-existe", tipo: "incidente", descripcion: "x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("servicio_no_encontrado");
  });

  it("vía SincronizarCambios: la entidad 'novedad' se confirma (ya no es error)", async () => {
    const resultados = await new SincronizarCambios(env.deps).execute({
      tenant: TENANT, usuarioId: COND_JUAN,
      cambios: [
        {
          clientId: "uuid-novedad-777", entidad: "novedad", operacion: "crear",
          payload: { servicioId, tipo: "siniestro", descripcion: "choque leve", fotoRef: "blob-9" },
          ocurridoEn: "2026-07-01T09:30:00Z",
        },
      ],
    });
    expect(resultados[0].resultado).toBe("confirmado");
    expect(resultados[0].serverId).toBeTruthy();
    expect(await env.novedades.listByServicio(TENANT, servicioId)).toHaveLength(1);
  });
});
