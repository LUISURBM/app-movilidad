/**
 * Pruebas del sink de notificaciones (delivery de spec-006 R4/R6 y spec-009 P3):
 * el flujo completo outbox → dispatcher → sink → canal, con reintento heredado.
 */
import { describe, it, expect } from "vitest";
import { DateOnly, FixedClock } from "../shared/kernel";
import { InMemoryOutboxStore, OutboxDispatcher, OutboxRow } from "./outbox";
import {
  CanalNotificacion,
  InMemoryCanalNotificacion,
  InMemoryDirectorioContactos,
  Mensaje,
  NotificacionesSink,
  formatearEvento,
} from "./notificaciones";

const clock = new FixedClock(DateOnly.parse("2026-07-02"));
const TENANT_A = "tenant-duster";
const TENANT_B = "tenant-otro";

function evento(tipo: string, payload: unknown, tenant = TENANT_A, id = `e-${Math.random()}`): OutboxRow {
  return { id, tenantId: tenant, tipoEvento: tipo, aggregateId: "agg-1", payload, intentos: 0 };
}

describe("formatearEvento — mensajes en el lenguaje del Operador", () => {
  it("DocumentoPorVencer indica QUÉ documento, de QUIÉN y en CUÁNTOS días (spec-006 R4)", () => {
    const m = formatearEvento(
      evento("DocumentoPorVencer", {
        tipoDocumento: "SOAT",
        sujeto: { tipo: "vehiculo", id: "veh-abc123" },
        diasRestantes: 15,
      }),
    );
    expect(m!.asunto).toContain("SOAT");
    expect(m!.asunto).toContain("15");
    expect(m!.cuerpo).toContain("veh-abc123");
    expect(m!.cuerpo).toContain("15 día(s)");
  });

  it("DocumentoVencido avisa el bloqueo operativo (spec-006 R6 + spec-009)", () => {
    const m = formatearEvento(
      evento("DocumentoVencido", {
        tipoDocumento: "LICENCIA",
        sujeto: { tipo: "conductor", id: "cond-juan" },
      }),
    );
    expect(m!.asunto).toContain("VENCIDO");
    expect(m!.cuerpo).toContain("Conductor cond-juan");
    expect(m!.cuerpo).toContain("bloqueado");
  });

  it("AsignacionRechazada distingue incumplimiento de choque (P3/P4)", () => {
    const inc = formatearEvento(evento("AsignacionRechazada", { servicioId: "srv-1", motivo: "incumplimiento", detalle: "SOAT vencido." }));
    const cho = formatearEvento(evento("AsignacionRechazada", { servicioId: "srv-2", motivo: "choque" }));
    expect(inc!.cuerpo).toContain("incumplimiento documental");
    expect(inc!.cuerpo).toContain("SOAT vencido.");
    expect(cho!.cuerpo).toContain("choque de ventana horaria");
  });

  it("eventos no notificables devuelven null (ServicioCreado, DocumentoRegistrado, ...)", () => {
    expect(formatearEvento(evento("ServicioCreado", {}))).toBeNull();
    expect(formatearEvento(evento("DocumentoRegistrado", {}))).toBeNull();
  });
});

describe("NotificacionesSink — entrega aislada por tenant sobre el dispatcher", () => {
  function entorno() {
    const directorio = new InMemoryDirectorioContactos();
    directorio.agregar(TENANT_A, { nombre: "Luis", email: "operador@duster.co" });
    const canal = new InMemoryCanalNotificacion();
    const sink = new NotificacionesSink(directorio, canal);
    const store = new InMemoryOutboxStore();
    const dispatcher = new OutboxDispatcher(store, sink, clock);
    return { directorio, canal, sink, store, dispatcher };
  }

  it("un DocumentoPorVencer en el outbox llega como mensaje SOLO a los contactos de SU tenant", async () => {
    const { canal, store, dispatcher } = entorno();
    store.encolar(evento("DocumentoPorVencer", { tipoDocumento: "SOAT", sujeto: { tipo: "vehiculo", id: "v1" }, diasRestantes: 3 }, TENANT_A, "e1"));
    store.encolar(evento("DocumentoVencido", { tipoDocumento: "RTM", sujeto: { tipo: "vehiculo", id: "v9" } }, TENANT_B, "e2")); // B sin contactos

    const r = await dispatcher.despacharUnaVez();
    expect(r.publicados).toBe(2); // ambos publicados; B sin contactos = no-op, no bloquea
    expect(canal.enviados).toHaveLength(1);
    expect(canal.enviados[0].tenantId).toBe(TENANT_A);
    expect(canal.enviados[0].destinatarios[0].email).toBe("operador@duster.co");
  });

  it("eventos no notificables se publican sin enviar nada", async () => {
    const { canal, store, dispatcher } = entorno();
    store.encolar(evento("ServicioAsignado", { servicioId: "srv-1" }, TENANT_A, "e1"));
    const r = await dispatcher.despacharUnaVez();
    expect(r.publicados).toBe(1);
    expect(canal.enviados).toHaveLength(0);
  });

  it("si el canal FALLA, el evento se reintenta con backoff (garantía del outbox)", async () => {
    const directorio = new InMemoryDirectorioContactos();
    directorio.agregar(TENANT_A, { email: "x@y.co" });
    class CanalCaido implements CanalNotificacion {
      intentos = 0;
      async enviar(_m: Mensaje): Promise<void> {
        this.intentos += 1;
        if (this.intentos === 1) throw new Error("SMTP caído");
      }
    }
    const canal = new CanalCaido();
    const store = new InMemoryOutboxStore();
    const dispatcher = new OutboxDispatcher(store, new NotificacionesSink(directorio, canal), clock, { backoffBaseMs: 0 });
    store.encolar(evento("DocumentoVencido", { tipoDocumento: "SOAT", sujeto: { tipo: "vehiculo", id: "v1" } }, TENANT_A, "e1"));

    const r1 = await dispatcher.despacharUnaVez();
    expect(r1.reintentos).toBe(1);
    expect(store.estadoDe("e1")!.estado).toBe("pendiente");

    const r2 = await dispatcher.despacharUnaVez(); // el canal ya se recuperó
    expect(r2.publicados).toBe(1);
    expect(canal.intentos).toBe(2);
  });
});
