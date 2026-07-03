/**
 * Mappers dominio <-> DTO de Fuel (contrato openapi.yaml).
 * El campo `litros` del contrato es la cantidad CANÓNICA en litros (los galones se
 * convierten), consistente con el evento CombustibleRegistrado.
 */
import { Tanqueo } from "../domain/tanqueo.aggregate";
import { TanqueoDto } from "./dtos";

export function tanqueoToDto(t: Tanqueo): TanqueoDto {
  return {
    id: t.id,
    vehiculoId: t.vehiculoId,
    litros: t.cantidad.enLitros(),
    valor: { moneda: "COP", valor: t.valor.montoCop },
    odometro: t.odometro.km,
    tanqueadoEn: t.ocurridoEn,
  };
}
