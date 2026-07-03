/**
 * Pruebas del módulo Driver Management (BC-3), DERIVADAS de los criterios Gherkin de
 * spec-004 (Registrar Conductor y su Licencia). La sección con ACL real atraviesa la
 * colaboración BC-3 → BC-4: la Licencia se materializa como Documento (R5) y alimenta
 * el Semáforo (regla de oro spec-009).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { DateOnly, FixedClock, SequentialIdGenerator, TenantId } from "../../shared/kernel";
import {
  InMemoryConductorRepository,
  InMemoryEventPublisher,
  StubRegistradorLicencia,
} from "./application/in-memory.adapters";
import { DriverDeps, RegistrarConductor } from "./application/use-cases";
import { LicenciaAcl, TIPO_LICENCIA } from "./infrastructure/licencia.acl";

// Compliance (in-memory) para verificar R5 de punta a punta.
import {
  InMemoryCatalogoTiposRepository,
  InMemoryDocumentoRepository,
  InMemoryEventPublisher as ComplianceEventPublisher,
} from "../compliance-documents/application/in-memory.adapters";
import {
  ComplianceDeps,
  ConsultarDocumentosVigentes,
  ConsultarSemaforo,
  RegistrarDocumento,
} from "../compliance-documents/application/use-cases";
import { Semaforo, SujetoRef, TipoDocumento, TipoSujeto } from "../compliance-documents/domain/value-objects";

const HOY = "2026-07-01";
const TENANT = TenantId("tenant-duster");
const EMPRESA_B = TenantId("tenant-b");

/** Entorno con Compliance REAL (in-memory) y la ACL de Licencia cableada. */
function entornoIntegrado() {
  const documentos = new InMemoryDocumentoRepository();
  const catalogo = new InMemoryCatalogoTiposRepository();
  const complianceDeps: ComplianceDeps = {
    documentos,
    catalogo,
    publisher: new ComplianceEventPublisher(),
    clock: new FixedClock(DateOnly.parse(HOY)),
    ids: new SequentialIdGenerator("doc"),
  };
  // Catálogo: LICENCIA es Tipo requerido del Conductor.
  catalogo.seed(TENANT, new TipoDocumento(TIPO_LICENCIA, TipoSujeto.Conductor, true, true));
  catalogo.seed(EMPRESA_B, new TipoDocumento(TIPO_LICENCIA, TipoSujeto.Conductor, true, true));

  const conductores = new InMemoryConductorRepository();
  const publisher = new InMemoryEventPublisher();
  const deps: DriverDeps = {
    conductores,
    publisher,
    licencia: new LicenciaAcl(new RegistrarDocumento(complianceDeps)),
    clock: new FixedClock(DateOnly.parse(HOY)),
    ids: new SequentialIdGenerator("cond"),
  };
  const semaforo = new ConsultarSemaforo(complianceDeps);
  const docsVigentes = new ConsultarDocumentosVigentes(complianceDeps);
  return { deps, conductores, publisher, semaforo, docsVigentes };
}

const juan = (over: Partial<Parameters<RegistrarConductor["execute"]>[0]> = {}) => ({
  tenant: TENANT,
  nombre: "Juan Pérez",
  documentoIdentidad: "1098765432",
  licencia: { numero: "LIC-001", categoria: "C1", vencimiento: "2027-03-15" },
  ...over,
});

