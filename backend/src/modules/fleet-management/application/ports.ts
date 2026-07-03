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
