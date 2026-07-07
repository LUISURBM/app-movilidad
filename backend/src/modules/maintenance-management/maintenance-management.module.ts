/**
 * maintenance-management.module.ts — wiring NestJS del módulo BC-7 (spec-012).
 *
 * Cablea adaptadores EN MEMORIA (como los demás módulos; los SQL de
 * `infrastructure/` los sustituyen en producción sin tocar dominio ni casos de uso).
 *
 * Costuras CERRADAS (antes pendientes):
 *  - P6: importa FleetManagementModule y se SUSCRIBE a `OdometroActualizado` vía
 *    `CosturaOdometroMantenimiento` → `EvaluarUmbralPorOdometro` (idempotente R8).
 *  - REST: `MantenimientoController` conforme a las rutas `/mantenimiento` del contrato.
 *  - P7: `EvaluarVencimientosPorFecha` queda exportado; el `DailyTenantJob` de
 *    plataforma lo invoca por tenant (wiring en AppModule, como con Compliance).
 */
import { Module, Scope } from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import { SystemClock, SequentialIdGenerator, TenantId } from "../../shared/kernel";
import { CLOCK, ID_GENERATOR } from "../../platform/tokens";
import { RequestTenantContext, Rol, TENANT_CONTEXT } from "../../platform/tenant-context";
import { FleetManagementModule } from "../fleet-management/fleet-management.module";
import { FLEET_EVENT_PUBLISHER } from "../fleet-management/interface/tokens";
import { PublicadorSuscribible } from "../fleet-management/application/ports";
import { MAINTENANCE_EVENT_PUBLISHER, UMBRAL_REPOSITORY } from "./interface/tokens";
import { MantenimientoController } from "./interface/mantenimiento.controller";
import { InMemoryEventPublisher, InMemoryUmbralRepository } from "./application/in-memory.adapters";
import { CosturaOdometroMantenimiento } from "./infrastructure/costura-odometro";
import { DataSource } from "typeorm";
import { DATA_SOURCE, elegirAdaptador } from "../../platform/persistencia";
import { SqlMaintenanceEventPublisher, SqlUmbralRepository } from "./infrastructure/sql-adapters";
import {
  DefinirUmbral,
  EvaluarUmbralPorOdometro,
  EvaluarVencimientosPorFecha,
  MaintenanceDeps,
  RegistrarCorrectivo,
  RegistrarEjecucion,
} from "./application/use-cases";

interface AuthedRequest {
  tenantId?: string;
  usuarioId?: string;
  roles?: Rol[];
}

const DEPS = [UMBRAL_REPOSITORY, MAINTENANCE_EVENT_PUBLISHER, CLOCK, ID_GENERATOR];
const armar = (umbrales: never, publisher: never, clock: never, ids: never): MaintenanceDeps =>
  ({ umbrales, publisher, clock, ids }) as unknown as MaintenanceDeps;

@Module({
  imports: [FleetManagementModule],
  controllers: [MantenimientoController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useFactory: () => new SequentialIdGenerator("mnt") },
    // Persistencia conmutable (E0): postgres → SQL; memoria → in-memory.
    {
      provide: UMBRAL_REPOSITORY,
      inject: [DATA_SOURCE],
      useFactory: (ds: DataSource | null) =>
        elegirAdaptador(ds, (d) => new SqlUmbralRepository(d), () => new InMemoryUmbralRepository()),
    },
    {
      provide: MAINTENANCE_EVENT_PUBLISHER,
      inject: [DATA_SOURCE],
      useFactory: (ds: DataSource | null) =>
        elegirAdaptador(ds, (d) => new SqlMaintenanceEventPublisher(d), () => new InMemoryEventPublisher()),
    },
    {
      provide: TENANT_CONTEXT,
      scope: Scope.REQUEST,
      inject: [REQUEST],
      useFactory: (req: AuthedRequest) =>
        new RequestTenantContext(TenantId(req.tenantId ?? ""), req.usuarioId ?? "", req.roles ?? []),
    },

    { provide: DefinirUmbral, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new DefinirUmbral(armar(...a)) },
    { provide: EvaluarUmbralPorOdometro, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new EvaluarUmbralPorOdometro(armar(...a)) },
    { provide: EvaluarVencimientosPorFecha, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new EvaluarVencimientosPorFecha(armar(...a)) },
    { provide: RegistrarEjecucion, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new RegistrarEjecucion(armar(...a)) },
    { provide: RegistrarCorrectivo, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new RegistrarCorrectivo(armar(...a)) },

    // Costura P6: al iniciar el módulo, Maintenance queda escuchando OdometroActualizado.
    // (Nest instancia los providers del módulo en el bootstrap; no requiere inyección externa.)
    {
      provide: CosturaOdometroMantenimiento,
      inject: [FLEET_EVENT_PUBLISHER, EvaluarUmbralPorOdometro],
      useFactory: (publicador: PublicadorSuscribible, evaluar: EvaluarUmbralPorOdometro) =>
        new CosturaOdometroMantenimiento(publicador, evaluar),
    },
  ],
  exports: [DefinirUmbral, EvaluarUmbralPorOdometro, EvaluarVencimientosPorFecha, RegistrarEjecucion, RegistrarCorrectivo],
})
export class MaintenanceManagementModule {}
