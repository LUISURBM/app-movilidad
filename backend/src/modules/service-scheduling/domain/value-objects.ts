/**
 * Value Objects del contexto Service Scheduling (CORE) — spec-008/009.
 * Inmutables, sin identidad, validados en construcción. Sin dependencias de framework.
 */
import { DomainError } from "../../../shared/kernel";

/** Ciclo de vida del Servicio (Invariante S2, spec-008 R7). */
export enum EstadoServicio {
  Planificado = "Planificado",
  Iniciado = "Iniciado",
  Finalizado = "Finalizado",
  Cancelado = "Cancelado",
}

/** Motivo de rechazo de una Asignación (spec-008 P4 / spec-009 P3). */
export type MotivoRechazo = "choque" | "incumplimiento";

/** Ruta del Servicio: origen y destino (spec-008 R2). */
export class Ruta {
  constructor(
    public readonly origen: string,
    public readonly destino: string,
  ) {
    if (!origen?.trim()) throw new DomainError("origen_requerido", "El origen del Servicio es obligatorio.");
    if (!destino?.trim()) throw new DomainError("destino_requerido", "El destino del Servicio es obligatorio.");
  }
}

/**
 * Ventana horaria: intervalo SEMIABIERTO `[inicio, fin)` (spec-008 R5).
 * Dos ventanas que solo comparten el instante de borde NO chocan.
 * Se modela con timestamps completos (fecha + hora), a diferencia de los
 * Vencimientos de Compliance que son fechas de calendario.
 */
export class VentanaHoraria {
  private constructor(
    public readonly inicio: Date,
    public readonly fin: Date,
  ) {}

  static de(inicio: Date, fin: Date): VentanaHoraria {
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
      throw new DomainError("ventana_invalida", "La Ventana horaria tiene fechas inválidas.");
    }
    if (fin.getTime() <= inicio.getTime()) {
      throw new DomainError("ventana_invalida", "El fin de la Ventana horaria debe ser posterior al inicio.");
    }
    return new VentanaHoraria(inicio, fin);
  }

  /** Parsea ISO 8601 (contrato openapi: date-time). */
  static parse(inicioIso: string, finIso: string): VentanaHoraria {
    return VentanaHoraria.de(new Date(inicioIso), new Date(finIso));
  }

  /**
   * Solapamiento de intervalos semiabiertos (Invariante S4, spec-008 R4/R5):
   * `[a,b) ∩ [c,d) ≠ ∅  ⇔  a < d && c < b`.
   * Consecutivas ([08,10) y [10,12)) NO chocan.
   */
  seSolapaCon(otra: VentanaHoraria): boolean {
    return this.inicio.getTime() < otra.fin.getTime() && otra.inicio.getTime() < this.fin.getTime();
  }

  equals(otra: VentanaHoraria): boolean {
    return this.inicio.getTime() === otra.inicio.getTime() && this.fin.getTime() === otra.fin.getTime();
  }

  toJSON(): { inicio: string; fin: string } {
    return { inicio: this.inicio.toISOString(), fin: this.fin.toISOString() };
  }
}

/**
 * Asignación de recursos a un Servicio: Vehículo + Conductor (spec-008 R3).
 * En el contrato (openapi.yaml) la Asignación no tiene identidad propia: vive
 * embebida en el Servicio (1:1). Se modela como VO dentro del agregado.
 */
export class Asignacion {
  constructor(
    public readonly vehiculoId: string,
    public readonly conductorId: string,
    /** Advertencias no bloqueantes (semáforo amarillo — spec-009 P11). */
    public readonly advertencias: readonly string[] = [],
  ) {
    if (!vehiculoId?.trim()) throw new DomainError("vehiculo_requerido", "El vehiculoId es obligatorio.");
    if (!conductorId?.trim()) throw new DomainError("conductor_requerido", "El conductorId es obligatorio.");
  }
}
