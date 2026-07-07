/**
 * Decorador que vuelve SUSCRIBIBLE cualquier EventPublisher de Fleet (E0):
 * en modo postgres, el publicador escribe al outbox (SqlFleetEventPublisher)
 * Y sigue notificando in-process a los suscriptores (costura P6 de spec-012,
 * Maintenance). Misma semántica de aislamiento que el in-memory: un suscriptor
 * que falla NO tumba el comando (R8 re-evalúa en el próximo avance).
 */
import { TenantId } from "../../../shared/kernel";
import { DomainEvent } from "../domain/events";
import {
  EventPublisher,
  PublicadorSuscribible,
  SuscriptorEventosFleet,
} from "../application/ports";

export class PublicadorSuscribibleSobre implements PublicadorSuscribible {
  private readonly suscriptores: SuscriptorEventosFleet[] = [];

  constructor(private readonly inner: EventPublisher) {}

  suscribir(suscriptor: SuscriptorEventosFleet): void {
    this.suscriptores.push(suscriptor);
  }

  async publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void> {
    await this.inner.publish(tenant, eventos);
    for (const e of eventos) {
      for (const s of this.suscriptores) {
        try {
          await s(tenant, e);
        } catch (err) {
          console.warn(
            `[fleet] suscriptor de eventos falló con ${e.tipo}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }
}
