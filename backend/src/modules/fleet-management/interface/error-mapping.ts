/**
 * Traduce errores de dominio de Fleet (DomainError.code) a estados HTTP + Problem (RFC 7807),
 * fiel a openapi.yaml (spec-003): placa duplicada 409, odómetro no monótono 409, resto 422/404.
 */
import { DomainError } from "../../../shared/kernel";
import { ProblemDto } from "./dtos";

const CODE_TO_STATUS: Record<string, number> = {
  // 409 Conflict
  placa_duplicada: 409,
  odometro_no_monotono: 409,
  // 404 Not Found
  vehiculo_no_encontrado: 404,
  // 422 Unprocessable Entity (validaciones de valor)
  placa_invalida: 422,
  clase_vehiculo_invalida: 422,
  odometro_invalido: 422,
  odometro_no_entero: 422,
  afiliacion_empresa_requerida: 422,
  fecha_invalida: 422,
};

export function statusForDomainError(err: DomainError): number {
  return CODE_TO_STATUS[err.code] ?? 400;
}

export function problemFromDomainError(err: DomainError, instance?: string): ProblemDto {
  const status = statusForDomainError(err);
  return { type: err.code, title: err.message, status, instance };
}
