/**
 * ANTI-CORRUPTION LAYER de Fuel hacia BC-2 Fleet Management (spec-011 R8 + spec-003 R6).
 *
 * Cierra la costura que spec-011 dejó anotada: el Odómetro autoritativo pertenece al
 * Vehículo (BC-2). Este adaptador reemplaza al stand-in `odometro_vehiculo` y delega la
 * lectura en el caso de uso público `ActualizarOdometro` de Fleet (que impone la monotonía).
 *
 * Traducción de resultados al lenguaje de Fuel (ResultadoOdometro):
 *  - ok                       → aplicado (la lectura avanzó).
 *  - `odometro_no_monotono`   → anomalía (P8/R8): la autoritativa NO retrocede; el Tanqueo
 *                               se conserva igual (el use-case de Fuel ya lo garantiza).
 *  - `vehiculo_no_encontrado` → no se aplica (el Vehículo no está en Fleet); el Tanqueo se
 *                               conserva, sin anomalía (no es una violación de monotonía).
 * Único punto de Fuel que conoce a Fleet.
 */
import { TenantId } from "../../../shared/kernel";
import {
  OdometroVehiculoGateway,
  ResultadoOdometro,
} from "../application/ports";
import { ActualizarOdometro } from "../../fleet-management/application/use-cases";
import { VehiculoRepository } from "../../fleet-management/application/ports";

export class FleetOdometroAcl implements OdometroVehiculoGateway {
  constructor(
    private readonly actualizar: ActualizarOdometro,
    private readonly vehiculos: VehiculoRepository,
  ) {}

  async lecturaActual(tenant: TenantId, vehiculoId: string): Promise<number | null> {
    const v = await this.vehiculos.findById(tenant, vehiculoId);
    return v?.odometro?.km ?? null;
  }

  async aplicarLectura(
    tenant: TenantId,
    vehiculoId: string,
    odometroKm: number,
  ): Promise<ResultadoOdometro> {
    const r = await this.actualizar.execute({
      tenant,
      vehiculoId,
      lectura: odometroKm,
      fuente: "tanqueo",
    });
    if (r.ok) {
      return { aplicado: true, anomalia: false, lecturaAutoritativa: odometroKm };
    }
    if (r.error.code === "odometro_no_monotono") {
      const actual = await this.lecturaActual(tenant, vehiculoId);
      return { aplicado: false, anomalia: true, lecturaAutoritativa: actual ?? odometroKm };
    }
    // vehiculo_no_encontrado u otro: el Tanqueo se conserva; el Odómetro no se aplica.
    return { aplicado: false, anomalia: false, lecturaAutoritativa: odometroKm };
  }
}
