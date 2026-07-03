/**
 * Agregado raíz `Tanqueo` del contexto Fuel Management (BC-6) — spec-011.
 *
 * Naturaleza (spec-011 R2): APPEND-ONLY. Un Tanqueo es un HECHO INMUTABLE (categoría B):
 * una vez creado no se edita ni se borra. Por eso el agregado NO expone mutadores; solo
 * una fábrica de registro y consultas. Dos dispositivos nunca chocan (R10): cada uno
 * añade los suyos; la única "resolución" es la idempotencia por `clientId` (R4/R5).
 *
 * El Odómetro del Tanqueo NO vive aquí como autoridad: la monotonía (P8, R8) se resuelve
 * contra la lectura autoritativa del Vehículo (BC-2) en la capa de aplicación al sincronizar.
 */
import { DomainError, Result, ok, err } from "../../../shared/kernel";
import { Cantidad, Dinero, Odometro, UnidadCombustible } from "./value-objects";
import { CombustibleRegistrado, DomainEvent, nowIso } from "./events";

export class Tanqueo {
  private _eventos: DomainEvent[] = [];

  private constructor(
    public readonly id: string,
    /** UUID de idempotencia generado en el dispositivo (spec-011 R4). */
    public readonly clientId: string,
    public readonly vehiculoId: string,
    public readonly cantidad: Cantidad,
    public readonly valor: Dinero,
    public readonly odometro: Odometro,
    /** Marca temporal de captura en el dispositivo (offline). */
    public readonly ocurridoEn: string,
  ) {}

  // ---------- Fábrica: registro del hecho (spec-011) ----------

  /**
   * Registra un Tanqueo. Valida las reglas de valor (R6): cantidad y valor COP positivos
   * (los VOs ya lo garantizan; la fábrica traduce entradas crudas a VOs y falla cerrado).
   * Al registrarse (que en el servidor coincide con la sincronización) emite
   * `CombustibleRegistrado` (R7).
   */
  static registrar(params: {
    id: string;
    clientId: string;
    vehiculoId: string;
    cantidad: number;
    unidad: UnidadCombustible;
    valorCop: number;
    odometro: number;
    ocurridoEn?: string;
  }): Result<Tanqueo> {
    const { id, clientId, vehiculoId } = params;
    if (!clientId || !clientId.trim()) {
      return err(new DomainError("client_id_requerido", "El Tanqueo requiere un UUID de idempotencia (clientId)."));
    }
    if (!vehiculoId || !vehiculoId.trim()) {
      return err(new DomainError("vehiculo_requerido", "El Tanqueo debe referir un Vehículo."));
    }

    let cantidad: Cantidad;
    let valor: Dinero;
    let odometro: Odometro;
    try {
      cantidad = Cantidad.de(params.cantidad, params.unidad);
      valor = Dinero.cop(params.valorCop);
      odometro = Odometro.en(params.odometro);
    } catch (e) {
      if (e instanceof DomainError) return err(e);
      throw e;
    }

    const ocurridoEn = params.ocurridoEn ?? nowIso();
    const tanqueo = new Tanqueo(id, clientId, vehiculoId, cantidad, valor, odometro, ocurridoEn);
    tanqueo._eventos.push(<CombustibleRegistrado>{
      tipo: "CombustibleRegistrado",
      ocurridoEn: nowIso(),
      tanqueoId: id,
      vehiculoId,
      litros: cantidad.enLitros(),
      valorCop: valor.montoCop,
      odometro: odometro.km,
    });
    return ok(tanqueo);
  }

  /** Rehidrata un Tanqueo desde persistencia (sin emitir eventos). */
  static rehidratar(params: {
    id: string;
    clientId: string;
    vehiculoId: string;
    cantidad: number;
    unidad: UnidadCombustible;
    valorCop: number;
    odometro: number;
    ocurridoEn: string;
  }): Tanqueo {
    return new Tanqueo(
      params.id,
      params.clientId,
      params.vehiculoId,
      Cantidad.de(params.cantidad, params.unidad),
      Dinero.cop(params.valorCop),
      Odometro.en(params.odometro),
      params.ocurridoEn,
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
    clientId: string;
    vehiculoId: string;
    cantidad: number;
    unidad: string;
    valorCop: number;
    odometro: number;
    ocurridoEn: string;
  } {
    return {
      id: this.id,
      clientId: this.clientId,
      vehiculoId: this.vehiculoId,
      cantidad: this.cantidad.valor,
      unidad: this.cantidad.unidad,
      valorCop: this.valor.montoCop,
      odometro: this.odometro.km,
      ocurridoEn: this.ocurridoEn,
    };
  }
}
