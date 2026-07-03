/**
 * Agregado raíz `Usuario` del contexto Identity & Access (BC-1) — spec-001 / spec-002.
 *
 * Pertenece a UN Tenant (R5, multi-membresía diferida). Máquina de estados (spec-002 R7):
 * Invitado → Activo → (Suspendido ↔ Activo) → Removido; Invitado → Expirado.
 * El primer Administrador (spec-001 R5) nace Activo. Las invitaciones nacen Invitado (R6).
 */
import { DomainError, Result, ok, err } from "../../../shared/kernel";
import { Rol } from "../../../platform/tenant-context";
import { Correo, EstadoUsuario } from "./value-objects";
import { DomainEvent, UsuarioInvitado, nowIso } from "./events";

export class Usuario {
  private _eventos: DomainEvent[] = [];

  private constructor(
    public readonly id: string,
    public readonly tenantId: string,
    public readonly nombre: string,
    public readonly correo: Correo,
    private _roles: Rol[],
    private _estado: EstadoUsuario,
  ) {}

  /** Primer Administrador del Tenant (spec-001 R5): nace Activo, sin evento de invitación. */
  static crearAdministrador(params: { id: string; tenantId: string; nombre: string; correo: Correo }): Usuario {
    return new Usuario(params.id, params.tenantId, params.nombre.trim(), params.correo, ["Administrador"], EstadoUsuario.Activo);
  }

  /** Invita a un Usuario (spec-002 R2/R6): nace Invitado con ≥1 Rol; emite UsuarioInvitado. */
  static invitar(params: {
    id: string;
    tenantId: string;
    nombre: string;
    correo: Correo;
    roles: Rol[];
  }): Result<Usuario> {
    if (params.roles.length === 0) {
      return err(new DomainError("roles_requeridos", "La invitación debe incluir al menos un Rol."));
    }
    const u = new Usuario(params.id, params.tenantId, params.nombre.trim(), params.correo, [...params.roles], EstadoUsuario.Invitado);
    u._eventos.push(<UsuarioInvitado>{
      tipo: "UsuarioInvitado",
      ocurridoEn: nowIso(),
      usuarioId: u.id,
      tenantId: u.tenantId,
      roles: [...params.roles],
    });
    return ok(u);
  }

  static rehidratar(params: {
    id: string;
    tenantId: string;
    nombre: string;
    correo: Correo;
    roles: Rol[];
    estado: EstadoUsuario;
  }): Usuario {
    return new Usuario(params.id, params.tenantId, params.nombre, params.correo, [...params.roles], params.estado);
  }

  get roles(): readonly Rol[] {
    return this._roles;
  }
  get estado(): EstadoUsuario {
    return this._estado;
  }

  // ---------- Transiciones de estado (spec-002 R7) ----------

  /** El invitado acepta y fija credenciales → Activo (R8). */
  aceptar(): Result<void> {
    if (this._estado !== EstadoUsuario.Invitado) {
      return this.transicionInvalida("aceptar");
    }
    this._estado = EstadoUsuario.Activo;
    return ok(undefined);
  }

  suspender(): Result<void> {
    if (this._estado !== EstadoUsuario.Activo) return this.transicionInvalida("suspender");
    this._estado = EstadoUsuario.Suspendido;
    return ok(undefined);
  }

  reactivar(): Result<void> {
    if (this._estado !== EstadoUsuario.Suspendido) return this.transicionInvalida("reactivar");
    this._estado = EstadoUsuario.Activo;
    return ok(undefined);
  }

  remover(): Result<void> {
    if (this._estado === EstadoUsuario.Removido) return this.transicionInvalida("remover");
    this._estado = EstadoUsuario.Removido;
    return ok(undefined);
  }

  /** La invitación vence sin aceptarse → Expirado (R7). */
  expirar(): Result<void> {
    if (this._estado !== EstadoUsuario.Invitado) return this.transicionInvalida("expirar");
    this._estado = EstadoUsuario.Expirado;
    return ok(undefined);
  }

  actualizarRoles(roles: Rol[]): Result<void> {
    if (roles.length === 0) return err(new DomainError("roles_requeridos", "El Usuario debe conservar al menos un Rol."));
    this._roles = [...roles];
    return ok(undefined);
  }

  private transicionInvalida(accion: string): Result<void> {
    return err(new DomainError("transicion_invalida", `No se puede "${accion}" un Usuario en estado ${this._estado}.`));
  }

  pullEventos(): DomainEvent[] {
    const e = this._eventos;
    this._eventos = [];
    return e;
  }

  snapshot(): {
    id: string;
    tenantId: string;
    nombre: string;
    correo: string;
    roles: Rol[];
    estado: EstadoUsuario;
  } {
    return {
      id: this.id,
      tenantId: this.tenantId,
      nombre: this.nombre,
      correo: this.correo.valor,
      roles: [...this._roles],
      estado: this._estado,
    };
  }
}
