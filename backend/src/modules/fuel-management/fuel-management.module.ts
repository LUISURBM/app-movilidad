/**
 * fuel-management.module.ts — wiring NestJS del módulo BC-6 (spec-011).
 *
 * Igual que Compliance y Scheduling, cablea los **adaptadores en memoria** (verificable
 * sin base de datos). Para producción se sustituyen los providers de repo/publisher/
 * odómetro por los de `infrastructure/` (SQL + Postgres + RLS + outbox) sin tocar el
 * dominio ni los casos de uso (inversión de dependencias).
 *
 * API PÚBLICA: exporta `RegistrarTanqueo`, consumido por la ACL de Service Scheduling
 * para resolver los cambios `entidad: "tanqueo"` del lote offline (spec-010 + spec-011).
 * Expone además el endpoint REST online `POST/GET /combustible` del contrato.
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
  InMemoryOdometroVehiculo,
  InMemoryTanqueoRepository,
} from "./application/in-memory.adapters";
import { FuelDeps, RegistrarTanqueo } from "./application/use-cases";

/** Forma mínima esperada del request tras el guard de autenticación. */
interface AuthedRequest {
  tenantId?: string;
  usuarioId?: string;
  roles?: Rol[];
}

@Module({
  controllers: [CombustibleController],
  providers: [
    { provide: ID_GENERATOR, useFactory: () => new SequentialIdGenerator("tanq") },

    // Contexto de tenant por request (derivado del JWT por el guard de auth).
    {
      provide: TENANT_CONTEXT,
      scope: Scope.REQUEST,
      inject: [REQUEST],
      useFactory: (req: AuthedRequest) =>
        new RequestTenantContext(TenantId(req.tenantId ?? ""), req.usuarioId ?? "", req.roles ?? []),
    },

    // Puertos -> adaptadores (EN MEMORIA; sustituir por infrastructure en prod).
    { provide: TANQUEO_REPOSITORY, useClass: InMemoryTanqueoRepository },
    { provide: ODOMETRO_VEHICULO_GATEWAY, useClass: InMemoryOdometroVehiculo },
    { provide: FUEL_EVENT_PUBLISHER, useClass: InMemoryEventPublisher },

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
