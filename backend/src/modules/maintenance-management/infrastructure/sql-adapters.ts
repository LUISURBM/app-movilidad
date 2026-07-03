/**
 * Adaptadores SQL (producción) de los puertos de Maintenance (spec-012): tabla
 * `umbral_mantenimiento` de la migración 0009, con RLS por tenant. SQL parametrizado directo.
 */
import { DataSource } from "typeorm";
import { TenantId } from "../../../shared/kernel";
import { Umbral } from "../domain/umbral.aggregate";
import { DomainEvent } from "../domain/events";
import { EventPublisher, UmbralRepository } from "../application/ports";

interface FilaUmbral {
  id: string;
  vehiculo_id: string;
  cada_km: number | null;
  base_km: number;
  cada_meses: number | null;
  base_fecha: string | null;
  pendiente: boolean;
  vencido: boolean;
}

function toUmbral(f: FilaUmbral): Umbral {
  return Umbral.rehidratar({
    id: f.id,
    vehiculoId: f.vehiculo_id,
    cadaKm: f.cada_km ?? undefined,
    baseKm: f.base_km,
    cadaMeses: f.cada_meses ?? undefined,
    baseFecha: f.base_fecha ?? undefined,
    pendiente: f.pendiente,
    vencido: f.vencido,
  });
}

const SELECT = `SELECT id, vehiculo_id, cada_km, base_km, cada_meses, base_fecha::text AS base_fecha,
  pendiente, vencido FROM umbral_mantenimiento`;

export class SqlUmbralRepository implements UmbralRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findByVehiculo(tenant: TenantId, vehiculoId: string): Promise<Umbral | null> {
    const rows: FilaUmbral[] = await this.dataSource.query(`${SELECT} WHERE tenant_id = $1 AND vehiculo_id = $2`, [tenant, vehiculoId]);
    return rows[0] ? toUmbral(rows[0]) : null;
  }

  async save(tenant: TenantId, u: Umbral): Promise<void> {
    const s = u.snapshot();
    await this.dataSource.query(
      `INSERT INTO umbral_mantenimiento (id, tenant_id, vehiculo_id, cada_km, base_km, cada_meses, base_fecha, pendiente, vencido)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id, vehiculo_id) DO UPDATE SET
         cada_km = EXCLUDED.cada_km, base_km = EXCLUDED.base_km, cada_meses = EXCLUDED.cada_meses,
         base_fecha = EXCLUDED.base_fecha, pendiente = EXCLUDED.pendiente, vencido = EXCLUDED.vencido,
         actualizado_en = now()`,
      [s.id, tenant, s.vehiculoId, s.cadaKm ?? null, s.baseKm, s.cadaMeses ?? null, s.baseFecha ?? null, s.pendiente, s.vencido],
    );
  }

  async list(tenant: TenantId): Promise<Umbral[]> {
    const rows: FilaUmbral[] = await this.dataSource.query(`${SELECT} WHERE tenant_id = $1`, [tenant]);
    return rows.map(toUmbral);
  }
}

export class SqlMaintenanceEventPublisher implements EventPublisher {
  constructor(private readonly dataSource: DataSource) {}

  async publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void> {
    for (const e of eventos) {
      await this.dataSource.query(
        `INSERT INTO outbox (tenant_id, tipo_evento, aggregate_id, payload) VALUES ($1,$2,$3,$4)`,
        [tenant, e.tipo, e.mantenimientoId, JSON.stringify(e)],
      );
    }
  }
}
