/**
 * Casos de uso del contexto Identity & Access (BC-1) — spec-001 / spec-002.
 * Orquestan el dominio y los puertos; sin dependencias de framework.
 */
import { Clock, DomainError, IdGenerator, Result, TenantId, err, ok } from "../../../shared/kernel";
import { Rol } from "../../../platform/tenant-context";
import { Tenant } from "../domain/tenant.aggregate";
import { Usuario } from "../domain/usuario.aggregate";
import { Consentimiento, Correo, EstadoUsuario } from "../domain/value-objects";
import { EventPublisher, TenantRepository, UsuarioRepository } from "./ports";

export interface IdentityDeps {
  tenants: TenantRepository;
  usuarios: UsuarioRepository;
  publisher: EventPublisher;
  clock: Clock;
  ids: IdGenerator;
}

/** Versión vigente de la política de tratamiento de datos (el contrato no la envía). */
const VERSION_POLITICA_ACTUAL = "v1.0";

// ───────────────────────── spec-001: Registrar Empresa (onboarding) ─────────────────────────

export interface RegistrarTenantInput {
  empresa: { razonSocial: string; nit?: string };
  administrador: { nombre: string; correo: string };
  aceptaTratamientoDatos: boolean;
}

export class RegistrarTenant {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(
    input: RegistrarTenantInput,
  ): Promise<Result<{ tenantId: string; adminUsuarioId: string }>> {
    // R3: sin aceptación del tratamiento de datos NO se crea nada.
    if (!input.aceptaTratamientoDatos) {
      return err(
        new DomainError("tratamiento_no_aceptado", "La aceptación del tratamiento de datos (Habeas Data) es obligatoria."),
      );
    }

    let correo: Correo;
    try {
      correo = Correo.de(input.administrador.correo);
    } catch (e) {
      if (e instanceof DomainError) return err(e);
      throw e;
    }

    // R7: el correo de registro es único entre Empresas activas.
    if (await this.deps.tenants.existsCorreoRegistro(correo.valor)) {
      return err(new DomainError("correo_ya_registrado", "El correo ya está en uso por otra Empresa."));
    }

    const tenantId = this.deps.ids.next();
    const adminId = this.deps.ids.next();

    // R5: primer Usuario Administrador/Owner, Activo.
    const admin = Usuario.crearAdministrador({
      id: adminId,
      tenantId,
      nombre: input.administrador.nombre,
      correo,
    });

    // R3/R4: evidencia del consentimiento (versión + fecha + titular).
    const consentimiento = Consentimiento.aceptar({
      version: VERSION_POLITICA_ACTUAL,
      aceptadoEn: this.deps.clock.now().toISOString(),
      titular: correo.valor,
    });

    // R6: nace en plan Free.
    const t = Tenant.crear({
      id: tenantId,
      razonSocial: input.empresa.razonSocial,
      nit: input.empresa.nit,
      correoRegistro: correo,
      consentimiento,
      adminUsuarioId: adminId,
    });
    if (!t.ok) return t;

    await this.deps.tenants.save(t.value);
    await this.deps.usuarios.save(tenantId as TenantId, admin);
    await this.deps.publisher.publish(tenantId as TenantId, t.value.pullEventos());
    return ok({ tenantId, adminUsuarioId: adminId });
  }
}

// ───────────────────────── spec-002: Invitar Usuario ─────────────────────────

export interface InvitarUsuarioInput {
  tenant: TenantId;
  /** Roles del solicitante (del contexto de auth) — RBAC R1/R11. */
  solicitanteRoles: readonly Rol[];
  nombre: string;
  correo: string;
  roles: Rol[];
}

export class InvitarUsuario {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(input: InvitarUsuarioInput): Promise<Result<{ usuarioId: string }>> {
    // R1/R11: solo Administrador/Owner puede invitar.
    if (!input.solicitanteRoles.includes("Administrador")) {
      return err(new DomainError("sin_permiso", "Solo un Administrador/Owner puede invitar usuarios."));
    }

    let correo: Correo;
    try {
      correo = Correo.de(input.correo);
    } catch (e) {
      if (e instanceof DomainError) return err(e);
      throw e;
    }

    // Rechazo si el correo ya pertenece a un Usuario vigente del Tenant (no removido/expirado).
    const existente = await this.deps.usuarios.findByCorreo(input.tenant, correo.valor);
    if (existente && ![EstadoUsuario.Removido, EstadoUsuario.Expirado].includes(existente.estado)) {
      return err(new DomainError("correo_ya_existe", "El correo ya pertenece a un Usuario del Tenant."));
    }

    const creado = Usuario.invitar({
      id: this.deps.ids.next(),
      tenantId: input.tenant,
      nombre: input.nombre,
      correo,
      roles: input.roles,
    });
    if (!creado.ok) return creado;

    await this.deps.usuarios.save(input.tenant, creado.value);
    await this.deps.publisher.publish(input.tenant, creado.value.pullEventos());
    return ok({ usuarioId: creado.value.id });
  }
}

// ───────────────────────── spec-002: Aceptar invitación / Expirar ─────────────────────────

export class AceptarInvitacion {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(input: { tenant: TenantId; usuarioId: string }): Promise<Result<{ estado: string }>> {
    const u = await this.deps.usuarios.findById(input.tenant, input.usuarioId);
    if (!u) return err(new DomainError("usuario_no_encontrado", "El Usuario no existe en este Tenant."));
    const r = u.aceptar();
    if (!r.ok) return r;
    await this.deps.usuarios.save(input.tenant, u);
    return ok({ estado: u.estado });
  }
}

export class ExpirarInvitacion {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(input: { tenant: TenantId; usuarioId: string }): Promise<Result<{ estado: string }>> {
    const u = await this.deps.usuarios.findById(input.tenant, input.usuarioId);
    if (!u) return err(new DomainError("usuario_no_encontrado", "El Usuario no existe en este Tenant."));
    const r = u.expirar();
    if (!r.ok) return r;
    await this.deps.usuarios.save(input.tenant, u);
    return ok({ estado: u.estado });
  }
}

// ───────────────────────── spec-002: Actualizar Usuario (roles / estado) ─────────────────────────

export interface ActualizarUsuarioInput {
  tenant: TenantId;
  solicitanteRoles: readonly Rol[];
  usuarioId: string;
  roles?: Rol[];
  estado?: "activo" | "suspendido";
}

export class ActualizarUsuario {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(input: ActualizarUsuarioInput): Promise<Result<{ estado: string; roles: readonly Rol[] }>> {
    if (!input.solicitanteRoles.includes("Administrador")) {
      return err(new DomainError("sin_permiso", "Solo un Administrador/Owner puede gestionar usuarios."));
    }
    const u = await this.deps.usuarios.findById(input.tenant, input.usuarioId);
    if (!u) return err(new DomainError("usuario_no_encontrado", "El Usuario no existe en este Tenant."));

    if (input.roles) {
      const r = u.actualizarRoles(input.roles);
      if (!r.ok) return r;
    }
    if (input.estado === "suspendido") {
      const r = u.suspender();
      if (!r.ok) return r;
    } else if (input.estado === "activo") {
      // Reactivar (si estaba suspendido) o aceptar (si estaba invitado).
      const r = u.estado === EstadoUsuario.Invitado ? u.aceptar() : u.reactivar();
      if (!r.ok) return r;
    }

    await this.deps.usuarios.save(input.tenant, u);
    return ok({ estado: u.estado, roles: u.roles });
  }
}
