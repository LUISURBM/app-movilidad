/**
 * EventPublisher sobre la tabla OUTBOX (ADR-0004).
 *
 * Escribe los eventos de dominio en `outbox` dentro del contexto transaccional actual,
 * para publicación confiable posterior por un worker. Aquí solo persiste; el despacho
 * (marcar publicado/reintentos) lo hace `OutboxDispatcher` (platform, fuera de este módulo).
 */
import { DataSource } from "typeorm";
import { TenantId } from "../../../shared/kernel";
import { DomainEvent } from "../domain/events";
import { EventPublisher } from "../application/ports";
import { OutboxEntity } from "./entities";

export class OutboxEventPublisher implements EventPublisher {
  constructor(private readonly dataSource: DataSource) {}

  async publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void> {
    if (eventos.length === 0) return;
    const repo = this.dataSource.getRepository(OutboxEntity);
    const filas = eventos.map((e) => {
      const aggregateId = "documentoId" in e ? (e as { documentoId: string }).documentoId : "";
      return repo.create({
        tenantId: tenant,
        tipoEvento: e.tipo,
        aggregateId,
        payload: e as unknown,
        estado: "pendiente" as const,
        intentos: 0,
      });
    });
    await repo.save(filas);
  }
}
