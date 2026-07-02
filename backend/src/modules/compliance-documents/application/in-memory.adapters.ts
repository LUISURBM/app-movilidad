/**
 * Adaptadores EN MEMORIA de los puertos — para pruebas y desarrollo sin infraestructura.
 * Respetan el aislamiento por Tenant (clave compuesta tenant + id). No son para producción;
 * la implementación real (TypeORM/Postgres + RLS + outbox) llega en la capa infrastructure.
 */
import { TenantId } from "../../../shared/kernel";
import { Documento } from "../domain/documento.aggregate";
import { SujetoRef, TipoDocumento } from "../domain/value-objects";
import { DomainEvent } from "../domain/events";
import { CatalogoTiposRepository, DocumentoRepository, EventPublisher } from "./ports";

const key = (tenant: TenantId, id: string) => `${tenant}::${id}`;

export class InMemoryDocumentoRepository implements DocumentoRepository {
  private store = new Map<string, Documento>();

  async save(tenant: TenantId, doc: Documento): Promise<void> {
    this.store.set(key(tenant, doc.id), doc);
  }

  async findById(tenant: TenantId, id: string): Promise<Documento | null> {
    return this.store.get(key(tenant, id)) ?? null;
  }

  async findVigentesBySujeto(tenant: TenantId, sujeto: SujetoRef): Promise<Documento[]> {
    return [...this.store.entries()]
      .filter(([k]) => k.startsWith(`${tenant}::`))
      .map(([, d]) => d)
      .filter((d) => d.sujeto.equals(sujeto));
  }

  async existsVigenteDelTipo(
    tenant: TenantId,
    sujeto: SujetoRef,
    tipoCodigo: string,
  ): Promise<boolean> {
    const docs = await this.findVigentesBySujeto(tenant, sujeto);
    return docs.some((d) => d.tipo.codigo === tipoCodigo);
  }

  async findAll(tenant: TenantId): Promise<Documento[]> {
    return [...this.store.entries()]
      .filter(([k]) => k.startsWith(`${tenant}::`))
      .map(([, d]) => d);
  }
}

export class InMemoryCatalogoTiposRepository implements CatalogoTiposRepository {
  private store = new Map<string, TipoDocumento>();

  /** Helper de pruebas: precargar un Tipo en el catálogo del tenant. */
  seed(tenant: TenantId, tipo: TipoDocumento): void {
    this.store.set(key(tenant, tipo.codigo), tipo);
  }

  /** Upsert por código (spec-005 R2/R10). */
  async save(tenant: TenantId, tipo: TipoDocumento): Promise<void> {
    this.store.set(key(tenant, tipo.codigo), tipo);
  }

  async findByCodigo(tenant: TenantId, codigo: string): Promise<TipoDocumento | null> {
    return this.store.get(key(tenant, codigo)) ?? null;
  }

  async findRequeridos(tenant: TenantId): Promise<TipoDocumento[]> {
    return [...this.store.entries()]
      .filter(([k]) => k.startsWith(`${tenant}::`))
      .map(([, t]) => t)
      .filter((t) => t.requerido && t.activo);
  }

  async findAll(tenant: TenantId): Promise<TipoDocumento[]> {
    return [...this.store.entries()]
      .filter(([k]) => k.startsWith(`${tenant}::`))
      .map(([, t]) => t);
  }
}

/** Publicador en memoria: acumula los eventos para poder verificarlos en pruebas. */
export class InMemoryEventPublisher implements EventPublisher {
  public readonly publicados: Array<{ tenant: TenantId; evento: DomainEvent }> = [];

  async publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void> {
    for (const e of eventos) this.publicados.push({ tenant, evento: e });
  }

  /** Eventos publicados de un tipo concreto (helper de pruebas). */
  porTipo<T extends DomainEvent["tipo"]>(tipo: T): Array<Extract<DomainEvent, { tipo: T }>> {
    return this.publicados
      .map((p) => p.evento)
      .filter((e): e is Extract<DomainEvent, { tipo: T }> => e.tipo === tipo);
  }

  limpiar(): void {
    this.publicados.length = 0;
  }
}
