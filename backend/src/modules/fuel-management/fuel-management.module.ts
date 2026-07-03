/**
 * fuel-management.module.ts — wiring NestJS del módulo BC-6 (spec-011).
 *
 * Cablea adaptadores EN MEMORIA para repo/publisher (verificable sin base de datos), y el
 * puerto `ODOMETRO_VEHICULO_GATEWAY` con la **ACL real hacia Fleet** (`FleetOdometroAcl`):
 * el Tanqueo actualiza el Odómetro autoritativo del Vehículo (BC-2, spec-003 R6) respetando
 * monotonía — ya no un stand-in local. Para producción se sustituyen repo/publisher por los
 * de `infrastructure/` (SQL + RLS + outbox) sin tocar el dominio ni los casos de uso.
 *
 * API PÚBLICA: exporta `RegistrarTanqueo` (lo consume la ACL de sync de Scheduling) y el repo.
 */
import { Module, Scope } from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import { SequentialIdGenerator, TenantId } from "../../shared/kernel";
import { ID_GENERATOR } from "../../platform/tokens";
import { RequestTenantContext, Rol, TENANT_CONTEXT } from "../../platform/tenant-context";

import {
  FUEL_EVENT_PUBLISHER,
  ODOMETRO_VEHICULO_GATEWAY,
  TANQUEO_REPOSITORY,
} from "./interface/tokens";
import { CombustibleController } from "./interface/combustible.controller";
import {
  InMemoryEventPublisher,
  InMemoryTanqueoRepository,
} from "./application/in-memory.adapters";
import { FuelDeps, RegistrarTanqueo } from "./application/use-cases";
import { FleetOdometroAcl } from "./infrastructure/fleet-odometro.acl";

// Colaboración entre contextos: SOLO la API pública de Fleet (ActualizarOdometro + repo).
import { FleetManagementModule } from "../fleet-management/fleet-management.module";
import { ActualizarOdometro } from "../fleet-management/application/use-cases";
import { VEHICULO_REPOSITORY } from "../fleet-management/interface/tokens";

interface AuthedRequest {
  tenantId?: string;
  usuarioId?: string;
  roles?: Rol[];
}

@Module({
  imports: [FleetManagementModule],
  controllers: [CombustibleController],
  providers: [
    { provide: ID_GENERATOR, useFactory: () => new SequentialIdGenerator("tanq") },
    {
      provide: TENANT_CONTEXT,
      scope: Scope.REQUEST,
      inject: [REQUEST],
      useFactory: (req: AuthedRequest) =>
        new RequestTenantContext(TenantId(req.tenantId ?? ""), req.usuarioId ?? "", req.roles ?? []),
    },

    { provide: TANQUEO_REPOSITORY, useClass: InMemoryTanqueoRepository },
    { provide: FUEL_EVENT_PUBLISHER, useClass: InMemoryEventPublisher },

    // ACL real hacia Fleet (spec-011 R8 + spec-003 R6): el Odómetro autoritativo vive en BC-2.
    {
      provide: ODOMETRO_VEHICULO_GATEWAY,
      inject: [ActualizarOdometro, VEHICULO_REPOSITORY],
      useFactory: (actualizar: ActualizarOdometro, vehiculos) =>
        new FleetOdometroAcl(actualizar, vehiculos),
    },

    {
      provide: RegistrarTanqueo,
      inject: [TANQUEO_REPOSITORY, ODOMETRO_VEHICULO_GATEWAY, FUEL_EVENT_PUBLISHER, ID_GENERATOR],
      useFactory: (tanqueos, odometro, publisher, ids) =>
        new RegistrarTanqueo({ tanqueos, odometro, publisher, ids } as FuelDeps),
    },
  ],
  exports: [RegistrarTanqueo, TANQUEO_REPOSITORY],
})
export class FuelManagementModule {}
