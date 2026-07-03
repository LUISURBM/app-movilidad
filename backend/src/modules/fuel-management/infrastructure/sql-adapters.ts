/**
 * Adaptadores SQL (producción) de los puertos de Fuel Management (spec-011):
 * tablas `tanqueo` y `odometro_vehiculo` de la migración 0004, con RLS por tenant.
 * SQL parametrizado directo (mismo criterio que sync.sql-adapters.ts / outbox.publisher.ts).
 *
 * Asumen que la sesión ya tiene fijado `app.current_tenant` (ver tenant-datasource.ts);
 * además filtran por tenant_id (defensa en profundidad, ADR-0008).
 */
import { DataSource } from "typeorm";
import { TenantId } from "../../../shared/kernel";
import { Tanqueo } from "../domain/tanqueo.aggregate";
import { UnidadCombustible } from "../domain/value-objects";
import { DomainEvent } from "../domain/events";
import {
  EventPublisher,
  OdometroVehiculoGateway,
  ResultadoOdometro,
  TanqueoRepository,
} from "../application/ports";

interface FilaTanqueo {
  id: string;
  client_id: string;
  vehiculo_id: string;
  cantidad: string; // numeric → string en pg
  unidad: string;
  valor_cop: string; // bigint → string en pg
  odometro: number;
  ocurrido_en: string;
}

function toTanqueo(f: FilaTanqueo): Tanqueo {
  return Tanqueo.rehidratar({
    id: f.id,
    clientId: f.client_id,
    vehiculoId: f.vehiculo_id,
    cantidad: Number(f.cantidad),
    unidad: f.unidad as UnidadCombustible,
    valorCop: Number(f.valor_cop),
    odometro: Number(f.odometro),
    ocurridoEn: new Date(f.ocurrido_en).toISOString(),
  });
}

export class SqlTanqueoRepository implements TanqueoRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findByClientId(tenant: TenantId, clientId: string): Promise<Tanqueo | null> {
    const rows: FilaTanqueo[] = await this.dataSource.query(
      `SELECT id, client_id, vehiculo_id, cantidad, unidad, valor_cop, odometro, ocurrido_en
       FROM tanqueo WHERE tenant_id = $1 AND client_id = $2`,
      [tenant, clientId],
    );
    return rows[0] ? toTanqueo(rows[0]) : null;
  }

  async append(tenant: TenantId, t: Tanqueo): Promise<void> {
    const s = t.snapshot();
    // ON CONFLICT DO NOTHING: append-only + dedupe físico por (tenant, client_id) (R5).
    await this.dataSource.query(
      `INSERT INTO tanqueo (id, tenant_id, client_id, vehiculo_id, cantidad, unidad, valor_cop, odometro, ocurrido_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id, client_id) DO NOTHING`,
      [s.id, tenant, s.clientId, s.vehiculoId, s.cantidad, s.unidad, s.valorCop, s.odometro, s.ocurridoEn],
    );
  }

  async listByVehiculo(tenant: TenantId, vehiculoId: string): Promise<Tanqueo[]> {
    const rows: FilaTanqueo[] = await this.dataSource.query(
      `SELECT id, client_id, vehiculo_id, cantidad, unidad, valor_cop, odometro, ocurrido_en
       FROM tanqueo WHERE tenant_id = $1 AND vehiculo_id = $2 ORDER BY ocurrido_en ASC, creado_en ASC`,
      [tenant, vehiculoId],
    );
    return rows.map(toTanqueo);
  }
}

export class SqlOdometroVehiculo implements OdometroVehiculoGateway {
  constructor(private readonly dataSource: DataSource) {}

  async lecturaActual(tenant: TenantId, vehiculoId: string): Promise<number | null> {
    const rows: Array<{ lectura: number }> = await this.dataSource.query(
      `SELECT lectura FROM odometro_vehiculo WHERE tenant_id = $1 AND vehiculo_id = $2`,
      [tenant, vehiculoId],
    );
    return rows[0]?.lectura ?? null;
  }

  async aplicarLectura(
    tenant: TenantId,
    vehiculoId: string,
    odometroKm: number,
  ): Promise<ResultadoOdometro> {
    // GREATEST impone la monotonía (P8/R8): la lectura solo avanza, nunca retrocede.
    const rows: Array<{ lectura: number }> = await this.dataSource.query(
      `INSERT INTO odometro_vehiculo (tenant_id, vehiculo_id, lectura)
       VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, vehiculo_id)
       DO UPDATE SET lectura = GREATEST(odometro_vehiculo.lectura, EXCLUDED.lectura),
                     actualizado_en = now()
       RETURNING lectura`,
      [tenant, vehiculoId, odometroKm],
    );
    const lecturaAutoritativa = rows[0].lectura;
    // Si la autoritativa quedó por ENCIMA de la lectura entrante, hubo anomalía (R8).
    const anomalia = lecturaAutoritativa > odometroKm;
    return { aplicado: !anomalia, anomalia, lecturaAutoritativa };
  }
}

export class SqlFuelEventPublisher implements EventPublisher {
  constructor(private readonly dataSource: DataSource) {}

  async publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void> {
    for (const e of eventos) {
      const aggregateId = "tanqueoId" in e ? (e as { tanqueoId: string }).tanqueoId : "";
      await this.dataSource.query(
        `INSERT INTO outbox (tenant_id, tipo_evento, aggregate_id, payload)
         VALUES ($1,$2,$3,$4)`,
        [tenant, e.tipo, aggregateId, JSON.stringify(e)],
      );
    }
  }
}
