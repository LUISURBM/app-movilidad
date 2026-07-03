/**
 * Mappers dominio -> DTO de Identity & Access (contrato openapi.yaml).
 */
import { Rol } from "../../../platform/tenant-context";
import { Tenant } from "../domain/tenant.aggregate";
import { Usuario } from "../domain/usuario.aggregate";
import { EstadoUsuarioDto, TenantDto, UsuarioDto } from "./dtos";

export function tenantToDto(t: Tenant): TenantDto {
  return {
    id: t.id,
    razonSocial: t.razonSocial,
    nit: t.nit,
    plan: t.plan,
    creadoEn: t.creadoEn,
  };
}

export function usuarioToDto(u: Usuario): UsuarioDto {
  return {
    id: u.id,
    nombre: u.nombre,
    correo: u.correo.valor,
    roles: [...u.roles] as Rol[],
    // El contrato expone invitado|activo|suspendido; removido/expirado se filtran del listado.
    estado: u.estado as EstadoUsuarioDto,
  };
}
