/**
 * AppModule — composición raíz del monolito modular (ADR-0001).
 *
 * Une los bounded contexts y los workers de plataforma:
 *  - Compliance & Documents (specs 005/006/007)
 *  - Service Scheduling (specs 008/009), que consume el Semáforo vía ACL
 *  - Fleet/Driver/Identity/Fuel y Maintenance (spec-012: REST /mantenimiento,
 *    costura P6 a OdometroActualizado y job diario P7)
 *  - Plataforma: dispatcher del outbox (ADR-0004) y jobs diarios (vencimientos
 *    spec-006 R8; mantenimiento spec-012 P7), in-memory en esta variante dev.
 *
 * Autenticación: middleware DEV por headers (stand-in del guard JWT del epic E0).
 * El tenant SIEMPRE sale del contexto de auth, nunca del body (ADR-0008).
 */
import {
  Controller,
  Get,
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { TenantId } from "./shared/kernel";
import { ComplianceDocumentsModule } from "./modules/compliance-documents/compliance-documents.module";
import { ServiceSchedulingModule } from "./modules/service-scheduling/service-scheduling.module";
import { FleetManagementModule } from "./modules/fleet-management/fleet-management.module";
import { DriverManagementModule } from "./modules/driver-management/driver-management.module";
import { IdentityAccessModule } from "./modules/identity-access/identity-access.module";
import { MaintenanceManagementModule } from "./modules/maintenance-management/maintenance-management.module";
import { EvaluarVencimientos } from "./modules/compliance-documents/application/use-cases";
import { EvaluarVencimientosPorFecha } from "./modules/maintenance-management/application/use-cases";
import { devAuthMiddleware } from "./platform/dev-auth.middleware";
import {
  InMemoryOutboxStore,
  OutboxDispatcher,
} from "./platform/outbox";
import {
  ConsoleCanalNotificacion,
  InMemoryDirectorioContactos,
  NotificacionesSink,
} from "./platform/notificaciones";
import {
  DailyTenantJob,
  InMemoryTenantRegistry,
  TenantRegistry,
} from "./platform/daily-job";
import { SystemClock } from "./shared/kernel";

export const TENANT_REGISTRY = Symbol("TENANT_REGISTRY");
export const OUTBOX_DISPATCHER = Symbol("OUTBOX_DISPATCHER");
export const DAILY_COMPLIANCE_JOB = Symbol("DAILY_COMPLIANCE_JOB");
export const DAILY_MAINTENANCE_JOB = Symbol("DAILY_MAINTENANCE_JOB");

@Controller()
class HealthController {
  @Get("health")
  health(): { status: string } {
    return { status: "ok" };
  }
}

/** Arranca/detiene los workers con el ciclo de vida de la app. */
class PlatformWorkers implements OnApplicationBootstrap, OnApplicationShutdown {
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly dispatcher: OutboxDispatcher,
    private readonly dailyJobs: DailyTenantJob[],
    private readonly pollMs: number,
  ) {}

  onApplicationBootstrap(): void {
    for (const job of this.dailyJobs) job.start();
    this.pollTimer = setInterval(() => void this.dispatcher.despacharUnaVez(), this.pollMs);
    (this.pollTimer as { unref?: () => void }).unref?.();
  }

  onApplicationShutdown(): void {
    for (const job of this.dailyJobs) job.stop();
    if (this.pollTimer) clearInterval(this.pollTimer);
  }
}

@Module({
  imports: [
    ComplianceDocumentsModule,
    ServiceSchedulingModule,
    FleetManagementModule,
    DriverManagementModule,
    IdentityAccessModule,
    // BC-7 (spec-012): REST /mantenimiento + costura P6 (OdometroActualizado).
    MaintenanceManagementModule,
  ],
  controllers: [HealthController],
  providers: [
    // Tenants activos: in-memory desde env (el onboarding spec-001 traerá la fuente real).
    {
      provide: TENANT_REGISTRY,
      useFactory: (): TenantRegistry =>
        new InMemoryTenantRegistry(
          (process.env.FLEETSPECIAL_TENANTS ?? "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .map((t) => TenantId(t)),
        ),
    },
    // Dispatcher del outbox → sink de NOTIFICACIONES (spec-006 R4/R6, spec-009 P3).
    // Dev: directorio desde env FLEETSPECIAL_CONTACTOS ("tenant1:mail@x.co,tenant2:otro@y.co")
    // y canal consola. Producción: SqlOutboxStore + EmailCanal/SmsCanal, misma lógica.
    {
      provide: OUTBOX_DISPATCHER,
      useFactory: () => {
        const directorio = new InMemoryDirectorioContactos();
        for (const par of (process.env.FLEETSPECIAL_CONTACTOS ?? "").split(",")) {
          const [tenant, email] = par.split(":").map((s) => s.trim());
          if (tenant && email) directorio.agregar(tenant, { email });
        }
        const sink = new NotificacionesSink(directorio, new ConsoleCanalNotificacion());
        return new OutboxDispatcher(new InMemoryOutboxStore(), sink, new SystemClock());
      },
    },
    // Job diario del reloj de dominio (spec-006 R8): EvaluarVencimientos por tenant.
    {
      provide: DAILY_COMPLIANCE_JOB,
      inject: [TENANT_REGISTRY, EvaluarVencimientos],
      useFactory: (registry: TenantRegistry, evaluar: EvaluarVencimientos) =>
        new DailyTenantJob("evaluar-vencimientos", registry, (tenant) => evaluar.execute(tenant)),
    },
    // Job diario de mantenimiento (spec-012 P7): marca vencidos por fecha objetivo.
    {
      provide: DAILY_MAINTENANCE_JOB,
      inject: [TENANT_REGISTRY, EvaluarVencimientosPorFecha],
      useFactory: (registry: TenantRegistry, evaluar: EvaluarVencimientosPorFecha) =>
        new DailyTenantJob("evaluar-mantenimiento", registry, (tenant) => evaluar.execute(tenant)),
    },
    {
      provide: PlatformWorkers,
      inject: [OUTBOX_DISPATCHER, DAILY_COMPLIANCE_JOB, DAILY_MAINTENANCE_JOB],
      useFactory: (d: OutboxDispatcher, jc: DailyTenantJob, jm: DailyTenantJob) =>
        new PlatformWorkers(d, [jc, jm], Number(process.env.OUTBOX_POLL_MS ?? 5000)),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Stand-in DEV del guard JWT (bearerAuth del contrato). Ver dev-auth.middleware.ts.
    // (El propio middleware deja pasar /health sin autenticación.)
    consumer.apply(devAuthMiddleware).forRoutes("*");
  }
}

/** Marker para que Nest instancie los workers (inject por clase). */
export { PlatformWorkers };
