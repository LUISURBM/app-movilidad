/**
 * Puertos (interfaces) de la capa de aplicación de Driver Management — Clean Architecture.
 */
import { Result, TenantId } from "../../../shared/kernel";
import { Conductor } from "../domain/conductor.aggregate";
import { DomainEvent } from "../domain/events";

/** Repositorio de Conductores, siempre dentro de un Tenant (multi-tenant, ADR-0008). */
export interface ConductorRepository {
  save(tenant: TenantId, conductor: Conductor): Promise<void>;
  findById(tenant: TenantId, id: string): Promise<Conductor | null>;
  /** Para R9: unicidad del documento de identidad por Tenant. */
  findByDocumento(tenant: TenantId, documento: string): Promise<Conductor | null>;
  list(tenant: TenantId): Promise<Conductor[]>;
}

export interface EventPublisher {
  publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void>;
}

/**
 * ACL hacia BC-4 Compliance & Documents (spec-004 R5): la Licencia se materializa como
 * un Documento del sujeto Conductor (Tipo "LICENCIA"), para que su vencimiento alimente
 * el Semáforo y la regla de oro (spec-009). Driver NO conoce el dominio de Compliance:
 * delega el registro del Documento a través de este puerto.
 */
export interface RegistradorLicencia {
  registrar(
    tenant: TenantId,
    conductorId: string,
    emisionIso: string,
    vencimientoIso: string,
  ): Promise<Result<void>>;
}
