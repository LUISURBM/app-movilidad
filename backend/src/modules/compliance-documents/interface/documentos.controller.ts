/**
 * DocumentosController — endpoints REST del contrato openapi.yaml para Documentos.
 *  POST   /documentos                       (spec-005)
 *  GET    /documentos/{documentoId}         (spec-005)
 *  PUT    /documentos/{documentoId}/adjunto (spec-005 R5: subir/reemplazar soporte)
 *  GET    /documentos/{documentoId}/adjunto (spec-005 R5: descargar soporte)
 *  POST   /documentos/{documentoId}/renovaciones  (spec-007)
 *
 * El tenant se toma del contexto de request (JWT), nunca del body (ADR-0008).
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import { Clock } from "../../../shared/kernel";
import { TENANT_CONTEXT, TenantContext } from "../../../platform/tenant-context";
import { CLOCK } from "../../../platform/tokens";
import {
  RegistrarDocumento,
  RenovarDocumento,
} from "../application/use-cases";
import {
  ADJUNTO_MAX_BYTES,
  DescargarAdjunto,
  SubirAdjunto,
} from "../application/adjuntos.use-cases";
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

/**
 * Tipos mínimos del transporte HTTP (Express en runtime) — se declaran locales
 * para no depender de @types/express: solo se usa lo que aparece aquí.
 */
type RequestCrudo = AsyncIterable<Buffer | string>;
interface RespuestaCruda {
  status(codigo: number): RespuestaCruda;
  type(mime: string): RespuestaCruda;
  setHeader(nombre: string, valor: string): unknown;
  json(cuerpo: unknown): void;
  send(cuerpo: Buffer): void;
}

/**
 * Lee el cuerpo binario crudo del request con tope de tamaño. El body-parser
 * JSON de Nest no toca `application/octet-stream`/imágenes, así que el stream
 * llega intacto. Devuelve "excedido" apenas se pasa el tope (no acumula de más).
 */
async function leerCuerpoBinario(
  req: RequestCrudo,
  maxBytes: number,
): Promise<Buffer | "excedido"> {
  const trozos: Buffer[] = [];
  let total = 0;
  for await (const trozo of req) {
    const buf = Buffer.isBuffer(trozo) ? trozo : Buffer.from(trozo);
    total += buf.length;
    if (total > maxBytes) return "excedido";
    trozos.push(buf);
  }
  return Buffer.concat(trozos);
}

@Controller("documentos")
export class DocumentosController {
  constructor(
    @Inject(RegistrarDocumento) private readonly registrar: RegistrarDocumento,
    @Inject(RenovarDocumento) private readonly renovar: RenovarDocumento,
    @Inject(SubirAdjunto) private readonly subirAdjunto: SubirAdjunto,
    @Inject(DescargarAdjunto) private readonly descargarAdjunto: DescargarAdjunto,
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

  @Put(":documentoId/adjunto")
  @HttpCode(204)
  async subirAdjuntoDocumento(
    @Param("documentoId") documentoId: string,
    @Headers("content-type") contentType: string | undefined,
    @Req() req: RequestCrudo,
  ): Promise<void> {
    const cuerpo = await leerCuerpoBinario(req, ADJUNTO_MAX_BYTES);
    if (cuerpo === "excedido") {
      throw new HttpException(
        {
          type: "adjunto_demasiado_grande",
          title: `El adjunto supera el máximo de ${ADJUNTO_MAX_BYTES / (1024 * 1024)} MB.`,
          status: 413,
        },
        413,
      );
    }
    const r = await this.subirAdjunto.execute({
      tenant: this.ctx.tenantId,
      documentoId,
      contenido: cuerpo,
      contentType,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, `/v1/documentos/${documentoId}/adjunto`);
      throw new HttpException(problem, problem.status);
    }
  }

  @Get(":documentoId/adjunto")
  async descargarAdjuntoDocumento(
    @Param("documentoId") documentoId: string,
    @Res() res: RespuestaCruda,
  ): Promise<void> {
    const r = await this.descargarAdjunto.execute({
      tenant: this.ctx.tenantId,
      documentoId,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, `/v1/documentos/${documentoId}/adjunto`);
      res.status(problem.status).type("application/problem+json").json(problem);
      return;
    }
    res.status(200).type(r.value.mime).send(Buffer.from(r.value.contenido));
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
