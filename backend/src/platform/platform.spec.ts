/**
 * Pruebas de la plataforma: dispatcher del outbox (ADR-0004) y job diario del
 * reloj de dominio (spec-006 R8). Deterministas: reloj fijo y fake timers.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { FixedClock, DateOnly, TenantId } from "../shared/kernel";
import {
  EventSink,
  InMemoryOutboxStore,
  OutboxDispatcher,
  OutboxRow,
} from "./outbox";
import {
  DailyTenantJob,
  InMemoryTenantRegistry,
  msHastaProximaMedianocheUTC,
} from "./daily-job";

const clock = new FixedClock(DateOnly.parse("2026-07-01"));

function fila(id: string, tenant = "tenant-duster"): Omit<OutboxRow, "intentos"> {
  return { id, tenantId: tenant, tipoEvento: "ServicioAsignado", aggregateId: "srv-1", payload: { x: 1 } };
}

class SinkQueFalla implements EventSink {
  public entregados: OutboxRow[] = [];
  constructor(private fallosRestantes: number) {}
  async entregar(e: OutboxRow): Promise<void> {
    if (this.fallosRestantes > 0) {
      this.fallosRestantes -= 1;
      throw new Error("destino caído");
    }
    this.entregados.push(e);
  }
}

// ════════════════════════════ OutboxDispatcher ════════════════════════════
describe("OutboxDispatcher (ADR-0004) — entrega al menos una vez con backoff", () => {
  it("publica las filas pendientes y las marca 'publicado'", async () => {
    const store = new InMemoryOutboxStore();
    store.encolar(fila("e1"));
    store.encolar(fila("e2"));
    const sink = new SinkQueFalla(0);
    const d = new OutboxDispatcher(store, sink, clock);

    const r = await d.despacharUnaVez();
    expect(r.publicados).toBe(2);
    expect(store.estadoDe("e1")!.estado).toBe("publicado");
    expect(sink.entregados.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("ante un fallo reprograma con backoff exponencial y conserva la fila pendiente", async () => {
    const store = new InMemoryOutboxStore();
    store.encolar(fila("e1"));
    const d = new OutboxDispatcher(store, new SinkQueFalla(1), clock, { backoffBaseMs: 1000 });

    const r = await d.despacharUnaVez();
    expect(r.reintentos).toBe(1);
    const estado = store.estadoDe("e1")!;
    expect(estado.estado).toBe("pendiente");
    expect(estado.intentos).toBe(1);
    // backoff = base * 2^intentos = 1000 * 2 = 2000 ms después de "ahora".
    expect(estado.proximoIntento.getTime()).toBe(clock.now().getTime() + 2000);
  });

  it("no toma filas cuyo proximo_intento aún no llega", async () => {
    const store = new InMemoryOutboxStore();
    const futuro = new Date(clock.now().getTime() + 60_000);
    store.encolar(fila("e1"), futuro);
    const sink = new SinkQueFalla(0);
    const d = new OutboxDispatcher(store, sink, clock);

    const r = await d.despacharUnaVez();
    expect(r.publicados).toBe(0);
    expect(sink.entregados).toHaveLength(0);
  });

  it("tras agotar maxIntentos la fila queda 'fallido' (requiere intervención)", async () => {
    const store = new InMemoryOutboxStore();
    store.encolar(fila("e1"));
    const d = new OutboxDispatcher(store, new SinkQueFalla(99), clock, {
      maxIntentos: 2,
      backoffBaseMs: 0, // sin espera para simplificar la prueba
    });

    await d.despacharUnaVez(); // intento 1 → reintento
    const r2 = await d.despacharUnaVez(); // intento 2 → agotado
    expect(r2.agotados).toBe(1);
    expect(store.estadoDe("e1")!.estado).toBe("fallido");
  });

  it("una entrega que falla no impide publicar el resto del lote", async () => {
    const store = new InMemoryOutboxStore();
    store.encolar(fila("mala"));
    store.encolar(fila("buena"));
    // Falla solo la primera entrega del lote.
    const d = new OutboxDispatcher(store, new SinkQueFalla(1), clock);

    const r = await d.despacharUnaVez();
    expect(r.publicados).toBe(1);
    expect(r.reintentos).toBe(1);
    expect(store.estadoDe("buena")!.estado).toBe("publicado");
  });
});

// ════════════════════════════ Job diario ════════════════════════════
describe("DailyTenantJob — el reloj de dominio corre solo (spec-006 R8)", () => {
  afterEach(() => vi.useRealTimers());

  it("msHastaProximaMedianocheUTC calcula el salto exacto", () => {
    expect(msHastaProximaMedianocheUTC(new Date("2026-07-01T23:59:59Z"))).toBe(1000);
    expect(msHastaProximaMedianocheUTC(new Date("2026-07-01T00:00:00Z"))).toBe(24 * 60 * 60 * 1000);
  });

  it("correrAhora ejecuta la tarea para CADA tenant y aísla errores", async () => {
    const corridos: string[] = [];
    const registry = new InMemoryTenantRegistry([
      TenantId("tenant-a"),
      TenantId("tenant-roto"),
      TenantId("tenant-b"),
    ]);
    const job = new DailyTenantJob("evaluar-vencimientos", registry, async (t) => {
      if (t === "tenant-roto") throw new Error("boom");
      corridos.push(t);
    });

    const r = await job.correrAhora();
    expect(r).toEqual({ tenants: 3, errores: 1 });
    expect(corridos).toEqual(["tenant-a", "tenant-b"]); // el error no detuvo a los demás
  });

  it("start() dispara a la próxima medianoche UTC y luego cada 24 h", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-01T18:00:00Z") });
    const registry = new InMemoryTenantRegistry([TenantId("tenant-duster")]);
    let corridas = 0;
    const job = new DailyTenantJob("evaluar-vencimientos", registry, async () => {
      corridas += 1;
    });

    job.start();
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 1); // 23:59:59.999
    expect(corridas).toBe(0);
    await vi.advanceTimersByTimeAsync(1); // medianoche
    expect(corridas).toBe(1);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); // día siguiente
    expect(corridas).toBe(2);
    job.stop();
  });
});
