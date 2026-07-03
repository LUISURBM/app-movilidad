/**
 * Adaptadores EN MEMORIA de los puertos de Identity & Access — para pruebas y desarrollo.
 */
import { TenantId } from "../../../shared/kernel";
import { Tenant } from "../domain/tenant.aggregate";
import { Usuario } from "../domain/usuario.aggregate";
import { DomainEvent } from "../domain/events";
import { EventPublisher, TenantRepository, UsuarioRepository } from "./ports";

const key = (tenant: TenantId, id: string) => `${tenant}::${id}`;

export class InMemoryTenantRepository implements TenantRepository {
  private store = new Map<string, Tenant>();

  async save(tenant: Tenant): Promise<void> {
    this.store.set(tenant.id, tenant);
  }
  async findById(id: string): Promise<Tenant | null> {
    return this.store.get(id) ?? null;
  }
  async existsCorreoRegistro(correo: string): Promise<boolean> {
    return [...this.store.values()].some((t) => t.correoRegistro.valor === correo);
  }
}

export class InMemoryUsuarioRepository implements UsuarioRepository {
  private store = new Map<string, Usuario>();

  async save(tenant: TenantId, usuario: Usuario): Promise<void> {
    this.store.set(key(tenant, usuario.id), usuario);
  }
  async findById(tenant: TenantId, id: string): Promise<Usuario | null> {
    return this.store.get(key(tenant, id)) ?? null;
  }
  async findByCorreo(tenant: TenantId, correo: string): Promise<Usuario | null> {
    return this.delTenant(tenant).find((u) => u.correo.valor === correo) ?? null;
  }
  async list(tenant: TenantId): Promise<Usuario[]> {
    return this.delTenant(tenant);
  }
  private delTenant(tenant: TenantId): Usuario[] {
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
