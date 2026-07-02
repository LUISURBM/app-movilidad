/**
 * ServiciosController — endpoints REST del contrato openapi.yaml para Servicios.
 *  GET    /servicios                        (agenda, paginada)
 *  POST   /servicios                        (spec-008, 201)
 *  PUT    /servicios/{servicioId}/asignacion  (spec-008 + spec-009 regla de oro, 200/409)
 *  POST   /servicios/{servicioId}/estado    (transiciones S1/S2; offline pleno en spec-010)
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
  Put,
  Query,
} from "@nestjs/common";
import { TENANT_CONTEXT, TenantContext } from "../../../platform/tenant-context";
import {
  AsignarServicio,
  CambiarEstadoServicio,
  CrearServicio,
} from "../application/use-cases";
import { ServicioRepository } from "../application/ports";
import { SERVICIO_REPOSITORY } from "./tokens";
import { servicioToDto } from "./mappers";
import {
  AsignacionDto,
  AsignarServicioRequestDto,
  CambiarEstadoServicioRequestDto,
  CrearServicioRequestDto,
  PaginaDto,
  ServicioDto,
} from "./dtos";
import { problemFromDomainError } from "./error-mapping";

@Controller("servicios")
export class ServiciosController {
  constructor(
    @Inject(CrearServicio) private readonly crear: CrearServicio,
    @Inject(AsignarServicio) private readonly asignar: AsignarServicio,
    @Inject(CambiarEstadoServicio) private readonly cambiarEstado: CambiarEstadoServicio,
    @Inject(SERVICIO_REPOSITORY) private readonly servicios: ServicioRepository,
    @Inject(TENANT_CONTEXT) private readonly ctx: TenantContext,
  ) {}

  @Get()
  async listarServicios(
    @Query("estado") estado?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ): Promise<PaginaDto<ServicioDto>> {
    const todos = await this.servicios.list(this.ctx.tenantId, { estado });
    const p = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const items = todos.slice((p - 1) * size, p * size).map(servicioToDto);
    return { items, page: p, pageSize: size, total: todos.length };
  }

  @Post()
  @HttpCode(201)
  async crearServicio(@Body() body: CrearServicioRequestDto): Promise<ServicioDto> {
    const r = await this.crear.execute({
      tenant: this.ctx.tenantId,
      origen: body.origen,
      destino: body.destino,
      ventanaInicio: body.ventana?.inicio,
      ventanaFin: body.ventana?.fin,
      cliente: body.cliente,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, "/v1/servicios");
      throw new HttpException(problem, problem.status);
    }
    const servicio = await this.servicios.findById(this.ctx.tenantId, r.value.servicioId);
    return servicioToDto(servicio!);
  }

  @Put(":servicioId/asignacion")
  async asignarServicio(
    @Param("servicioId") servicioId: string,
    @Body() body: AsignarServicioRequestDto,
  ): Promise<AsignacionDto> {
    const r = await this.asignar.execute({
      tenant: this.ctx.tenantId,
      servicioId,
      vehiculoId: body.vehiculoId,
      conductorId: body.conductorId,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, `/v1/servicios/${servicioId}/asignacion`);
      throw new HttpException(problem, problem.status);
    }
    return {
      servicioId: r.value.servicioId,
      vehiculoId: r.value.vehiculoId,
      conductorId: r.value.conductorId,
      advertencias: r.value.advertencias.length > 0 ? r.value.advertencias : undefined,
    };
  }

  @Post(":servicioId/estado")
  async cambiarEstadoServicio(
    @Param("servicioId") servicioId: string,
    @Body() body: CambiarEstadoServicioRequestDto,
  ): Promise<ServicioDto> {
    const r = await this.cambiarEstado.execute({
      tenant: this.ctx.tenantId,
      servicioId,
      accion: body.accion,
      ocurridoEn: body.ocurridoEn,
      odometro: body.odometro,
      clientId: body.clientId, // idempotencia offline (spec-010 R6/R8)
      usuarioId: this.ctx.usuarioId,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, `/v1/servicios/${servicioId}/estado`);
      throw new HttpException(problem, problem.status);
    }
    const servicio = await this.servicios.findById(this.ctx.tenantId, servicioId);
    return servicioToDto(servicio!);
  }
}
