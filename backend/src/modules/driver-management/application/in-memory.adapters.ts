/**
 * Adaptadores EN MEMORIA de los puertos de Driver — para pruebas y desarrollo.
 * Respetan el aislamiento por Tenant (clave compuesta tenant + id).
 */
import { Result, TenantId, ok } from "../../../shared/kernel";
import { Conductor } from "../domain/conductor.aggregate";
import { DomainEvent } from "../domain/events";
import { ConductorRepository, EventPublisher, RegistradorLicencia } from "./ports";

const key = (tenant: TenantId, id: string) => `${tenant}::${id}`;

export class InMemoryConductorRepository implements ConductorRepository {
  private store = new Map<string, Conductor>();

  async save(tenant: TenantId, conductor: Conductor): Promise<void> {
    this.store.set(key(tenant, conductor.id), conductor);
  }
  async findById(tenant: TenantId, id: string): Promise<Conductor | null> {
    return this.store.get(key(tenant, id)) ?? null;
  }
  async findByDocumento(tenant: TenantId, documento: string): Promise<Conductor | null> {
    return this.delTenant(tenant).find((c) => c.documento.valor === documento) ?? null;
  }
  async list(tenant: TenantId): Promise<Conductor[]> {
    return this.delTenant(tenant);
  }
  private delTenant(tenant: TenantId): Conductor[] {
    return [...this.store.entries()].filter(([k]) => k.startsWith(`${tenant}::`)).map(([, c]) => c);
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

/**
 * Stub del ACL de Licencia para pruebas unitarias de Driver: registra las llamadas y
 * confirma por defecto. (La ACL real sobre Compliance está en infrastructure/licencia.acl.ts
 * y se prueba de punta a punta con el módulo Compliance in-memory.)
 */
export class StubRegistradorLicencia implements RegistradorLicencia {
  public readonly llamadas: Array<{ tenant: TenantId; conductorId: string; emision: string; vencimiento: string }> = [];

  async registrar(tenant: TenantId, conductorId: string, emisionIso: string, vencimientoIso: string): Promise<Result<void>> {
    this.llamadas.push({ tenant, conductorId, emision: emisionIso, vencimiento: vencimientoIso });
    return ok(undefined);
  }
}
