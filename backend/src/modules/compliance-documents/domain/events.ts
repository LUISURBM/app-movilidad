/**
 * Domain Events del contexto Compliance & Documents — Fase 2 (catálogo) + AsyncAPI.
 * Estos eventos se persistirían en el outbox (ADR-0004); aquí se modelan como objetos
 * planos que el agregado acumula. Coinciden con los payloads del contrato asyncapi.yaml.
 */
import { SujetoRef, UmbralAlerta } from "./value-objects";

export type DomainEvent =
  | DocumentoRegistrado
  | DocumentoPorVencer
  | DocumentoVencido
  | DocumentoRenovado;

interface BaseEvent {
  readonly tipo: string;
  readonly ocurridoEn: string; // ISO date-time
}

/** spec-005 R9. */
export interface DocumentoRegistrado extends BaseEvent {
  readonly tipo: "DocumentoRegistrado";
  readonly documentoId: string;
  readonly sujeto: SujetoRef;
  readonly tipoDocumento: string;
  readonly vencimiento: string; // YYYY-MM-DD
}

/** spec-006 P1 — alerta anticipada (30/15/3). */
export interface DocumentoPorVencer extends BaseEvent {
  readonly tipo: "DocumentoPorVencer";
  readonly documentoId: string;
  readonly sujeto: SujetoRef;
  readonly tipoDocumento: string;
  readonly diasRestantes: UmbralAlerta;
}

/** spec-006 P2 — vencimiento superado. */
export interface DocumentoVencido extends BaseEvent {
  readonly tipo: "DocumentoVencido";
  readonly documentoId: string;
  readonly sujeto: SujetoRef;
  readonly tipoDocumento: string;
}

/** spec-007 R7 — renovación. */
export interface DocumentoRenovado extends BaseEvent {
  readonly tipo: "DocumentoRenovado";
  readonly documentoId: string;
  readonly nuevoVencimiento: string; // YYYY-MM-DD
  readonly versionAnterior: number;
}

export const nowIso = (): string => new Date().toISOString();
