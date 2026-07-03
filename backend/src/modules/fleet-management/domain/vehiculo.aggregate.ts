/**
 * Agregado raíz `Vehiculo` del contexto Fleet Management (BC-2) — spec-003.
 *
 * Invariantes que protege:
 *  - Placa INMUTABLE (R3): no hay mutador de placa; se fija en la fábrica.
 *  - Odómetro MONÓTONO (R5/R6): la lectura autoritativa nunca decrece; una lectura
 *    menor se rechaza (Result err), la autoritativa no retrocede.
 * La unicidad de Placa por Tenant (R2) es un invariante de conjunto: se garantiza en
 * la capa de aplicación (repo) y en la base (UNIQUE(tenant_id, placa)).
 */
import { DateOnly, DomainError, Result, ok, err } from "../../../shared/kernel";
import {
  Afiliacion,
  ClaseVehiculo,
  FuenteOdometro,
  Odometro,
  Placa,
} from "./value-objects";
import {
  DomainEvent,
  OdometroActualizado,
  VehiculoAfiliado,
  VehiculoRegistrado,
  nowIso,
} from "./events";

export type EstadoVehiculo = "activo" | "inactivo";

export class Vehiculo {
  private _eventos: DomainEvent[] = [];

  private constructor(
    public readonly id: string,
    public readonly placa: Placa, // inmutable (R3)
    public readonly clase: ClaseVehiculo,
    private _marca: string | undefined,
    private _modelo: string | undefined,
    private _anio: number | undefined,
    private _propietarioId: string | undefined,
    private _odometro: Odometro | undefined,
    private _afiliacion: Afiliacion | undefined,
    private _estado: EstadoVehiculo,
  ) {}

  // ---------- Fábrica: registro (spec-003) ----------

  static registrar(params: {
    id: string;
    placa: Placa;
    clase: ClaseVehiculo;
    marca?: string;
    modelo?: string;
    anio?: number;
    propietarioId?: string;
    odometroInicial?: Odometro;
    afiliacion?: Afiliacion;
  }): Vehiculo {
    const v = new Vehiculo(
      params.id,
      params.placa,
      params.clase,
      params.marca,
      params.modelo,
      params.anio,
      params.propietarioId,
      params.odometroInicial,
      params.afiliacion,
      "activo",
    );
    v._eventos.push(<VehiculoRegistrado>{
      tipo: "VehiculoRegistrado",
      ocurridoEn: nowIso(),
      vehiculoId: v.id,
      placa: params.placa.valor,
      clase: params.clase,
      propietarioId: params.propietarioId,
    });
    if (params.afiliacion) {
      v._eventos.push(<VehiculoAfiliado>{
        tipo: "VehiculoAfiliado",
        ocurridoEn: nowIso(),
        vehiculoId: v.id,
        empresaTransportadoraId: params.afiliacion.empresaTransportadoraId,
        desde: params.afiliacion.desde.toISO(),
      });
    }
    return v;
  }

  /** Rehidrata desde persistencia (sin emitir eventos). */
  static rehidratar(params: {
    id: string;
    placa: Placa;
    clase: ClaseVehiculo;
    marca?: string;
    modelo?: string;
    anio?: number;
    propietarioId?: string;
    odometro?: Odometro;
    afiliacion?: Afiliacion;
    estado: EstadoVehiculo;
  }): Vehiculo {
    return new Vehiculo(
      params.id,
      params.placa,
      params.clase,
      params.marca,
      params.modelo,
      params.anio,
      params.propietarioId,
      params.odometro,
      params.afiliacion,
      params.estado,
    );
  }

  // ---------- Odómetro monótono (spec-003 R5/R6) ----------

  /**
   * Actualiza la lectura autoritativa respetando monotonía (R6). Una lectura MENOR a
   * la última se rechaza y la autoritativa NO retrocede. Emite `OdometroActualizado`.
   */
  actualizarOdometro(lectura: Odometro, fuente: FuenteOdometro): Result<void> {
    if (this._odometro && !lectura.esMayorOIgualQue(this._odometro)) {
      return err(
        new DomainError(
          "odometro_no_monotono",
          `La lectura ${lectura.km} es menor a la última registrada (${this._odometro.km}); viola la monotonía.`,
        ),
      );
    }
    this._odometro = lectura;
    this._eventos.push(<OdometroActualizado>{
      tipo: "OdometroActualizado",
      ocurridoEn: nowIso(),
      vehiculoId: this.id,
      lectura: lectura.km,
      fuente,
    });
    return ok(undefined);
  }

  // ---------- Consultas ----------

  get odometro(): Odometro | undefined {
    return this._odometro;
  }
  get marca(): string | undefined {
    return this._marca;
  }
  get modelo(): string | undefined {
    return this._modelo;
  }
  get anio(): number | undefined {
    return this._anio;
  }
  get propietarioId(): string | undefined {
    return this._propietarioId;
  }
  get afiliacion(): Afiliacion | undefined {
    return this._afiliacion;
  }
  get estado(): EstadoVehiculo {
    return this._estado;
  }

  // ---------- Eventos / snapshot ----------

  pullEventos(): DomainEvent[] {
    const e = this._eventos;
    this._eventos = [];
    return e;
  }
  peekEventos(): readonly DomainEvent[] {
    return this._eventos;
  }

  snapshot(): {
    id: string;
    placa: string;
    clase: string;
    marca?: string;
    modelo?: string;
    anio?: number;
    propietarioId?: string;
    odometro?: number;
    afiliacionEmpresaId?: string;
    afiliacionDesde?: string;
    estado: EstadoVehiculo;
  } {
    return {
      id: this.id,
      placa: this.placa.valor,
      clase: this.clase,
      marca: this._marca,
      modelo: this._modelo,
      anio: this._anio,
      propietarioId: this._propietarioId,
      odometro: this._odometro?.km,
      afiliacionEmpresaId: this._afiliacion?.empresaTransportadoraId,
      afiliacionDesde: this._afiliacion ? this._afiliacion.desde.toISO() : undefined,
      estado: this._estado,
    };
  }
}
