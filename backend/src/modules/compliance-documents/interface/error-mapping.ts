/**
 * Traduce errores de dominio (DomainError.code) a estados HTTP + Problem (RFC 7807),
 * fiel a las respuestas declaradas en openapi.yaml.
 */
import { DomainError } from "../../../shared/kernel";
import { ProblemDto } from "./dtos";

/** Mapa código de dominio -> HTTP status. */
const CODE_TO_STATUS: Record<string, number> = {
  // 409 Conflict
  documento_vigente_duplicado: 409,
  tipo_documento_duplicado: 409,
  // 404 Not Found
  documento_no_encontrado: 404,
  tipo_no_encontrado: 404,
  // 422 Unprocessable Entity (validaciones de negocio)
  vencimiento_anterior_a_emision: 422,
  tipo_no_aplica_al_sujeto: 422,
  tipo_documento_desconocido: 422,
  tipo_documento_inactivo: 422,
  fecha_invalida: 422,
  sujeto_id_requerido: 422,
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
