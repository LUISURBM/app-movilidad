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
import {
  CredencialRepository,
  GeneradorCodigos,
  HasherPassword,
  InvitacionRepository,
} from "./auth.ports";
import {
  hashCodigoInvitacion,
  normalizarCorreo,
  PASSWORD_MIN_LARGO,
} from "./auth.use-cases";

export interface IdentityDeps {
  tenants: TenantRepository;
  usuarios: UsuarioRepository;
  publisher: EventPublisher;
  clock: Clock;
  ids: IdGenerator;
  /**
   * Costura spec-015 (OPCIONAL para no romper armados previos): con `auth`
   * presente, RegistrarTenant guarda la credencial del primer admin e
   * InvitarUsuario emite el código de invitación de un solo uso.
   */
  auth?: {
    credenciales: CredencialRepository;
    invitaciones: InvitacionRepository;
    hasher: HasherPassword;
    codigos: GeneradorCodigos;
  };
}

/** Vigencia del código de invitación (spec-002 R9 / spec-015 regla 6). */
const INVITACION_DIAS = 7;

/** Versión vigente de la política de tratamiento de datos (el contrato no la envía). */
const VERSION_POLITICA_ACTUAL = "v1.0";

// ───────────────────────── spec-001: Registrar Empresa (onboarding) ─────────────────────────

export interface RegistrarTenantInput {
  empresa: { razonSocial: string; nit?: string };
  /** `password` (spec-015): requerido por el contrato REST; opcional aquí para importaciones. */
  administrador: { nombre: string; correo: string; password?: string };
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

    // spec-015 regla 9: si viene contraseña, validarla ANTES de crear nada.
    const password = input.administrador.password;
    if (password !== undefined && password.length < PASSWORD_MIN_LARGO) {
      return err(
        new DomainError(
          "password_debil",
          `La contraseña debe tener al menos ${PASSWORD_MIN_LARGO} caracteres.`,
        ),
      );
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

    // spec-015: credencial del primer administrador (hash scrypt, nunca la clave).
    if (password !== undefined && this.deps.auth) {
      await this.deps.auth.credenciales.guardar({
        tenantId,
        usuarioId: adminId,
        correo: normalizarCorreo(correo.valor),
        passwordHash: await this.deps.auth.hasher.derivar(password),
      });
    }

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

  async execute(
    input: InvitarUsuarioInput,
  ): Promise<Result<{ usuarioId: string; invitacion?: string }>> {
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

    // spec-015 regla 6: código de un solo uso (solo se guarda su hash; expira en 7 días).
    let invitacion: string | undefined;
    if (this.deps.auth) {
      invitacion = this.deps.auth.codigos.generar();
      const expiraEn = new Date(
        this.deps.clock.now().getTime() + INVITACION_DIAS * 24 * 60 * 60 * 1000,
      ).toISOString();
      await this.deps.auth.invitaciones.guardar({
        codigoHash: hashCodigoInvitacion(invitacion),
        tenantId: input.tenant,
        usuarioId: creado.value.id,
        expiraEn,
      });
    }

    await this.deps.publisher.publish(input.tenant, creado.value.pullEventos());
    return ok({ usuarioId: creado.value.id, ...(invitacion ? { invitacion } : {}) });
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
