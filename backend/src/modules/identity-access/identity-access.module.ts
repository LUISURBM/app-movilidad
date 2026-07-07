/**
 * identity-access.module.ts — wiring NestJS del módulo BC-1 (spec-001 / spec-002 / spec-015).
 *
 * Cablea adaptadores EN MEMORIA para repos/eventos (verificable sin base de datos;
 * los SQL de `infrastructure/` los sustituyen en producción). Las piezas de
 * AUTENTICACIÓN (spec-015) usan implementaciones REALES sin dependencias:
 * scrypt de node:crypto y JWT HS256 de platform/jwt.ts (secreto por env).
 * `POST /tenants`, `/auth/login` y `/auth/aceptar-invitacion` son públicos
 * (exentos en dev-auth.middleware, `security: []` en el contrato).
 */
import { Module, Scope } from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import { SystemClock, SequentialIdGenerator, TenantId } from "../../shared/kernel";
import { CLOCK, ID_GENERATOR } from "../../platform/tokens";
import { RequestTenantContext, Rol, TENANT_CONTEXT } from "../../platform/tenant-context";

import {
  CREDENCIAL_REPOSITORY,
  EMISOR_TOKENS,
  GENERADOR_CODIGOS,
  HASHER_PASSWORD,
  IDENTITY_EVENT_PUBLISHER,
  INVITACION_REPOSITORY,
  RECUPERACION_REPOSITORY,
  TENANT_REPOSITORY,
  USUARIO_REPOSITORY,
} from "./interface/tokens";
import { TenantsController } from "./interface/tenants.controller";
import { UsuariosController } from "./interface/usuarios.controller";
import { AuthController } from "./interface/auth.controller";
import {
  InMemoryEventPublisher,
  InMemoryTenantRepository,
  InMemoryUsuarioRepository,
} from "./application/in-memory.adapters";
import {
  InMemoryCredencialRepository,
  InMemoryInvitacionRepository,
} from "./application/auth.in-memory";
import {
  EmisorTokensJwt,
  GeneradorCodigosAleatorio,
  ScryptHasher,
} from "./infrastructure/auth-adapters";
import {
  AceptarInvitacion,
  ActualizarUsuario,
  ExpirarInvitacion,
  IdentityDeps,
  InvitarUsuario,
  RegistrarTenant,
} from "./application/use-cases";
import {
  AceptarInvitacionConCodigo,
  AuthDeps,
  CambiarPassword,
  IniciarSesion,
} from "./application/auth.use-cases";
import {
  RecuperacionDeps,
  RestablecerPassword,
  SolicitarRecuperacion,
} from "./application/recuperacion.use-cases";
import { SqlRecuperacionRepository } from "./infrastructure/recuperacion.sql-adapter";
import {
  ConsoleCanalNotificacion,
} from "../../platform/notificaciones";
import { smtpCanalDesdeEnv } from "../../platform/notificaciones.infra";
import { DataSource } from "typeorm";
import { DATA_SOURCE, elegirAdaptador } from "../../platform/persistencia";
import {
  SqlIdentityEventPublisher,
  SqlTenantRepository,
  SqlUsuarioRepository,
} from "./infrastructure/sql-adapters";
import {
  SqlCredencialRepository,
  SqlInvitacionRepository,
} from "./infrastructure/auth.sql-adapters";

interface AuthedRequest {
  tenantId?: string;
  usuarioId?: string;
  roles?: Rol[];
}

const DEPS = [
  TENANT_REPOSITORY,
  USUARIO_REPOSITORY,
  IDENTITY_EVENT_PUBLISHER,
  CLOCK,
  ID_GENERATOR,
  CREDENCIAL_REPOSITORY,
  INVITACION_REPOSITORY,
  HASHER_PASSWORD,
  GENERADOR_CODIGOS,
];
const armar = (
  tenants: never,
  usuarios: never,
  publisher: never,
  clock: never,
  ids: never,
  credenciales: never,
  invitaciones: never,
  hasher: never,
  codigos: never,
): IdentityDeps =>
  ({
    tenants,
    usuarios,
    publisher,
    clock,
    ids,
    auth: { credenciales, invitaciones, hasher, codigos },
  }) as unknown as IdentityDeps;

const AUTH_DEPS = [
  CREDENCIAL_REPOSITORY,
  INVITACION_REPOSITORY,
  USUARIO_REPOSITORY,
  TENANT_REPOSITORY,
  HASHER_PASSWORD,
  EMISOR_TOKENS,
  CLOCK,
];
const armarAuth = (
  credenciales: never,
  invitaciones: never,
  usuarios: never,
  tenants: never,
  hasher: never,
  emisor: never,
  clock: never,
): AuthDeps =>
  ({ credenciales, invitaciones, usuarios, tenants, hasher, emisor, clock }) as unknown as AuthDeps;

