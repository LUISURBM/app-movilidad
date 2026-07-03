/**
 * Traduce errores de dominio de Fuel (DomainError.code) a estados HTTP + Problem (RFC 7807),
 * fiel a las respuestas declaradas en openapi.yaml (spec-011). Los rechazos de valor son 422.
 */
import { DomainError } from "../../../shared/kernel";
import { ProblemDto } from "./dtos";

const CODE_TO_STATUS: Record<string, number> = {
  // 422 Unprocessable Entity (rechazos locales de valor, spec-011 R6)
  valor_cop_no_positivo: 422,
  valor_cop_no_entero: 422,
  cantidad_no_positiva: 422,
  odometro_invalido: 422,
  odometro_no_entero: 422,
  client_id_requerido: 422,
  vehiculo_requerido: 422,
};

export function statusForDomainError(err: DomainError): number {
  return CODE_TO_STATUS[err.code] ?? 400;
}

export function problemFromDomainError(err: DomainError, instance?: string): ProblemDto {
  const status = statusForDomainError(err);
  return { type: err.code, title: err.message, status, instance };
}
