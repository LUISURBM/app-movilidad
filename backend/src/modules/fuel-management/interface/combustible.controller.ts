/**
 * CombustibleController — endpoints REST del contrato openapi.yaml para Tanqueos (spec-011).
 *  POST /combustible   Registrar un tanqueo (append-only, idempotente por clientId/Idempotency-Key).
 *  GET  /combustible   Listar tanqueos de un Vehículo.
 *
 * El tenant se toma del contexto de request (JWT), nunca del body (ADR-0008). Es la vía
 * ONLINE del mismo caso de uso que /sync/push resuelve para el lote offline.
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { TENANT_CONTEXT, TenantContext } from "../../../platform/tenant-context";
import { RegistrarTanqueo } from "../application/use-cases";
import { TanqueoRepository } from "../application/ports";
import { UnidadCombustible } from "../domain/value-objects";
import { TANQUEO_REPOSITORY } from "./tokens";
import { tanqueoToDto } from "./mappers";
import { RegistrarTanqueoRequestDto, TanqueoDto, TanqueosPaginaDto } from "./dtos";
import { problemFromDomainError } from "./error-mapping";

/** Mínimo de la respuesta HTTP para fijar el status (evita depender de tipos de express). */
interface RespuestaHttp {
  status(code: number): void;
}

@Controller("combustible")
export class CombustibleController {
  constructor(
    @Inject(RegistrarTanqueo) private readonly registrar: RegistrarTanqueo,
    @Inject(TANQUEO_REPOSITORY) private readonly tanqueos: TanqueoRepository,
    @Inject(TENANT_CONTEXT) private readonly ctx: TenantContext,
  ) {}

  @Post()
  async registrarTanqueo(
    @Body() body: RegistrarTanqueoRequestDto,
    @Res({ passthrough: true }) res: RespuestaHttp,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<TanqueoDto> {
    // El clientId del body es la clave (spec-011 R4); el header Idempotency-Key es alterno.
    const clientId = body.clientId ?? idempotencyKey ?? "";
    const r = await this.registrar.execute({
      tenant: this.ctx.tenantId,
      clientId,
      vehiculoId: body.vehiculoId,
      cantidad: body.litros,
      unidad: UnidadCombustible.Litros, // el REST captura litros (contrato); galones llegan por /sync.
      valorCop: body.valor?.valor,
      odometro: body.odometro,
      ocurridoEn: body.tanqueadoEn,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, "/v1/combustible");
      throw new HttpException(problem, problem.status);
    }

    // 200 si fue un reintento idempotente (ya existía); 201 si se creó (contrato spec-011).
    res.status(r.value.duplicado ? 200 : 201);
    const tanqueo = await this.tanqueos.findByClientId(this.ctx.tenantId, clientId);
    // El registro siempre existe tras execute() OK; si no, se devuelve una vista mínima.
    return tanqueo
      ? tanqueoToDto(tanqueo)
      : {
          id: r.value.tanqueoId,
          vehiculoId: body.vehiculoId,
          litros: r.value.litros,
          valor: { moneda: "COP", valor: body.valor.valor },
          odometro: body.odometro,
          tanqueadoEn: body.tanqueadoEn,
        };
  }

  @Get()
  async listarTanqueos(@Query("vehiculoId") vehiculoId?: string): Promise<TanqueosPaginaDto> {
    const items = vehiculoId
      ? (await this.tanqueos.listByVehiculo(this.ctx.tenantId, vehiculoId)).map(tanqueoToDto)
      : [];
    return { items, page: 1, pageSize: items.length, total: items.length };
  }
}
