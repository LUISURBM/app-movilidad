/**
 * Pruebas del módulo Identity & Access (BC-1), DERIVADAS de los criterios Gherkin de
 * spec-001 (onboarding de Empresa) y spec-002 (invitar usuarios y roles).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { DateOnly, FixedClock, SequentialIdGenerator, TenantId } from "../../shared/kernel";
import {
  InMemoryEventPublisher,
  InMemoryTenantRepository,
  InMemoryUsuarioRepository,
} from "./application/in-memory.adapters";
import {
  AceptarInvitacion,
  ActualizarUsuario,
  ExpirarInvitacion,
  IdentityDeps,
  InvitarUsuario,
  RegistrarTenant,
} from "./application/use-cases";
import { EstadoUsuario, PlanSuscripcion } from "./domain/value-objects";

function nuevoEntorno() {
  const tenants = new InMemoryTenantRepository();
  const usuarios = new InMemoryUsuarioRepository();
  const publisher = new InMemoryEventPublisher();
  const deps: IdentityDeps = {
    tenants, usuarios, publisher,
    clock: new FixedClock(DateOnly.parse("2026-07-01")),
    ids: new SequentialIdGenerator("id"),
  };
  return { tenants, usuarios, publisher, deps };
}

const onboarding = (over: Partial<Parameters<RegistrarTenant["execute"]>[0]> = {}) => ({
  empresa: { razonSocial: "Transporte Duster SAS" },
  administrador: { nombre: "Luis", correo: "duster@transporte.co" },
  aceptaTratamientoDatos: true,
  ...over,
});

// ════════════════════════════ spec-001 ════════════════════════════
describe("spec-001 — Onboarding de Empresa (Tenant) con primer Administrador", () => {
  let env: ReturnType<typeof nuevoEntorno>;
  beforeEach(() => (env = nuevoEntorno()));

  it("onboarding exitoso: crea Tenant Free, Admin Activo y registra el consentimiento", async () => {
    const r = await new RegistrarTenant(env.deps).execute(onboarding());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tenant = await env.tenants.findById(r.value.tenantId);
    expect(tenant!.razonSocial).toBe("Transporte Duster SAS");
    expect(tenant!.plan).toBe(PlanSuscripcion.Free);
    expect(tenant!.consentimiento.version).toBe("v1.0");
    expect(tenant!.consentimiento.titular).toBe("duster@transporte.co");
    const admin = await env.usuarios.findById(r.value.tenantId as TenantId, r.value.adminUsuarioId);
    expect(admin!.estado).toBe(EstadoUsuario.Activo);
    expect(admin!.roles).toContain("Administrador");
    expect(env.publisher.porTipo("TenantCreado")).toHaveLength(1);
  });

  it("sin aceptar el tratamiento de datos NO se crea nada (R3)", async () => {
    const r = await new RegistrarTenant(env.deps).execute(onboarding({ aceptaTratamientoDatos: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("tratamiento_no_aceptado");
    expect(env.publisher.porTipo("TenantCreado")).toHaveLength(0);
  });

  it("registro sin NIT (opcional en el MVP) se crea igualmente", async () => {
    const r = await new RegistrarTenant(env.deps).execute(
      onboarding({ empresa: { razonSocial: "Flota Pyme SAS" }, administrador: { nombre: "Ana", correo: "flota@pyme.co" } }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect((await env.tenants.findById(r.value.tenantId))!.nit).toBeUndefined();
  });

  it("rechazo por correo de registro ya en uso (R7)", async () => {
    const reg = new RegistrarTenant(env.deps);
    expect((await reg.execute(onboarding())).ok).toBe(true);
    const r = await reg.execute(onboarding({ empresa: { razonSocial: "Otra SAS" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("correo_ya_registrado");
  });

  it("rechazo por correo inválido", async () => {
    const r = await new RegistrarTenant(env.deps).execute(onboarding({ administrador: { nombre: "X", correo: "no-es-correo" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("correo_invalido");
  });
});

// ════════════════════════════ spec-002 ════════════════════════════
describe("spec-002 — Invitar usuarios y asignar roles dentro del Tenant", () => {
  let env: ReturnType<typeof nuevoEntorno>;
  let tenant: TenantId;
  const ADMIN: Array<import("../../platform/tenant-context").Rol> = ["Administrador"];
  beforeEach(async () => {
    env = nuevoEntorno();
    const r = await new RegistrarTenant(env.deps).execute(onboarding());
    tenant = (r.ok ? r.value.tenantId : "") as TenantId;
    env.publisher.limpiar();
  });

  const invitar = (correo: string, roles: Parameters<InvitarUsuario["execute"]>[0]["roles"], solicitante: Array<import("../../platform/tenant-context").Rol> = [...ADMIN]) =>
    new InvitarUsuario(env.deps).execute({ tenant, solicitanteRoles: solicitante, nombre: "Invitado", correo, roles });

  it("invitar a un Operador emite UsuarioInvitado y lo deja Invitado; al aceptar queda Activo", async () => {
    const r = await invitar("operador@duster.co", ["Operador"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(env.publisher.porTipo("UsuarioInvitado")).toHaveLength(1);
    const u1 = await env.usuarios.findById(tenant, r.value.usuarioId);
    expect(u1!.estado).toBe(EstadoUsuario.Invitado);
    const acc = await new AceptarInvitacion(env.deps).execute({ tenant, usuarioId: r.value.usuarioId });
    expect(acc.ok).toBe(true);
    expect((await env.usuarios.findById(tenant, r.value.usuarioId))!.estado).toBe(EstadoUsuario.Activo);
  });

  it("asignar varios roles a un mismo invitado", async () => {
    const r = await invitar("gestor@duster.co", ["Operador", "GestorPlanilla"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const u = await env.usuarios.findById(tenant, r.value.usuarioId);
      expect(u!.roles).toEqual(["Operador", "GestorPlanilla"]);
    }
  });

  it("suspender y reactivar conserva al Usuario (vía ActualizarUsuario)", async () => {
    const r = await invitar("cond@duster.co", ["Conductor"]);
    const id = r.ok ? r.value.usuarioId : "";
    await new AceptarInvitacion(env.deps).execute({ tenant, usuarioId: id });
    const susp = await new ActualizarUsuario(env.deps).execute({ tenant, solicitanteRoles: [...ADMIN], usuarioId: id, estado: "suspendido" });
    expect(susp.ok && susp.value.estado).toBe(EstadoUsuario.Suspendido);
    const react = await new ActualizarUsuario(env.deps).execute({ tenant, solicitanteRoles: [...ADMIN], usuarioId: id, estado: "activo" });
    expect(react.ok && react.value.estado).toBe(EstadoUsuario.Activo);
  });

  it("un Usuario sin permiso (Operador) NO puede invitar (R1/R11)", async () => {
    const r = await invitar("otro@duster.co", ["Operador"], ["Operador"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("sin_permiso");
  });

  it("la invitación vence sin aceptarse → Expirado (R7)", async () => {
    const r = await invitar("tardio@duster.co", ["Conductor"]);
    const id = r.ok ? r.value.usuarioId : "";
    const exp = await new ExpirarInvitacion(env.deps).execute({ tenant, usuarioId: id });
    expect(exp.ok && exp.value.estado).toBe(EstadoUsuario.Expirado);
  });

  it("rechazo por correo ya vigente en el Tenant", async () => {
    await invitar("operador@duster.co", ["Operador"]);
    const r = await invitar("operador@duster.co", ["Operador"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("correo_ya_existe");
  });

  it("aislamiento: un Usuario invitado en OTRO Tenant no aparece en este Tenant", async () => {
    const r2 = await new RegistrarTenant(env.deps).execute(onboarding({ administrador: { nombre: "B", correo: "b@empresa.co" }, empresa: { razonSocial: "Empresa B" } }));
    const tenantB = (r2.ok ? r2.value.tenantId : "") as TenantId;
    await new InvitarUsuario(env.deps).execute({ tenant: tenantB, solicitanteRoles: [...ADMIN], nombre: "X", correo: "x@empresa.co", roles: ["Operador"] });
    expect(await env.usuarios.list(tenant)).toHaveLength(1); // solo el admin de este tenant
  });
});
