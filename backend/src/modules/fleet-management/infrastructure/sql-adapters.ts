/**
 * Adaptadores SQL (producción) de los puertos de Fleet Management (spec-003):
 * tabla `vehiculo` de la migración 0005, con RLS por tenant. SQL parametrizado directo.
 * Asumen la sesión con `app.current_tenant` fijado (ver tenant-datasource.ts).
 */
import { DataSource } from "typeorm";
import { TenantId } from "../../../shared/kernel";
import { Vehiculo } from "../domain/vehiculo.aggregate";
import {
  Afiliacion,
  Odometro,
  Placa,
  parseClase,
} from "../domain/value-objects";
import { DomainEvent } from "../domain/events";
import { EventPublisher, VehiculoRepository } from "../application/ports";

interface FilaVehiculo {
  id: string;
  placa: string;
  clase: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  propietario_id: string | null;
  odometro: number | null;
  afiliacion_empresa_id: string | null;
  afiliacion_desde: string | null;
  estado: "activo" | "inactivo";
}

function toVehiculo(f: FilaVehiculo): Vehiculo {
  return Vehiculo.rehidratar({
    id: f.id,
    placa: Placa.de(f.placa),
    clase: parseClase(f.clase),
    marca: f.marca ?? undefined,
    modelo: f.modelo ?? undefined,
    anio: f.anio ?? undefined,
    propietarioId: f.propietario_id ?? undefined,
    odometro: f.odometro !== null ? Odometro.en(f.odometro) : undefined,
    afiliacion:
      f.afiliacion_empresa_id && f.afiliacion_desde
        ? Afiliacion.de(f.afiliacion_empresa_id, f.afiliacion_desde)
        : undefined,
    estado: f.estado,
  });
}

const SELECT = `SELECT id, placa, clase, marca, modelo, anio, propietario_id, odometro,
  afiliacion_empresa_id, afiliacion_desde::text AS afiliacion_desde, estado FROM vehiculo`;

export class SqlVehiculoRepository implements VehiculoRepository {
  constructor(private readonly dataSource: DataSource) {}

  async save(tenant: TenantId, v: Vehiculo): Promise<void> {
    const s = v.snapshot();
    await this.dataSource.query(
      `INSERT INTO vehiculo
         (id, tenant_id, placa, clase, marca, modelo, anio, propietario_id, odometro,
          afiliacion_empresa_id, afiliacion_desde, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         marca = EXCLUDED.marca, modelo = EXCLUDED.modelo, anio = EXCLUDED.anio,
         propietario_id = EXCLUDED.propietario_id, odometro = EXCLUDED.odometro,
         afiliacion_empresa_id = EXCLUDED.afiliacion_empresa_id,
         afiliacion_desde = EXCLUDED.afiliacion_desde, estado = EXCLUDED.estado,
         actualizado_en = now()`,
      [
        s.id, tenant, s.placa, s.clase, s.marca ?? null, s.modelo ?? null, s.anio ?? null,
        s.propietarioId ?? null, s.odometro ?? null, s.afiliacionEmpresaId ?? null,
        s.afiliacionDesde ?? null, s.estado,
      ],
    );
  }

  async findById(tenant: TenantId, id: string): Promise<Vehiculo | null> {
    const rows: FilaVehiculo[] = await this.dataSource.query(
      `${SELECT} WHERE tenant_id = $1 AND id = $2`,
      [tenant, id],
    );
    return rows[0] ? toVehiculo(rows[0]) : null;
  }

  async findByPlaca(tenant: TenantId, placa: string): Promise<Vehiculo | null> {
    const rows: FilaVehiculo[] = await this.dataSource.query(
      `${SELECT} WHERE tenant_id = $1 AND placa = $2`,
      [tenant, placa],
    );
    return rows[0] ? toVehiculo(rows[0]) : null;
  }

  async list(tenant: TenantId): Promise<Vehiculo[]> {
    const rows: FilaVehiculo[] = await this.dataSource.query(
      `${SELECT} WHERE tenant_id = $1 ORDER BY creado_en ASC`,
      [tenant],
    );
    return rows.map(toVehiculo);
  }
}

export class SqlFleetEventPublisher implements EventPublisher {
  constructor(private readonly dataSource: DataSource) {}

  async publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void> {
    for (const e of eventos) {
      await this.dataSource.query(
        `INSERT INTO outbox (tenant_id, tipo_evento, aggregate_id, payload)
         VALUES ($1,$2,$3,$4)`,
        [tenant, e.tipo, (e as { vehiculoId: string }).vehiculoId, JSON.stringify(e)],
      );
    }
  }
}
