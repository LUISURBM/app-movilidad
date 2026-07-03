/**
 * Domain Events del contexto Identity & Access (BC-1) — spec-001 / spec-002 + AsyncAPI.
 * Se publican vía outbox (ADR-0004).
 */
import { Rol } from "../../../platform/tenant-context";

export type DomainEvent = TenantCreado | UsuarioInvitado;

interface BaseEvent {
  readonly tipo: string;
  readonly ocurridoEn: string; // ISO date-time
}

/**
 * spec-001 R9 (alta inicial). Dispara el onboarding. (AsyncAPI: candidato a añadir junto a
 * `UsuarioInvitado`/`SuscripcionActivada`; hoy documentado como evento del BC-1.)
 */
export interface TenantCreado extends BaseEvent {
  readonly tipo: "TenantCreado";
  readonly tenantId: string;
  readonly razonSocial: string;
  readonly plan: string;
  readonly adminUsuarioId: string;
}

/** spec-002 R6. Consumidores: Notificaciones (onboarding del invitado). */
export interface UsuarioInvitado extends BaseEvent {
  readonly tipo: "UsuarioInvitado";
  readonly usuarioId: string;
  readonly tenantId: string;
  readonly roles: readonly Rol[];
}

export const nowIso = (): string => new Date().toISOString();
