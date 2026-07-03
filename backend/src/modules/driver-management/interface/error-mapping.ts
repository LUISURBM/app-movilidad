/**
 * Traduce errores de dominio de Driver (DomainError.code) a estados HTTP + Problem (RFC 7807),
 * fiel a openapi.yaml (spec-004). Documento duplicado 409; validaciones 422.
 * Incluye códigos que puede propagar la ACL de Licencia hacia Compliance (tipo/fecha).
 */
import { DomainError } from "../../../shared/kernel";
import { ProblemDto } from "./dtos";

const CODE_TO_STATUS: Record<string, number> = {
  // 409 Conflict
  documento_duplicado: 409,
  // 422 Unprocessable Entity (validaciones de valor)
  nombre_requerido: 422,
  documento_identidad_requerido: 422,
  licencia_numero_requerido: 422,
  licencia_categoria_requerida: 422,
  fecha_invalida: 422,
  // Propagados por la ACL de Licencia (Compliance) al materializar el Documento
  tipo_no_aplica_al_sujeto: 422,
  tipo_documento_desconocido: 422,
  tipo_documento_inactivo: 422,
  vencimiento_anterior_a_emision: 422,
};

export function statusForDomainError(err: DomainError): number {
  return CODE_TO_STATUS[err.code] ?? 400;
}

export function problemFromDomainError(err: DomainError, instance?: string): ProblemDto {
  const status = statusForDomainError(err);
  return { type: err.code, title: err.message, status, instance };
}
