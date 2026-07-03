/**
 * Domain Events del contexto Maintenance Management (BC-7) — spec-012 + AsyncAPI.
 * Se publican vía outbox (ADR-0004).
 */

export type DomainEvent = MantenimientoProgramado | MantenimientoVencido | MantenimientoRegistrado;

interface BaseEvent {
  readonly tipo: string;
  readonly ocurridoEn: string; // ISO date-time
}

/** spec-012 R4 (P6). Se programa un preventivo al superar el Umbral. */
export interface MantenimientoProgramado extends BaseEvent {
  readonly tipo: "MantenimientoProgramado";
  readonly mantenimientoId: string;
  readonly vehiculoId: string;
  readonly tipoMantenimiento: "preventivo" | "correctivo";
  readonly dispararPor: "km" | "fecha";
}

/** spec-012 R3 (P7). Llega la fecha objetivo sin ejecución registrada. */
export interface MantenimientoVencido extends BaseEvent {
  readonly tipo: "MantenimientoVencido";
  readonly mantenimientoId: string;
  readonly vehiculoId: string;
  readonly umbralSuperado: string;
}

/** spec-012 R6/R7. Ejecución de un preventivo (reinicia ciclo) o registro de un correctivo. */
export interface MantenimientoRegistrado extends BaseEvent {
  readonly tipo: "MantenimientoRegistrado";
  readonly mantenimientoId: string;
  readonly vehiculoId: string;
  readonly tipoMantenimiento: "preventivo" | "correctivo";
  readonly costoCop: number;
  readonly odometro: number;
}

export const nowIso = (): string => new Date().toISOString();
