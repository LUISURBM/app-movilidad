/**
 * Value Objects del contexto Fleet Management (BC-2) — spec-003.
 * Inmutables, sin identidad, validados en construcción. Sin dependencias de framework.
 */
import { DateOnly, DomainError } from "../../../shared/kernel";

/** Clase del Vehículo (contrato openapi.yaml: ClaseVehiculo). */
export enum ClaseVehiculo {
  Automovil = "automovil",
  Camioneta = "camioneta",
  Van = "van",
  Microbus = "microbus",
  Bus = "bus",
  Campero = "campero",
  Otro = "otro",
}

const CLASES = new Set<string>(Object.values(ClaseVehiculo));

export function parseClase(v: string): ClaseVehiculo {
  if (!CLASES.has(v)) {
    throw new DomainError("clase_vehiculo_invalida", `Clase de vehículo inválida: ${v}.`);
  }
  return v as ClaseVehiculo;
}

/**
 * Placa colombiana. spec-003 R2/R3: única por Tenant (se valida en repo) e INMUTABLE
 * (el agregado no expone mutador). Formato del contrato: 3 letras + 2-3 dígitos.
 */
export class Placa {
  private static readonly PATRON = /^[A-Z]{3}[0-9]{2,3}$/;

  private constructor(public readonly valor: string) {}

  static de(v: string): Placa {
    const norm = (v ?? "").trim().toUpperCase();
    if (!Placa.PATRON.test(norm)) {
      throw new DomainError("placa_invalida", `Placa inválida: "${v}". Formato esperado: ABC123.`);
    }
    return new Placa(norm);
  }

  equals(other: Placa): boolean {
    return this.valor === other.valor;
  }
  toString(): string {
    return this.valor;
  }
}

/**
 * Lectura de Odómetro (kilómetros), entero no negativo. spec-003 R5/R6: la lectura
 * autoritativa es monótonamente creciente; la comparación vive aquí, la política de
 * rechazo en el agregado.
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

/** Afiliación opcional a una empresa transportadora. spec-003 R7 (dato del Vehículo). */
export class Afiliacion {
  private constructor(
    public readonly empresaTransportadoraId: string,
    public readonly desde: DateOnly,
  ) {}

  static de(empresaTransportadoraId: string, desdeIso: string): Afiliacion {
    if (!empresaTransportadoraId || !empresaTransportadoraId.trim()) {
      throw new DomainError("afiliacion_empresa_requerida", "La Afiliación requiere la empresa transportadora.");
    }
    return new Afiliacion(empresaTransportadoraId, DateOnly.parse(desdeIso));
  }
}

/** Fuente de una lectura de Odómetro (contrato: manual|tanqueo|servicio). */
export type FuenteOdometro = "manual" | "tanqueo" | "servicio";
