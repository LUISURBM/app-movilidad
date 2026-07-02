/**
 * Adaptadores SQL (producción) de los puertos de sincronización offline (spec-010):
 * tablas `idempotencia` y `bitacora_sync` de la migración 0003, con RLS por tenant.
 * SQL parametrizado directo (mismo criterio que outbox.publisher.ts).
 */
import { DataSource } from "typeorm";
import { TenantId } from "../../../shared/kernel";
import {
  BitacoraSync,
  EntradaBitacora,
  IdempotencyStore,
  RespuestaIdempotente,
} from "../application/ports";

export class SqlIdempotencyStore implements IdempotencyStore {
  constructor(private readonly dataSource: DataSource) {}

  async get(tenant: TenantId, clientId: string): Promise<RespuestaIdempotente | null> {
    const rows: Array<{ respuesta: RespuestaIdempotente }> = await this.dataSource.query(
      `SELECT respuesta FROM idempotencia WHERE tenant_id = $1 AND client_id = $2`,
      [tenant, clientId],
    );
    return rows[0]?.respuesta ?? null;
  }

  async save(tenant: TenantId, clientId: string, respuesta: RespuestaIdempotente): Promise<void> {
    // ON CONFLICT DO NOTHING: si dos reintentos concurrentes llegan a la vez, gana el
    // primero y el segundo leerá la respuesta ya guardada (dedupe también físico).
    await this.dataSource.query(
      `INSERT INTO idempotencia (tenant_id, client_id, respuesta)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, client_id) DO NOTHING`,
      [tenant, clientId, JSON.stringify(respuesta)],
    );
  }
}

export class SqlBitacoraSync implements BitacoraSync {
  constructor(private readonly dataSource: DataSource) {}

  async registrar(tenant: TenantId, e: EntradaBitacora): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO bitacora_sync (tenant_id, servicio_id, usuario_id, detalle, ocurrido_en)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenant, e.servicioId, e.usuarioId, e.detalle, e.ocurridoEn],
    );
  }
}
