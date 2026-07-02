/**
 * Mappers dominio <-> DTO (capa interface). Funciones puras y verificables sin framework.
 * Garantizan que la salida REST cumple `openapi.yaml`.
 */
import { Servicio } from "../domain/servicio.aggregate";
import { AsignacionDto, EstadoServicioDto, ServicioDto } from "./dtos";

export function servicioToDto(s: Servicio): ServicioDto {
  const asignacion: AsignacionDto | undefined = s.asignacion
    ? {
        servicioId: s.id,
        vehiculoId: s.asignacion.vehiculoId,
        conductorId: s.asignacion.conductorId,
        advertencias: s.asignacion.advertencias.length > 0 ? [...s.asignacion.advertencias] : undefined,
      }
    : undefined;

  return {
    id: s.id,
    origen: s.ruta.origen,
    destino: s.ruta.destino,
    ventana: s.ventana.toJSON(),
    cliente: s.clienteRef,
    estado: s.estado as EstadoServicioDto,
    asignacion,
    inicioReal: s.inicioReal?.toISOString(),
    finReal: s.finReal?.toISOString(),
  };
}
