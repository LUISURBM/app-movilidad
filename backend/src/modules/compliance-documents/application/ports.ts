/**
 * Puertos (interfaces) de la capa de aplicación — Clean Architecture.
 * El dominio/aplicación define QUÉ necesita; la infraestructura (futura) implementa CÓMO.
 * Aquí no hay TypeORM ni Postgres: solo contratos.
 */
import { TenantId } from "../../../shared/kernel";
import { Documento } from "../domain/documento.aggregate";
import { SujetoRef, TipoDocumento } from "../domain/value-objects";
import { DomainEvent } from "../domain/events";

/** Repositorio de Documentos, siempre operando dentro de un Tenant (multi-tenant). */
export interface DocumentoRepository {
  save(tenant: TenantId, doc: Documento): Promise<void>;
  findById(tenant: TenantId, id: string): Promise<Documento | null>;
  /** Documentos VIGENTES (versión actual) de un sujeto. */
  findVigentesBySujeto(tenant: TenantId, sujeto: SujetoRef): Promise<Documento[]>;
  /** ¿Existe ya un Documento vigente de ese Tipo para el sujeto? (Invariante I2, spec-005 R6). */
  existsVigenteDelTipo(tenant: TenantId, sujeto: SujetoRef, tipoCodigo: string): Promise<boolean>;
  /** Todos los Documentos del tenant (para la evaluación diaria). */
  findAll(tenant: TenantId): Promise<Documento[]>;
}

/** Catálogo configurable de Tipos de documento por Tenant (spec-005 R2/R10). */
export interface CatalogoTiposRepository {
  findByCodigo(tenant: TenantId, codigo: string): Promise<TipoDocumento | null>;
  findRequeridos(tenant: TenantId): Promise<TipoDocumento[]>;
  findAll(tenant: TenantId): Promise<TipoDocumento[]>;
  /** Inserta o actualiza (por código) un Tipo del catálogo del tenant. */
  save(tenant: TenantId, tipo: TipoDocumento): Promise<void>;
}

/**
 * Publicador de eventos de dominio. En producción escribe al outbox transaccional
 * (ADR-0004); aquí se abstrae para poder verificar emisiones en pruebas.
 */
export interface EventPublisher {
  publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void>;
}
