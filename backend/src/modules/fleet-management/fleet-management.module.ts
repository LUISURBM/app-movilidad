/**
 * fleet-management.module.ts — wiring NestJS del módulo BC-2 (spec-003).
 *
 * Igual que los demás módulos, cablea adaptadores EN MEMORIA (verificable sin base de
 * datos). Para producción se sustituyen por los de `infrastructure/` (SQL + RLS + outbox)
 * sin tocar el dominio ni los casos de uso.
 *
 * API PÚBLICA: exporta `RegistrarVehiculo`, `ActualizarOdometro` y el repositorio, para
 * que otros contextos (p. ej. Fuel, spec-011) puedan consultar/actualizar el Odómetro
 * autoritativo del Vehículo vía ACL cuando corresponda.
 */
import { Module, Scope } from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import { SequentialIdGenerator, TenantId } from "../../shared/kernel";
import { ID_GENERATOR } from "../../platform/tokens";
import { RequestTenantContext, Rol, TENANT_CONTEXT } from "../../platform/tenant-context";

import { FLEET_EVENT_PUBLISHER, VEHICULO_REPOSITORY } from "./interface/tokens";
import { VehiculosController } from "./interface/vehiculos.controller";
import {
  InMemoryEventPublisher,
  InMemoryVehiculoRepository,
} from "./application/in-memory.adapters";
import { ActualizarOdometro, FleetDeps, RegistrarVehiculo } from "./application/use-cases";
import { DataSource } from "typeorm";
import { DATA_SOURCE, elegirAdaptador } from "../../platform/persistencia";
import { SqlFleetEventPublisher, SqlVehiculoRepository } from "./infrastructure/sql-adapters";
import { PublicadorSuscribibleSobre } from "./infrastructure/publicador-suscribible";

interface AuthedRequest {
  tenantId?: string;
  usuarioId?: string;
  roles?: Rol[];
}

const DEPS = [VEHICULO_REPOSITORY, FLEET_EVENT_PUBLISHER, ID_GENERATOR];
const armar = (vehiculos: never, publisher: never, ids: never): FleetDeps =>
  ({ vehiculos, publisher, ids }) as unknown as FleetDeps;

@Module({
  controllers: [VehiculosController],
  providers: [
    { provide: ID_GENERATOR, useFactory: () => new SequentialIdGenerator("veh") },
    {
      provide: TENANT_CONTEXT,
      scope: Scope.REQUEST,
      inject: [REQUEST],
      useFactory: (req: AuthedRequest) =>
        new RequestTenantContext(TenantId(req.tenantId ?? ""), req.usuarioId ?? "", req.roles ?? []),
    },

    // Persistencia conmutable (E0): postgres → adaptadores SQL; memoria → in-memory.
    {
      provide: VEHICULO_REPOSITORY,
      inject: [DATA_SOURCE],
      useFactory: (ds: DataSource | null) =>
        elegirAdaptador(ds, (d) => new SqlVehiculoRepository(d), () => new InMemoryVehiculoRepository()),
    },
    // El publicador SIEMPRE es suscribible (costura P6 de spec-012): en postgres
    // escribe al outbox Y notifica in-process; en memoria el in-memory ya lo es.
    {
      provide: FLEET_EVENT_PUBLISHER,
      inject: [DATA_SOURCE],
      useFactory: (ds: DataSource | null) =>
        elegirAdaptador(
          ds,
          (d) => new PublicadorSuscribibleSobre(new SqlFleetEventPublisher(d)),
          () => new InMemoryEventPublisher(),
        ),
    },

    { provide: RegistrarVehiculo, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new RegistrarVehiculo(armar(...a)) },
    { provide: ActualizarOdometro, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new ActualizarOdometro(armar(...a)) },
  ],
  // FLEET_EVENT_PUBLISHER se exporta para que los consumidores aguas abajo
  // (Maintenance, spec-012 P6) se SUSCRIBAN a los eventos de Fleet in-process;
  // Fleet no conoce a sus suscriptores (puerto PublicadorSuscribible).
  exports: [RegistrarVehiculo, ActualizarOdometro, VEHICULO_REPOSITORY, FLEET_EVENT_PUBLISHER],
})
export class FleetManagementModule {}
