/**
 * ANTI-CORRUPTION LAYER hacia BC-4 Compliance & Documents (spec-009 R2).
 *
 * Traduce el modelo de Compliance (Semáforo, Vencimientos, Documentos) al lenguaje
 * de Scheduling (`permitido` / `advertencias`), de modo que Scheduling NO importe
 * esos conceptos a su dominio:
 *   - rojo (Vencido) en Vehículo O Conductor → bloquea (P3, basta uno — R6).
 *   - amarillo (PorVencer) → permite + advertencia "QUÉ documento y en cuántos días" (P11/R9).
 *   - verde (Vigente) → permite sin advertencias.
 *
 * En el monolito modular (ADR-0001) la consulta es IN-PROCESS al caso de uso público
 * `ConsultarSemaforo` de Compliance (equivale a GET /cumplimiento/... del contrato,
 * sin salto HTTP). Si Scheduling se extrajera a otro proceso, esta clase pasaría a
 * llamar el endpoint REST sin tocar el dominio ni los casos de uso de Scheduling.
 *
 * Este archivo es el ÚNICO punto del módulo que conoce a Compliance.
 */
import { TenantId } from "../../../shared/kernel";
import { ConsultarSemaforo } from "../../compliance-documents/application/use-cases";
import { SujetoRef } from "../../compliance-documents/domain/value-objects";
import { ResultadoCumplimiento } from "../../compliance-documents/domain/semaforo.service";
import { VentanaHoraria } from "../domain/value-objects";
import { CumplimientoGateway, ResultadoOperabilidad } from "../application/ports";

export class ComplianceAcl implements CumplimientoGateway {
  constructor(private readonly consultarSemaforo: ConsultarSemaforo) {}

  async puedeOperar(
    tenant: TenantId,
    vehiculoId: string,
    conductorId: string,
    _ventana: VentanaHoraria,
  ): Promise<ResultadoOperabilidad> {
    // R10: la consulta respeta el aislamiento por Tenant (mismo tenant del request).
    const [vehiculo, conductor] = await Promise.all([
      this.consultarSemaforo.execute(tenant, SujetoRef.vehiculo(vehiculoId)),
      this.consultarSemaforo.execute(tenant, SujetoRef.conductor(conductorId)),
    ]);

    // P3 + R6: rojo en CUALQUIERA de los dos recursos bloquea.
    const bloqueo = this.motivoBloqueo("Vehículo", vehiculo) ?? this.motivoBloqueo("Conductor", conductor);
    if (bloqueo) {
      return { permitido: false, motivoBloqueo: bloqueo, advertencias: [] };
    }

    // P11 + R9: amarillo advierte QUÉ documento está por vencer y en cuántos días.
    const advertencias = [
      ...this.advertenciasDe("Vehículo", vehiculo),
      ...this.advertenciasDe("Conductor", conductor),
    ];
    return { permitido: true, advertencias };
  }

  /** Traducción rojo → motivo de bloqueo en lenguaje del Operador. */
  private motivoBloqueo(recurso: string, r: ResultadoCumplimiento): string | undefined {
    if (r.semaforo !== "Vencido") return undefined;
    const causas = r.detalles
      .filter((d) => d.estado === "Vencido")
      .map((d) => (d.ausente ? `${d.tipoDocumento} requerido ausente` : `${d.tipoDocumento} vencido`));
    return `${recurso} no está al día documentalmente: ${causas.join(", ")}.`;
  }

  /** Traducción amarillo → advertencias no bloqueantes. */
  private advertenciasDe(recurso: string, r: ResultadoCumplimiento): string[] {
    return r.detalles
      .filter((d) => d.estado === "PorVencer" && d.diasRestantes !== null)
      .map((d) => `${d.tipoDocumento} del ${recurso} vence en ${d.diasRestantes} día(s).`);
  }
}
