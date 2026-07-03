/**
 * maintenance-management.module.ts — wiring NestJS del módulo BC-7 (spec-012).
 *
 * Cablea adaptadores EN MEMORIA. Expone los casos de uso para su cableado posterior:
 *  - `EvaluarUmbralPorOdometro`: se disparará con el evento `OdometroActualizado` (P6) —
 *    seam pendiente (vía outbox/ACL cuando se cablee el bus de eventos).
 *  - `EvaluarVencimientosPorFecha`: lo invocará el job diario de plataforma (P7) — como
 *    ya hace `DailyTenantJob` con Compliance.
 *  - `DefinirUmbral`/`RegistrarEjecucion`/`RegistrarCorrectivo`: para el controller REST
 *    cuando el contrato defina las rutas `/mantenimiento` (aún no existen en openapi.yaml).
 *
 * Por eso el módulo aún NO se importa en AppModule (sin REST ni disparadores cableados);
 * su dominio y aplicación quedan implementados y probados, listos para conectar.
 */
import { Module } from "@nestjs/common";
import { SystemClock, SequentialIdGenerator } from "../../shared/kernel";
import { CLOCK, ID_GENERATOR } from "../../platform/tokens";
import { MAINTENANCE_EVENT_PUBLISHER, UMBRAL_REPOSITORY } from "./interface/tokens";
import { InMemoryEventPublisher, InMemoryUmbralRepository } from "./application/in-memory.adapters";
import {
  DefinirUmbral,
  EvaluarUmbralPorOdometro,
  EvaluarVencimientosPorFecha,
  MaintenanceDeps,
  RegistrarCorrectivo,
  RegistrarEjecucion,
} from "./application/use-cases";

const DEPS = [UMBRAL_REPOSITORY, MAINTENANCE_EVENT_PUBLISHER, CLOCK, ID_GENERATOR];
const armar = (umbrales: never, publisher: never, clock: never, ids: never): MaintenanceDeps =>
  ({ umbrales, publisher, clock, ids }) as unknown as MaintenanceDeps;

@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useFactory: () => new SequentialIdGenerator("mnt") },
    { provide: UMBRAL_REPOSITORY, useClass: InMemoryUmbralRepository },
    { provide: MAINTENANCE_EVENT_PUBLISHER, useClass: InMemoryEventPublisher },

    { provide: DefinirUmbral, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new DefinirUmbral(armar(...a)) },
    { provide: EvaluarUmbralPorOdometro, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new EvaluarUmbralPorOdometro(armar(...a)) },
    { provide: EvaluarVencimientosPorFecha, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new EvaluarVencimientosPorFecha(armar(...a)) },
    { provide: RegistrarEjecucion, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new RegistrarEjecucion(armar(...a)) },
    { provide: RegistrarCorrectivo, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new RegistrarCorrectivo(armar(...a)) },
  ],
  exports: [DefinirUmbral, EvaluarUmbralPorOdometro, EvaluarVencimientosPorFecha, RegistrarEjecucion, RegistrarCorrectivo],
})
export class MaintenanceManagementModule {}
