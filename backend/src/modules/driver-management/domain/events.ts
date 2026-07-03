/**
 * Domain Events del contexto Driver Management (BC-3) — spec-004 + AsyncAPI.
 * Se publican vía outbox (ADR-0004).
 */

export type DomainEvent = ConductorRegistrado;

interface BaseEvent {
  readonly tipo: string;
  readonly ocurridoEn: string; // ISO date-time
}

/** spec-004 R6. Consumidores: Compliance (expediente), Scheduling. */
export interface ConductorRegistrado extends BaseEvent {
  readonly tipo: "ConductorRegistrado";
  readonly conductorId: string;
  readonly usuarioId?: string;
}

export const nowIso = (): string => new Date().toISOString();
