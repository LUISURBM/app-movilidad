/**
 * Puertos (interfaces) de la capa de aplicación — Clean Architecture.
 * Scheduling define QUÉ necesita; la infraestructura implementa CÓMO.
 *
 * El puerto clave es `CumplimientoGateway`: la ANTI-CORRUPTION LAYER hacia
 * BC-4 Compliance & Documents (spec-009 R2). Scheduling pregunta
 * `puedeOperar(vehiculoId, conductorId, ventana)` en SU PROPIO lenguaje
 * (`permitido` / `advertencias`) y NO importa a su modelo los Vencimientos
 * ni el Semáforo.
 */
import { TenantId } from "../../../shared/kernel";
import { Servicio } from "../domain/servicio.aggregate";
import { VentanaHoraria } from "../domain/value-objects";
import { VentanaOcupada } from "../domain/agenda.service";
import { DomainEvent } from "../domain/events";

/** Repositorio de Servicios, siempre dentro de un Tenant (multi-tenant, ADR-0008). */
export interface ServicioRepository {
  save(tenant: TenantId, servicio: Servicio): Promise<void>;
  findById(tenant: TenantId, id: string): Promise<Servicio | null>;
  /** Servicios del tenant (agenda), opcionalmente filtrados por estado. */
  list(tenant: TenantId, filtro?: { estado?: string }): Promise<Servicio[]>;
  /** "Mi día" del Conductor (spec-010 R1: solo ve lo suyo). */
  listAsignadosAConductor(tenant: TenantId, conductorId: string): Promise<Servicio[]>;
  /**
   * Ventanas ocupadas por Asignaciones ACTIVAS (Planificado|Iniciado) del Vehículo (S4).
   */
  ventanasOcupadasDeVehiculo(tenant: TenantId, vehiculoId: string): Promise<VentanaOcupada[]>;
  /** Ídem para el Conductor. */
  ventanasOcupadasDeConductor(tenant: TenantId, conductorId: string): Promise<VentanaOcupada[]>;
}

/**
 * Deduplicación idempotente (spec-010 R6/R8): los cambios generados offline llevan
 * un UUID (`clientId`); si el mismo cambio llega dos veces (confirmación perdida),
 * el servidor devuelve la respuesta original SIN aplicar la transición de nuevo.
 * Solo se registran aplicaciones EXITOSAS (los rechazos se re-evalúan: son puros).
 */
export interface RespuestaIdempotente {
  readonly estado: string;
  readonly version: number;
}

export interface IdempotencyStore {
  get(tenant: TenantId, clientId: string): Promise<RespuestaIdempotente | null>;
  save(tenant: TenantId, clientId: string, respuesta: RespuestaIdempotente): Promise<void>;
}

/**
 * Bitácora de sincronización (spec-010 R9/R10): los intentos rechazados contra un
 * estado TERMINAL quedan registrados — nunca se descartan en silencio (R11).
 */
export interface EntradaBitacora {
  readonly servicioId: string;
  readonly usuarioId: string;
  readonly detalle: string;
  readonly ocurridoEn: string; // ISO date-time
}

export interface BitacoraSync {
  registrar(tenant: TenantId, entrada: EntradaBitacora): Promise<void>;
}

/**
 * ACL hacia Compliance & Documents (spec-009 R2).
 * Resultado traducido al lenguaje de Scheduling:
 *  - rojo (Vencido) en cualquiera de los dos recursos → `permitido: false` (P3).
 *  - amarillo (Por vencer) → `permitido: true` + `advertencias` legibles (P11),
 *    indicando QUÉ documento está por vencer y en cuántos días (R9).
 *  - verde (Vigente) → `permitido: true` sin advertencias.
 */
export interface ResultadoOperabilidad {
  readonly permitido: boolean;
  /** Detalle legible cuando NO está permitido (qué recurso/documento está en rojo). */
  readonly motivoBloqueo?: string;
  /** Advertencias no bloqueantes (amarillo). */
  readonly advertencias: readonly string[];
}

export interface CumplimientoGateway {
  puedeOperar(
    tenant: TenantId,
    vehiculoId: string,
    conductorId: string,
    ventana: VentanaHoraria,
  ): Promise<ResultadoOperabilidad>;
}

/**
 * Publicador de eventos de dominio. En producción escribe al outbox transaccional
 * (ADR-0004); se abstrae para verificar emisiones en pruebas.
 */
export interface EventPublisher {
  publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void>;
}
