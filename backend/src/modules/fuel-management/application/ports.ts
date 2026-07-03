/**
 * Puertos (interfaces) de la capa de aplicación de Fuel Management — Clean Architecture.
 * Fuel define QUÉ necesita; la infraestructura implementa CÓMO.
 */
import { TenantId } from "../../../shared/kernel";
import { Tanqueo } from "../domain/tanqueo.aggregate";
import { DomainEvent } from "../domain/events";

/**
 * Repositorio de Tanqueos — APPEND-ONLY (spec-011 R2), siempre dentro de un Tenant.
 * `append` solo inserta (nunca actualiza ni borra). La idempotencia (R5) se resuelve
 * buscando por `clientId` ANTES de insertar; la unicidad física (tenant, client_id)
 * es la última línea de defensa contra duplicados por carreras (ver migración/infra).
 */
export interface TanqueoRepository {
  /** Busca un Tanqueo ya registrado con ese `clientId` (dedupe idempotente, R5). */
  findByClientId(tenant: TenantId, clientId: string): Promise<Tanqueo | null>;
  /** Inserta un Tanqueo nuevo (append-only). */
  append(tenant: TenantId, tanqueo: Tanqueo): Promise<void>;
  /** Tanqueos de un Vehículo (orden de captura). Para Costo por km / reportes (R9). */
  listByVehiculo(tenant: TenantId, vehiculoId: string): Promise<Tanqueo[]>;
}

/** Resultado de intentar avanzar la lectura autoritativa del Odómetro del Vehículo. */
export interface ResultadoOdometro {
  /** true si la lectura se aplicó (monótona, R8). */
  readonly aplicado: boolean;
  /** true si la lectura era MENOR a la autoritativa → anomalía (P8, R8). */
  readonly anomalia: boolean;
  /** Lectura autoritativa resultante (sin retroceder ante anomalía). */
  readonly lecturaAutoritativa: number;
}

/**
 * ANTI-CORRUPTION LAYER hacia BC-2 Fleet Management (spec-011 R8, Política P8).
 *
 * El Odómetro autoritativo pertenece al Vehículo (BC-2). Fuel NO lo posee: pide
 * "aplica esta lectura respetando monotonía" y recibe si avanzó o si fue anomalía.
 * Mientras BC-2 (spec-003) no exista, el adaptador mantiene la lectura por su cuenta;
 * cuando exista, este puerto pasará a delegar en Fleet SIN tocar el dominio de Fuel.
 */
export interface OdometroVehiculoGateway {
  aplicarLectura(tenant: TenantId, vehiculoId: string, odometroKm: number): Promise<ResultadoOdometro>;
  /** Lectura autoritativa actual (para consultas/pruebas). */
  lecturaActual(tenant: TenantId, vehiculoId: string): Promise<number | null>;
}

/**
 * Publicador de eventos de dominio. En producción escribe al outbox transaccional
 * (ADR-0004); se abstrae para verificar emisiones en pruebas.
 */
export interface EventPublisher {
  publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void>;
}
