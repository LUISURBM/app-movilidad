/**
 * Casos de uso del contexto Compliance & Documents (CORE).
 * Orquestan el dominio y los puertos; sin dependencias de framework.
 * Cada caso traza a una spec (Fase 3).
 */
import { DateOnly, IdGenerator, Result, TenantId, ok, err, DomainError } from "../../../shared/kernel";
import { Clock } from "../../../shared/kernel";
import { Documento } from "../domain/documento.aggregate";
import { SujetoRef, TipoSujeto, Vencimiento } from "../domain/value-objects";
import {
  calcularSemaforo,
  requeridosPara,
  ResultadoCumplimiento,
} from "../domain/semaforo.service";
import {
  CatalogoTiposRepository,
  DocumentoRepository,
  EventPublisher,
} from "./ports";

export interface ComplianceDeps {
  documentos: DocumentoRepository;
  catalogo: CatalogoTiposRepository;
  publisher: EventPublisher;
  clock: Clock;
  ids: IdGenerator;
}

// ───────────────────────── spec-005: Registrar Documento ─────────────────────────

export interface RegistrarDocumentoInput {
  tenant: TenantId;
  sujeto: SujetoRef;
  tipoCodigo: string;
  emision: string; // YYYY-MM-DD
  vencimiento: string; // YYYY-MM-DD
  adjuntoRef?: string;
}

export class RegistrarDocumento {
  constructor(private readonly deps: ComplianceDeps) {}

  async execute(input: RegistrarDocumentoInput): Promise<Result<{ documentoId: string }>> {
    const { tenant } = input;

    const tipo = await this.deps.catalogo.findByCodigo(tenant, input.tipoCodigo);
    if (!tipo) {
      return err(new DomainError("tipo_documento_desconocido", `Tipo "${input.tipoCodigo}" no existe en el catálogo.`));
    }
    if (!tipo.activo) {
      return err(new DomainError("tipo_documento_inactivo", `Tipo "${input.tipoCodigo}" está desactivado.`));
    }

    // Invariante I2 (spec-005 R6): no duplicar Documento vigente del mismo Tipo para el sujeto.
    const yaExiste = await this.deps.documentos.existsVigenteDelTipo(tenant, input.sujeto, tipo.codigo);
    if (yaExiste) {
      return err(
        new DomainError(
          "documento_vigente_duplicado",
          `Ya existe un Documento "${tipo.codigo}" vigente para ${input.sujeto.toString()}; use Renovación (spec-007).`,
        ),
      );
    }

    const reg = Documento.registrar({
      id: this.deps.ids.next(),
      sujeto: input.sujeto,
      tipo,
      emision: DateOnly.parse(input.emision),
      vencimiento: Vencimiento.parse(input.vencimiento),
      adjuntoRef: input.adjuntoRef,
    });
    if (!reg.ok) return reg;

    const doc = reg.value;
    await this.deps.documentos.save(tenant, doc);
    await this.deps.publisher.publish(tenant, doc.pullEventos());
    return ok({ documentoId: doc.id });
  }
}

// ───────────────────────── spec-007: Renovar Documento ─────────────────────────

export interface RenovarDocumentoInput {
  tenant: TenantId;
  documentoId: string;
  nuevaEmision: string;
  nuevoVencimiento: string;
  adjuntoRef?: string;
}

export class RenovarDocumento {
  constructor(private readonly deps: ComplianceDeps) {}

  async execute(input: RenovarDocumentoInput): Promise<Result<{ version: number }>> {
    const { tenant } = input;
    const doc = await this.deps.documentos.findById(tenant, input.documentoId);
    if (!doc) {
      return err(new DomainError("documento_no_encontrado", "El Documento no existe en este Tenant."));
    }

    const r = doc.renovar({
      nuevaEmision: DateOnly.parse(input.nuevaEmision),
      nuevoVencimiento: Vencimiento.parse(input.nuevoVencimiento),
      adjuntoRef: input.adjuntoRef,
    });
    if (!r.ok) return r;

    await this.deps.documentos.save(tenant, doc);
    await this.deps.publisher.publish(tenant, doc.pullEventos());
    return ok({ version: doc.version });
  }
}

// ───────────────────────── spec-006: Consultar Semáforo ─────────────────────────

export class ConsultarSemaforo {
  constructor(private readonly deps: ComplianceDeps) {}

  async execute(tenant: TenantId, sujeto: SujetoRef): Promise<ResultadoCumplimiento> {
    const documentos = await this.deps.documentos.findVigentesBySujeto(tenant, sujeto);
    const requeridosCatalogo = await this.deps.catalogo.findRequeridos(tenant);
    const requeridos = requeridosPara(sujeto.tipo, requeridosCatalogo);
    return calcularSemaforo(sujeto, documentos, requeridos, this.deps.clock.today());
  }
}

// ───────────── spec-010 (sync "mi día"): Documentos vigentes de un sujeto ─────────────

/**
 * Query pública para composición entre módulos (p. ej. /sync/pull descarga los
 * Documentos del Vehículo asignado al Conductor). Solo lectura.
 */
export class ConsultarDocumentosVigentes {
  constructor(private readonly deps: ComplianceDeps) {}

  async execute(tenant: TenantId, sujeto: SujetoRef): Promise<Documento[]> {
    return this.deps.documentos.findVigentesBySujeto(tenant, sujeto);
  }
}

// ───────────────────────── spec-006: Evaluación diaria de Vencimientos ─────────────────────────

export interface ResumenEvaluacion {
  documentosEvaluados: number;
  eventosEmitidos: number;
}

export class EvaluarVencimientos {
  constructor(private readonly deps: ComplianceDeps) {}

  /**
   * Corre el "reloj de dominio" (spec-006 R8): evalúa todos los Documentos del Tenant,
   * acumula y publica las alertas (DocumentoPorVencer / DocumentoVencido).
   */
  async execute(tenant: TenantId): Promise<ResumenEvaluacion> {
    const hoy = this.deps.clock.today();
    const docs = await this.deps.documentos.findAll(tenant);
    let eventos = 0;

    for (const doc of docs) {
      doc.evaluar(hoy);
      const e = doc.pullEventos();
      if (e.length > 0) {
        await this.deps.publisher.publish(tenant, e);
        await this.deps.documentos.save(tenant, doc); // persistir el seguimiento de umbrales
        eventos += e.length;
      }
    }

    return { documentosEvaluados: docs.length, eventosEmitidos: eventos };
  }
}
