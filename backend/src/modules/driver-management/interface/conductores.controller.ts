/**
 * ConductoresController — endpoints REST del contrato openapi.yaml para Conductores (spec-004).
 *  POST /conductores                   Registrar (documento único; crea Documento LICENCIA en BC-4).
 *  GET  /conductores                   Listar.
 *  GET  /conductores/{conductorId}     Obtener uno.
 *
 * El tenant sale del contexto de request (JWT), nunca del body (ADR-0008).
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
import { TENANT_CONTEXT, TenantContext } from "../../../platform/tenant-context";
import { RegistrarConductor } from "../application/use-cases";
import { ConductorRepository } from "../application/ports";
import { CONDUCTOR_REPOSITORY } from "./tokens";
import { conductorToDto } from "./mappers";
import { ConductorDto, ConductoresPaginaDto, RegistrarConductorRequestDto } from "./dtos";
import { problemFromDomainError } from "./error-mapping";

@Controller("conductores")
export class ConductoresController {
  constructor(
    @Inject(RegistrarConductor) private readonly registrar: RegistrarConductor,
    @Inject(CONDUCTOR_REPOSITORY) private readonly conductores: ConductorRepository,
    @Inject(TENANT_CONTEXT) private readonly ctx: TenantContext,
  ) {}

  @Post()
  @HttpCode(201)
  async registrarConductor(@Body() body: RegistrarConductorRequestDto): Promise<ConductorDto> {
    const r = await this.registrar.execute({
      tenant: this.ctx.tenantId,
      nombre: body.nombre,
      documentoIdentidad: body.documentoIdentidad,
      usuarioId: body.usuarioId,
      licencia: body.licencia,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, "/v1/conductores");
      throw new HttpException(problem, problem.status);
    }
    const c = await this.conductores.findById(this.ctx.tenantId, r.value.conductorId);
    return conductorToDto(c!);
  }

  @Get()
  async listarConductores(): Promise<ConductoresPaginaDto> {
    const items = (await this.conductores.list(this.ctx.tenantId)).map(conductorToDto);
    return { items, page: 1, pageSize: items.length, total: items.length };
  }

  @Get(":conductorId")
  async obtenerConductor(@Param("conductorId") conductorId: string): Promise<ConductorDto> {
    const c = await this.conductores.findById(this.ctx.tenantId, conductorId);
    if (!c) {
      throw new HttpException(
        { type: "conductor_no_encontrado", title: "Conductor no encontrado", status: 404 },
        404,
      );
    }
    return conductorToDto(c);
  }
}
