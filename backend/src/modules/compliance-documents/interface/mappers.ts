/**
 * Mappers dominio <-> DTO (capa interface). Funciones puras y verificables sin framework.
 * Garantizan que la salida REST cumple `openapi.yaml` y que la entrada se traduce al dominio.
 */
import { Documento } from "../domain/documento.aggregate";
import {
  Semaforo,
  SujetoRef,
  TipoSujeto,
} from "../domain/value-objects";
import {
  DetalleCumplimiento,
  ResultadoCumplimiento,
} from "../domain/semaforo.service";
import { DateOnly } from "../../../shared/kernel";
import {
  DocumentoDto,
  EstadoCumplimientoDto,
  SemaforoDto,
  SujetoRefDto,
} from "./dtos";

export function semaforoToDto(s: Semaforo): SemaforoDto {
  return s; // el enum de dominio usa los mismos literales del contrato
}

export function sujetoToDto(s: SujetoRef): SujetoRefDto {
  return { tipo: s.tipo, id: s.id };
}

export function sujetoFromDto(d: SujetoRefDto): SujetoRef {
  return SujetoRef.of(d.tipo as TipoSujeto, d.id);
}

/** Serializa un Documento del dominio al DTO del contrato, calculando su estado a `hoy`. */
export function documentoToDto(doc: Documento, hoy: DateOnly): DocumentoDto {
  return {
    id: doc.id,
    sujeto: sujetoToDto(doc.sujeto),
    tipo: doc.tipo.codigo,
    vencimiento: doc.vencimiento.fecha.toISO(),
    expedicion: doc.emision.toISO(),
    estado: semaforoToDto(doc.estado(hoy)),
    tieneAdjunto: doc.adjuntoRef !== undefined,
    version: doc.version,
    historico: doc.historico.map((h) => ({
      version: h.version,
      vencimiento: h.vencimiento,
      reemplazadoEn: h.reemplazadoEn,
    })),
  };
}

export function cumplimientoToDto(r: ResultadoCumplimiento): EstadoCumplimientoDto {
  return {
    sujeto: sujetoToDto(r.sujeto),
    semaforo: semaforoToDto(r.semaforo),
    documentos: r.detalles.map((d: DetalleCumplimiento) => ({
      tipo: d.tipoDocumento,
      estado: semaforoToDto(d.estado),
      diasRestantes: d.diasRestantes ?? undefined,
    })),
  };
}
