/**
 * Pruebas de los mappers de la capa interface: garantizan que la salida cumple las
 * formas de `openapi.yaml` y que el error-mapping usa los estados correctos.
 * Puras: no requieren NestJS.
 */
import { describe, it, expect } from "vitest";
import { DateOnly, DomainError } from "../../../shared/kernel";
import { Documento } from "../domain/documento.aggregate";
import { SujetoRef, TipoDocumento, TipoSujeto, Semaforo, Vencimiento } from "../domain/value-objects";
import { calcularSemaforo } from "../domain/semaforo.service";
import { documentoToDto, cumplimientoToDto, sujetoFromDto } from "./mappers";
import { statusForDomainError, problemFromDomainError } from "./error-mapping";

const HOY = DateOnly.parse("2026-06-25");

function nuevoDoc(vencIso: string): Documento {
  const r = Documento.registrar({
    id: "doc-1",
    sujeto: SujetoRef.vehiculo("veh-1"),
    tipo: new TipoDocumento("SOAT", TipoSujeto.Vehiculo, false, true),
    emision: DateOnly.parse("2020-01-01"),
    vencimiento: Vencimiento.parse(vencIso),
  });
  if (!r.ok) throw new Error("setup");
  return r.value;
}

describe("mappers interface — documentoToDto", () => {
  it("serializa un Documento a la forma del contrato con estado calculado", () => {
    const doc = nuevoDoc("2026-12-31"); // > 30 días => Vigente
    const dto = documentoToDto(doc, HOY);
    expect(dto).toMatchObject({
      id: "doc-1",
      sujeto: { tipo: "vehiculo", id: "veh-1" },
      tipo: "SOAT",
      vencimiento: "2026-12-31",
      estado: "Vigente",
      tieneAdjunto: false,
      version: 1,
    });
    expect(Array.isArray(dto.historico)).toBe(true);
  });

  it("estado del DTO refleja PorVencer si vence dentro de 30 días", () => {
    // 2026-07-10 respecto 2026-06-25 = 15 días => PorVencer
    const dto = documentoToDto(nuevoDoc("2026-07-10"), HOY);
    expect(dto.estado).toBe("PorVencer");
  });
});

describe("mappers interface — cumplimientoToDto", () => {
  it("mapea el resultado del Semáforo a EstadoCumplimientoDto", () => {
    const sujeto = SujetoRef.vehiculo("veh-1");
    const res = calcularSemaforo(sujeto, [nuevoDoc("2026-07-10")], [], HOY);
    const dto = cumplimientoToDto(res);
    expect(dto.sujeto).toEqual({ tipo: "vehiculo", id: "veh-1" });
    expect(["Vigente", "PorVencer", "Vencido"]).toContain(dto.semaforo);
    expect(dto.documentos?.[0]?.tipo).toBe("SOAT");
  });
});

describe("mappers interface — sujetoFromDto", () => {
  it("reconstruye un SujetoRef de dominio desde el DTO", () => {
    const s = sujetoFromDto({ tipo: "conductor", id: "cond-9" });
    expect(s.tipo).toBe(TipoSujeto.Conductor);
    expect(s.id).toBe("cond-9");
  });
});

describe("error-mapping — código de dominio -> HTTP", () => {
  it.each([
    ["documento_vigente_duplicado", 409],
    ["documento_no_encontrado", 404],
    ["vencimiento_anterior_a_emision", 422],
    ["tipo_no_aplica_al_sujeto", 422],
    ["tipo_documento_desconocido", 422],
    ["codigo_desconocido", 400],
  ])("%s => %i", (code, status) => {
    expect(statusForDomainError(new DomainError(code, "x"))).toBe(status);
  });

  it("problemFromDomainError arma un Problem RFC7807 con type=code", () => {
    const p = problemFromDomainError(new DomainError("documento_no_encontrado", "no existe"), "/v1/documentos/1");
    expect(p).toMatchObject({
      type: "documento_no_encontrado",
      title: "no existe",
      status: 404,
      instance: "/v1/documentos/1",
    });
  });
});
