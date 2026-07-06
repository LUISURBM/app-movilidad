import { describe, expect, it } from "vitest";
import {
  cop,
  diasRestantesTexto,
  fecha,
  problemaAMensaje,
} from "@/lib/format";

describe("fecha", () => {
  it("formatea una fecha (date) en es-CO sin correrse un día", () => {
    // La fecha sin hora se ancla a medianoche LOCAL: debe seguir siendo día 6.
    // es-CO (ICU) usa medium numérico: "6/07/2026"; se tolera variante con mes.
    const texto = fecha("2026-07-06");
    expect(texto).toMatch(/^6[/ ]/);
    expect(texto).toContain("2026");
  });

  it("devuelve — cuando falta o es inválida", () => {
    expect(fecha(undefined)).toBe("—");
    expect(fecha("no-es-fecha")).toBe("—");
  });
});

describe("cop", () => {
  it("formatea COP sin decimales", () => {
    const texto = cop(250000);
    expect(texto).toContain("250.000");
    expect(texto).toContain("$");
  });
});

describe("diasRestantesTexto", () => {
  it("distingue vencido, hoy y futuro", () => {
    expect(diasRestantesTexto(-2)).toBe("vencido hace 2 días");
    expect(diasRestantesTexto(-1)).toBe("vencido hace 1 día");
    expect(diasRestantesTexto(0)).toBe("vence hoy");
    expect(diasRestantesTexto(1)).toBe("vence en 1 día");
    expect(diasRestantesTexto(15)).toBe("vence en 15 días");
  });
});

describe("problemaAMensaje (RFC 7807 → es-CO)", () => {
  it("antepone el encabezado de la regla de oro en 409 incumplimiento", () => {
    const mensaje = problemaAMensaje({
      type: "incumplimiento",
      title: "Conflict",
      status: 409,
      detail: "El vehículo ABC123 tiene el SOAT vencido.",
    });
    expect(mensaje).toBe(
      "Bloqueado por la regla de oro: El vehículo ABC123 tiene el SOAT vencido.",
    );
  });

  it("antepone choque de agenda en conflicto_horario", () => {
    const mensaje = problemaAMensaje({
      type: "conflicto_horario",
      title: "Conflict",
      status: 409,
      detail: "El conductor ya tiene un servicio en esa ventana.",
    });
    expect(mensaje).toMatch(/^Choque de agenda:/);
  });

  it("incluye errores de validación por campo", () => {
    const mensaje = problemaAMensaje({
      title: "Unprocessable Entity",
      status: 422,
      detail: "Solicitud inválida.",
      errors: [{ campo: "vencimiento", mensaje: "es requerido" }],
    });
    expect(mensaje).toContain("vencimiento: es requerido");
  });

  it("usa el fallback si no hay Problem", () => {
    expect(problemaAMensaje(null, "Sin conexión.")).toBe("Sin conexión.");
  });
});
