/**
 * service-scheduling.module.ts — wiring NestJS del módulo CORE.
 *
 * Igual que en Compliance, esta variante cablea los **adaptadores en memoria**
 * (verificable sin base de datos), con UNA diferencia deliberada: el puerto
 * `CUMPLIMIENTO_GATEWAY` se cablea con la **ACL real** (`ComplianceAcl`) sobre el
 * caso de uso `ConsultarSemaforo` de Compliance — la regla de oro (spec-009) es
 * la colaboración entre los dos CORE y debe atravesarse de verdad.
 *
 * Para producción se sustituyen los providers de repo/publisher por los de
 * `infrastructure/` (TypeORM + Postgres + RLS + outbox) sin tocar controllers
 * ni dominio (inversión de dependencias).
 */
import { Module, Scope } from "@nestjs/common";
import { REQUEST } from "@nestjs/core";

import { SystemClock, SequentialIdGenerator, TenantId } from "../../shared/kernel";
import { CLOCK, ID_GENERATOR } from "../../platform/tokens";
import {
  RequestTenantContext,
  Rol,
  TENANT_CONTEXT,
} from "../../platform/tenant-context";

import {
  BITACORA_SYNC,
  CUMPLIMIENTO_GATEWAY,
  IDEMPOTENCY_STORE,
  SCHEDULING_EVENT_PUBLISHER,
  SERVICIO_REPOSITORY,
  TANQUEO_REGISTRADOR,
} from "./interface/tokens";
import { ServiciosController } from "./interface/servicios.controller";
import { SyncController } from "./interface/sync.controller";

import {
  InMemoryBitacoraSync,
  InMemoryEventPublisher,
  InMemoryIdempotencyStore,
  InMemoryServicioRepository,
} from "./application/in-memory.adapters";
import {
  AsignarServicio,
  CambiarEstadoServicio,
  ConsultarMiDia,
  CrearServicio,
  SchedulingDeps,
  SincronizarCambios,
} from "./application/use-cases";
import { ComplianceAcl } from "./infrastructure/compliance.acl";
import { ConsultarSemaforo } from "../compliance-documents/application/use-cases";
import { ComplianceDocumentsModule } from "../compliance-documents/compliance-documents.module";
import { TanqueoAcl } from "./infrastructure/tanqueo.acl";
import { RegistrarTanqueo } from "../fuel-management/application/use-cases";
import { FuelManagementModule } from "../fuel-management/fuel-management.module";

/** Forma mínima esperada del request tras el guard de autenticación. */
interface AuthedRequest {
  tenantId?: string;
  usuarioId?: string;
  roles?: Rol[];
}

const DEPS = [
  SERVICIO_REPOSITORY,
  CUMPLIMIENTO_GATEWAY,
  SCHEDULING_EVENT_PUBLISHER,
  IDEMPOTENCY_STORE,
  BITACORA_SYNC,
  TANQUEO_REGISTRADOR,
  CLOCK,
  ID_GENERATOR,
];
const armar = (servicios: never, cumplimiento: never, publisher: never, idempotencia: never, bitacora: never, tanqueo: never, clock: never, ids: never): SchedulingDeps =>
  ({ servicios, cumplimiento, publisher, idempotencia, bitacora, tanqueo, clock, ids }) as unknown as SchedulingDeps;

@Module({
  // Dependencias entre bounded contexts: SOLO la API pública de otros CORE —
  // ACL de la regla de oro (spec-009 R2), composición de /sync/pull (spec-010) y
  // registro de Tanqueos del lote offline vía Fuel (spec-011).
  imports: [ComplianceDocumentsModule, FuelManagementModule],
  controllers: [ServiciosController, SyncController],
  providers: [
    // Plataforma
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useFactory: () => new SequentialIdGenerator("srv") },

    // Contexto de tenant por request (derivado del JWT por el guard de auth).
    {
      provide: TENANT_CONTEXT,
      scope: Scope.REQUEST,
      inject: [REQUEST],
      useFactory: (req: AuthedRequest) =>
        new RequestTenantContext(
          TenantId(req.tenantId ?? ""),
          req.usuarioId ?? "",
          req.roles ?? [],
        ),
    },

    // Puertos -> adaptadores (EN MEMORIA; sustituir por infrastructure en prod).
    { provide: SERVICIO_REPOSITORY, useClass: InMemoryServicioRepository },
    { provide: SCHEDULING_EVENT_PUBLISHER, useClass: InMemoryEventPublisher },
    { provide: IDEMPOTENCY_STORE, useClass: InMemoryIdempotencyStore },
    { provide: BITACORA_SYNC, useClass: InMemoryBitacoraSync },

    // ACL real hacia Compliance (spec-009 R2). `ConsultarSemaforo` la provee el
    // módulo raíz de la app (AppModule) al importar ambos módulos; aquí se declara
    // la dependencia explícita del caso de uso público de Compliance.
    {
      provide: CUMPLIMIENTO_GATEWAY,
      inject: [ConsultarSemaforo],
      useFactory: (consultar: ConsultarSemaforo) => new ComplianceAcl(consultar),
    },

    // ACL real hacia Fuel (spec-011): resuelve `entidad: "tanqueo"` del lote offline.
    // `RegistrarTanqueo` lo provee FuelManagementModule (importado arriba).
    {
      provide: TANQUEO_REGISTRADOR,
      inject: [RegistrarTanqueo],
      useFactory: (registrar: RegistrarTanqueo) => new TanqueoAcl(registrar),
    },

    // Casos de uso (se arman con los puertos + plataforma).
    { provide: CrearServicio, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new CrearServicio(armar(...a)) },
    { provide: AsignarServicio, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new AsignarServicio(armar(...a)) },
    { provide: CambiarEstadoServicio, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new CambiarEstadoServicio(armar(...a)) },
    { provide: SincronizarCambios, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new SincronizarCambios(armar(...a)) },
    { provide: ConsultarMiDia, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new ConsultarMiDia(armar(...a)) },
  ],
})
export class ServiceSchedulingModule {}
