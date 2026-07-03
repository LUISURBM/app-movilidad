/**
 * Mappers dominio -> DTO de Driver (contrato openapi.yaml).
 * `semaforo` es opcional en el contrato y se consulta vía BC-4 (GET /cumplimiento/...):
 * se omite aquí para no acoplar Driver a Compliance en esta vista.
 */
import { Conductor } from "../domain/conductor.aggregate";
import { ConductorDto } from "./dtos";

export function conductorToDto(c: Conductor): ConductorDto {
  return {
    id: c.id,
    nombre: c.nombre,
    usuarioId: c.usuarioId,
    licencia: {
      numero: c.licencia.numero,
      categoria: c.licencia.categoria,
      vencimiento: c.licencia.vencimiento.toISO(),
    },
  };
}
