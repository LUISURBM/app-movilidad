/**
 * Adaptadores EN MEMORIA de los puertos de Fleet — para pruebas y desarrollo sin
 * infraestructura. Respetan el aislamiento por Tenant (clave compuesta tenant + id).
 */
import { TenantId } from "../../../shared/kernel";
import { Vehiculo } from "../domain/vehiculo.aggregate";
import { DomainEvent } from "../domain/events";
import {
  PublicadorSuscribible,
  SuscriptorEventosFleet,
  VehiculoRepository,
} from "./ports";

const key = (tenant: TenantId, id: string) => `${tenant}::${id}`;

export class InMemoryVehiculoRepository implements VehiculoRepository {
  private store = new Map<string, Vehiculo>();

  async save(tenant: TenantId, vehiculo: Vehiculo): Promise<void> {
    this.store.set(key(tenant, vehiculo.id), vehiculo);
  }

  async findById(tenant: TenantId, id: string): Promise<Vehiculo | null> {
    return this.store.get(key(tenant, id)) ?? null;
  }

  async findByPlaca(tenant: TenantId, placa: string): Promise<Vehiculo | null> {
    return this.delTenant(tenant).find((v) => v.placa.valor === placa) ?? null;
  }

  async list(tenant: TenantId): Promise<Vehiculo[]> {
    return this.delTenant(tenant);
  }

  private delTenant(tenant: TenantId): Vehiculo[] {
    return [...this.store.entries()]
      .filter(([k]) => k.startsWith(`${tenant}::`))
      .map(([, v]) => v);
  }
}

/**
 * Publicador en memoria: acumula los eventos para verificarlos en pruebas y los
 * reenvía a los suscriptores in-process (costura P6 de spec-012). Un suscriptor
 * que falla NO tumba el comando que emitió el evento: se deja la advertencia y
 * se sigue — la evaluación por Umbral es idempotente (R8) y se re-evalúa con el
 * próximo avance del odómetro.
 */
export class InMemoryEventPublisher implements PublicadorSuscribible {
  public readonly publicados: Array<{ tenant: TenantId; evento: DomainEvent }> = [];
  private readonly suscriptores: SuscriptorEventosFleet[] = [];

  suscribir(suscriptor: SuscriptorEventosFleet): void {
    this.suscriptores.push(suscriptor);
  }

  async publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void> {
    for (const e of eventos) {
      this.publicados.push({ tenant, evento: e });
      for (const s of this.suscriptores) {
        try {
          await s(tenant, e);
        } catch (err) {
          console.warn(
            `[fleet] suscriptor de eventos falló con ${e.tipo}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
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
