/**
 * Traduce errores de dominio de Identity & Access a estados HTTP + Problem (RFC 7807),
 * fiel a openapi.yaml (spec-001 / spec-002 / spec-015).
 */
import { DomainError } from "../../../shared/kernel";
import { ProblemDto } from "./dtos";

const CODE_TO_STATUS: Record<string, number> = {
  // 409 Conflict
  correo_ya_registrado: 409,
  correo_ya_existe: 409,
  transicion_invalida: 409,
  multiples_empresas: 409,
  // 403 Forbidden (RBAC / spec-015)
  sin_permiso: 403,
  usuario_no_activo: 403,
  // 404 Not Found
  usuario_no_encontrado: 404,
  // 401 / 410 / 429 / 503 (spec-015)
  credenciales_invalidas: 401,
  invitacion_no_valida: 410,
  recuperacion_no_valida: 410,
  demasiados_intentos: 429,
  auth_no_configurada: 503,
  notificacion_no_disponible: 503,
  // 422 Unprocessable Entity (validaciones)
  tratamiento_no_aceptado: 422,
  correo_invalido: 422,
  razon_social_requerida: 422,
  version_politica_requerida: 422,
  roles_requeridos: 422,
  password_debil: 422,
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
