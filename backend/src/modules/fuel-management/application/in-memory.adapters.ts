/**
 * Adaptadores EN MEMORIA de los puertos de Fuel Management — para pruebas y desarrollo
 * sin infraestructura. Respetan el aislamiento por Tenant (clave compuesta tenant + id).
 * No son para producción; la implementación real (TypeORM/Postgres + RLS + outbox)
 * está en la capa infrastructure.
 */
import { TenantId } from "../../../shared/kernel";
import { Tanqueo } from "../domain/tanqueo.aggregate";
import { DomainEvent } from "../domain/events";
import {
  EventPublisher,
  OdometroVehiculoGateway,
  ResultadoOdometro,
  TanqueoRepository,
} from "./ports";

const key = (tenant: TenantId, id: string) => `${tenant}::${id}`;

/** Repositorio append-only en memoria, con dedupe idempotente por (tenant, clientId). */
export class InMemoryTanqueoRepository implements TanqueoRepository {
  /** Índice por clientId para idempotencia (R5). */
  private porClientId = new Map<string, Tanqueo>();
  /** Todos los hechos, en orden de inserción (para listByVehiculo, R9). */
  private readonly todos: Array<{ tenant: TenantId; tanqueo: Tanqueo }> = [];

  async findByClientId(tenant: TenantId, clientId: string): Promise<Tanqueo | null> {
    return this.porClientId.get(key(tenant, clientId)) ?? null;
  }

  async append(tenant: TenantId, tanqueo: Tanqueo): Promise<void> {
    const k = key(tenant, tanqueo.clientId);
    // Append-only + idempotencia: si ya existe el clientId, NO se reinserta.
    if (this.porClientId.has(k)) return;
    this.porClientId.set(k, tanqueo);
    this.todos.push({ tenant, tanqueo });
  }

  async listByVehiculo(tenant: TenantId, vehiculoId: string): Promise<Tanqueo[]> {
    return this.todos
      .filter((t) => t.tenant === tenant && t.tanqueo.vehiculoId === vehiculoId)
      .map((t) => t.tanqueo);
  }
}

/**
 * Autoridad de Odómetro en memoria (stand-in de BC-2 Fleet mientras spec-003 no exista).
 * Aplica la monotonía P8/R8: solo avanza; una lectura menor es anomalía y no retrocede.
 */
export class InMemoryOdometroVehiculo implements OdometroVehiculoGateway {
  private lecturas = new Map<string, number>();

  /** Fija una lectura autoritativa inicial (para preparar escenarios de prueba). */
  seed(tenant: TenantId, vehiculoId: string, km: number): void {
    this.lecturas.set(key(tenant, vehiculoId), km);
  }

  async lecturaActual(tenant: TenantId, vehiculoId: string): Promise<number | null> {
    return this.lecturas.get(key(tenant, vehiculoId)) ?? null;
  }

  async aplicarLectura(
    tenant: TenantId,
    vehiculoId: string,
    odometroKm: number,
  ): Promise<ResultadoOdometro> {
    const k = key(tenant, vehiculoId);
    const actual = this.lecturas.get(k);
    if (actual === undefined || odometroKm >= actual) {
      this.lecturas.set(k, odometroKm);
      return { aplicado: true, anomalia: false, lecturaAutoritativa: odometroKm };
    }
    // Lectura menor a la autoritativa → anomalía; NO retrocede (R8).
    return { aplicado: false, anomalia: true, lecturaAutoritativa: actual };
  }
}

/** Publicador en memoria: acumula los eventos para poder verificarlos en pruebas. */
export class InMemoryEventPublisher implements EventPublisher {
  public readonly publicados: Array<{ tenant: TenantId; evento: DomainEvent }> = [];

  async publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void> {
    for (const e of eventos) this.publicados.push({ tenant, evento: e });
  }

  porTipo<T extends DomainEvent["tipo"]>(tipo: T): Array<Extract<DomainEvent, { tipo: T }>> {
    return this.publicados
      .map((p) => p.evento)
      .filter((e): e is Extract<DomainEvent, { tipo: T }> => e.tipo === tipo);
  }

  limpiar(): void {
    this.publicados.length = 0;
  }
}
