/**
 * Ámbitos de sesión SQL para RLS (E1, cierra la deuda anotada en DESPLIEGUE.md):
 * con un rol SIN BYPASSRLS, ninguna fila cruza tenants aunque el código tenga un
 * bug — las políticas de las migraciones lo garantizan en la base.
 *
 *  - `enTenant(ds, tenant, work)`: transacción con `SET LOCAL app.current_tenant`.
 *    TODO acceso de los adaptadores a tablas con RLS pasa por aquí (además del
 *    filtro explícito por tenant_id: defensa en profundidad).
 *  - `comoPlataforma(ds, work)`: transacción con `SET LOCAL app.rol='plataforma'`
 *    para los workers transversales (dispatcher del outbox), habilitada por la
 *    política de la migración 0011. No expone datos de negocio: solo el outbox.
 *
 * `SET LOCAL` muere con la transacción: no hay fugas entre requests que reusan
 * conexiones del pool. Bonus: cada método de adaptador queda ATÓMICO.
 */
import { DataSource, EntityManager } from "typeorm";
import { TenantId } from "../shared/kernel";

export async function enTenant<T>(
  dataSource: DataSource,
  tenant: TenantId | string,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return dataSource.transaction(async (manager) => {
    await manager.query("SELECT set_config('app.current_tenant', $1, true)", [String(tenant)]);
    return work(manager);
  });
}

/**
 * Azúcar para adaptadores de SQL crudo: `q(ds, tenant).query(sql, params)` —
 * cada llamada corre en su transacción con el tenant fijado (reemplazo directo
 * de `ds.query`, mismo shape de retorno).
 */
export function q(
  dataSource: DataSource,
  tenant: TenantId | string,
): { query: (sql: string, params?: unknown[]) => Promise<any> } {
  return {
    query: (sql, params) => enTenant(dataSource, tenant, (m) => m.query(sql, params)),
  };
}

/** Azúcar equivalente para los workers de plataforma (outbox). */
export function qPlataforma(
  dataSource: DataSource,
): { query: (sql: string, params?: unknown[]) => Promise<any> } {
  return {
    query: (sql, params) => comoPlataforma(dataSource, (m) => m.query(sql, params)),
  };
}

export async function comoPlataforma<T>(
  dataSource: DataSource,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return dataSource.transaction(async (manager) => {
    await manager.query("SELECT set_config('app.rol', 'plataforma', true)");
    return work(manager);
  });
}
