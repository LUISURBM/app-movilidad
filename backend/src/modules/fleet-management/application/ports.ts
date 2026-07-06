/**
 * Puertos (interfaces) de la capa de aplicación de Fleet Management — Clean Architecture.
 */
import { TenantId } from "../../../shared/kernel";
import { Vehiculo } from "../domain/vehiculo.aggregate";
import { DomainEvent } from "../domain/events";

/** Repositorio de Vehículos, siempre dentro de un Tenant (multi-tenant, ADR-0008). */
export interface VehiculoRepository {
  save(tenant: TenantId, vehiculo: Vehiculo): Promise<void>;
  findById(tenant: TenantId, id: string): Promise<Vehiculo | null>;
  /** Para R2: unicidad de Placa por Tenant. */
  findByPlaca(tenant: TenantId, placa: string): Promise<Vehiculo | null>;
  list(tenant: TenantId): Promise<Vehiculo[]>;
}

/**
 * Publicador de eventos de dominio. En producción escribe al outbox transaccional
 * (ADR-0004); se abstrae para verificar emisiones en pruebas.
 */
export interface EventPublisher {
  publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void>;
}

/**
 * Suscripción in-process a los eventos de Fleet: consumidores aguas abajo
 * (p. ej. Maintenance — spec-012 P6 reacciona a `OdometroActualizado`) se
 * registran en el composition root SIN que Fleet los conozca. En la variante
 * SQL el equivalente es un sink del dispatcher del outbox (ADR-0004); este
 * puerto cubre el wiring in-memory de dev y las pruebas.
 */
export type SuscriptorEventosFleet = (
  tenant: TenantId,
  evento: DomainEvent,
) => Promise<void>;

export interface PublicadorSuscribible extends EventPublisher {
  suscribir(suscriptor: SuscriptorEventosFleet): void;
}
