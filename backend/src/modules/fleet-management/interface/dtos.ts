/**
 * DTOs de la capa interface (REST) de Fleet — reflejan los esquemas de
 * `backend/contracts/openapi.yaml` (API First): ClaseVehiculo, RegistrarVehiculoRequest,
 * Vehiculo, RegistrarOdometroRequest.
 */

export interface ProblemDto {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

export type ClaseVehiculoDto =
  | "automovil"
  | "camioneta"
  | "van"
  | "microbus"
  | "bus"
  | "campero"
  | "otro";

export interface RegistrarVehiculoRequestDto {
  placa: string;
  clase: ClaseVehiculoDto;
  marca?: string;
  modelo?: string;
  anio?: number;
  propietarioId?: string;
  odometroInicial?: number;
}

export interface VehiculoDto {
  id: string;
  placa: string;
  clase: ClaseVehiculoDto;
  marca?: string;
  modelo?: string;
  anio?: number;
  odometro?: number;
  estado: "activo" | "inactivo";
}

export interface VehiculosPaginaDto {
  items: VehiculoDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface RegistrarOdometroRequestDto {
  lectura: number;
  fuente: "manual" | "tanqueo" | "servicio";
  registradoEn?: string;
}

export interface LecturaOdometroDto {
  vehiculoId: string;
  lectura: number;
  fuente: string;
}