@Module({
  controllers: [TenantsController, UsuariosController, AuthController],
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

    // Persistencia conmutable (E0): postgres → SQL (migraciones 0007/0010); memoria → in-memory.
    {
      provide: TENANT_REPOSITORY,
      inject: [DATA_SOURCE],
      useFactory: (ds: DataSource | null) =>
        elegirAdaptador(ds, (d) => new SqlTenantRepository(d), () => new InMemoryTenantRepository()),
    },
    {
      provide: USUARIO_REPOSITORY,
      inject: [DATA_SOURCE],
      useFactory: (ds: DataSource | null) =>
        elegirAdaptador(ds, (d) => new SqlUsuarioRepository(d), () => new InMemoryUsuarioRepository()),
    },
    {
      provide: IDENTITY_EVENT_PUBLISHER,
      inject: [DATA_SOURCE],
      useFactory: (ds: DataSource | null) =>
        elegirAdaptador(ds, (d) => new SqlIdentityEventPublisher(d), () => new InMemoryEventPublisher()),
    },

    // spec-015: hasher scrypt y emisor JWT son implementaciones reales sin dependencias.
    {
      provide: CREDENCIAL_REPOSITORY,
      inject: [DATA_SOURCE],
      useFactory: (ds: DataSource | null) =>
        elegirAdaptador(ds, (d) => new SqlCredencialRepository(d), () => new InMemoryCredencialRepository()),
    },
    {
      provide: INVITACION_REPOSITORY,
      inject: [DATA_SOURCE],
      useFactory: (ds: DataSource | null) =>
        elegirAdaptador(ds, (d) => new SqlInvitacionRepository(d), () => new InMemoryInvitacionRepository()),
    },
    { provide: HASHER_PASSWORD, useClass: ScryptHasher },
    { provide: EMISOR_TOKENS, useFactory: () => new EmisorTokensJwt() },
    { provide: GENERADOR_CODIGOS, useClass: GeneradorCodigosAleatorio },

    { provide: RegistrarTenant, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new RegistrarTenant(armar(...a)) },
    { provide: InvitarUsuario, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new InvitarUsuario(armar(...a)) },
    { provide: AceptarInvitacion, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new AceptarInvitacion(armar(...a)) },
    { provide: ExpirarInvitacion, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new ExpirarInvitacion(armar(...a)) },
    { provide: ActualizarUsuario, inject: DEPS, useFactory: (...a: Parameters<typeof armar>) => new ActualizarUsuario(armar(...a)) },

    { provide: IniciarSesion, inject: AUTH_DEPS, useFactory: (...a: Parameters<typeof armarAuth>) => new IniciarSesion(armarAuth(...a)) },
    { provide: AceptarInvitacionConCodigo, inject: AUTH_DEPS, useFactory: (...a: Parameters<typeof armarAuth>) => new AceptarInvitacionConCodigo(armarAuth(...a)) },
    { provide: CambiarPassword, inject: AUTH_DEPS, useFactory: (...a: Parameters<typeof armarAuth>) => new CambiarPassword(armarAuth(...a)) },

    // Recuperación de contraseña (spec-015, sección recuperación): código por
    // email (SMTP real si está configurado; consola en dev). Tabla 0012 en
    // postgres, in-memory (misma clase de invitaciones, instancia aparte) en dev.
    { provide: RECUPERACION_REPOSITORY,
      inject: [DATA_SOURCE],
      useFactory: (ds: DataSource | null) =>
        elegirAdaptador(ds, (d) => new SqlRecuperacionRepository(d), () => new InMemoryInvitacionRepository()),
    },
    {
      provide: SolicitarRecuperacion,
      inject: [CREDENCIAL_REPOSITORY, RECUPERACION_REPOSITORY, USUARIO_REPOSITORY, HASHER_PASSWORD, GENERADOR_CODIGOS, CLOCK],
      useFactory: (credenciales, recuperaciones, usuarios, hasher, codigos, clock) =>
        new SolicitarRecuperacion({
          credenciales, recuperaciones, usuarios, hasher, codigos, clock,
          canal: smtpCanalDesdeEnv() ?? new ConsoleCanalNotificacion(),
        } as unknown as RecuperacionDeps),
    },
    {
      provide: RestablecerPassword,
      inject: [CREDENCIAL_REPOSITORY, RECUPERACION_REPOSITORY, USUARIO_REPOSITORY, HASHER_PASSWORD, GENERADOR_CODIGOS, CLOCK],
      useFactory: (credenciales, recuperaciones, usuarios, hasher, codigos, clock) =>
        new RestablecerPassword({
          credenciales, recuperaciones, usuarios, hasher, codigos, clock,
          canal: new ConsoleCanalNotificacion(), // restablecer no envía correo
        } as unknown as RecuperacionDeps),
    },
  ],
  exports: [RegistrarTenant, InvitarUsuario],
})
export class IdentityAccessModule {}
