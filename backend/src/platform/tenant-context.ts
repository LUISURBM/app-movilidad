/**
 * Contexto de tenant por request (multi-tenant, ADR-0008).
 *
 * El `tenant_id` SIEMPRE se deriva del JWT (claim), nunca del body/query (regla del
 * contrato openapi.yaml). Esta interfaz abstrae "el tenant y roles del request actual"
 * para que los controllers no dependan de cómo se obtiene (Passport, header, etc.).
 *
 * En la capa infrastructure, el valor concreto se fija por request (AsyncLocalStorage o
 * request-scoped provider) y además se usa para hacer `SET LOCAL app.current_tenant`
 * en la conexión de base, activando Row Level Security.
 */
import { TenantId } from "../shared/kernel";

export type Rol =
  | "Administrador"
  | "Operador"
  | "GestorPlanilla"
  | "RepresentanteLegal"
  | "DuenoVehiculo"
  | "Conductor";

export interface TenantContext {
  readonly tenantId: TenantId;
  readonly usuarioId: string;
  readonly roles: readonly Rol[];
  has(rol: Rol): boolean;
}

export class RequestTenantContext implements TenantContext {
  constructor(
    public readonly tenantId: TenantId,
    public readonly usuarioId: string,
    public readonly roles: readonly Rol[],
  ) {}
  has(rol: Rol): boolean {
    return this.roles.includes(rol);
  }
}

/** Token de inyección para el contexto de tenant (NestJS). */
export const TENANT_CONTEXT = Symbol("TENANT_CONTEXT");
