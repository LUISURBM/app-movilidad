/**
 * DTOs de la capa interface (REST) de Driver — reflejan los esquemas de
 * `backend/contracts/openapi.yaml`: RegistrarConductorRequest, Conductor, Licencia.
 */

export interface ProblemDto {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

export interface LicenciaDto {
  numero: string;
  categoria: string;
  vencimiento: string; // YYYY-MM-DD
}

export interface RegistrarConductorRequestDto {
  nombre: string;
  documentoIdentidad: string;
  usuarioId?: string;
  licencia: LicenciaDto;
}

export interface ConductorDto {
  id: string;
  nombre: string;
  usuarioId?: string;
  licencia: LicenciaDto;
}

export interface ConductoresPaginaDto {
  items: ConductorDto[];
  page: number;
  pageSize: number;
  total: number;
}
