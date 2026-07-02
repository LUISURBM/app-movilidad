/**
 * Agregado raíz `Servicio` del contexto Service Scheduling (CORE) — spec-008/009.
 *
 * Invariantes que protege:
 *  - S1: un Servicio solo puede pasar a Iniciado si tiene una Asignación válida.
 *  - S2: transiciones válidas únicamente `Planificado → Iniciado → Finalizado`
 *        o `Planificado → Cancelado`; no se salta ni se retrocede. Un estado
 *        TERMINAL nunca se reabre (autoridad de campo del Conductor, spec-010 R9).
 *  - S5 (spec-010): `inicioReal <= finReal`.
 *  - La (re)asignación solo es posible mientras el Servicio está Planificado (R11).
 *
 * Concurrencia: `version` incrementa con cada mutación (control optimista para la
 * sincronización offline de spec-010: los cambios del cliente llevan base_version).
 *
 * NOTA: S4 (no solapamiento de Ventanas) y S3 (regla de oro) son invariantes de
 * CONJUNTO / de colaboración entre contextos; se garantizan en la capa de aplicación
 * (AsignarServicio) y en la base (EXCLUDE constraint, migración 0002), no aquí.
 */
import { DomainError, Result, ok, err } from "../../../shared/kernel";
import {
  Asignacion,
  EstadoServicio,
  Ruta,
  VentanaHoraria,
} from "./value-objects";
import {
  DomainEvent,
  ServicioAsignado,
  ServicioCreado,
  ServicioFinalizado,
  ServicioIniciado,
  nowIso,
} from "./events";

export class Servicio {
  private _eventos: DomainEvent[] = [];
  private _version = 1;

  private constructor(
    public readonly id: string,
    public readonly ruta: Ruta,
    public readonly ventana: VentanaHoraria,
    public readonly clienteRef: string | undefined,
    private _estado: EstadoServicio,
    private _asignacion: Asignacion | undefined,
    private _inicioReal: Date | undefined,
    private _finReal: Date | undefined,
  ) {}

  // ---------- Fábrica: creación (spec-008 R2) ----------

  /** Crea un Servicio en estado Planificado y emite `ServicioCreado`. */
  static crear(params: {
    id: string;
    ruta: Ruta;
    ventana: VentanaHoraria;
    clienteRef?: string;
  }): Servicio {
    const s = new Servicio(
      params.id,
      params.ruta,
      params.ventana,
      params.clienteRef,
      EstadoServicio.Planificado,
      undefined,
      undefined,
      undefined,
    );
    s._eventos.push(<ServicioCreado>{
      tipo: "ServicioCreado",
      ocurridoEn: nowIso(),
      servicioId: s.id,
      ruta: { origen: s.ruta.origen, destino: s.ruta.destino },
      ventana: s.ventana.toJSON(),
      clienteRef: s.clienteRef,
    });
    return s;
  }

  /** Rehidrata desde persistencia (sin emitir eventos). */
  static rehidratar(params: {
    id: string;
    ruta: Ruta;
    ventana: VentanaHoraria;
    clienteRef?: string;
    estado: EstadoServicio;
    asignacion?: Asignacion;
    inicioReal?: Date;
    finReal?: Date;
    version?: number;
  }): Servicio {
    const s = new Servicio(
      params.id,
      params.ruta,
      params.ventana,
      params.clienteRef,
      params.estado,
      params.asignacion,
      params.inicioReal,
      params.finReal,
    );
    s._version = params.version ?? 1;
    return s;
  }

  // ---------- Consultas ----------

  get estado(): EstadoServicio {
    return this._estado;
  }
  get asignacion(): Asignacion | undefined {
    return this._asignacion;
  }
  get inicioReal(): Date | undefined {
    return this._inicioReal;
  }
  get finReal(): Date | undefined {
    return this._finReal;
  }
  /** Versión para control optimista (spec-010 R9). */
  get version(): number {
    return this._version;
  }
  /** ¿Estado terminal? (Finalizado/Cancelado nunca se reabren — spec-010 R9.) */
  get esTerminal(): boolean {
    return this._estado === EstadoServicio.Finalizado || this._estado === EstadoServicio.Cancelado;
  }

  // ---------- Asignación / reasignación (spec-008 R3/R11) ----------

  /**
   * Vincula Vehículo + Conductor al Servicio y emite `ServicioAsignado`.
   * PRECONDICIÓN (capa de aplicación): sin choques (S4) y regla de oro aprobada (S3).
   * Reasignar es válido mientras el Servicio esté Planificado (R11).
   */
  asignar(asignacion: Asignacion): Result<void> {
    if (this._estado !== EstadoServicio.Planificado) {
      return err(
        new DomainError(
          "servicio_no_planificado",
          `Solo se puede (re)asignar un Servicio Planificado; estado actual: ${this._estado}.`,
        ),
      );
    }
    this._asignacion = asignacion;
    this._version += 1;
    this._eventos.push(<ServicioAsignado>{
      tipo: "ServicioAsignado",
      ocurridoEn: nowIso(),
      servicioId: this.id,
      vehiculoId: asignacion.vehiculoId,
      conductorId: asignacion.conductorId,
      ventana: this.ventana.toJSON(),
    });
    return ok(undefined);
  }

