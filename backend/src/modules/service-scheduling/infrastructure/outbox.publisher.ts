/**
 * EventPublisher sobre la tabla OUTBOX (ADR-0004) para Scheduling.
 *
 * La tabla `outbox` es infraestructura COMPARTIDA de la plataforma (creada en la
 * migración 0001). Para no acoplar este módulo a las entidades de Compliance,
 * se inserta con SQL parametrizado en el contexto transaccional actual.
 */
import { DataSource } from "typeorm";
import { TenantId } from "../../../shared/kernel";
import { DomainEvent } from "../domain/events";
import { EventPublisher } from "../application/ports";

export class OutboxEventPublisher implements EventPublisher {
  constructor(private readonly dataSource: DataSource) {}

  async publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void> {
    if (eventos.length === 0) return;
    for (const e of eventos) {
      await this.dataSource.query(
        `INSERT INTO outbox (tenant_id, tipo_evento, aggregate_id, payload, estado, intentos)
         VALUES ($1, $2, $3, $4, 'pendiente', 0)`,
        [tenant, e.tipo, e.servicioId, JSON.stringify(e)],
      );
    }
  }
}
