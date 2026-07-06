/**
 * DTOs de la capa interface (REST) de Maintenance — reflejan EXACTAMENTE los
 * esquemas de `backend/contracts/openapi.yaml` (API First, spec-012).
 */

export interface ProblemDto {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

/** Money del contrato: monto entero en COP, sin decimales. */
export interface MoneyDto {
  moneda: "COP";
  valor: number;
}

export interface UmbralMantenimientoDto {
  umbralId: string;
  vehiculoId: string;
  cadaKm?: number;
  baseKm: number;
  cadaMeses?: number;
  baseFecha?: string; // date
  pendiente: boolean;
  vencido: boolean;
}

export interface DefinirUmbralMantenimientoRequestDto {
  cadaKm?: number;
  baseKm?: number;
  cadaMeses?: number;
  baseFecha?: string; // date
}

export interface RegistrarMantenimientoRequestDto {
  vehiculoId: string;
  odometro: number;
  costo: MoneyDto;
}

export interface MantenimientoRegistradoResponseDto {
  mantenimientoId: string;
}
