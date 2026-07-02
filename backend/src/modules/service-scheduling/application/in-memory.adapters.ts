/**
 * Adaptadores EN MEMORIA de los puertos — para pruebas y desarrollo sin infraestructura.
 * Respetan el aislamiento por Tenant (clave compuesta tenant + id). No son para producción;
 * la implementación real (TypeORM/Postgres + RLS + outbox) está en la capa infrastructure.
 */
import { TenantId } from "../../../shared/kernel";
import { Servicio } from "../domain/servicio.aggregate";
import { VentanaHoraria } from "../domain/value-objects";
import { VentanaOcupada } from "../domain/agenda.service";
import { DomainEvent } from "../domain/events";
import {
  BitacoraSync,
  CumplimientoGateway,
  EntradaBitacora,
  EventPublisher,
  IdempotencyStore,
  RespuestaIdempotente,
  ResultadoOperabilidad,
  ServicioRepository,
} from "./ports";

const key = (tenant: TenantId, id: string) => `${tenant}::${id}`;

export class InMemoryServicioRepository implements ServicioRepository {
  private store = new Map<string, Servicio>();

  async save(tenant: TenantId, servicio: Servicio): Promise<void> {
    this.store.set(key(tenant, servicio.id), servicio);
  }

  async findById(tenant: TenantId, id: string): Promise<Servicio | null> {
    return this.store.get(key(tenant, id)) ?? null;
  }

  async list(tenant: TenantId, filtro?: { estado?: string }): Promise<Servicio[]> {
    return this.delTenant(tenant).filter(
      (s) => !filtro?.estado || s.estado === filtro.estado,
    );
  }

  async listAsignadosAConductor(tenant: TenantId, conductorId: string): Promise<Servicio[]> {
    return this.delTenant(tenant).filter((s) => s.asignacion?.conductorId === conductorId);
  }

  async ventanasOcupadasDeVehiculo(tenant: TenantId, vehiculoId: string): Promise<VentanaOcupada[]> {
    return this.delTenant(tenant)
      .filter((s) => s.ocupaAgenda() && s.asignacion!.vehiculoId === vehiculoId)
      .map((s) => ({ servicioId: s.id, ventana: s.ventana }));
  }

  async ventanasOcupadasDeConductor(tenant: TenantId, conductorId: string): Promise<VentanaOcupada[]> {
    return this.delTenant(tenant)
      .filter((s) => s.ocupaAgenda() && s.asignacion!.conductorId === conductorId)
      .map((s) => ({ servicioId: s.id, ventana: s.ventana }));
  }

  private delTenant(tenant: TenantId): Servicio[] {
    return [...this.store.entries()]
      .filter(([k]) => k.startsWith(`${tenant}::`))
      .map(([, s]) => s);
  }
}

/**
 * Stub del gateway de Cumplimiento para pruebas UNITARIAS de Scheduling:
 * permite fijar la respuesta por recurso sin depender del módulo Compliance.
 * (La ACL real sobre Compliance está en infrastructure/compliance.acl.ts y se
 * prueba de punta a punta en el spec del módulo.)
 */
export class StubCumplimientoGateway implements CumplimientoGateway {
  private bloqueados = new Map<string, string>(); // key -> motivo
  private advertencias = new Map<string, string[]>();

  bloquear(tenant: TenantId, recursoId: string, motivo: string): void {
    this.bloqueados.set(key(tenant, recursoId), motivo);
  }

  advertir(tenant: TenantId, recursoId: string, advertencia: string): void {
    const k = key(tenant, recursoId);
    this.advertencias.set(k, [...(this.advertencias.get(k) ?? []), advertencia]);
  }

  limpiar(): void {
    this.bloqueados.clear();
    this.advertencias.clear();
  }

  async puedeOperar(
    tenant: TenantId,
    vehiculoId: string,
    conductorId: string,
    _ventana: VentanaHoraria,
  ): Promise<ResultadoOperabilidad> {
    for (const recurso of [vehiculoId, conductorId]) {
      const motivo = this.bloqueados.get(key(tenant, recurso));
      if (motivo) return { permitido: false, motivoBloqueo: motivo, advertencias: [] };
    }
    const advertencias = [
      ...(this.advertencias.get(key(tenant, vehiculoId)) ?? []),
      ...(this.advertencias.get(key(tenant, conductorId)) ?? []),
    ];
    return { permitido: true, advertencias };
  }
}

/** Deduplicación idempotente en memoria (spec-010 R8). */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private store = new Map<string, RespuestaIdempotente>();

  async get(tenant: TenantId, clientId: string): Promise<RespuestaIdempotente | null> {
    return this.store.get(key(tenant, clientId)) ?? null;
  }

  async save(tenant: TenantId, clientId: string, respuesta: RespuestaIdempotente): Promise<void> {
    this.store.set(key(tenant, clientId), respuesta);
  }
}

/** Bitácora en memoria (spec-010 R10): verificable en pruebas. */
export class InMemoryBitacoraSync implements BitacoraSync {
  public readonly entradas: Array<{ tenant: TenantId; entrada: EntradaBitacora }> = [];

  async registrar(tenant: TenantId, entrada: EntradaBitacora): Promise<void> {
    this.entradas.push({ tenant, entrada });
  }

  deTenant(tenant: TenantId): EntradaBitacora[] {
    return this.entradas.filter((e) => e.tenant === tenant).map((e) => e.entrada);
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
