/**
 * Casos de uso del contexto Driver Management (BC-3) — spec-004.
 */
import { Clock, DomainError, IdGenerator, Result, TenantId, err, ok } from "../../../shared/kernel";
import { Conductor } from "../domain/conductor.aggregate";
import { DocumentoIdentidad, Licencia } from "../domain/value-objects";
import { ConductorRepository, EventPublisher, RegistradorLicencia } from "./ports";

export interface DriverDeps {
  conductores: ConductorRepository;
  publisher: EventPublisher;
  /** ACL hacia Compliance para materializar la Licencia como Documento (R5). */
  licencia: RegistradorLicencia;
  clock: Clock;
  ids: IdGenerator;
}

export interface RegistrarConductorInput {
  tenant: TenantId;
  nombre: string;
  documentoIdentidad: string;
  usuarioId?: string;
  licencia: { numero: string; categoria: string; vencimiento: string };
}

export class RegistrarConductor {
  constructor(private readonly deps: DriverDeps) {}

  async execute(input: RegistrarConductorInput): Promise<Result<{ conductorId: string }>> {
    // VOs (falla cerrado ante datos inválidos: documento, licencia, fecha).
    let documento: DocumentoIdentidad;
    let licencia: Licencia;
    try {
      if (!input.nombre || !input.nombre.trim()) {
        return err(new DomainError("nombre_requerido", "El nombre del Conductor es obligatorio."));
      }
      documento = DocumentoIdentidad.de(input.documentoIdentidad);
      licencia = Licencia.de(input.licencia);
    } catch (e) {
      if (e instanceof DomainError) return err(e);
      throw e;
    }

    // R9: documento de identidad único por Tenant.
    const existente = await this.deps.conductores.findByDocumento(input.tenant, documento.valor);
    if (existente) {
      return err(
        new DomainError(
          "documento_duplicado",
          `Ya existe un Conductor con el documento ${documento.valor} en la Empresa.`,
        ),
      );
    }

    const id = this.deps.ids.next();

    // R5: materializar la Licencia como Documento del Conductor en BC-4 (vía ACL).
    // La emisión no la captura el contrato; se usa hoy (o el vencimiento si ya pasó) para
    // respetar la invariante vencimiento >= emisión de Compliance. No afecta el Semáforo,
    // que depende solo del vencimiento.
    const hoy = this.deps.clock.today();
    const emision = licencia.vencimiento.isBefore(hoy) ? licencia.vencimiento : hoy;
    const rLic = await this.deps.licencia.registrar(
      input.tenant,
      id,
      emision.toISO(),
      licencia.vencimiento.toISO(),
    );
    if (!rLic.ok) return rLic;

    const conductor = Conductor.registrar({
      id,
      nombre: input.nombre.trim(),
      documento,
      licencia,
      usuarioId: input.usuarioId,
    });
    await this.deps.conductores.save(input.tenant, conductor);
    await this.deps.publisher.publish(input.tenant, conductor.pullEventos());
    return ok({ conductorId: id });
  }
}
