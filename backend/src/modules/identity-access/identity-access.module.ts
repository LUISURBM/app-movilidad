/**
 * identity-access.module.ts — wiring NestJS del módulo BC-1 (spec-001 / spec-002).
 *
 * Cablea adaptadores EN MEMORIA (verificable sin base de datos). Para producción se
 * sustituyen por los de `infrastructure/` (SQL + RLS + outbox) sin tocar el dominio ni
 * los casos de uso. El onboarding `POST /tenants` es público (exento de auth en el
 * middleware); el resto usa el contexto de tenant del request.
 */
import { Module, Scope } from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import { SystemClock, SequentialIdGenerator, TenantId } from "../../shared/kernel";
import { CLOCK, ID_GENERATOR } from "../../platform/tokens";
import { RequestTenantContext, Rol, TENANT_CONTEXT } from "../../platform/tenant-context";

import {
  IDENTITY_EVENT_PUBLISHER,
  TENANT_REPOSITORY,
  USUARIO_REPOSITORY,
} from "./interface/tokens";
import { TenantsController } from "./interface/tenants.controller";
import { UsuariosController } from "./interface/usuarios.controller";
import {
  InMemoryEventPublisher,
  InMemoryTenantRepository,
  InMemoryUsuarioRepository,
} from "./application/in-memory.adapters";
import {
  AceptarInvitacion,
  ActualizarUsuario,
  ExpirarInvitacion,
  IdentityDeps,
  InvitarUsuario,
  RegistrarTenant,
} from "./application/use-cases";

interface AuthedRequest {
  tenantId?: string;
  usuarioId?: string;
  roles?: Rol[];
}

const DEPS = [TENANT_REPOSITORY, USUARIO_REPOSITORY, IDENTITY_EVENT_PUBLISHER, CLOCK, ID_GENERATOR];
const armar = (tenants: never, usuarios: never, publisher: never, clock: never, ids: never): IdentityDeps =>
  ({ tenants, usuarios, publisher, clock, ids }) as unknown as IdentityDeps;

@Module({
  controllers: [TenantsController, UsuariosController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useFactory: () => new SequentialIdGenerator("usr") },
    {
      provide: TENANT_CONTEXT,
      scope: Scope.REQUEST,
      inject: [REQUEST],
      useFactory: (req: AuthedRequest) =>
        new RequestTenantContext(TenantId(req.tenantId ?? ""), req.usuarioId ?? "", req.roles ?? []),
    },

    { provide: TENANT_REPOSITORY, useClass: InMemoryTenantRepository },
    { provide: USUARIO_REPOSITORY, useClass: InMemoryUsuarioRepository },
    { provide: IDENTITY_EVENT_PUBLISHER, useClass: InMemoryEventPublisher },

    { provide: RegistrarTenant, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new RegistrarTenant(armar(...a)) },
    { provide: InvitarUsuario, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new InvitarUsuario(armar(...a)) },
    { provide: AceptarInvitacion, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new AceptarInvitacion(armar(...a)) },
    { provide: ExpirarInvitacion, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new ExpirarInvitacion(armar(...a)) },
    { provide: ActualizarUsuario, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new ActualizarUsuario(armar(...a)) },
  ],
  exports: [RegistrarTenant, InvitarUsuario],
})
export class IdentityAccessModule {}
