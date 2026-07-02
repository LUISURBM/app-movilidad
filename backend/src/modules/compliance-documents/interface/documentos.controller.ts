/**
 * DocumentosController — endpoints REST del contrato openapi.yaml para Documentos.
 *  POST   /documentos                       (spec-005)
 *  GET    /documentos/{documentoId}         (spec-005)
 *  POST   /documentos/{documentoId}/renovaciones  (spec-007)
 *
 * El tenant se toma del contexto de request (JWT), nunca del body (ADR-0008).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
} from "@nestjs/common";
import { Clock } from "../../../shared/kernel";
import { TENANT_CONTEXT, TenantContext } from "../../../platform/tenant-context";
import { CLOCK } from "../../../platform/tokens";
import {
  RegistrarDocumento,
  RenovarDocumento,
} from "../application/use-cases";
import { DocumentoRepository } from "../application/ports";
import { DOCUMENTO_REPOSITORY } from "./tokens";
import { documentoToDto } from "./mappers";
import { sujetoFromDto } from "./mappers";
import {
  DocumentoDto,
  RegistrarDocumentoRequestDto,
  RenovarDocumentoRequestDto,
} from "./dtos";
import { problemFromDomainError } from "./error-mapping";

@Controller("documentos")
export class DocumentosController {
  constructor(
    @Inject(RegistrarDocumento) private readonly registrar: RegistrarDocumento,
    @Inject(RenovarDocumento) private readonly renovar: RenovarDocumento,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TENANT_CONTEXT) private readonly ctx: TenantContext,
  ) {}

  @Post()
  @HttpCode(201)
  async registrarDocumento(
    @Body() body: RegistrarDocumentoRequestDto,
  ): Promise<{ id: string }> {
    const r = await this.registrar.execute({
      tenant: this.ctx.tenantId,
      sujeto: sujetoFromDto(body.sujeto),
      tipoCodigo: body.tipo,
      emision: body.expedicion ?? body.vencimiento, // si no hay emisión, se asume igual (validado por dominio)
      vencimiento: body.vencimiento,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, "/v1/documentos");
      throw new HttpException(problem, problem.status);
    }
    return { id: r.value.documentoId };
  }

  @Get(":documentoId")
  async obtenerDocumento(
    @Param("documentoId") documentoId: string,
  ): Promise<DocumentoDto> {
    const doc = await this.documentos.findById(this.ctx.tenantId, documentoId);
    if (!doc) {
      throw new HttpException(
        { type: "documento_no_encontrado", title: "Documento no encontrado", status: 404 },
        404,
      );
    }
    return documentoToDto(doc, this.clock.today());
  }

  @Post(":documentoId/renovaciones")
  @HttpCode(201)
  async renovarDocumento(
    @Param("documentoId") documentoId: string,
    @Body() body: RenovarDocumentoRequestDto,
  ): Promise<{ version: number }> {
    const r = await this.renovar.execute({
      tenant: this.ctx.tenantId,
      documentoId,
      nuevaEmision: body.expedicion ?? body.vencimiento,
      nuevoVencimiento: body.vencimiento,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(
        r.error,
        `/v1/documentos/${documentoId}/renovaciones`,
      );
      throw new HttpException(problem, problem.status);
    }
    return { version: r.value.version };
  }
}
