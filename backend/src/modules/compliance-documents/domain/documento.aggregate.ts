/**
 * Agregado raíz `Documento` del contexto Compliance & Documents (CORE) — Fase 2.
 *
 * Invariantes que protege:
 *  - I4: la nueva Vigencia (renovación) debe ser posterior o igual a su emisión;
 *        las versiones anteriores se conservan como histórico inmutable.
 *  - Estado del Documento derivado del Vencimiento vigente (spec-006).
 *  - R5 (spec-006): cada umbral de alerta (30/15/3) se emite una sola vez.
 *
 * NOTA: la invariante I2 ("un solo Documento vigente por Tipo+sujeto") es un invariante
 * de conjunto, no de un único agregado; se garantiza en la capa de aplicación al
 * registrar/renovar (ver application/use-cases). Aquí el agregado modela un Documento
 * y su cadena de versiones.
 */
import { DateOnly, DomainError, Result, ok, err } from "../../../shared/kernel";
import {
  Semaforo,
  SujetoRef,
  TipoDocumento,
  Vencimiento,
  UMBRALES_ALERTA,
  UmbralAlerta,
} from "./value-objects";
import {
  DomainEvent,
  DocumentoPorVencer,
  DocumentoVencido,
  DocumentoRenovado,
  DocumentoRegistrado,
  nowIso,
} from "./events";

/** Una versión histórica del Documento (inmutable). spec-007 R3/R5. */
export interface VersionHistorica {
  readonly version: number;
  readonly vencimiento: string; // YYYY-MM-DD
  readonly emision: string; // YYYY-MM-DD
  readonly adjuntoRef?: string;
  readonly reemplazadoEn: string; // ISO date-time
}

export class Documento {
  private _eventos: DomainEvent[] = [];
  /** Umbrales de alerta ya notificados (R5: una vez por umbral). */
  private _umbralesNotificados = new Set<UmbralAlerta>();
  private _vencido = false;

  private constructor(
    public readonly id: string,
    public readonly sujeto: SujetoRef,
    public readonly tipo: TipoDocumento,
    private _vencimiento: Vencimiento,
    private _emision: DateOnly,
    private _adjuntoRef: string | undefined,
    private _version: number,
    private readonly _historico: VersionHistorica[],
  ) {}

  // ---------- Fábrica: registro (spec-005) ----------

  /**
   * Registra un nuevo Documento. Reglas spec-005:
   *  - R4: el Vencimiento debe ser posterior o igual a la emisión.
   *  - El Tipo debe aplicar al sujeto (R: error si no aplica).
   */
  static registrar(params: {
    id: string;
    sujeto: SujetoRef;
    tipo: TipoDocumento;
    emision: DateOnly;
    vencimiento: Vencimiento;
    adjuntoRef?: string;
  }): Result<Documento> {
    const { id, sujeto, tipo, emision, vencimiento, adjuntoRef } = params;

    if (!tipo.aplicaASujeto(sujeto)) {
      return err(
        new DomainError(
          "tipo_no_aplica_al_sujeto",
          `El Tipo "${tipo.codigo}" no aplica a un sujeto de tipo ${sujeto.tipo}.`,
        ),
      );
    }
    if (vencimiento.fecha.isBefore(emision)) {
      return err(
        new DomainError(
          "vencimiento_anterior_a_emision",
          "El Vencimiento no puede ser anterior a la fecha de emisión.",
        ),
      );
    }

    const doc = new Documento(id, sujeto, tipo, vencimiento, emision, adjuntoRef, 1, []);
    doc._eventos.push(<DocumentoRegistrado>{
      tipo: "DocumentoRegistrado",
      ocurridoEn: nowIso(),
      documentoId: id,
      sujeto,
      tipoDocumento: tipo.codigo,
      vencimiento: vencimiento.fecha.toISO(),
    });
    return ok(doc);
  }

  /** Rehidrata un Documento desde persistencia (sin emitir eventos). */
  static rehidratar(params: {
    id: string;
    sujeto: SujetoRef;
    tipo: TipoDocumento;
    vencimiento: Vencimiento;
    emision: DateOnly;
    adjuntoRef?: string;
    version: number;
    historico: VersionHistorica[];
    umbralesNotificados?: UmbralAlerta[];
    vencidoNotificado?: boolean;
  }): Documento {
    const d = new Documento(
      params.id,
      params.sujeto,
      params.tipo,
      params.vencimiento,
      params.emision,
      params.adjuntoRef,
      params.version,
      params.historico ?? [],
    );
    for (const u of params.umbralesNotificados ?? []) d._umbralesNotificados.add(u);
    d._vencido = params.vencidoNotificado ?? false;
    return d;
  }

  // ---------- Consultas ----------

