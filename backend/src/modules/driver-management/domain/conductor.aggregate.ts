/**
 * Agregado raíz `Conductor` del contexto Driver Management (BC-3) — spec-004.
 *
 * El Conductor es sujeto de cumplimiento documental propio (BC-4). Su Licencia se
 * captura al alta y se materializa como Documento en Compliance (R5, en la capa de
 * aplicación vía ACL). La unicidad del documento de identidad por Tenant (R9) es un
 * invariante de conjunto: se garantiza en el repo y en la base (UNIQUE(tenant, documento)).
 */
import { DomainEvent, ConductorRegistrado, nowIso } from "./events";
import { DocumentoIdentidad, Licencia } from "./value-objects";

export class Conductor {
  private _eventos: DomainEvent[] = [];

  private constructor(
    public readonly id: string,
    public readonly nombre: string,
    public readonly documento: DocumentoIdentidad,
    public readonly licencia: Licencia,
    private _usuarioId: string | undefined,
  ) {}

  static registrar(params: {
    id: string;
    nombre: string;
    documento: DocumentoIdentidad;
    licencia: Licencia;
    usuarioId?: string;
  }): Conductor {
    const c = new Conductor(params.id, params.nombre, params.documento, params.licencia, params.usuarioId);
    c._eventos.push(<ConductorRegistrado>{
      tipo: "ConductorRegistrado",
      ocurridoEn: nowIso(),
      conductorId: c.id,
      usuarioId: params.usuarioId,
    });
    return c;
  }

  static rehidratar(params: {
    id: string;
    nombre: string;
    documento: DocumentoIdentidad;
    licencia: Licencia;
    usuarioId?: string;
  }): Conductor {
    return new Conductor(params.id, params.nombre, params.documento, params.licencia, params.usuarioId);
  }

  get usuarioId(): string | undefined {
    return this._usuarioId;
  }

  pullEventos(): DomainEvent[] {
    const e = this._eventos;
    this._eventos = [];
    return e;
  }
  peekEventos(): readonly DomainEvent[] {
    return this._eventos;
  }

  snapshot(): {
    id: string;
    nombre: string;
    documento: string;
    licenciaNumero: string;
    licenciaCategoria: string;
    licenciaVencimiento: string;
    usuarioId?: string;
  } {
    return {
      id: this.id,
      nombre: this.nombre,
      documento: this.documento.valor,
      licenciaNumero: this.licencia.numero,
      licenciaCategoria: this.licencia.categoria,
      licenciaVencimiento: this.licencia.vencimiento.toISO(),
      usuarioId: this._usuarioId,
    };
  }
}
