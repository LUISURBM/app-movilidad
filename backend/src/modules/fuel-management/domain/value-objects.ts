/**
 * Value Objects del contexto Fuel Management (BC-6) — spec-011.
 * Inmutables, sin identidad, validados en construcción. Sin dependencias de framework.
 */
import { DomainError } from "../../../shared/kernel";

/** Unidad en que el Conductor captura la carga (spec-011 R1, caso alternativo galones). */
export enum UnidadCombustible {
  Litros = "litros",
  Galones = "galones",
}

/** Factor de conversión galón (US) → litros. Constante física estándar. */
const LITROS_POR_GALON = 3.785411784;

/**
 * Cantidad de combustible cargada, con su unidad de captura (spec-011 R1/R6).
 * Debe ser estrictamente positiva. Conserva la unidad ORIGINAL (el hecho append-only
 * no se normaliza), pero sabe expresarse en litros para el evento canónico (R7).
 */
export class Cantidad {
  private constructor(
    public readonly valor: number,
    public readonly unidad: UnidadCombustible,
  ) {}

  static de(valor: number, unidad: UnidadCombustible): Cantidad {
    if (!Number.isFinite(valor) || valor <= 0) {
      throw new DomainError("cantidad_no_positiva", "La cantidad de combustible debe ser positiva.");
    }
    return new Cantidad(valor, unidad);
  }

  static litros(valor: number): Cantidad {
    return Cantidad.de(valor, UnidadCombustible.Litros);
  }
  static galones(valor: number): Cantidad {
    return Cantidad.de(valor, UnidadCombustible.Galones);
  }

  /** Cantidad expresada en litros (canónica para el evento CombustibleRegistrado, R7). */
  enLitros(): number {
    const litros =
      this.unidad === UnidadCombustible.Galones ? this.valor * LITROS_POR_GALON : this.valor;
    // Redondeo a 3 decimales: litros es una magnitud de reporte, no contable.
    return Math.round(litros * 1000) / 1000;
  }

  equals(other: Cantidad): boolean {
    return this.valor === other.valor && this.unidad === other.unidad;
  }
}

/**
 * Dinero en pesos colombianos (COP). spec-011 R1/R6: debe ser positivo.
 * COP no maneja centavos en la práctica → monto entero en pesos.
 */
export class Dinero {
  private constructor(public readonly montoCop: number) {}

  static cop(monto: number): Dinero {
    if (!Number.isFinite(monto) || monto <= 0) {
      throw new DomainError("valor_cop_no_positivo", "El valor en COP debe ser positivo.");
    }
    if (!Number.isInteger(monto)) {
      throw new DomainError("valor_cop_no_entero", "El valor en COP debe ser un entero (pesos).");
    }
    return new Dinero(monto);
  }

  equals(other: Dinero): boolean {
    return this.montoCop === other.montoCop;
  }
}

/**
 * Lectura de Odómetro (kilómetros). spec-011 R8: entero no negativo.
 * La MONOTONÍA (Política P8) NO es invariante de esta lectura aislada, sino del
 * Vehículo (BC-2 Fleet); se resuelve al sincronizar contra la lectura autoritativa.
 */
export class Odometro {
  private constructor(public readonly km: number) {}

  static en(km: number): Odometro {
    if (!Number.isFinite(km) || km < 0) {
      throw new DomainError("odometro_invalido", "El Odómetro debe ser un número no negativo.");
    }
    if (!Number.isInteger(km)) {
      throw new DomainError("odometro_no_entero", "El Odómetro debe ser un entero (kilómetros).");
    }
    return new Odometro(km);
  }

  esMayorOIgualQue(other: Odometro): boolean {
    return this.km >= other.km;
  }

  equals(other: Odometro): boolean {
    return this.km === other.km;
  }
}
