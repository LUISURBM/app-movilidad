/**
 * Servicio de dominio: cálculo del Estado de cumplimiento (Semáforo) de un sujeto.
 * spec-006: peor estado entre los Documentos (R1), y Documento requerido ausente = Vencido (I3/R7).
 */
import { DateOnly } from "../../../shared/kernel";
import { Documento } from "./documento.aggregate";
import {
  Semaforo,
  SujetoRef,
  TipoDocumento,
  TipoSujeto,
  peorEstado,
} from "./value-objects";

export interface DetalleCumplimiento {
  readonly tipoDocumento: string;
  readonly estado: Semaforo;
  readonly diasRestantes: number | null; // null si el Documento requerido está ausente
  readonly ausente: boolean;
}

export interface ResultadoCumplimiento {
  readonly sujeto: SujetoRef;
  readonly semaforo: Semaforo;
  readonly detalles: readonly DetalleCumplimiento[];
}

/**
 * Calcula el Semáforo de un sujeto.
 * @param sujeto          el Vehículo o Conductor.
 * @param documentos      Documentos VIGENTES del sujeto (la capa de aplicación filtra por sujeto).
 * @param tiposRequeridos catálogo de Tipos requeridos para ese tipo de sujeto (I3).
 * @param hoy             fecha de evaluación (reloj de dominio).
 */
export function calcularSemaforo(
  sujeto: SujetoRef,
  documentos: readonly Documento[],
  tiposRequeridos: readonly TipoDocumento[],
  hoy: DateOnly,
): ResultadoCumplimiento {
  const detalles: DetalleCumplimiento[] = [];

  // 1) Estado de cada Documento presente del sujeto.
  const codigosPresentes = new Set<string>();
  for (const doc of documentos) {
    if (!doc.sujeto.equals(sujeto)) continue; // defensa: solo del sujeto
    codigosPresentes.add(doc.tipo.codigo);
    detalles.push({
      tipoDocumento: doc.tipo.codigo,
      estado: doc.estado(hoy),
      diasRestantes: doc.vencimiento.diasRestantesDesde(hoy),
      ausente: false,
    });
  }

  // 2) I3: cada Tipo requerido y ausente cuenta como Vencido (rojo).
  for (const req of tiposRequeridos) {
    if (!req.activo) continue;
    if (req.aplicaA !== sujeto.tipo) continue;
    if (!codigosPresentes.has(req.codigo)) {
      detalles.push({
        tipoDocumento: req.codigo,
        estado: Semaforo.Vencido,
        diasRestantes: null,
        ausente: true,
      });
    }
  }

  // 3) Semáforo = peor estado entre los detalles. Sin Documentos ni requeridos → Vigente.
  let semaforo = Semaforo.Vigente;
  for (const d of detalles) semaforo = peorEstado(semaforo, d.estado);

  return { sujeto, semaforo, detalles };
}

/** Conveniencia para tipar el catálogo por tipo de sujeto. */
export function requeridosPara(
  tipoSujeto: TipoSujeto,
  catalogo: readonly TipoDocumento[],
): TipoDocumento[] {
  return catalogo.filter((t) => t.requerido && t.activo && t.aplicaA === tipoSujeto);
}
