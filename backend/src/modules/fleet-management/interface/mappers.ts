/**
 * Mappers dominio -> DTO de Fleet (contrato openapi.yaml).
 * `semaforo` es opcional en el contrato y se consulta vía BC-4 (GET /cumplimiento/...):
 * se omite aquí para no acoplar Fleet a Compliance en esta vista.
 */
import { Vehiculo } from "../domain/vehiculo.aggregate";
import { ClaseVehiculoDto, VehiculoDto } from "./dtos";

export function vehiculoToDto(v: Vehiculo): VehiculoDto {
  return {
    id: v.id,
    placa: v.placa.valor,
    clase: v.clase as ClaseVehiculoDto,
    marca: v.marca,
    modelo: v.modelo,
    anio: v.anio,
    odometro: v.odometro?.km,
    estado: v.estado,
  };
}
