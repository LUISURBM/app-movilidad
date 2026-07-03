/**
 * Adaptadores EN MEMORIA de los puertos de Maintenance — para pruebas y desarrollo.
 */
import { TenantId } from "../../../shared/kernel";
import { Umbral } from "../domain/umbral.aggregate";
import { DomainEvent } from "../domain/events";
import { EventPublisher, UmbralRepository } from "./ports";

const key = (tenant: TenantId, id: string) => `${tenant}::${id}`;

export class InMemoryUmbralRepository implements UmbralRepository {
  private store = new Map<string, Umbral>();

  async findByVehiculo(tenant: TenantId, vehiculoId: string): Promise<Umbral | null> {
    return this.store.get(key(tenant, vehiculoId)) ?? null;
  }
  async save(tenant: TenantId, umbral: Umbral): Promise<void> {
    // Un Umbral por (tenant, vehículo): la clave es el vehiculoId.
    this.store.set(key(tenant, umbral.vehiculoId), umbral);
  }
  async list(tenant: TenantId): Promise<Umbral[]> {
    return [...this.store.entries()].filter(([k]) => k.startsWith(`${tenant}::`)).map(([, u]) => u);
  }
}

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