describe("spec-004 — Registrar Conductor y su Licencia (con ACL real a Compliance)", () => {
  let env: ReturnType<typeof entornoIntegrado>;
  beforeEach(() => (env = entornoIntegrado()));

  it("alta exitosa: ConductorRegistrado + la Licencia queda como Documento con su vencimiento (R5)", async () => {
    const r = await new RegistrarConductor(env.deps).execute(juan());
    expect(r.ok).toBe(true);
    const id = r.ok ? r.value.conductorId : "";
    expect(env.publisher.porTipo("ConductorRegistrado")).toHaveLength(1);

    // R5: la Licencia es un Documento vigente del Conductor con vencimiento 2027-03-15.
    const docs = await env.docsVigentes.execute(TENANT, SujetoRef.conductor(id));
    const licencia = docs.find((d) => d.tipo.codigo === TIPO_LICENCIA);
    expect(licencia).toBeTruthy();
    expect(licencia!.vencimiento.fecha.toISO()).toBe("2027-03-15");
    // Con licencia vigente y sin otros requeridos ausentes, el Semáforo es verde.
    expect((await env.semaforo.execute(TENANT, SujetoRef.conductor(id))).semaforo).toBe(Semaforo.Vigente);
  });

  it("alta sin vincular Usuario: el Conductor queda registrado con usuarioId ausente", async () => {
    const r = await new RegistrarConductor(env.deps).execute(
      juan({ nombre: "Ana Gómez", documentoIdentidad: "1102233445" }),
    );
    expect(r.ok).toBe(true);
    const c = r.ok ? await env.conductores.findById(TENANT, r.value.conductorId) : null;
    expect(c!.usuarioId).toBeUndefined();
  });

  it("Licencia VENCIDA deja el Semáforo del Conductor en rojo (alimenta la regla de oro)", async () => {
    const r = await new RegistrarConductor(env.deps).execute(
      juan({ documentoIdentidad: "1100112233", licencia: { numero: "L", categoria: "C1", vencimiento: "2026-06-01" } }),
    );
    expect(r.ok).toBe(true);
    const id = r.ok ? r.value.conductorId : "";
    expect((await env.semaforo.execute(TENANT, SujetoRef.conductor(id))).semaforo).toBe(Semaforo.Vencido);
  });

  it("rechazo por documento de identidad duplicado en el Tenant (R9)", async () => {
    const reg = new RegistrarConductor(env.deps);
    expect((await reg.execute(juan())).ok).toBe(true);
    const r = await reg.execute(juan({ nombre: "Otro" })); // misma cédula
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("documento_duplicado");
  });

  it("la misma cédula PUEDE existir en Tenants distintos (aislamiento R9)", async () => {
    const reg = new RegistrarConductor(env.deps);
    expect((await reg.execute(juan())).ok).toBe(true);
    expect((await reg.execute(juan({ tenant: EMPRESA_B }))).ok).toBe(true);
  });

  it("rechazo por nombre vacío", async () => {
    const r = await new RegistrarConductor(env.deps).execute(juan({ nombre: "  " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("nombre_requerido");
  });

  it("Habeas Data (R3): el snapshot solo contiene los datos mínimos necesarios", async () => {
    const r = await new RegistrarConductor(env.deps).execute(juan({ documentoIdentidad: "1100009999" }));
    const c = r.ok ? await env.conductores.findById(TENANT, r.value.conductorId) : null;
    expect(Object.keys(c!.snapshot()).sort()).toEqual(
      ["documento", "id", "licenciaCategoria", "licenciaNumero", "licenciaVencimiento", "nombre", "usuarioId"].sort(),
    );
  });
});

// ─────────── Aislamiento unitario con stub del ACL (sin Compliance) ───────────
describe("spec-004 — RegistrarConductor: contrato con el puerto de Licencia", () => {
  it("llama al ACL de Licencia con la emisión (hoy) y el vencimiento correctos", async () => {
    const stub = new StubRegistradorLicencia();
    const deps: DriverDeps = {
      conductores: new InMemoryConductorRepository(),
      publisher: new InMemoryEventPublisher(),
      licencia: stub,
      clock: new FixedClock(DateOnly.parse(HOY)),
      ids: new SequentialIdGenerator("cond"),
    };
    const r = await new RegistrarConductor(deps).execute(juan());
    expect(r.ok).toBe(true);
    expect(stub.llamadas).toHaveLength(1);
    expect(stub.llamadas[0].vencimiento).toBe("2027-03-15");
    expect(stub.llamadas[0].emision).toBe(HOY); // vencimiento futuro ⇒ emisión = hoy
  });
});