  // ---------- Ciclo de vida (S1/S2, spec-008 R6/R7) ----------

  /** Planificado → Iniciado. Exige Asignación válida (S1). */
  iniciar(params?: { ocurridoEn?: Date; odometro?: number }): Result<void> {
    if (this._estado !== EstadoServicio.Planificado) {
      return err(this.transicionInvalida(EstadoServicio.Iniciado));
    }
    if (!this._asignacion) {
      return err(
        new DomainError(
          "servicio_sin_asignacion",
          "No se puede iniciar un Servicio sin Asignación válida (Invariante S1).",
        ),
      );
    }
    this._estado = EstadoServicio.Iniciado;
    this._inicioReal = params?.ocurridoEn ?? new Date();
    this._version += 1;
    this._eventos.push(<ServicioIniciado>{
      tipo: "ServicioIniciado",
      ocurridoEn: nowIso(),
      servicioId: this.id,
      inicioReal: this._inicioReal.toISOString(),
      odometroInicio: params?.odometro,
    });
    return ok(undefined);
  }

  /** Iniciado → Finalizado. Invariante S5: `inicioReal <= finReal` (spec-010 R5). */
  finalizar(params?: { ocurridoEn?: Date; odometro?: number }): Result<void> {
    if (this._estado !== EstadoServicio.Iniciado) {
      return err(this.transicionInvalida(EstadoServicio.Finalizado));
    }
    const finReal = params?.ocurridoEn ?? new Date();
    if (this._inicioReal && finReal.getTime() < this._inicioReal.getTime()) {
      return err(
        new DomainError(
          "fin_anterior_a_inicio",
          "El fin real no puede ser anterior al inicio real (Invariante S5).",
        ),
      );
    }
    this._estado = EstadoServicio.Finalizado;
    this._finReal = finReal;
    this._version += 1;
    this._eventos.push(<ServicioFinalizado>{
      tipo: "ServicioFinalizado",
      ocurridoEn: nowIso(),
      servicioId: this.id,
      finReal: this._finReal.toISOString(),
      odometroFin: params?.odometro,
    });
    return ok(undefined);
  }

  /** Planificado → Cancelado. */
  cancelar(): Result<void> {
    if (this._estado !== EstadoServicio.Planificado) {
      return err(this.transicionInvalida(EstadoServicio.Cancelado));
    }
    this._estado = EstadoServicio.Cancelado;
    this._version += 1;
    return ok(undefined);
  }

  /** ¿La Asignación de este Servicio ocupa agenda? (para S4: Planificado o Iniciado). */
  ocupaAgenda(): boolean {
    return (
      this._asignacion !== undefined &&
      (this._estado === EstadoServicio.Planificado || this._estado === EstadoServicio.Iniciado)
    );
  }

  private transicionInvalida(destino: EstadoServicio): DomainError {
    return new DomainError(
      "transicion_invalida",
      `Transición inválida: ${this._estado} → ${destino} (Invariante S2).`,
    );
  }

  // ---------- Eventos acumulados (para el outbox) ----------

  pullEventos(): DomainEvent[] {
    const e = this._eventos;
    this._eventos = [];
    return e;
  }

  peekEventos(): readonly DomainEvent[] {
    return this._eventos;
  }

  // ---------- Snapshot para persistencia (capa infrastructure) ----------

  snapshot(): {
    id: string;
    origen: string;
    destino: string;
    ventanaInicio: string; // ISO date-time
    ventanaFin: string; // ISO date-time
    clienteRef?: string;
    estado: EstadoServicio;
    vehiculoId?: string;
    conductorId?: string;
    advertencias: string[];
    inicioReal?: string;
    finReal?: string;
    version: number;
  } {
    return {
      version: this._version,
      id: this.id,
      origen: this.ruta.origen,
      destino: this.ruta.destino,
      ventanaInicio: this.ventana.inicio.toISOString(),
      ventanaFin: this.ventana.fin.toISOString(),
      clienteRef: this.clienteRef,
      estado: this._estado,
      vehiculoId: this._asignacion?.vehiculoId,
      conductorId: this._asignacion?.conductorId,
      advertencias: [...(this._asignacion?.advertencias ?? [])],
      inicioReal: this._inicioReal?.toISOString(),
      finReal: this._finReal?.toISOString(),
    };
  }
}
