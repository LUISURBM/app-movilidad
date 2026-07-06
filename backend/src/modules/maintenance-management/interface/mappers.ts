/** Mappers dominio <-> DTO del contrato (spec-012). */
import { Umbral } from "../domain/umbral.aggregate";
import { UmbralMantenimientoDto } from "./dtos";

export function umbralToDto(u: Umbral): UmbralMantenimientoDto {
  const s = u.snapshot();
  return {
    umbralId: s.id,
    vehiculoId: s.vehiculoId,
    ...(s.cadaKm !== undefined ? { cadaKm: s.cadaKm } : {}),
    baseKm: s.baseKm,
    ...(s.cadaMeses !== undefined ? { cadaMeses: s.cadaMeses } : {}),
    ...(s.baseFecha !== undefined ? { baseFecha: s.baseFecha } : {}),
    pendiente: s.pendiente,
    vencido: s.vencido,
  };
}
