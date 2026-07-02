/**
 * Implementación del puerto ServicioRepository con TypeORM + PostgreSQL.
 * Traduce entidad <-> agregado y confía en RLS (ADR-0008) para el aislamiento,
 * además de filtrar por tenant_id en cada query (defensa en profundidad).
 *
 * NOTA: asume que la conexión ya tiene fijado `app.current_tenant`
 * (ver compliance-documents/infrastructure/tenant-datasource.ts).
 */
import { DataSource, In, Repository } from "typeorm";
import { TenantId } from "../../../shared/kernel";
import { Servicio } from "../domain/servicio.aggregate";
import {
  Asignacion,
  EstadoServicio,
  Ruta,
  VentanaHoraria,
} from "../domain/value-objects";
import { VentanaOcupada } from "../domain/agenda.service";
import { ServicioRepository } from "../application/ports";
import { ServicioEntity } from "./entities";

function toServicio(e: ServicioEntity): Servicio {
  return Servicio.rehidratar({
    id: e.id,
    ruta: new Ruta(e.origen, e.destino),
    ventana: VentanaHoraria.de(new Date(e.ventanaInicio), new Date(e.ventanaFin)),
    clienteRef: e.cliente ?? undefined,
    estado: e.estado as EstadoServicio,
    asignacion:
      e.vehiculoId && e.conductorId
        ? new Asignacion(e.vehiculoId, e.conductorId, e.advertencias ?? [])
        : undefined,
    inicioReal: e.inicioReal ? new Date(e.inicioReal) : undefined,
    finReal: e.finReal ? new Date(e.finReal) : undefined,
    version: e.version,
  });
}

const ESTADOS_ACTIVOS = ["Planificado", "Iniciado"] as const;

export class TypeOrmServicioRepository implements ServicioRepository {
  private readonly repo: Repository<ServicioEntity>;
  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(ServicioEntity);
  }

  async save(tenant: TenantId, servicio: Servicio): Promise<void> {
    const s = servicio.snapshot();
    await this.repo.save({
      id: s.id,
      tenantId: tenant,
      origen: s.origen,
      destino: s.destino,
      ventanaInicio: new Date(s.ventanaInicio),
      ventanaFin: new Date(s.ventanaFin),
      cliente: s.clienteRef ?? null,
      estado: s.estado as ServicioEntity["estado"],
      vehiculoId: s.vehiculoId ?? null,
      conductorId: s.conductorId ?? null,
      advertencias: s.advertencias,
      version: s.version,
      inicioReal: s.inicioReal ? new Date(s.inicioReal) : null,
      finReal: s.finReal ? new Date(s.finReal) : null,
    });
  }

  async findById(tenant: TenantId, id: string): Promise<Servicio | null> {
    const e = await this.repo.findOne({ where: { id, tenantId: tenant } });
    return e ? toServicio(e) : null;
  }

  async list(tenant: TenantId, filtro?: { estado?: string }): Promise<Servicio[]> {
    const rows = await this.repo.find({
      where: {
        tenantId: tenant,
        ...(filtro?.estado ? { estado: filtro.estado as ServicioEntity["estado"] } : {}),
      },
      order: { ventanaInicio: "ASC" },
    });
    return rows.map(toServicio);
  }

  async listAsignadosAConductor(tenant: TenantId, conductorId: string): Promise<Servicio[]> {
    const rows = await this.repo.find({
      where: { tenantId: tenant, conductorId },
      order: { ventanaInicio: "ASC" },
    });
    return rows.map(toServicio);
  }

  async ventanasOcupadasDeVehiculo(tenant: TenantId, vehiculoId: string): Promise<VentanaOcupada[]> {
    const rows = await this.repo.find({
      where: { tenantId: tenant, vehiculoId, estado: In([...ESTADOS_ACTIVOS]) },
    });
    return rows.map((e) => ({
      servicioId: e.id,
      ventana: VentanaHoraria.de(new Date(e.ventanaInicio), new Date(e.ventanaFin)),
    }));
  }

  async ventanasOcupadasDeConductor(tenant: TenantId, conductorId: string): Promise<VentanaOcupada[]> {
    const rows = await this.repo.find({
      where: { tenantId: tenant, conductorId, estado: In([...ESTADOS_ACTIVOS]) },
    });
    return rows.map((e) => ({
      servicioId: e.id,
      ventana: VentanaHoraria.de(new Date(e.ventanaInicio), new Date(e.ventanaFin)),
    }));
  }
}
