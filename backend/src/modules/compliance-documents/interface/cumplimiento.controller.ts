/**
 * CumplimientoController — endpoints REST del Semáforo y alertas (spec-006).
 *  GET /cumplimiento/vehiculos/{vehiculoId}
 *  GET /cumplimiento/conductores/{conductorId}
 *  GET /cumplimiento/alertas
 */
import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { TENANT_CONTEXT, TenantContext } from "../../../platform/tenant-context";
import { ConsultarSemaforo, EvaluarVencimientos } from "../application/use-cases";
import { DocumentoRepository } from "../application/ports";
import { DOCUMENTO_REPOSITORY } from "./tokens";
import { SujetoRef } from "../domain/value-objects";
import { Clock } from "../../../shared/kernel";
import { CLOCK } from "../../../platform/tokens";
import { cumplimientoToDto } from "./mappers";
import { AlertaDto, EstadoCumplimientoDto, PaginaDto } from "./dtos";

@Controller("cumplimiento")
export class CumplimientoController {
  constructor(
    @Inject(ConsultarSemaforo) private readonly consultar: ConsultarSemaforo,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TENANT_CONTEXT) private readonly ctx: TenantContext,
  ) {}

  @Get("vehiculos/:vehiculoId")
  async cumplimientoVehiculo(
    @Param("vehiculoId") vehiculoId: string,
  ): Promise<EstadoCumplimientoDto> {
    const r = await this.consultar.execute(this.ctx.tenantId, SujetoRef.vehiculo(vehiculoId));
    return cumplimientoToDto(r);
  }

  @Get("conductores/:conductorId")
  async cumplimientoConductor(
    @Param("conductorId") conductorId: string,
  ): Promise<EstadoCumplimientoDto> {
    const r = await this.consultar.execute(this.ctx.tenantId, SujetoRef.conductor(conductorId));
    return cumplimientoToDto(r);
  }

  @Get("alertas")
  async listarAlertas(
    @Query("estado") estado?: "por_vencer" | "vencido",
    @Query("page") page = 1,
    @Query("pageSize") pageSize = 20,
  ): Promise<PaginaDto<AlertaDto>> {
    const hoy = this.clock.today();
    const docs = await this.documentos.findAll(this.ctx.tenantId);

    const alertas: AlertaDto[] = [];
    for (const doc of docs) {
      const dias = doc.vencimiento.diasRestantesDesde(hoy);
      let estadoAlerta: "por_vencer" | "vencido" | null = null;
      if (dias < 0) estadoAlerta = "vencido";
      else if (dias <= 30) estadoAlerta = "por_vencer";
      if (!estadoAlerta) continue;
      if (estado && estado !== estadoAlerta) continue;
      alertas.push({
        documentoId: doc.id,
        sujeto: { tipo: doc.sujeto.tipo, id: doc.sujeto.id },
        tipo: doc.tipo.codigo,
        estado: estadoAlerta,
        vencimiento: doc.vencimiento.fecha.toISO(),
        diasRestantes: dias,
      });
    }

    // Ordenar por urgencia (menos días primero) y paginar.
    alertas.sort((a, b) => (a.diasRestantes ?? 0) - (b.diasRestantes ?? 0));
    const total = alertas.length;
    const start = (Number(page) - 1) * Number(pageSize);
    const items = alertas.slice(start, start + Number(pageSize));
    return { items, page: Number(page), pageSize: Number(pageSize), total };
  }
}
