/**
 * Dispatcher del OUTBOX (ADR-0004) — plataforma, compartido por todos los módulos.
 *
 * Los módulos escriben eventos en la tabla `outbox` dentro de su transacción
 * (ver el `outbox.publisher.ts` de la infrastructure de cada módulo). Este worker
 * los publica DESPUÉS, con reintentos y backoff exponencial (al menos una vez).
 *
 * Puertos:
 *  - `OutboxStore`: acceso a las filas pendientes (SQL en prod, in-memory en tests).
 *  - `EventSink` : destino de entrega (notificador, bus, log). Los integradores
 *    concretos (email/SMS/push — gap conocido de spec-006) implementan este puerto.
 */
import { Clock } from "../shared/kernel";

export interface OutboxRow {
  readonly id: string;
  readonly tenantId: string;
  readonly tipoEvento: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly intentos: number;
}

export interface OutboxStore {
  /** Filas 'pendiente' cuyo proximo_intento <= ahora, hasta `limite`. */
  tomarPendientes(limite: number, ahora: Date): Promise<OutboxRow[]>;
  marcarPublicado(id: string): Promise<void>;
  /** Reprograma un intento fallido; si `agotado`, marca la fila como 'fallido'. */
  reprogramar(id: string, intentos: number, proximoIntento: Date, agotado: boolean): Promise<void>;
}

export interface EventSink {
  entregar(evento: OutboxRow): Promise<void>;
}

export interface ResultadoDespacho {
  publicados: number;
  reintentos: number;
  agotados: number;
}

export interface OpcionesDispatcher {
  batch?: number; // filas por pasada (default 50)
  maxIntentos?: number; // intentos antes de marcar 'fallido' (default 8)
  backoffBaseMs?: number; // base del backoff exponencial (default 1000)
}

export class OutboxDispatcher {
  private readonly batch: number;
  private readonly maxIntentos: number;
  private readonly backoffBaseMs: number;

  constructor(
    private readonly store: OutboxStore,
    private readonly sink: EventSink,
    private readonly clock: Clock,
    opts: OpcionesDispatcher = {},
  ) {
    this.batch = opts.batch ?? 50;
    this.maxIntentos = opts.maxIntentos ?? 8;
    this.backoffBaseMs = opts.backoffBaseMs ?? 1000;
  }

  /** Una pasada de despacho (el loop/timer lo maneja quien lo aloja). */
  async despacharUnaVez(): Promise<ResultadoDespacho> {
    const ahora = this.clock.now();
    const filas = await this.store.tomarPendientes(this.batch, ahora);
    const resultado: ResultadoDespacho = { publicados: 0, reintentos: 0, agotados: 0 };

    for (const fila of filas) {
      try {
        await this.sink.entregar(fila);
        await this.store.marcarPublicado(fila.id);
        resultado.publicados += 1;
      } catch {
        const intentos = fila.intentos + 1;
        const agotado = intentos >= this.maxIntentos;
        // Backoff exponencial: base * 2^intentos.
        const espera = this.backoffBaseMs * 2 ** intentos;
        const proximo = new Date(ahora.getTime() + espera);
        await this.store.reprogramar(fila.id, intentos, proximo, agotado);
        if (agotado) resultado.agotados += 1;
        else resultado.reintentos += 1;
      }
    }
    return resultado;
  }
}

/** Sink mínimo de desarrollo: deja traza. Los notificadores reales lo sustituyen. */
export class LogEventSink implements EventSink {
  async entregar(e: OutboxRow): Promise<void> {
    // eslint-disable-next-line no-console
    console.info(`[outbox] ${e.tipoEvento} tenant=${e.tenantId} aggregate=${e.aggregateId}`);
  }
}

/** Fila interna MUTABLE del store en memoria (OutboxRow es readonly hacia afuera). */
interface FilaInterna {
  id: string;
  tenantId: string;
  tipoEvento: string;
  aggregateId: string;
  payload: unknown;
  intentos: number;
  estado: "pendiente" | "publicado" | "fallido";
  proximoIntento: Date;
}

/** Store en memoria para pruebas y arranque sin base de datos. */
export class InMemoryOutboxStore implements OutboxStore {
  private filas = new Map<string, FilaInterna>();

  /** Helper de pruebas/dev: encolar una fila pendiente. */
  encolar(row: Omit<OutboxRow, "intentos">, proximoIntento = new Date(0)): void {
    this.filas.set(row.id, { ...row, intentos: 0, estado: "pendiente", proximoIntento });
  }

  estadoDe(id: string): { estado: string; intentos: number; proximoIntento: Date } | undefined {
    const f = this.filas.get(id);
    return f ? { estado: f.estado, intentos: f.intentos, proximoIntento: f.proximoIntento } : undefined;
  }

  async tomarPendientes(limite: number, ahora: Date): Promise<OutboxRow[]> {
    return [...this.filas.values()]
      .filter((f) => f.estado === "pendiente" && f.proximoIntento.getTime() <= ahora.getTime())
      .slice(0, limite)
      .map((f) => ({
        id: f.id,
        tenantId: f.tenantId,
        tipoEvento: f.tipoEvento,
        aggregateId: f.aggregateId,
        payload: f.payload,
        intentos: f.intentos,
      }));
  }

  async marcarPublicado(id: string): Promise<void> {
    const f = this.filas.get(id);
    if (f) f.estado = "publicado";
  }

  async reprogramar(id: string, intentos: number, proximoIntento: Date, agotado: boolean): Promise<void> {
    const f = this.filas.get(id);
    if (!f) return;
    f.intentos = intentos;
    f.proximoIntento = proximoIntento;
    if (agotado) f.estado = "fallido";
  }
}
