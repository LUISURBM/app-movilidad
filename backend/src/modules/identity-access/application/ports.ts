/**
 * Puertos (interfaces) de la capa de aplicación de Identity & Access — Clean Architecture.
 */
import { TenantId } from "../../../shared/kernel";
import { Tenant } from "../domain/tenant.aggregate";
import { Usuario } from "../domain/usuario.aggregate";
import { DomainEvent } from "../domain/events";

/**
 * Repositorio de Tenants (Empresas) — el REGISTRO de tenants. No es tenant-scoped como el
 * resto: el onboarding (spec-001) es público y crea el Tenant. `existsCorreoRegistro`
 * materializa la unicidad global del correo de registro (R7).
 */
export interface TenantRepository {
  save(tenant: Tenant): Promise<void>;
  findById(id: string): Promise<Tenant | null>;
  existsCorreoRegistro(correo: string): Promise<boolean>;
}

/** Repositorio de Usuarios, dentro de un Tenant (multi-tenant, ADR-0008). */
export interface UsuarioRepository {
  save(tenant: TenantId, usuario: Usuario): Promise<void>;
  findById(tenant: TenantId, id: string): Promise<Usuario | null>;
  /** Para la unicidad de correo dentro del Tenant (spec-002). */
  findByCorreo(tenant: TenantId, correo: string): Promise<Usuario | null>;
  list(tenant: TenantId): Promise<Usuario[]>;
}

/**
 * Publicador de eventos de dominio. En producción escribe al outbox transaccional
 * (ADR-0004); se abstrae para verificar emisiones en pruebas.
 */
export interface EventPublisher {
  publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void>;
}
