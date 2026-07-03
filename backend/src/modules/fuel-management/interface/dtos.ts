/**
 * DTOs de la capa interface (REST) de Fuel — reflejan EXACTAMENTE los esquemas de
 * `backend/contracts/openapi.yaml` (API First): Money, RegistrarTanqueoRequest, Tanqueo.
 * Tipos planos de transporte; los mappers traducen dominio <-> DTO.
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

// ---- spec-011: Registrar Tanqueo ----
export interface RegistrarTanqueoRequestDto {
  vehiculoId: string;
  /** Litros o galones según configuración del tenant (contrato). El REST asume litros. */
  litros: number;
  valor: MoneyDto;
  odometro: number;
  tanqueadoEn?: string; // date-time
  /** UUID del cambio para idempotencia (append-only). */
  clientId: string;
}

export interface TanqueoDto {
  id: string;
  vehiculoId: string;
  litros: number;
  valor: MoneyDto;
  odometro: number;
  tanqueadoEn?: string;
}

export interface TanqueosPaginaDto {
  items: TanqueoDto[];
  page: number;
  pageSize: number;
  total: number;
}
