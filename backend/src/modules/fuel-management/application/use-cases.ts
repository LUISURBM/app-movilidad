/**
 * Casos de uso del contexto Fuel Management (BC-6) — spec-011.
 * Orquestan el dominio y los puertos; sin dependencias de framework.
 */
import { IdGenerator, Result, TenantId, ok } from "../../../shared/kernel";
import { Tanqueo } from "../domain/tanqueo.aggregate";
import { UnidadCombustible } from "../domain/value-objects";
import {
  EventPublisher,
  OdometroVehiculoGateway,
  TanqueoRepository,
} from "./ports";

export interface FuelDeps {
  tanqueos: TanqueoRepository;
  odometro: OdometroVehiculoGateway;
  publisher: EventPublisher;
  ids: IdGenerator;
}

export interface RegistrarTanqueoInput {
  tenant: TenantId;
  /** UUID de idempotencia generado en el dispositivo (spec-011 R4). */
  clientId: string;
  vehiculoId: string;
  cantidad: number;
  unidad: UnidadCombustible;
  valorCop: number;
  odometro: number;
  /** Marca de captura del cliente (offline). */
  ocurridoEn?: string;
}

export interface RegistrarTanqueoOutput {
  tanqueoId: string;
  /** true si el `clientId` ya existía y se devolvió el registro original (R5). */
  duplicado: boolean;
  /** true si el Odómetro era menor a la lectura autoritativa (anomalía P8/R8). */
  anomaliaOdometro: boolean;
  /** Cantidad canónica en litros (para trazas/reportes). */
  litros: number;
}

/**
 * Registra un Tanqueo (spec-011). Flujo:
 *  1) Idempotencia (R4/R5): si el `clientId` ya existe → se devuelve el registro
 *     original SIN reinsertar, SIN reemitir evento y SIN reaplicar el Odómetro.
 *  2) Se construye el HECHO (append-only). La validación de valor (R6) vive en los VOs;
 *     un valor/cantidad no positivo se rechaza como error de dominio.
 *  3) Se inserta (append) y se aplica la lectura de Odómetro respetando monotonía (R8):
 *     si es menor a la autoritativa se marca anomalía y la autoritativa NO retrocede,
 *     pero el Tanqueo SE CONSERVA igual (el hecho no se descarta).
 *  4) Se emite `CombustibleRegistrado` (R7) para alimentar mantenimiento y costo por km (R9).
 */
export class RegistrarTanqueo {
  constructor(private readonly deps: FuelDeps) {}

  async execute(input: RegistrarTanqueoInput): Promise<Result<RegistrarTanqueoOutput>> {
    // 1) Deduplicación idempotente por clientId (R5): un solo registro.
    const previo = await this.deps.tanqueos.findByClientId(input.tenant, input.clientId);
    if (previo) {
      return ok({
        tanqueoId: previo.id,
        duplicado: true,
        anomaliaOdometro: false,
        litros: previo.cantidad.enLitros(),
      });
    }

    // 2) Construir el hecho (append-only). Falla cerrado ante valores no positivos (R6).
    const creado = Tanqueo.registrar({
      id: this.deps.ids.next(),
      clientId: input.clientId,
      vehiculoId: input.vehiculoId,
      cantidad: input.cantidad,
      unidad: input.unidad,
      valorCop: input.valorCop,
      odometro: input.odometro,
      ocurridoEn: input.ocurridoEn,
    });
    if (!creado.ok) return creado;
    const tanqueo = creado.value;

    // 3) Persistir el hecho y aplicar el Odómetro respetando monotonía (R8, P8).
    await this.deps.tanqueos.append(input.tenant, tanqueo);
    const odo = await this.deps.odometro.aplicarLectura(
      input.tenant,
      tanqueo.vehiculoId,
      tanqueo.odometro.km,
    );

    // 4) Emitir el hecho de dominio (R7) — se emite SIEMPRE, aun con anomalía de Odómetro.
    await this.deps.publisher.publish(input.tenant, tanqueo.pullEventos());

    return ok({
      tanqueoId: tanqueo.id,
      duplicado: false,
      anomaliaOdometro: odo.anomalia,
      litros: tanqueo.cantidad.enLitros(),
    });
  }
}
