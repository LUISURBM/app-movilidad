/**
 * Domain Events del contexto Service Scheduling — spec-008/009 + AsyncAPI.
 * Se persisten en el outbox (ADR-0004); el agregado los acumula y la capa de
 * aplicación los publica. Coinciden con los payloads del contrato asyncapi.yaml.
 */
import { MotivoRechazo } from "./value-objects";

export type DomainEvent =
  | ServicioCreado
  | ServicioAsignado
  | AsignacionRechazada
  | ServicioIniciado
  | ServicioFinalizado
  | NovedadReportada;

interface BaseEvent {
  readonly tipo: string;
  readonly ocurridoEn: string; // ISO date-time
}

export interface VentanaPayload {
  readonly inicio: string; // ISO date-time
  readonly fin: string; // ISO date-time
}

/** spec-008 R8. */
export interface ServicioCreado extends BaseEvent {
  readonly tipo: "ServicioCreado";
  readonly servicioId: string;
  readonly ruta: { readonly origen: string; readonly destino: string };
  readonly ventana: VentanaPayload;
  readonly clienteRef?: string;
}

/** spec-008 R9 — sincroniza la app del conductor. */
export interface ServicioAsignado extends BaseEvent {
  readonly tipo: "ServicioAsignado";
  readonly servicioId: string;
  readonly vehiculoId: string;
  readonly conductorId: string;
  readonly ventana: VentanaPayload;
}

/** spec-008 R10 (P4, choque) / spec-009 R3 (P3, incumplimiento). */
export interface AsignacionRechazada extends BaseEvent {
  readonly tipo: "AsignacionRechazada";
  readonly servicioId: string;
  readonly motivo: MotivoRechazo;
  /** Detalle legible para el Operador (p. ej. qué recurso está en rojo). */
  readonly detalle?: string;
}

/** spec-010 (la transición S1/S2 se protege desde spec-008). */
export interface ServicioIniciado extends BaseEvent {
  readonly tipo: "ServicioIniciado";
  readonly servicioId: string;
  readonly inicioReal: string; // ISO date-time
  readonly odometroInicio?: number;
}

/** spec-010 — alimenta Fleet (odómetro), Billing y Maintenance. */
export interface ServicioFinalizado extends BaseEvent {
  readonly tipo: "ServicioFinalizado";
  readonly servicioId: string;
  readonly finReal: string; // ISO date-time
  readonly odometroFin?: number;
}

/** spec-014 — Novedad append-only reportada por el Conductor. `tipo` es el discriminante
 * del evento; `tipoNovedad` es la clase de la Novedad. Consumidores: operador, memoria operativa. */
export interface NovedadReportada extends BaseEvent {
  readonly tipo: "NovedadReportada";
  readonly servicioId: string;
  readonly tipoNovedad: "incidente" | "retraso" | "siniestro";
  readonly fotoRef?: string;
}

export const nowIso = (): string => new Date().toISOString();
