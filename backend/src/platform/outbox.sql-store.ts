/**
 * OutboxStore sobre PostgreSQL (producción) — tabla `outbox` de la migración 0001.
 *
 * `FOR UPDATE SKIP LOCKED` permite varios workers en paralelo sin pisarse.
 * NOTA de tenancy (spec-005 R11): el worker corre con un rol/tenant de plataforma;
 * cada fila conserva su tenant_id y el sink que entregue notificaciones debe
 * respetarlo (no mezclar destinatarios entre Empresas).
 */
import { DataSource } from "typeorm";
import { OutboxRow, OutboxStore } from "./outbox";

interface OutboxRecord {
  id: string;
  tenant_id: string;
  tipo_evento: string;
  aggregate_id: string;
  payload: unknown;
  intentos: number;
}

export class SqlOutboxStore implements OutboxStore {
  constructor(private readonly dataSource: DataSource) {}

  async tomarPendientes(limite: number, ahora: Date): Promise<OutboxRow[]> {
    const rows: OutboxRecord[] = await this.dataSource.query(
      `SELECT id, tenant_id, tipo_evento, aggregate_id, payload, intentos
         FROM outbox
        WHERE estado = 'pendiente' AND proximo_intento <= $1
        ORDER BY creado_en
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [ahora.toISOString(), limite],
    );
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      tipoEvento: r.tipo_evento,
      aggregateId: r.aggregate_id,
      payload: r.payload,
      intentos: r.intentos,
    }));
  }

  async marcarPublicado(id: string): Promise<void> {
    await this.dataSource.query(`UPDATE outbox SET estado = 'publicado' WHERE id = $1`, [id]);
  }

  async reprogramar(id: string, intentos: number, proximoIntento: Date, agotado: boolean): Promise<void> {
    await this.dataSource.query(
      `UPDATE outbox
          SET intentos = $2, proximo_intento = $3, estado = $4
        WHERE id = $1`,
      [id, intentos, proximoIntento.toISOString(), agotado ? "fallido" : "pendiente"],
    );
  }
}
