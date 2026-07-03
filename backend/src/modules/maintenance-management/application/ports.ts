/**
 * Puertos (interfaces) de la capa de aplicación de Maintenance Management — Clean Architecture.
 */
import { TenantId } from "../../../shared/kernel";
import { Umbral } from "../domain/umbral.aggregate";
import { DomainEvent } from "../domain/events";

/** Repositorio de Umbrales de mantenimiento, dentro de un Tenant. Uno por Vehículo. */
export interface UmbralRepository {
  findByVehiculo(tenant: TenantId, vehiculoId: string): Promise<Umbral | null>;
  save(tenant: TenantId, umbral: Umbral): Promise<void>;
  list(tenant: TenantId): Promise<Umbral[]>;
}

export interface EventPublisher {
  publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void>;
}
