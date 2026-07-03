/**
 * driver-management.module.ts — wiring NestJS del módulo BC-3 (spec-004).
 *
 * Cablea adaptadores EN MEMORIA (verificable sin base de datos), con UNA colaboración
 * real entre contextos: el puerto `REGISTRADOR_LICENCIA` se cablea con la ACL real
 * (`LicenciaAcl`) sobre `RegistrarDocumento` de Compliance — la Licencia se materializa
 * como Documento del Conductor (spec-004 R5) y debe atravesarse de verdad.
 *
 * API PÚBLICA: exporta `RegistrarConductor` y el repositorio.
 */
import { Module, Scope } from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import { SystemClock, SequentialIdGenerator, TenantId } from "../../shared/kernel";
import { CLOCK, ID_GENERATOR } from "../../platform/tokens";
import { RequestTenantContext, Rol, TENANT_CONTEXT } from "../../platform/tenant-context";

import {
  CONDUCTOR_REPOSITORY,
  DRIVER_EVENT_PUBLISHER,
  REGISTRADOR_LICENCIA,
} from "./interface/tokens";
import { ConductoresController } from "./interface/conductores.controller";
import {
  InMemoryConductorRepository,
  InMemoryEventPublisher,
} from "./application/in-memory.adapters";
import { DriverDeps, RegistrarConductor } from "./application/use-cases";
import { LicenciaAcl } from "./infrastructure/licencia.acl";
import { RegistrarDocumento } from "../compliance-documents/application/use-cases";
import { ComplianceDocumentsModule } from "../compliance-documents/compliance-documents.module";

interface AuthedRequest {
  tenantId?: string;
  usuarioId?: string;
  roles?: Rol[];
}

const DEPS = [CONDUCTOR_REPOSITORY, DRIVER_EVENT_PUBLISHER, REGISTRADOR_LICENCIA, CLOCK, ID_GENERATOR];
const armar = (conductores: never, publisher: never, licencia: never, clock: never, ids: never): DriverDeps =>
  ({ conductores, publisher, licencia, clock, ids }) as unknown as DriverDeps;

@Module({
  imports: [ComplianceDocumentsModule],
  controllers: [ConductoresController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useFactory: () => new SequentialIdGenerator("cond") },
    {
      provide: TENANT_CONTEXT,
      scope: Scope.REQUEST,
      inject: [REQUEST],
      useFactory: (req: AuthedRequest) =>
        new RequestTenantContext(TenantId(req.tenantId ?? ""), req.usuarioId ?? "", req.roles ?? []),
    },

    { provide: CONDUCTOR_REPOSITORY, useClass: InMemoryConductorRepository },
    { provide: DRIVER_EVENT_PUBLISHER, useClass: InMemoryEventPublisher },

    // ACL real hacia Compliance (spec-004 R5): materializa la Licencia como Documento.
    {
      provide: REGISTRADOR_LICENCIA,
      inject: [RegistrarDocumento],
      useFactory: (registrar: RegistrarDocumento) => new LicenciaAcl(registrar),
    },

    { provide: RegistrarConductor, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new RegistrarConductor(armar(...a)) },
  ],
  exports: [RegistrarConductor, CONDUCTOR_REPOSITORY],
})
export class DriverManagementModule {}
