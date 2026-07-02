/**
 * Notificaciones sobre el OUTBOX (cierra el delivery de spec-006 R4/R6 y spec-009 P3).
 *
 * `NotificacionesSink` implementa `EventSink`: el OutboxDispatcher le entrega cada
 * evento y este decide si notifica. Traduce los eventos de dominio relevantes a
 * mensajes legibles para el Operador y los envía por el `CanalNotificacion`.
 *
 * Puertos (los integradores reales llegan después, sin tocar esta lógica):
 *  - `DirectorioContactos`: quién recibe las alertas de cada tenant. Hoy in-memory;
 *    la fuente real llega con spec-002 (usuarios/roles del tenant).
 *  - `CanalNotificacion` : cómo se entrega (email/SMS/push). Hoy consola (dev).
 *
 * Si el canal falla, el sink LANZA: el dispatcher reintenta con backoff (ADR-0004),
 * de modo que las alertas heredan la garantía "al menos una vez" del outbox.
 */
import { OutboxRow, EventSink } from "./outbox";

export interface Contacto {
  readonly nombre?: string;
  readonly email?: string;
  readonly telefono?: string;
}

export interface Mensaje {
  readonly tenantId: string;
  readonly asunto: string;
  readonly cuerpo: string;
  readonly destinatarios: readonly Contacto[];
}

export interface DirectorioContactos {
  /** Contactos que reciben alertas operativas del tenant (Operador/Admin). */
  contactosDeTenant(tenantId: string): Promise<Contacto[]>;
}

export interface CanalNotificacion {
  enviar(mensaje: Mensaje): Promise<void>;
}

// ---------- Formato de mensajes (lenguaje del Operador, es-CO) ----------

interface SujetoPayload {
  tipo?: "vehiculo" | "conductor";
  id?: string;
}

const nombreSujeto = (s?: SujetoPayload): string =>
  s?.tipo === "conductor" ? `el Conductor ${s.id ?? ""}` : `el Vehículo ${s?.id ?? ""}`;

/**
 * Devuelve el mensaje para un evento, o null si el evento no genera notificación.
 * Cubre: DocumentoPorVencer (spec-006 R4), DocumentoVencido (spec-006 R6),
 * AsignacionRechazada (spec-008 P4 / spec-009 P3).
 */
export function formatearEvento(row: OutboxRow): Omit<Mensaje, "destinatarios" | "tenantId"> | null {
  const p = row.payload as Record<string, unknown>;
  switch (row.tipoEvento) {
    case "DocumentoPorVencer": {
      const dias = p.diasRestantes as number;
      return {
        asunto: `⚠️ ${p.tipoDocumento} por vencer (${dias} días)`,
        cuerpo: `El documento ${p.tipoDocumento} de ${nombreSujeto(p.sujeto as SujetoPayload)} vence en ${dias} día(s). Renueve a tiempo para no bloquear la operación (regla de oro).`,
      };
    }
    case "DocumentoVencido":
      return {
        asunto: `🔴 ${p.tipoDocumento} VENCIDO`,
        cuerpo: `El documento ${p.tipoDocumento} de ${nombreSujeto(p.sujeto as SujetoPayload)} está VENCIDO. El recurso queda bloqueado para nuevas asignaciones hasta renovarlo (spec-009).`,
      };
    case "AsignacionRechazada": {
      const motivo = p.motivo === "incumplimiento" ? "incumplimiento documental" : "choque de ventana horaria";
      return {
        asunto: `Asignación rechazada (${motivo})`,
        cuerpo: `La asignación del Servicio ${p.servicioId} fue rechazada por ${motivo}.${p.detalle ? ` Detalle: ${p.detalle}` : ""}`,
      };
    }
    default:
      return null; // el resto de eventos no notifica (se marca publicado igualmente)
  }
}

// ---------- Sink ----------

export class NotificacionesSink implements EventSink {
  constructor(
    private readonly directorio: DirectorioContactos,
    private readonly canal: CanalNotificacion,
  ) {}

  async entregar(row: OutboxRow): Promise<void> {
    const formato = formatearEvento(row);
    if (!formato) return; // evento no notificable: entrega exitosa (no-op)

    const destinatarios = await this.directorio.contactosDeTenant(row.tenantId);
    if (destinatarios.length === 0) return; // sin contactos configurados: no bloquear el outbox

    await this.canal.enviar({
      tenantId: row.tenantId, // aislamiento: destinatarios SOLO del tenant del evento
      asunto: formato.asunto,
      cuerpo: formato.cuerpo,
      destinatarios,
    });
  }
}

// ---------- Adaptadores mínimos (dev / pruebas) ----------

/** Directorio in-memory; la fuente real llega con spec-002 (usuarios del tenant). */
export class InMemoryDirectorioContactos implements DirectorioContactos {
  private porTenant = new Map<string, Contacto[]>();

  agregar(tenantId: string, contacto: Contacto): void {
    this.porTenant.set(tenantId, [...(this.porTenant.get(tenantId) ?? []), contacto]);
  }

  async contactosDeTenant(tenantId: string): Promise<Contacto[]> {
    return this.porTenant.get(tenantId) ?? [];
  }
}

/** Canal de desarrollo: imprime el mensaje. Producción: EmailCanal/SmsCanal/PushCanal. */
export class ConsoleCanalNotificacion implements CanalNotificacion {
  async enviar(m: Mensaje): Promise<void> {
    // eslint-disable-next-line no-console
    console.info(`[notificación→${m.tenantId}] ${m.asunto} :: ${m.cuerpo} → ${m.destinatarios.length} destinatario(s)`);
  }
}

/** Canal en memoria para PRUEBAS: acumula los mensajes enviados. */
export class InMemoryCanalNotificacion implements CanalNotificacion {
  public readonly enviados: Mensaje[] = [];
  async enviar(m: Mensaje): Promise<void> {
    this.enviados.push(m);
  }
}
