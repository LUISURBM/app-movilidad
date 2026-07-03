/**
 * Casos de uso del contexto Fleet Management (BC-2) — spec-003.
 * Orquestan el dominio y los puertos; sin dependencias de framework.
 */
import { DomainError, IdGenerator, Result, TenantId, err, ok } from "../../../shared/kernel";
import { Vehiculo } from "../domain/vehiculo.aggregate";
import {
  Afiliacion,
  ClaseVehiculo,
  FuenteOdometro,
  Odometro,
  Placa,
  parseClase,
} from "../domain/value-objects";
import { EventPublisher, VehiculoRepository } from "./ports";

export interface FleetDeps {
  vehiculos: VehiculoRepository;
  publisher: EventPublisher;
  ids: IdGenerator;
}

// ───────────────────────── spec-003: Registrar Vehículo ─────────────────────────

export interface RegistrarVehiculoInput {
  tenant: TenantId;
  placa: string;
  clase: string;
  marca?: string;
  modelo?: string;
  anio?: number;
  propietarioId?: string;
  odometroInicial?: number;
  afiliacion?: { empresaTransportadoraId: string; desde: string };
}

export class RegistrarVehiculo {
  constructor(private readonly deps: FleetDeps) {}

  async execute(input: RegistrarVehiculoInput): Promise<Result<{ vehiculoId: string }>> {
    // Construcción de VOs (falla cerrado ante datos inválidos: placa, clase, odómetro).
    let placa: Placa;
    let clase: ClaseVehiculo;
    let odometroInicial: Odometro | undefined;
    let afiliacion: Afiliacion | undefined;
    try {
      placa = Placa.de(input.placa);
      clase = parseClase(input.clase);
      odometroInicial =
        input.odometroInicial !== undefined ? Odometro.en(input.odometroInicial) : undefined;
      afiliacion = input.afiliacion
        ? Afiliacion.de(input.afiliacion.empresaTransportadoraId, input.afiliacion.desde)
        : undefined;
    } catch (e) {
      if (e instanceof DomainError) return err(e);
      throw e;
    }

    // R2: Placa única por Tenant.
    const existente = await this.deps.vehiculos.findByPlaca(input.tenant, placa.valor);
    if (existente) {
      return err(
        new DomainError("placa_duplicada", `Ya existe un Vehículo con la placa ${placa.valor} en la Empresa.`),
      );
    }

    const vehiculo = Vehiculo.registrar({
      id: this.deps.ids.next(),
      placa,
      clase,
      marca: input.marca,
      modelo: input.modelo,
      anio: input.anio,
      propietarioId: input.propietarioId,
      odometroInicial,
      afiliacion,
    });

    await this.deps.vehiculos.save(input.tenant, vehiculo);
    await this.deps.publisher.publish(input.tenant, vehiculo.pullEventos());
    return ok({ vehiculoId: vehiculo.id });
  }
}

// ───────────────────────── spec-003: Actualizar Odómetro (monótono) ─────────────────────────

export interface ActualizarOdometroInput {
  tenant: TenantId;
  vehiculoId: string;
  lectura: number;
  fuente: FuenteOdometro;
}

export class ActualizarOdometro {
  constructor(private readonly deps: FleetDeps) {}

  async execute(input: ActualizarOdometroInput): Promise<Result<{ lectura: number }>> {
    const vehiculo = await this.deps.vehiculos.findById(input.tenant, input.vehiculoId);
    if (!vehiculo) {
      return err(new DomainError("vehiculo_no_encontrado", "El Vehículo no existe en este Tenant."));
    }

    let lectura: Odometro;
    try {
      lectura = Odometro.en(input.lectura);
    } catch (e) {
      if (e instanceof DomainError) return err(e);
      throw e;
    }

    const r = vehiculo.actualizarOdometro(lectura, input.fuente); // R6: rechaza si no es monótona
    if (!r.ok) return r;

    await this.deps.vehiculos.save(input.tenant, vehiculo);
    await this.deps.publisher.publish(input.tenant, vehiculo.pullEventos());
    return ok({ lectura: lectura.km });
  }
}
