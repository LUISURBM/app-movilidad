/**
 * MantenimientoController — endpoints REST del contrato openapi.yaml (spec-012).
 *  GET  /mantenimiento/umbrales                    Umbrales con estado del ciclo.
 *  PUT  /mantenimiento/umbrales/{vehiculoId}       Definir/redefinir Umbral (upsert por Vehículo).
 *  POST /mantenimiento/ejecuciones                 Ejecución del preventivo (reinicia ciclo, R6).
 *  POST /mantenimiento/correctivos                 Correctivo reactivo (R7).
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
  Put,
} from "@nestjs/common";
import { Clock } from "../../../shared/kernel";
import { CLOCK } from "../../../platform/tokens";
import { TENANT_CONTEXT, TenantContext } from "../../../platform/tenant-context";
import {
  DefinirUmbral,
  RegistrarCorrectivo,
  RegistrarEjecucion,
} from "../application/use-cases";
import { UmbralRepository } from "../application/ports";
import { UMBRAL_REPOSITORY } from "./tokens";
import { umbralToDto } from "./mappers";
import {
  DefinirUmbralMantenimientoRequestDto,
  MantenimientoRegistradoResponseDto,
  RegistrarMantenimientoRequestDto,
  UmbralMantenimientoDto,
} from "./dtos";
import { problemFromDomainError } from "./error-mapping";

@Controller("mantenimiento")
export class MantenimientoController {
  constructor(
    @Inject(DefinirUmbral) private readonly definir: DefinirUmbral,
    @Inject(RegistrarEjecucion) private readonly registrarEjecucion: RegistrarEjecucion,
    @Inject(RegistrarCorrectivo) private readonly registrarCorrectivo: RegistrarCorrectivo,
    @Inject(UMBRAL_REPOSITORY) private readonly umbrales: UmbralRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TENANT_CONTEXT) private readonly ctx: TenantContext,
  ) {}

  @Get("umbrales")
  async listarUmbrales(): Promise<UmbralMantenimientoDto[]> {
    const umbrales = await this.umbrales.list(this.ctx.tenantId);
    return umbrales.map(umbralToDto);
  }

  @Put("umbrales/:vehiculoId")
  async definirUmbral(
    @Param("vehiculoId") vehiculoId: string,
    @Body() body: DefinirUmbralMantenimientoRequestDto,
  ): Promise<UmbralMantenimientoDto> {
    // Contrato: si se define por meses sin baseFecha, la base es HOY (reloj de dominio).
    const baseFecha =
      body.cadaMeses !== undefined && body.baseFecha === undefined
        ? this.clock.today().toISO()
        : body.baseFecha;

    const r = await this.definir.execute({
      tenant: this.ctx.tenantId,
      vehiculoId,
      cadaKm: body.cadaKm,
      baseKm: body.baseKm,
      cadaMeses: body.cadaMeses,
      baseFecha,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, `/v1/mantenimiento/umbrales/${vehiculoId}`);
      throw new HttpException(problem, problem.status);
    }
    const u = await this.umbrales.findByVehiculo(this.ctx.tenantId, vehiculoId);
    return umbralToDto(u!);
  }

  @Post("ejecuciones")
  @HttpCode(200)
  async ejecutar(@Body() body: RegistrarMantenimientoRequestDto): Promise<UmbralMantenimientoDto> {
    const r = await this.registrarEjecucion.execute({
      tenant: this.ctx.tenantId,
      vehiculoId: body.vehiculoId,
      odometro: body.odometro,
      costoCop: body.costo.valor,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, "/v1/mantenimiento/ejecuciones");
      throw new HttpException(problem, problem.status);
    }
    const u = await this.umbrales.findByVehiculo(this.ctx.tenantId, body.vehiculoId);
    return umbralToDto(u!);
  }

  @Post("correctivos")
  @HttpCode(201)
  async correctivo(
    @Body() body: RegistrarMantenimientoRequestDto,
  ): Promise<MantenimientoRegistradoResponseDto> {
    const r = await this.registrarCorrectivo.execute({
      tenant: this.ctx.tenantId,
      vehiculoId: body.vehiculoId,
      odometro: body.odometro,
      costoCop: body.costo.valor,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, "/v1/mantenimiento/correctivos");
      throw new HttpException(problem, problem.status);
    }
    return { mantenimientoId: r.value.mantenimientoId };
  }
}
