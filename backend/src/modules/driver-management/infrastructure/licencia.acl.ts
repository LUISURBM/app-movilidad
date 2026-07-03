/**
 * ANTI-CORRUPTION LAYER hacia BC-4 Compliance & Documents (spec-004 R5).
 *
 * Materializa la Licencia de conducción como un Documento del sujeto Conductor (Tipo
 * "LICENCIA"), delegando en el caso de uso público `RegistrarDocumento` de Compliance.
 * Driver NO importa el dominio de Compliance más allá de este punto (SujetoRef + el caso
 * de uso). En el monolito la llamada es IN-PROCESS; si Compliance se extrajera, pasaría a
 * un POST /documentos sin tocar el dominio de Driver.
 */
import { Result, TenantId, ok } from "../../../shared/kernel";
import { RegistradorLicencia } from "../application/ports";
import { RegistrarDocumento } from "../../compliance-documents/application/use-cases";
import { SujetoRef } from "../../compliance-documents/domain/value-objects";

/** Código del Tipo de documento de la Licencia en el catálogo del Tenant. */
export const TIPO_LICENCIA = "LICENCIA";

export class LicenciaAcl implements RegistradorLicencia {
  constructor(private readonly registrarDocumento: RegistrarDocumento) {}

  async registrar(
    tenant: TenantId,
    conductorId: string,
    emisionIso: string,
    vencimientoIso: string,
  ): Promise<Result<void>> {
    const r = await this.registrarDocumento.execute({
      tenant,
      sujeto: SujetoRef.conductor(conductorId),
      tipoCodigo: TIPO_LICENCIA,
      emision: emisionIso,
      vencimiento: vencimientoIso,
    });
    if (!r.ok) return r;
    return ok(undefined);
  }
}
