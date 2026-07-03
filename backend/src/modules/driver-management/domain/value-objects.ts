/**
 * Value Objects del contexto Driver Management (BC-3) — spec-004.
 * Inmutables, validados en construcción. Sin dependencias de framework.
 */
import { DateOnly, DomainError } from "../../../shared/kernel";

/**
 * Documento de identidad del Conductor (cédula). spec-004 R2/R9: dato mínimo y único por
 * Tenant. Habeas Data (R3): se minimiza — solo lo necesario para la habilitación.
 */
export class DocumentoIdentidad {
  private constructor(public readonly valor: string) {}

  static de(v: string): DocumentoIdentidad {
    const norm = (v ?? "").trim();
    if (!norm) {
      throw new DomainError("documento_identidad_requerido", "El documento de identidad es obligatorio.");
    }
    return new DocumentoIdentidad(norm);
  }

  equals(other: DocumentoIdentidad): boolean {
    return this.valor === other.valor;
  }
}

/**
 * Licencia de conducción. spec-004 R4/R5: categoría + fecha de vencimiento. La vigencia
 * se gestiona como un Documento en BC-4 (la Licencia es un Tipo de documento del Conductor);
 * este VO captura el dato al alta.
 */
export class Licencia {
  private constructor(
    public readonly numero: string,
    public readonly categoria: string,
    public readonly vencimiento: DateOnly,
  ) {}

  static de(params: { numero: string; categoria: string; vencimiento: string }): Licencia {
    const numero = (params.numero ?? "").trim();
    const categoria = (params.categoria ?? "").trim();
    if (!numero) throw new DomainError("licencia_numero_requerido", "El número de la Licencia es obligatorio.");
    if (!categoria) throw new DomainError("licencia_categoria_requerida", "La categoría de la Licencia es obligatoria.");
    return new Licencia(numero, categoria, DateOnly.parse(params.vencimiento));
  }
}