  get vencimiento(): Vencimiento {
    return this._vencimiento;
  }
  get emision(): DateOnly {
    return this._emision;
  }
  get version(): number {
    return this._version;
  }
  get adjuntoRef(): string | undefined {
    return this._adjuntoRef;
  }
  get historico(): readonly VersionHistorica[] {
    return this._historico;
  }

  /** Estado (Semáforo) del Documento a la fecha dada. spec-006 R2/R3. */
  estado(hoy: DateOnly): Semaforo {
    return this._vencimiento.estadoDesde(hoy);
  }

  // ---------- Renovación (spec-007) ----------

  /**
   * Renueva el Documento: conserva la versión actual como histórico inmutable y
   * adopta una nueva Vigencia. Invariante I4: nueva Vigencia >= nueva emisión.
   * Se puede renovar estando por vencer o ya vencido (R9).
   */
  renovar(params: {
    nuevaEmision: DateOnly;
    nuevoVencimiento: Vencimiento;
    adjuntoRef?: string;
  }): Result<void> {
    const { nuevaEmision, nuevoVencimiento, adjuntoRef } = params;
    if (nuevoVencimiento.fecha.isBefore(nuevaEmision)) {
      return err(
        new DomainError(
          "vencimiento_anterior_a_emision",
          "La nueva Vigencia no puede ser anterior a la fecha de emisión de la renovación.",
        ),
      );
    }

    // Conservar la versión actual como histórico inmutable (spec-007 R3/R5).
    this._historico.push({
      version: this._version,
      vencimiento: this._vencimiento.fecha.toISO(),
      emision: this._emision.toISO(),
      adjuntoRef: this._adjuntoRef,
      reemplazadoEn: nowIso(),
    });

    // Adoptar la nueva versión.
    this._version += 1;
    this._vencimiento = nuevoVencimiento;
    this._emision = nuevaEmision;
    this._adjuntoRef = adjuntoRef;

    // Reiniciar el seguimiento de alertas: es una nueva vigencia (R5 aplica por vigencia).
    this._umbralesNotificados.clear();
    this._vencido = false;

    this._eventos.push(<DocumentoRenovado>{
      tipo: "DocumentoRenovado",
      ocurridoEn: nowIso(),
      documentoId: this.id,
      nuevoVencimiento: nuevoVencimiento.fecha.toISO(),
      versionAnterior: this._version - 1,
    });
    return ok(undefined);
  }

  // ---------- Evaluación diaria (spec-006) ----------

  /**
   * Evalúa el Vencimiento a la fecha `hoy` y acumula los eventos correspondientes:
   *  - emite `DocumentoPorVencer` exactamente al cruzar 30/15/3 días, una vez por umbral (R4/R5).
   *  - emite `DocumentoVencido` una vez al superar el Vencimiento (R6).
   * Idempotente dentro del mismo umbral / estado.
   */
  evaluar(hoy: DateOnly): void {
    const dias = this._vencimiento.diasRestantesDesde(hoy);

    if (dias < 0) {
      if (!this._vencido) {
        this._vencido = true;
        this._eventos.push(<DocumentoVencido>{
          tipo: "DocumentoVencido",
          ocurridoEn: nowIso(),
          documentoId: this.id,
          sujeto: this.sujeto,
          tipoDocumento: this.tipo.codigo,
        });
      }
      return;
    }

    // Aún vigente o por vencer: revisar umbrales cruzados.
    // Se notifica el umbral más alto que ya se cruzó y no se ha notificado.
    for (const umbral of UMBRALES_ALERTA) {
      if (dias <= umbral && !this._umbralesNotificados.has(umbral)) {
        this._umbralesNotificados.add(umbral);
        this._eventos.push(<DocumentoPorVencer>{
          tipo: "DocumentoPorVencer",
          ocurridoEn: nowIso(),
          documentoId: this.id,
          sujeto: this.sujeto,
          tipoDocumento: this.tipo.codigo,
          diasRestantes: umbral,
        });
      }
    }
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

  /** Estado relevante para persistir (incluye el seguimiento de alertas). */
  snapshot(): {
    id: string;
    sujetoTipo: string;
    sujetoId: string;
    tipoCodigo: string;
    emision: string;
    vencimiento: string;
    adjuntoRef?: string;
    version: number;
    umbralesNotificados: UmbralAlerta[];
    vencidoNotificado: boolean;
    historico: VersionHistorica[];
  } {
    return {
      id: this.id,
      sujetoTipo: this.sujeto.tipo,
      sujetoId: this.sujeto.id,
      tipoCodigo: this.tipo.codigo,
      emision: this._emision.toISO(),
      vencimiento: this._vencimiento.fecha.toISO(),
      adjuntoRef: this._adjuntoRef,
      version: this._version,
      umbralesNotificados: [...this._umbralesNotificados],
      vencidoNotificado: this._vencido,
      historico: [...this._historico],
    };
  }
}
