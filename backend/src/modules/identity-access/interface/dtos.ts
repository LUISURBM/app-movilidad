/**
 * DTOs de la capa interface (REST) de Identity & Access — reflejan los esquemas de
 * `backend/contracts/openapi.yaml`: RegistrarTenantRequest, Tenant, Usuario, etc.
 */
import { Rol } from "../../../platform/tenant-context";

export interface ProblemDto {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

export type RolUsuarioDto = Rol;
export type EstadoUsuarioDto = "invitado" | "activo" | "suspendido";

// ---- spec-001 ----
export interface RegistrarTenantRequestDto {
  empresa: { razonSocial: string; nit?: string };
  administrador: { nombre: string; correo: string };
  aceptaTratamientoDatos: boolean;
}

export interface TenantDto {
  id: string;
  razonSocial: string;
  nit?: string;
  plan: "Free" | "Starter" | "Pro" | "Enterprise";
  creadoEn: string;
}

export interface UsuarioDto {
  id: string;
  nombre: string;
  correo: string;
  roles: RolUsuarioDto[];
  estado: EstadoUsuarioDto;
}

export interface TenantCreadoDto {
  tenant: TenantDto;
  administrador: UsuarioDto;
}

// ---- spec-002 ----
export interface InvitarUsuarioRequestDto {
  nombre: string;
  correo: string;
  roles: RolUsuarioDto[];
}

export interface ActualizarUsuarioRequestDto {
  roles?: RolUsuarioDto[];
  estado?: "activo" | "suspendido";
}

export interface UsuariosPaginaDto {
  items: UsuarioDto[];
  page: number;
  pageSize: number;
  total: number;
}
