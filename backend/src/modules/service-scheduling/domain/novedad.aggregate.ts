/**
 * Agregado `Novedad` del contexto Service Scheduling (BC-5) — spec-014.
 *
 * APPEND-ONLY (R3): hecho inmutable (categoría B); no se edita ni se borra. Pertenece
 * SIEMPRE a un Servicio existente (R1, se valida en la capa de aplicación). La foto se
 * referencia por `fotoRef` (URL/ID resultante de la subida en dos pasos, R6); el agregado
 * no incrusta el binario. Idempotencia por `clientId` (R7).
 */
import { DomainError, Result, ok, err } from "../../../shared/kernel";
import { NovedadReportada, DomainEvent, nowIso } from "./events";

export enum TipoNovedad {
  Incidente = "incidente",
  Retraso = "retraso",
  Siniestro = "siniestro",
}

const TIPOS = new Set<string>(Object.values(TipoNovedad));

export class Novedad {
  private _eventos: DomainEvent[] = [];

  private constructor(
    public readonly id: string,
    public readonly clientId: string,
    public readonly servicioId: string,
    public readonly tipo: TipoNovedad,
    public readonly descripcion: string,
    public readonly fotoRef: string | undefined,
    public readonly ocurridoEn: string,
  ) {}

  /** Registra la Novedad (que en el servidor coincide con la sincronización). Emite NovedadReportada (R9). */
  static registrar(params: {
    id: string;
    clientId: string;
    servicioId: string;
    tipo: string;
    descripcion: string;
    fotoRef?: string;
    ocurridoEn?: string;
  }): Result<Novedad> {
    if (!params.clientId || !params.clientId.trim()) {
      return err(new DomainError("client_id_requerido", "La Novedad requiere un UUID de idempotencia (clientId)."));
    }
    if (!params.servicioId || !params.servicioId.trim()) {
      return err(new DomainError("servicio_requerido", "La Novedad debe pertenecer a un Servicio."));
    }
    if (!TIPOS.has(params.tipo)) {
      return err(new DomainError("tipo_novedad_invalido", `Tipo de Novedad inválido: ${params.tipo}.`));
    }
    const ocurridoEn = params.ocurridoEn ?? nowIso();
    const n = new Novedad(
      params.id,
      params.clientId,
      params.servicioId,
      params.tipo as TipoNovedad,
      (params.descripcion ?? "").trim(),
      params.fotoRef?.trim() || undefined,
      ocurridoEn,
    );
    n._eventos.push(<NovedadReportada>{
      tipo: "NovedadReportada",
      ocurridoEn: nowIso(),
      servicioId: n.servicioId,
      tipoNovedad: n.tipo,
      fotoRef: n.fotoRef,
    });
    return ok(n);
  }

  static rehidratar(params: {
    id: string;
    clientId: string;
    servicioId: string;
    tipo: string;
    descripcion: string;
    fotoRef?: string;
    ocurridoEn: string;
  }): Novedad {
    return new Novedad(
      params.id,
      params.clientId,
      params.servicioId,
      params.tipo as TipoNovedad,
      params.descripcion,
      params.fotoRef,
      params.ocurridoEn,
    );
  }

  pullEventos(): DomainEvent[] {
    const e = this._eventos;
    this._eventos = [];
    return e;
  }

  snapshot(): {
    id: string;
    clientId: string;
    servicioId: string;
    tipo: string;
    descripcion: string;
    fotoRef?: string;
    ocurridoEn: string;
  } {
    return {
      id: this.id,
      clientId: this.clientId,
      servicioId: this.servicioId,
      tipo: this.tipo,
      descripcion: this.descripcion,
      fotoRef: this.fotoRef,
      ocurridoEn: this.ocurridoEn,
    };
  }
}
