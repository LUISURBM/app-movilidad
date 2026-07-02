/**
 * SyncController — endpoints de sincronización offline del contrato (spec-010).
 *  GET  /sync/pull   "mi día" del Conductor: sus Servicios + Documentos del Vehículo.
 *  POST /sync/push   lote de cambios offline con deduplicación idempotente.
 *
 * Es un endpoint de COMPOSICIÓN: agrega la representación de los dos CORE. Para los
 * Documentos usa la query y el mapper PÚBLICOS de Compliance (no toca su dominio).
 * El conductorId se deriva del contexto de auth (dev: header x-usuario-id).
 */
import { Body, Controller, Get, Inject, Post, Query } from "@nestjs/common";
import { Clock } from "../../../shared/kernel";
import { CLOCK } from "../../../platform/tokens";
import { TENANT_CONTEXT, TenantContext } from "../../../platform/tenant-context";
import { ConsultarMiDia, SincronizarCambios } from "../application/use-cases";
import { servicioToDto } from "./mappers";
import { SyncPullResponseDto, SyncPushRequestDto, SyncPushResponseDto } from "./dtos";

// Composición inter-módulos: SOLO la API pública de Compliance (query + mapper + VO).
import { ConsultarDocumentosVigentes } from "../../compliance-documents/application/use-cases";
import { documentoToDto } from "../../compliance-documents/interface/mappers";
import { SujetoRef } from "../../compliance-documents/domain/value-objects";

@Controller("sync")
export class SyncController {
  constructor(
    @Inject(ConsultarMiDia) private readonly miDia: ConsultarMiDia,
    @Inject(SincronizarCambios) private readonly sincronizar: SincronizarCambios,
    @Inject(ConsultarDocumentosVigentes)
    private readonly documentosVigentes: ConsultarDocumentosVigentes,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TENANT_CONTEXT) private readonly ctx: TenantContext,
  ) {}

  @Get("pull")
  async pull(@Query("cursor") _cursor?: string): Promise<SyncPullResponseDto> {
    const { servicios, vehiculoIds, cursor } = await this.miDia.execute({
      tenant: this.ctx.tenantId,
      conductorId: this.ctx.usuarioId,
    });

    const hoy = this.clock.today();
    const documentos = (
      await Promise.all(
        vehiculoIds.map((v) =>
          this.documentosVigentes.execute(this.ctx.tenantId, SujetoRef.vehiculo(v)),
        ),
      )
    )
      .flat()
      .map((d) => documentoToDto(d, hoy));

    return {
      cursor,
      servicios: servicios.map(servicioToDto),
      documentos,
      vehiculos: [], // llega con el módulo Fleet (spec-003)
    };
  }

  @Post("push")
  async push(@Body() body: SyncPushRequestDto): Promise<SyncPushResponseDto> {
    const resultados = await this.sincronizar.execute({
      tenant: this.ctx.tenantId,
      usuarioId: this.ctx.usuarioId,
      cambios: (body.cambios ?? []).map((c) => ({
        clientId: c.clientId,
        entidad: c.entidad,
        operacion: c.operacion,
        payload: c.payload,
        ocurridoEn: c.ocurridoEn,
      })),
    });
    return { resultados };
  }
}
