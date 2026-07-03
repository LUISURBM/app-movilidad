/**
 * Casos de uso del contexto Maintenance Management (BC-7) — spec-012.
 */
import { Clock, DomainError, IdGenerator, Result, TenantId, err, ok } from "../../../shared/kernel";
import { Umbral } from "../domain/umbral.aggregate";
import { MantenimientoRegistrado, nowIso } from "../domain/events";
import { EventPublisher, UmbralRepository } from "./ports";

export interface MaintenanceDeps {
  umbrales: UmbralRepository;
  publisher: EventPublisher;
  clock: Clock;
  ids: IdGenerator;
}

// ───────────── spec-012: Definir Umbral ─────────────

export interface DefinirUmbralInput {
  tenant: TenantId;
  vehiculoId: string;
  cadaKm?: number;
  baseKm?: number;
  cadaMeses?: number;
  baseFecha?: string;
}

export class DefinirUmbral {
  constructor(private readonly deps: MaintenanceDeps) {}

  async execute(input: DefinirUmbralInput): Promise<Result<{ umbralId: string }>> {
    const r = Umbral.definir({
      id: this.deps.ids.next(),
      vehiculoId: input.vehiculoId,
      cadaKm: input.cadaKm,
      baseKm: input.baseKm,
      cadaMeses: input.cadaMeses,
      baseFecha: input.baseFecha,
    });
    if (!r.ok) return r;
    await this.deps.umbrales.save(input.tenant, r.value);
    return ok({ umbralId: r.value.id });
  }
}

// ───────────── spec-012: Evaluar por Odómetro (P6) ─────────────

/**
 * Se invoca cuando avanza el Odómetro autoritativo del Vehículo (evento `OdometroActualizado`,
 * originado por Tanqueo o Servicio). *Seguimiento:* cablear este disparo al evento vía outbox/ACL;
 * hoy es un caso de uso invocable (probado directamente).
 */
export class EvaluarUmbralPorOdometro {
  constructor(private readonly deps: MaintenanceDeps) {}

  async execute(input: { tenant: TenantId; vehiculoId: string; lectura: number }): Promise<Result<{ programado: boolean }>> {
    const umbral = await this.deps.umbrales.findByVehiculo(input.tenant, input.vehiculoId);
    if (!umbral) return ok({ programado: false }); // sin Umbral definido: nada que evaluar
    const programado = umbral.evaluarPorOdometro(input.lectura, this.deps.ids.next());
    if (programado) {
      await this.deps.umbrales.save(input.tenant, umbral);
      await this.deps.publisher.publish(input.tenant, umbral.pullEventos());
    }
    return ok({ programado });
  }
}

// ───────────── spec-012: Evaluar vencimientos por fecha (P7, job diario) ─────────────

export class EvaluarVencimientosPorFecha {
  constructor(private readonly deps: MaintenanceDeps) {}

  async execute(tenant: TenantId): Promise<{ vencidos: number }> {
    const hoy = this.deps.clock.today();
    const umbrales = await this.deps.umbrales.list(tenant);
    let vencidos = 0;
    for (const u of umbrales) {
      if (u.evaluarPorFecha(hoy, this.deps.ids.next())) {
        await this.deps.umbrales.save(tenant, u);
        await this.deps.publisher.publish(tenant, u.pullEventos());
        vencidos += 1;
      }
    }
    return { vencidos };
  }
}

// ───────────── spec-012: Registrar ejecución (reinicia ciclo, R6) ─────────────

export class RegistrarEjecucion {
  constructor(private readonly deps: MaintenanceDeps) {}

  async execute(input: {
    tenant: TenantId;
    vehiculoId: string;
    odometro: number;
    costoCop: number;
  }): Promise<Result<void>> {
    const umbral = await this.deps.umbrales.findByVehiculo(input.tenant, input.vehiculoId);
    if (!umbral) {
      return err(new DomainError("umbral_no_encontrado", "El Vehículo no tiene un Umbral de mantenimiento definido."));
    }
    umbral.registrarEjecucion({
      mantenimientoId: this.deps.ids.next(),
      odometro: input.odometro,
      costoCop: input.costoCop,
      hoy: this.deps.clock.today(),
    });
    await this.deps.umbrales.save(input.tenant, umbral);
    await this.deps.publisher.publish(input.tenant, umbral.pullEventos());
    return ok(undefined);
  }
}

// ───────────── spec-012: Registrar correctivo (reactivo, R7) ─────────────

export class RegistrarCorrectivo {
  constructor(private readonly deps: MaintenanceDeps) {}

  async execute(input: {
    tenant: TenantId;
    vehiculoId: string;
    odometro: number;
    costoCop: number;
  }): Promise<Result<{ mantenimientoId: string }>> {
    if (!Number.isFinite(input.costoCop) || input.costoCop <= 0) {
      return err(new DomainError("costo_invalido", "El costo del mantenimiento debe ser positivo."));
    }
    const mantenimientoId = this.deps.ids.next();
    await this.deps.publisher.publish(input.tenant, [
      <MantenimientoRegistrado>{
        tipo: "MantenimientoRegistrado",
        ocurridoEn: nowIso(),
        mantenimientoId,
        vehiculoId: input.vehiculoId,
        tipoMantenimiento: "correctivo",
        costoCop: input.costoCop,
        odometro: input.odometro,
      },
    ]);
    return ok({ mantenimientoId });
  }
}
