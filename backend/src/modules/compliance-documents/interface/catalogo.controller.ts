/**
 * CatalogoController — endpoints del catálogo de Tipos (spec-005 R2/R10).
 *  GET   /catalogo/tipos            listar
 *  POST  /catalogo/tipos            agregar (409 si el código ya existe)
 *  PATCH /catalogo/tipos/{codigo}   activar/desactivar, marcar requerido (404 si no existe)
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { TENANT_CONTEXT, TenantContext } from "../../../platform/tenant-context";
import { TipoDocumento, TipoSujeto } from "../domain/value-objects";
import {
  ActualizarTipoDocumento,
  AgregarTipoDocumento,
  ListarTiposDocumento,
} from "../application/catalogo.use-cases";
import { problemFromDomainError } from "./error-mapping";

// ---- DTOs del contrato (openapi.yaml: TipoDocumentoCatalogo y requests) ----
export interface TipoDocumentoCatalogoDto {
  codigo: string;
  aplicaA: "vehiculo" | "conductor";
  requerido: boolean;
  activo: boolean;
}

export interface AgregarTipoDocumentoRequestDto {
  codigo: string;
  aplicaA: "vehiculo" | "conductor";
  requerido?: boolean;
}

export interface ActualizarTipoDocumentoRequestDto {
  activo?: boolean;
  requerido?: boolean;
}

function tipoToDto(t: TipoDocumento): TipoDocumentoCatalogoDto {
  return { codigo: t.codigo, aplicaA: t.aplicaA, requerido: t.requerido, activo: t.activo };
}

@Controller("catalogo/tipos")
export class CatalogoController {
  constructor(
    @Inject(ListarTiposDocumento) private readonly listar: ListarTiposDocumento,
    @Inject(AgregarTipoDocumento) private readonly agregar: AgregarTipoDocumento,
    @Inject(ActualizarTipoDocumento) private readonly actualizar: ActualizarTipoDocumento,
    @Inject(TENANT_CONTEXT) private readonly ctx: TenantContext,
  ) {}

  @Get()
  async listarTipos(): Promise<TipoDocumentoCatalogoDto[]> {
    const tipos = await this.listar.execute(this.ctx.tenantId);
    return tipos.map(tipoToDto);
  }

  @Post()
  @HttpCode(201)
  async agregarTipo(@Body() body: AgregarTipoDocumentoRequestDto): Promise<TipoDocumentoCatalogoDto> {
    const r = await this.agregar.execute({
      tenant: this.ctx.tenantId,
      codigo: body.codigo,
      aplicaA: body.aplicaA as TipoSujeto,
      requerido: body.requerido,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, "/v1/catalogo/tipos");
      throw new HttpException(problem, problem.status);
    }
    return tipoToDto(r.value);
  }

  @Patch(":codigo")
  async actualizarTipo(
    @Param("codigo") codigo: string,
    @Body() body: ActualizarTipoDocumentoRequestDto,
  ): Promise<TipoDocumentoCatalogoDto> {
    const r = await this.actualizar.execute({
      tenant: this.ctx.tenantId,
      codigo,
      activo: body.activo,
      requerido: body.requerido,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, `/v1/catalogo/tipos/${codigo}`);
      throw new HttpException(problem, problem.status);
    }
    return tipoToDto(r.value);
  }
}
