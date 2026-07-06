/**
 * Traduce errores de dominio de Maintenance (DomainError.code) a HTTP + Problem
 * (RFC 7807), fiel a openapi.yaml (spec-012): validaciones del Umbral 422,
 * Umbral inexistente 404.
 */
import { DomainError } from "../../../shared/kernel";
import { ProblemDto } from "./dtos";

const CODE_TO_STATUS: Record<string, number> = {
  // 404 Not Found
  umbral_no_encontrado: 404,
  // 422 Unprocessable Entity (validaciones de valor)
  umbral_sin_criterio: 422,
  umbral_km_invalido: 422,
  umbral_meses_invalido: 422,
  costo_invalido: 422,
  fecha_invalida: 422,
};

export function problemFromDomainError(err: DomainError, instance?: string): ProblemDto {
  const status = CODE_TO_STATUS[err.code] ?? 400;
  return { type: err.code, title: err.message, status, instance };
}
