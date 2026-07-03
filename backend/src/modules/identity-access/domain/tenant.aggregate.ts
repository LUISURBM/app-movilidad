/**
 * Agregado raíz `Tenant` (Empresa) del contexto Identity & Access (BC-1) — spec-001.
 *
 * El Tenant es la unidad de aislamiento (ADR-0008): todo dato posterior pertenece a
 * exactamente una Empresa. Se crea SOLO con consentimiento Habeas Data (R3) y nace con
 * una Suscripción en plan Free (R6). La unicidad del correo de registro (R7) es un
 * invariante de conjunto (repo + UNIQUE en base) sobre `correoRegistro`.
 */
import { DomainError, Result, ok, err } from "../../../shared/kernel";
import { Consentimiento, Correo, PlanSuscripcion } from "./value-objects";
import { DomainEvent, TenantCreado, nowIso } from "./events";

export class Tenant {
  private _eventos: DomainEvent[] = [];

  private constructor(
    public readonly id: string,
    public readonly razonSocial: string,
    public readonly nit: string | undefined,
    /** Correo con el que se registró la Empresa (el del primer Admin). Único global (R7). */
    public readonly correoRegistro: Correo,
    public readonly plan: PlanSuscripcion,
    public readonly consentimiento: Consentimiento,
    public readonly creadoEn: string,
  ) {}

  /**
   * Crea la Empresa. spec-001: exige razón social y consentimiento; nace en plan Free (R6).
   * `adminUsuarioId` es el primer Usuario Administrador (creado por el caso de uso).
   */
  static crear(params: {
    id: string;
    razonSocial: string;
    nit?: string;
    correoRegistro: Correo;
    consentimiento: Consentimiento;
    adminUsuarioId: string;
    plan?: PlanSuscripcion;
    creadoEn?: string;
  }): Result<Tenant> {
    const razonSocial = (params.razonSocial ?? "").trim();
    if (!razonSocial) {
      return err(new DomainError("razon_social_requerida", "La razón social de la Empresa es obligatoria."));
    }
    const nit = params.nit?.trim() || undefined;
    const plan = params.plan ?? PlanSuscripcion.Free;
    const creadoEn = params.creadoEn ?? nowIso();

    const t = new Tenant(params.id, razonSocial, nit, params.correoRegistro, plan, params.consentimiento, creadoEn);
    t._eventos.push(<TenantCreado>{
      tipo: "TenantCreado",
      ocurridoEn: nowIso(),
      tenantId: t.id,
      razonSocial,
      plan,
      adminUsuarioId: params.adminUsuarioId,
    });
    return ok(t);
  }

  static rehidratar(params: {
    id: string;
    razonSocial: string;
    nit?: string;
    correoRegistro: Correo;
    plan: PlanSuscripcion;
    consentimiento: Consentimiento;
    creadoEn: string;
  }): Tenant {
    return new Tenant(
      params.id,
      params.razonSocial,
      params.nit,
      params.correoRegistro,
      params.plan,
      params.consentimiento,
      params.creadoEn,
    );
  }

  pullEventos(): DomainEvent[] {
    const e = this._eventos;
    this._eventos = [];
    return e;
  }

  snapshot(): {
    id: string;
    razonSocial: string;
    nit?: string;
    correoRegistro: string;
    plan: string;
    consentimientoVersion: string;
    consentimientoEn: string;
    consentimientoTitular: string;
    creadoEn: string;
  } {
    return {
      id: this.id,
      razonSocial: this.razonSocial,
      nit: this.nit,
      correoRegistro: this.correoRegistro.valor,
      plan: this.plan,
      consentimientoVersion: this.consentimiento.version,
      consentimientoEn: this.consentimiento.aceptadoEn,
      consentimientoTitular: this.consentimiento.titular,
      creadoEn: this.creadoEn,
    };
  }
}
