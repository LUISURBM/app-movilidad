/**
 * Casos de uso del CATÁLOGO de Tipos de documento (spec-005 R2/R10).
 * El catálogo es configurable por tenant SIN redeploy: los cambios normativos se
 * resuelven agregando o desactivando Tipos desde el portal.
 */
import { DomainError, Result, TenantId, err, ok } from "../../../shared/kernel";
import { TipoDocumento, TipoSujeto } from "../domain/value-objects";
import { CatalogoTiposRepository } from "./ports";

export class ListarTiposDocumento {
  constructor(private readonly catalogo: CatalogoTiposRepository) {}

  async execute(tenant: TenantId): Promise<TipoDocumento[]> {
    return this.catalogo.findAll(tenant);
  }
}

export interface AgregarTipoInput {
  tenant: TenantId;
  codigo: string;
  aplicaA: TipoSujeto;
  requerido?: boolean;
}

export class AgregarTipoDocumento {
  constructor(private readonly catalogo: CatalogoTiposRepository) {}

  async execute(input: AgregarTipoInput): Promise<Result<TipoDocumento>> {
    const existente = await this.catalogo.findByCodigo(input.tenant, input.codigo);
    if (existente) {
      return err(
        new DomainError(
          "tipo_documento_duplicado",
          `Ya existe el Tipo "${input.codigo}" en el catálogo de este tenant.`,
        ),
      );
    }
    // El constructor de TipoDocumento valida código no vacío.
    let tipo: TipoDocumento;
    try {
      tipo = new TipoDocumento(input.codigo, input.aplicaA, input.requerido ?? false, true);
    } catch (e) {
      if (e instanceof DomainError) return err(e);
      throw e;
    }
    await this.catalogo.save(input.tenant, tipo);
    return ok(tipo);
  }
}

export interface ActualizarTipoInput {
  tenant: TenantId;
  codigo: string;
  activo?: boolean;
  requerido?: boolean;
}

export class ActualizarTipoDocumento {
  constructor(private readonly catalogo: CatalogoTiposRepository) {}

  /**
   * R10: desactivar impide registrar NUEVOS Documentos de ese Tipo (los existentes
   * no se tocan). `requerido` alimenta la invariante I3 del Semáforo.
   * TipoDocumento es inmutable: se construye la versión actualizada.
   */
  async execute(input: ActualizarTipoInput): Promise<Result<TipoDocumento>> {
    const actual = await this.catalogo.findByCodigo(input.tenant, input.codigo);
    if (!actual) {
      return err(
        new DomainError("tipo_no_encontrado", `El Tipo "${input.codigo}" no existe en este tenant.`),
      );
    }
    const actualizado = new TipoDocumento(
      actual.codigo,
      actual.aplicaA,
      input.requerido ?? actual.requerido,
      input.activo ?? actual.activo,
    );
    await this.catalogo.save(input.tenant, actualizado);
    return ok(actualizado);
  }
}
