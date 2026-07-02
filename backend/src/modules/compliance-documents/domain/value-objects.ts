/**
 * Value Objects del contexto Compliance & Documents (CORE) — Fase 2.
 * Inmutables, sin identidad, validados en construcción. Sin dependencias de framework.
 */
import { DateOnly, DomainError } from "../../../shared/kernel";

/** El Semáforo: peor-estado documental de un sujeto. spec-006 R2. */
export enum Semaforo {
  Vigente = "Vigente", // verde
  PorVencer = "PorVencer", // amarillo
  Vencido = "Vencido", // rojo
}

/** Severidad para comparar y obtener el "peor estado" (mayor = peor). spec-006 R1. */
const SEVERIDAD: Record<Semaforo, number> = {
  [Semaforo.Vigente]: 0,
  [Semaforo.PorVencer]: 1,
  [Semaforo.Vencido]: 2,
};

/** Devuelve el peor (más severo) de dos estados. */
export function peorEstado(a: Semaforo, b: Semaforo): Semaforo {
  return SEVERIDAD[a] >= SEVERIDAD[b] ? a : b;
}

/** Umbrales de alerta anticipada, en días restantes. spec-006 R4. */
export const UMBRALES_ALERTA = [30, 15, 3] as const;
export type UmbralAlerta = (typeof UMBRALES_ALERTA)[number];

/** Tipo de sujeto al que aplica un Documento. */
export enum TipoSujeto {
  Vehiculo = "vehiculo",
  Conductor = "conductor",
}

/** Referencia tipada a un Vehículo o Conductor. spec-005 R1. */
export class SujetoRef {
  private constructor(
    public readonly tipo: TipoSujeto,
    public readonly id: string,
  ) {}

  static vehiculo(id: string): SujetoRef {
    return new SujetoRef(TipoSujeto.Vehiculo, SujetoRef.requireId(id));
  }
  static conductor(id: string): SujetoRef {
    return new SujetoRef(TipoSujeto.Conductor, SujetoRef.requireId(id));
  }
  static of(tipo: TipoSujeto, id: string): SujetoRef {
    return new SujetoRef(tipo, SujetoRef.requireId(id));
  }

  private static requireId(id: string): string {
    if (!id || !id.trim()) throw new DomainError("sujeto_id_requerido", "El id del sujeto es obligatorio.");
    return id;
  }

  equals(other: SujetoRef): boolean {
    return this.tipo === other.tipo && this.id === other.id;
  }

  toString(): string {
    return `${this.tipo}:${this.id}`;
  }
}

/**
 * Tipo de documento del catálogo configurable del Tenant. spec-005 R2.
 * Define a qué clase de sujeto aplica y si es requerido (Invariante I3).
 */
export class TipoDocumento {
  constructor(
    public readonly codigo: string, // p. ej. "SOAT", "RTM", "LICENCIA"
    public readonly aplicaA: TipoSujeto,
    public readonly requerido: boolean = false,
    public readonly activo: boolean = true,
  ) {
    if (!codigo || !codigo.trim()) {
      throw new DomainError("tipo_documento_codigo_requerido", "El código del Tipo de documento es obligatorio.");
    }
  }

  aplicaASujeto(sujeto: SujetoRef): boolean {
    return this.aplicaA === sujeto.tipo;
  }
}

/**
 * Vencimiento: la fecha en que un Documento deja de tener validez, con la lógica
 * de estado por días restantes. Corazón de spec-006.
 */
export class Vencimiento {
  private constructor(public readonly fecha: DateOnly) {}

  static el(fecha: DateOnly): Vencimiento {
    return new Vencimiento(fecha);
  }
  static parse(iso: string): Vencimiento {
    return new Vencimiento(DateOnly.parse(iso));
  }

  /** Días restantes hasta el vencimiento respecto de `hoy` (negativo si ya venció). */
  diasRestantesDesde(hoy: DateOnly): number {
    return hoy.daysUntil(this.fecha);
  }

  /**
   * Estado del Documento según días restantes (spec-006 R2 y R3):
   *  - > 30 días  → Vigente (verde)
   *  - 0..30 días → Por vencer (amarillo)   [incluye "vence hoy" = 0]
   *  - < 0 días   → Vencido (rojo)
   */
  estadoDesde(hoy: DateOnly): Semaforo {
    const dias = this.diasRestantesDesde(hoy);
    if (dias < 0) return Semaforo.Vencido;
    if (dias <= 30) return Semaforo.PorVencer;
    return Semaforo.Vigente;
  }

  equals(other: Vencimiento): boolean {
    return this.fecha.equals(other.fecha);
  }
}
