/**
 * Traduce errores de dominio (DomainError.code) a estados HTTP + Problem (RFC 7807),
 * fiel a las respuestas declaradas en openapi.yaml:
 *   - 409 `conflicto_horario` (solapamiento, S4) e `incumplimiento` (regla de oro, S3).
 *   - 409 para transiciones inválidas (S1/S2).
 *   - 422 para validaciones de entrada.
 */
import { DomainError } from "../../../shared/kernel";
import { ProblemDto } from "./dtos";

const CODE_TO_STATUS: Record<string, number> = {
  // 409 Conflict (contrato: PUT /servicios/{id}/asignacion y POST /estado)
  conflicto_horario: 409,
  incumplimiento: 409,
  transicion_invalida: 409,
  servicio_sin_asignacion: 409,
  servicio_no_planificado: 409,
  // 404 Not Found
  servicio_no_encontrado: 404,
  // 422 Unprocessable Entity (validaciones de negocio)
  ventana_invalida: 422,
  origen_requerido: 422,
  destino_requerido: 422,
  vehiculo_requerido: 422,
  conductor_requerido: 422,
  accion_desconocida: 422,
};

export function statusForDomainError(err: DomainError): number {
  return CODE_TO_STATUS[err.code] ?? 400;
}

export function problemFromDomainError(err: DomainError, instance?: string): ProblemDto {
  const status = statusForDomainError(err);
  return {
    type: err.code,
    title: err.message,
    status,
    instance,
  };
}
