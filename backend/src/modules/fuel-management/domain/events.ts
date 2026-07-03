/**
 * Domain Events del contexto Fuel Management (BC-6) — spec-011 + AsyncAPI.
 * Se persisten en el outbox (ADR-0004); el agregado los acumula y la capa de
 * aplicación los publica. Coinciden con los payloads del contrato asyncapi.yaml.
 */

export type DomainEvent = CombustibleRegistrado;

interface BaseEvent {
  readonly tipo: string;
  readonly ocurridoEn: string; // ISO date-time
}

/**
 * spec-011 R7: al sincronizar un Tanqueo se emite este hecho. Alimenta el Umbral de
 * mantenimiento (P6, spec-012) y el recálculo del Costo por kilómetro (R9).
 * `litros` es la cantidad canónica (los galones se convierten para el evento).
 */
export interface CombustibleRegistrado extends BaseEvent {
  readonly tipo: "CombustibleRegistrado";
  readonly tanqueoId: string;
  readonly vehiculoId: string;
  readonly litros: number;
  readonly valorCop: number;
  readonly odometro: number;
}

export const nowIso = (): string => new Date().toISOString();
