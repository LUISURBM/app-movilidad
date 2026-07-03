/**
 * compliance-documents.module.ts — wiring NestJS del módulo CORE.
 *
 * Esta variante cablea los **adaptadores en memoria** (verificable sin base de datos).
 * Para producción se sustituyen los providers de repos/publisher por los de
 * `infrastructure/` (TypeORM + Postgres + RLS + outbox) sin tocar controllers ni dominio
 * (Clean Architecture / inversión de dependencias).
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
  DOCUMENTO_REPOSITORY,
  CATALOGO_TIPOS_REPOSITORY,
  EVENT_PUBLISHER,
} from "./interface/tokens";
import { DocumentosController } from "./interface/documentos.controller";
import { CumplimientoController } from "./interface/cumplimiento.controller";
import { CatalogoController } from "./interface/catalogo.controller";
import {
  ActualizarTipoDocumento,
  AgregarTipoDocumento,
  ListarTiposDocumento,
} from "./application/catalogo.use-cases";

import {
  InMemoryDocumentoRepository,
  InMemoryCatalogoTiposRepository,
  InMemoryEventPublisher,
} from "./application/in-memory.adapters";
import {
  ComplianceDeps,
  ConsultarDocumentosVigentes,
  ConsultarSemaforo,
  EvaluarVencimientos,
  RegistrarDocumento,
  RenovarDocumento,
} from "./application/use-cases";

/** Forma mínima esperada del request tras el guard de autenticación. */
interface AuthedRequest {
  tenantId?: string;
  usuarioId?: string;
  roles?: Rol[];
}

@Module({
  controllers: [DocumentosController, CumplimientoController, CatalogoController],
  providers: [
    // Plataforma
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useFactory: () => new SequentialIdGenerator("doc") },

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
    { provide: DOCUMENTO_REPOSITORY, useClass: InMemoryDocumentoRepository },
    { provide: CATALOGO_TIPOS_REPOSITORY, useClass: InMemoryCatalogoTiposRepository },
    { provide: EVENT_PUBLISHER, useClass: InMemoryEventPublisher },

    // Casos de uso (se arman con los puertos + plataforma).
    {
      provide: RegistrarDocumento,
      inject: [DOCUMENTO_REPOSITORY, CATALOGO_TIPOS_REPOSITORY, EVENT_PUBLISHER, CLOCK, ID_GENERATOR],
      useFactory: (documentos, catalogo, publisher, clock, ids) =>
        new RegistrarDocumento({ documentos, catalogo, publisher, clock, ids } as ComplianceDeps),
    },
    {
      provide: RenovarDocumento,
      inject: [DOCUMENTO_REPOSITORY, CATALOGO_TIPOS_REPOSITORY, EVENT_PUBLISHER, CLOCK, ID_GENERATOR],
      useFactory: (documentos, catalogo, publisher, clock, ids) =>
        new RenovarDocumento({ documentos, catalogo, publisher, clock, ids } as ComplianceDeps),
    },
    {
      provide: ConsultarSemaforo,
      inject: [DOCUMENTO_REPOSITORY, CATALOGO_TIPOS_REPOSITORY, EVENT_PUBLISHER, CLOCK, ID_GENERATOR],
      useFactory: (documentos, catalogo, publisher, clock, ids) =>
        new ConsultarSemaforo({ documentos, catalogo, publisher, clock, ids } as ComplianceDeps),
    },
    {
      provide: EvaluarVencimientos,
      inject: [DOCUMENTO_REPOSITORY, CATALOGO_TIPOS_REPOSITORY, EVENT_PUBLISHER, CLOCK, ID_GENERATOR],
      useFactory: (documentos, catalogo, publisher, clock, ids) =>
        new EvaluarVencimientos({ documentos, catalogo, publisher, clock, ids } as ComplianceDeps),
    },
    {
      provide: ConsultarDocumentosVigentes,
      inject: [DOCUMENTO_REPOSITORY, CATALOGO_TIPOS_REPOSITORY, EVENT_PUBLISHER, CLOCK, ID_GENERATOR],
      useFactory: (documentos, catalogo, publisher, clock, ids) =>
        new ConsultarDocumentosVigentes({ documentos, catalogo, publisher, clock, ids } as ComplianceDeps),
    },

    // Catálogo de Tipos (spec-005 R2/R10) — solo dependen del repositorio.
    { provide: ListarTiposDocumento, inject: [CATALOGO_TIPOS_REPOSITORY], useFactory: (c) => new ListarTiposDocumento(c) },
    { provide: AgregarTipoDocumento, inject: [CATALOGO_TIPOS_REPOSITORY], useFactory: (c) => new AgregarTipoDocumento(c) },
    { provide: ActualizarTipoDocumento, inject: [CATALOGO_TIPOS_REPOSITORY], useFactory: (c) => new ActualizarTipoDocumento(c) },
  ],
  /**
   * API PÚBLICA del módulo hacia el resto del monolito:
   *  - `ConsultarSemaforo`: consumido por la ACL de Service Scheduling (spec-009 R2).
   *  - `EvaluarVencimientos`: consumido por el job diario de la plataforma (spec-006 R8).
   *  - `ConsultarDocumentosVigentes`: composición de /sync/pull, "mi día" (spec-010).
   * Nada más se exporta: los repos y el dominio son privados del bounded context.
   */
  exports: [ConsultarSemaforo, EvaluarVencimientos, ConsultarDocumentosVigentes, RegistrarDocumento],
})
export class ComplianceDocumentsModule {}
