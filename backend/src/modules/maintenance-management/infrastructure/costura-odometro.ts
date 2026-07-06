/**
 * Costura P6 (spec-012 R2): `OdometroActualizado` (BC-2 Fleet, originado por
 * Tanqueo/Servicio/manual) dispara `EvaluarUmbralPorOdometro` (BC-7).
 *
 * Es el ÚNICO punto de Maintenance que conoce a Fleet (ACL de consumo, misma
 * dirección que Fuel→Fleet): se suscribe al publicador de eventos que Fleet
 * exporta, sin que Fleet sepa de Maintenance. La entrega es al-menos-una-vez
 * desde la perspectiva del consumidor; es seguro porque la evaluación es
 * idempotente (R8: no duplica un preventivo pendiente).
 *
 * En la variante SQL de producción, el equivalente es un sink del dispatcher
 * del outbox (ADR-0004) con esta misma reacción — anotado en la spec.
 */
import { PublicadorSuscribible } from "../../fleet-management/application/ports";
import { EvaluarUmbralPorOdometro } from "../application/use-cases";

export class CosturaOdometroMantenimiento {
  constructor(
    publicadorFleet: PublicadorSuscribible,
    evaluar: EvaluarUmbralPorOdometro,
  ) {
    publicadorFleet.suscribir(async (tenant, evento) => {
      if (evento.tipo !== "OdometroActualizado") return;
      await evaluar.execute({
        tenant,
        vehiculoId: evento.vehiculoId,
        lectura: evento.lectura,
      });
    });
  }
}
