/**
 * ANTI-CORRUPTION LAYER hacia BC-6 Fuel Management (spec-011).
 *
 * Traduce un cambio de `tanqueo` del lote offline (spec-010) al caso de uso público
 * `RegistrarTanqueo` de Fuel y devuelve el resultado en el lenguaje de sync de Scheduling
 * (`confirmado` / `duplicado` / `error`). Scheduling NO importa el dominio de Fuel.
 *
 * En el monolito modular (ADR-0001) la llamada es IN-PROCESS. Si Fuel se extrajera a otro
 * proceso, esta clase pasaría a invocar su endpoint REST sin tocar el resto de Scheduling.
 * Este archivo es el ÚNICO punto del módulo que conoce a Fuel.
 */
import { TenantId } from "../../../shared/kernel";
import {
  EntradaTanqueoSync,
  RegistradorTanqueo,
  ResultadoTanqueoSync,
} from "../application/ports";
import { RegistrarTanqueo } from "../../fuel-management/application/use-cases";
import { UnidadCombustible } from "../../fuel-management/domain/value-objects";

export class TanqueoAcl implements RegistradorTanqueo {
  constructor(private readonly registrarTanqueo: RegistrarTanqueo) {}

  async registrar(tenant: TenantId, entrada: EntradaTanqueoSync): Promise<ResultadoTanqueoSync> {
    const r = await this.registrarTanqueo.execute({
      tenant,
      clientId: entrada.clientId,
      vehiculoId: entrada.vehiculoId,
      cantidad: entrada.cantidad,
      unidad:
        entrada.unidad === "galones" ? UnidadCombustible.Galones : UnidadCombustible.Litros,
      valorCop: entrada.valorCop,
      odometro: entrada.odometro,
      ocurridoEn: entrada.ocurridoEn,
    });

    if (!r.ok) {
      // Rechazo local del contrato (valor/cantidad/odómetro inválidos, R6): error de datos.
      return {
        resultado: "error",
        problema: { type: r.error.code, title: r.error.message, status: 422 },
      };
    }
    return {
      resultado: r.value.duplicado ? "duplicado" : "confirmado",
      serverId: r.value.tanqueoId,
      anomaliaOdometro: r.value.anomaliaOdometro,
    };
  }
}
