/**
 * Agregado `Umbral` de mantenimiento del contexto Maintenance Management (BC-7) — spec-012.
 *
 * Define el ciclo de mantenimiento preventivo de un Vehículo por kilometraje (cada N km) y/o
 * por fecha (cada T meses). Programa el preventivo al superar el Umbral (P6/R2) — de forma
 * idempotente (R8: no duplica si ya hay uno pendiente) — o lo marca vencido por fecha (P7/R3).
 * Registrar la ejecución reinicia el ciclo desde la nueva base (R6).
 */
import { DateOnly, DomainError, Result, ok, err } from "../../../shared/kernel";
import {
  DomainEvent,
  MantenimientoProgramado,
  MantenimientoRegistrado,
  MantenimientoVencido,
  nowIso,
} from "./events";

function sumarMeses(base: DateOnly, meses: number): DateOnly {
  const d = base.toDate();
  d.setUTCMonth(d.getUTCMonth() + meses);
  return DateOnly.fromDate(d);
}

export class Umbral {
  private _eventos: DomainEvent[] = [];

  private constructor(
    public readonly id: string,
    public readonly vehiculoId: string,
    private _cadaKm: number | undefined,
    private _baseKm: number,
    private _cadaMeses: number | undefined,
    private _baseFecha: DateOnly | undefined,
    private _pendiente: boolean,
    private _vencido: boolean,
  ) {}

  static definir(params: {
    id: string;
    vehiculoId: string;
    cadaKm?: number;
    baseKm?: number;
    cadaMeses?: number;
    baseFecha?: string;
  }): Result<Umbral> {
    if (!params.cadaKm && !params.cadaMeses) {
      return err(new DomainError("umbral_sin_criterio", "El Umbral debe definirse por kilometraje, por fecha, o ambos."));
    }
    if (params.cadaKm !== undefined && params.cadaKm <= 0) {
      return err(new DomainError("umbral_km_invalido", "El intervalo de kilometraje debe ser positivo."));
    }
    if (params.cadaMeses !== undefined && params.cadaMeses <= 0) {
      return err(new DomainError("umbral_meses_invalido", "El intervalo en meses debe ser positivo."));
    }
    return ok(
      new Umbral(
        params.id,
        params.vehiculoId,
        params.cadaKm,
        params.baseKm ?? 0,
        params.cadaMeses,
        params.baseFecha ? DateOnly.parse(params.baseFecha) : undefined,
        false,
        false,
      ),
    );
  }

  static rehidratar(params: {
    id: string;
    vehiculoId: string;
    cadaKm?: number;
    baseKm: number;
    cadaMeses?: number;
    baseFecha?: string;
    pendiente: boolean;
    vencido: boolean;
  }): Umbral {
    return new Umbral(
      params.id,
      params.vehiculoId,
      params.cadaKm,
      params.baseKm,
      params.cadaMeses,
      params.baseFecha ? DateOnly.parse(params.baseFecha) : undefined,
      params.pendiente,
      params.vencido,
    );
  }

  get pendiente(): boolean {
    return this._pendiente;
  }
  get vencido(): boolean {
    return this._vencido;
  }
  get baseKm(): number {
    return this._baseKm;
  }

  /**
   * P6/R2: si un avance del Odómetro alcanza o supera (baseKm + cadaKm), programa un
   * preventivo. R8: idempotente — si ya hay uno pendiente, no programa otro.
   * Devuelve true si programó.
   */
  evaluarPorOdometro(lectura: number, mantenimientoId: string): boolean {
    if (!this._cadaKm || this._pendiente) return false;
    if (lectura < this._baseKm + this._cadaKm) return false;
    this._pendiente = true;
    this._eventos.push(<MantenimientoProgramado>{
      tipo: "MantenimientoProgramado",
      ocurridoEn: nowIso(),
      mantenimientoId,
      vehiculoId: this.vehiculoId,
      tipoMantenimiento: "preventivo",
      dispararPor: "km",
    });
    return true;
  }

  /** P7/R3: si se alcanza la fecha objetivo sin ejecución, marca vencido y lo emite. */
  evaluarPorFecha(hoy: DateOnly, mantenimientoId: string): boolean {
    if (!this._cadaMeses || !this._baseFecha || this._vencido) return false;
    const objetivo = sumarMeses(this._baseFecha, this._cadaMeses);
    if (hoy.isBefore(objetivo)) return false;
    this._vencido = true;
    this._eventos.push(<MantenimientoVencido>{
      tipo: "MantenimientoVencido",
      ocurridoEn: nowIso(),
      mantenimientoId,
      vehiculoId: this.vehiculoId,
      umbralSuperado: `cada ${this._cadaMeses} meses`,
    });
    return true;
  }

  /** R6: registrar la ejecución reinicia el ciclo desde la nueva base (km/fecha) y lo emite. */
  registrarEjecucion(params: { mantenimientoId: string; odometro: number; costoCop: number; hoy: DateOnly }): void {
    this._baseKm = params.odometro;
    this._baseFecha = params.hoy;
    this._pendiente = false;
    this._vencido = false;
    this._eventos.push(<MantenimientoRegistrado>{
      tipo: "MantenimientoRegistrado",
      ocurridoEn: nowIso(),
      mantenimientoId: params.mantenimientoId,
      vehiculoId: this.vehiculoId,
      tipoMantenimiento: "preventivo",
      costoCop: params.costoCop,
      odometro: params.odometro,
    });
  }

  pullEventos(): DomainEvent[] {
    const e = this._eventos;
    this._eventos = [];
    return e;
  }

  snapshot(): {
    id: string;
    vehiculoId: string;
    cadaKm?: number;
    baseKm: number;
    cadaMeses?: number;
    baseFecha?: string;
    pendiente: boolean;
    vencido: boolean;
  } {
    return {
      id: this.id,
      vehiculoId: this.vehiculoId,
      cadaKm: this._cadaKm,
      baseKm: this._baseKm,
      cadaMeses: this._cadaMeses,
      baseFecha: this._baseFecha?.toISO(),
      pendiente: this._pendiente,
      vencido: this._vencido,
    };
  }
}
