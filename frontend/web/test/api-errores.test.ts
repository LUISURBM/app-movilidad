import { describe, expect, it } from "vitest";
import { desenvolver, ErrorApi, problemaDe } from "@/lib/api";

function respuesta(status: number): Response {
  return { status } as Response;
}

describe("desenvolver", () => {
  it("devuelve data cuando la respuesta es exitosa", () => {
    const data = { id: "abc" };
    expect(desenvolver({ data, response: respuesta(200) })).toBe(data);
  });

  it("lanza ErrorApi conservando el Problem del backend", () => {
    const problema = {
      type: "incumplimiento",
      title: "Conflict",
      status: 409,
      detail: "Semáforo en rojo.",
    };
    try {
      desenvolver({ error: problema, response: respuesta(409) });
      expect.unreachable("debió lanzar");
    } catch (err) {
      expect(err).toBeInstanceOf(ErrorApi);
      const e = err as ErrorApi;
      expect(e.problema?.type).toBe("incumplimiento");
      expect(e.message).toContain("Bloqueado por la regla de oro");
    }
  });

  it("lanza ErrorApi con el status cuando no hay cuerpo Problem", () => {
    try {
      desenvolver({ response: respuesta(500) });
      expect.unreachable("debió lanzar");
    } catch (err) {
      expect((err as ErrorApi).message).toContain("500");
    }
  });
});

describe("problemaDe", () => {
  it("extrae el Problem de un ErrorApi para la UI", () => {
    const e = new ErrorApi({ title: "Conflict", status: 409, type: "duplicado" });
    const p = problemaDe(e);
    expect(typeof p).not.toBe("string");
    expect((p as { type?: string }).type).toBe("duplicado");
  });

  it("degrada a mensaje para errores comunes", () => {
    expect(problemaDe(new Error("Falló la red"))).toBe("Falló la red");
    expect(problemaDe(null)).toBeNull();
  });
});
