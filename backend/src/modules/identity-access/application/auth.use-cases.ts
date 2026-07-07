/**
 * Casos de uso de AUTENTICACIÓN (spec-015): IniciarSesion, AceptarInvitacionConCodigo
 * y CambiarPassword. Orquestan dominio + puertos; el emisor de tokens es un puerto
 * (JWT HS256 hoy, OIDC mañana).
 */
import { createHash } from "node:crypto";
import { Clock, DomainError, Result, TenantId, err, ok } from "../../../shared/kernel";
import { Usuario } from "../domain/usuario.aggregate";
import { Tenant } from "../domain/tenant.aggregate";
import { EstadoUsuario } from "../domain/value-objects";
import { TenantRepository, UsuarioRepository } from "./ports";
import {
  Credencial,
  CredencialRepository,
  EmisorTokens,
  HasherPassword,
  InvitacionRepository,
  SesionEmitida,
} from "./auth.ports";

export const PASSWORD_MIN_LARGO = 10;

/** SHA-256 hex de un código de invitación (el código es de alta entropía). */
export function hashCodigoInvitacion(codigo: string): string {
  return createHash("sha256").update(codigo).digest("hex");
}

export function normalizarCorreo(correo: string): string {
  return correo.trim().toLowerCase();
}

function passwordDebil(password: string): DomainError | null {
  if (!password || password.length < PASSWORD_MIN_LARGO) {
    return new DomainError(
      "password_debil",
      `La contraseña debe tener al menos ${PASSWORD_MIN_LARGO} caracteres.`,
    );
  }
  return null;
}

export interface AuthDeps {
  credenciales: CredencialRepository;
  invitaciones: InvitacionRepository;
  usuarios: UsuarioRepository;
  tenants: TenantRepository;
  hasher: HasherPassword;
  emisor: EmisorTokens;
  clock: Clock;
}

export interface SesionCreada {
  sesion: SesionEmitida;
  usuario: Usuario;
  tenant: Tenant;
}

const NO_CONFIGURADA = new DomainError(
  "auth_no_configurada",
  "La autenticación no está configurada en este servidor (falta el secreto de tokens).",
);
const CREDENCIALES_INVALIDAS = new DomainError(
  "credenciales_invalidas",
  "Correo o contraseña incorrectos.",
);

// ───────────────────────── spec-015: Iniciar sesión ─────────────────────────

export class IniciarSesion {
  /** Hash de sacrificio para igualar el tiempo cuando el correo no existe. */
  private hashSacrificio: Promise<string> | undefined;

  constructor(private readonly deps: AuthDeps) {}

  async execute(input: {
    correo: string;
    password: string;
    empresaNit?: string;
  }): Promise<Result<SesionCreada>> {
    if (!this.deps.emisor.disponible()) return err(NO_CONFIGURADA);

    const correo = normalizarCorreo(input.correo);
    let candidatas = await this.deps.credenciales.buscarPorCorreo(correo);

    // Desambiguación por Empresa (mismo correo en varios tenants — spec-002).
    if (input.empresaNit && candidatas.length > 0) {
      const filtradas: Credencial[] = [];
      for (const c of candidatas) {
        const t = await this.deps.tenants.findById(c.tenantId);
        if (t?.nit && t.nit === input.empresaNit.trim()) filtradas.push(c);
      }
      candidatas = filtradas;
    }

    if (candidatas.length === 0) {
      // Verificación de sacrificio: mismo costo que un intento real (no filtrar correos).
      this.hashSacrificio ??= this.deps.hasher.derivar("sacrificio-timing");
      await this.deps.hasher.verificar(input.password, await this.hashSacrificio);
      return err(CREDENCIALES_INVALIDAS);
    }
    if (candidatas.length > 1) {
      return err(
        new DomainError(
          "multiples_empresas",
          "El correo pertenece a varias Empresas: indique el NIT de la Empresa (empresaNit).",
        ),
      );
    }

    const credencial = candidatas[0];
    const valida = await this.deps.hasher.verificar(input.password, credencial.passwordHash);
    if (!valida) return err(CREDENCIALES_INVALIDAS);

    const tenant = await this.deps.tenants.findById(credencial.tenantId);
    const usuario = await this.deps.usuarios.findById(
      credencial.tenantId as TenantId,
      credencial.usuarioId,
    );
    if (!tenant || !usuario) return err(CREDENCIALES_INVALIDAS);
    if (usuario.estado !== EstadoUsuario.Activo) {
      return err(
        new DomainError("usuario_no_activo", "El usuario no está habilitado para iniciar sesión."),
      );
    }

    const sesion = this.deps.emisor.emitir({
      sub: usuario.id,
      tenantId: tenant.id,
      roles: usuario.roles,
    });
    return ok({ sesion, usuario, tenant });
  }
}

// ─────────────── spec-015: Aceptar invitación con código (cierra spec-002) ───────────────

export class AceptarInvitacionConCodigo {
  constructor(private readonly deps: AuthDeps) {}

  async execute(input: { codigo: string; password: string }): Promise<Result<SesionCreada>> {
    if (!this.deps.emisor.disponible()) return err(NO_CONFIGURADA);

    const debil = passwordDebil(input.password);
    if (debil) return err(debil);

    const NO_VALIDA = new DomainError(
      "invitacion_no_valida",
      "La invitación no existe, ya fue usada o está vencida.",
    );

    const codigo = (input.codigo ?? "").trim();
    if (!codigo) return err(NO_VALIDA);

    const invitacion = await this.deps.invitaciones.consumir(
      hashCodigoInvitacion(codigo),
      this.deps.clock.now(),
    );
    if (!invitacion) return err(NO_VALIDA);

    const tenantId = invitacion.tenantId as TenantId;
    const usuario = await this.deps.usuarios.findById(tenantId, invitacion.usuarioId);
    const tenant = await this.deps.tenants.findById(invitacion.tenantId);
    if (!usuario || !tenant) return err(NO_VALIDA);

    // Transición Invitado → Activo (spec-002 R7). Si ya no es invitado, el código no vale.
    const aceptado = usuario.aceptar();
    if (!aceptado.ok) return err(NO_VALIDA);

    await this.deps.credenciales.guardar({
      tenantId: invitacion.tenantId,
      usuarioId: usuario.id,
      correo: normalizarCorreo(usuario.correo.valor),
      passwordHash: await this.deps.hasher.derivar(input.password),
    });
    await this.deps.usuarios.save(tenantId, usuario);

    const sesion = this.deps.emisor.emitir({
      sub: usuario.id,
      tenantId: tenant.id,
      roles: usuario.roles,
    });
    return ok({ sesion, usuario, tenant });
  }
}

// ───────────────────────── spec-015: Cambiar contraseña propia ─────────────────────────

export class CambiarPassword {
  constructor(private readonly deps: AuthDeps) {}

  async execute(input: {
    tenant: TenantId;
    usuarioId: string;
    actual: string;
    nueva: string;
  }): Promise<Result<void>> {
    const debil = passwordDebil(input.nueva);
    if (debil) return err(debil);

    const credencial = await this.deps.credenciales.obtener(input.tenant, input.usuarioId);
    if (!credencial) return err(CREDENCIALES_INVALIDAS);

    const valida = await this.deps.hasher.verificar(input.actual, credencial.passwordHash);
    if (!valida) return err(CREDENCIALES_INVALIDAS);

    await this.deps.credenciales.guardar({
      ...credencial,
      passwordHash: await this.deps.hasher.derivar(input.nueva),
    });
    return ok(undefined);
  }
}
