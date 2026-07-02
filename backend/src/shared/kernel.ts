/**
 * Kernel compartido del dominio (shared kernel, Fase 2).
 *
 * Tipos base reutilizables por todos los bounded contexts. SIN dependencias de framework
 * (Clean Architecture): no importa NestJS, ni el ORM, ni nada de infraestructura.
 */

/** Resultado explícito de una operación de dominio: éxito con valor o fallo con error. */
export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Error de dominio con un código estable (mapeable a `Problem.type` del contrato OpenAPI). */
export class DomainError extends Error {
  constructor(
    /** Código estable, p. ej. "vencimiento_anterior_a_emision". */
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/**
 * Reloj de dominio. Abstrae "hoy" para poder probar el cálculo del Semáforo y las alertas
 * de forma determinista (spec-006 corre como un chequeo diario del reloj de dominio).
 */
export interface Clock {
  today(): DateOnly;
  now(): Date;
}

export class SystemClock implements Clock {
  today(): DateOnly {
    return DateOnly.fromDate(new Date());
  }
  now(): Date {
    return new Date();
  }
}

/** Reloj fijo para pruebas. */
export class FixedClock implements Clock {
  constructor(private readonly fixed: DateOnly) {}
  today(): DateOnly {
    return this.fixed;
  }
  now(): Date {
    return this.fixed.toDate();
  }
}

/**
 * Fecha sin hora (calendario), en UTC, para vencimientos y emisiones.
 * Evita los errores de comparar Date con horas/zonas. Inmutable.
 */
export class DateOnly {
  private constructor(private readonly y: number, private readonly m: number, private readonly d: number) {}

  static of(year: number, month: number, day: number): DateOnly {
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (
      dt.getUTCFullYear() !== year ||
      dt.getUTCMonth() !== month - 1 ||
      dt.getUTCDate() !== day
    ) {
      throw new DomainError("fecha_invalida", `Fecha inválida: ${year}-${month}-${day}`);
    }
    return new DateOnly(year, month, day);
  }

  /** Parsea "YYYY-MM-DD". */
  static parse(iso: string): DateOnly {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) throw new DomainError("fecha_invalida", `Formato de fecha inválido: ${iso}`);
    return DateOnly.of(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  static fromDate(dt: Date): DateOnly {
    return DateOnly.of(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  toDate(): Date {
    return new Date(Date.UTC(this.y, this.m - 1, this.d));
  }

  toISO(): string {
    const mm = String(this.m).padStart(2, "0");
    const dd = String(this.d).padStart(2, "0");
    return `${this.y}-${mm}-${dd}`;
  }

  /** Días enteros desde esta fecha hasta `other` (other - this). Negativo si other es anterior. */
  daysUntil(other: DateOnly): number {
    const MS = 24 * 60 * 60 * 1000;
    return Math.round((other.toDate().getTime() - this.toDate().getTime()) / MS);
  }

  isAfter(other: DateOnly): boolean {
    return this.toDate().getTime() > other.toDate().getTime();
  }

  isBefore(other: DateOnly): boolean {
    return this.toDate().getTime() < other.toDate().getTime();
  }

  equals(other: DateOnly): boolean {
    return this.toDate().getTime() === other.toDate().getTime();
  }
}

/** Identificador de Tenant (multi-tenant). Marca de tipo para no confundir UUIDs. */
export type TenantId = string & { readonly __brand: "TenantId" };
export const TenantId = (v: string): TenantId => v as TenantId;

/** Generador de identidad inyectable (para IDs determinísticos en pruebas). */
export interface IdGenerator {
  next(): string;
}

let __seq = 0;
/** Generador simple incremental para pruebas/dominio (no para producción cripto). */
export class SequentialIdGenerator implements IdGenerator {
  constructor(private readonly prefix = "id") {}
  next(): string {
    __seq += 1;
    return `${this.prefix}-${__seq}`;
  }
}
