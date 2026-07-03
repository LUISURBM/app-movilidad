/**
 * VehiculosController — endpoints REST del contrato openapi.yaml para Vehículos (spec-003).
 *  POST /vehiculos                     Registrar (placa única por tenant).
 *  GET  /vehiculos                     Listar.
 *  GET  /vehiculos/{vehiculoId}        Obtener uno.
 *  POST /vehiculos/{vehiculoId}/odometro   Registrar lectura de Odómetro (monótona).
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
import { ActualizarOdometro, RegistrarVehiculo } from "../application/use-cases";
import { VehiculoRepository } from "../application/ports";
import { VEHICULO_REPOSITORY } from "./tokens";
import { vehiculoToDto } from "./mappers";
import {
  LecturaOdometroDto,
  RegistrarOdometroRequestDto,
  RegistrarVehiculoRequestDto,
  VehiculoDto,
  VehiculosPaginaDto,
} from "./dtos";
import { problemFromDomainError } from "./error-mapping";

@Controller("vehiculos")
export class VehiculosController {
  constructor(
    @Inject(RegistrarVehiculo) private readonly registrar: RegistrarVehiculo,
    @Inject(ActualizarOdometro) private readonly actualizarOdometro: ActualizarOdometro,
    @Inject(VEHICULO_REPOSITORY) private readonly vehiculos: VehiculoRepository,
    @Inject(TENANT_CONTEXT) private readonly ctx: TenantContext,
  ) {}

  @Post()
  @HttpCode(201)
  async registrarVehiculo(@Body() body: RegistrarVehiculoRequestDto): Promise<VehiculoDto> {
    const r = await this.registrar.execute({
      tenant: this.ctx.tenantId,
      placa: body.placa,
      clase: body.clase,
      marca: body.marca,
      modelo: body.modelo,
      anio: body.anio,
      propietarioId: body.propietarioId,
      odometroInicial: body.odometroInicial,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, "/v1/vehiculos");
      throw new HttpException(problem, problem.status);
    }
    const v = await this.vehiculos.findById(this.ctx.tenantId, r.value.vehiculoId);
    return vehiculoToDto(v!);
  }

  @Get()
  async listarVehiculos(): Promise<VehiculosPaginaDto> {
    const items = (await this.vehiculos.list(this.ctx.tenantId)).map(vehiculoToDto);
    return { items, page: 1, pageSize: items.length, total: items.length };
  }

  @Get(":vehiculoId")
  async obtenerVehiculo(@Param("vehiculoId") vehiculoId: string): Promise<VehiculoDto> {
    const v = await this.vehiculos.findById(this.ctx.tenantId, vehiculoId);
    if (!v) {
      throw new HttpException(
        { type: "vehiculo_no_encontrado", title: "Vehículo no encontrado", status: 404 },
        404,
      );
    }
    return vehiculoToDto(v);
  }

  @Post(":vehiculoId/odometro")
  async registrarOdometro(
    @Param("vehiculoId") vehiculoId: string,
    @Body() body: RegistrarOdometroRequestDto,
  ): Promise<LecturaOdometroDto> {
    const r = await this.actualizarOdometro.execute({
      tenant: this.ctx.tenantId,
      vehiculoId,
      lectura: body.lectura,
      fuente: body.fuente,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, `/v1/vehiculos/${vehiculoId}/odometro`);
      throw new HttpException(problem, problem.status);
    }
    return { vehiculoId, lectura: r.value.lectura, fuente: body.fuente };
  }
}
