/**
 * Servicio de dominio: detección de choques de Ventana horaria (Invariante S4, spec-008).
 * Función pura sobre las ventanas ya ocupadas de un recurso (Vehículo o Conductor).
 */
import { VentanaHoraria } from "./value-objects";

/** Una ventana ocupada en la agenda de un recurso, con el Servicio que la ocupa. */
export interface VentanaOcupada {
  readonly servicioId: string;
  readonly ventana: VentanaHoraria;
}

export interface Choque {
  readonly servicioId: string; // el Servicio existente con el que choca
  readonly ventana: VentanaHoraria;
}

/**
 * Busca el primer choque de `ventana` contra las ventanas ocupadas del recurso.
 * `excluirServicioId` permite la REASIGNACIÓN (R11): la ventana del propio
 * Servicio no cuenta como choque contra sí misma.
 */
export function detectarChoque(
  ventana: VentanaHoraria,
  ocupadas: readonly VentanaOcupada[],
  excluirServicioId?: string,
): Choque | null {
  for (const o of ocupadas) {
    if (excluirServicioId !== undefined && o.servicioId === excluirServicioId) continue;
    if (ventana.seSolapaCon(o.ventana)) {
      return { servicioId: o.servicioId, ventana: o.ventana };
    }
  }
  return null;
}
