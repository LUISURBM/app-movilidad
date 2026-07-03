/**
 * Domain Events del contexto Fleet Management (BC-2) — spec-003 + AsyncAPI.
 * Se persisten en el outbox (ADR-0004); el agregado los acumula y la capa de
 * aplicación los publica. Coinciden con los payloads del contrato asyncapi.yaml.
 */

export type DomainEvent = VehiculoRegistrado | VehiculoAfiliado | OdometroActualizado;

interface BaseEvent {
  readonly tipo: string;
  readonly ocurridoEn: string; // ISO date-time
}

/** spec-003 R8. Consumidores: Compliance (expediente), Scheduling, Billing (conteo). */
export interface VehiculoRegistrado extends BaseEvent {
  readonly tipo: "VehiculoRegistrado";
  readonly vehiculoId: string;
  readonly placa: string;
  readonly clase: string;
  readonly propietarioId?: string;
}

/** spec-003 R9. Afiliación a empresa transportadora. */
export interface VehiculoAfiliado extends BaseEvent {
  readonly tipo: "VehiculoAfiliado";
  readonly vehiculoId: string;
  readonly empresaTransportadoraId: string;
  readonly desde: string; // YYYY-MM-DD
}

/** spec-003 R6 (lectura autoritativa avanza). Consumidores: Maintenance (P6), Fuel (costo/km). */
export interface OdometroActualizado extends BaseEvent {
  readonly tipo: "OdometroActualizado";
  readonly vehiculoId: string;
  readonly lectura: number;
  readonly fuente: "manual" | "tanqueo" | "servicio";
}

export const nowIso = (): string => new Date().toISOString();
