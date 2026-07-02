/**
 * Helper de aislamiento por tenant a nivel de conexión (ADR-0008).
 *
 * Ejecuta el trabajo dentro de una transacción con `SET LOCAL app.current_tenant`,
 * de modo que las políticas RLS de la base filtren automáticamente por ese tenant.
 * `SET LOCAL` dura solo la transacción, evitando fugas entre requests que reusan conexión.
 */
import { DataSource, EntityManager } from "typeorm";
import { TenantId } from "../../../shared/kernel";

export async function runInTenant<T>(
  dataSource: DataSource,
  tenant: TenantId,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return dataSource.transaction(async (manager) => {
    // set_config(setting, value, is_local=true) → equivalente a SET LOCAL.
    await manager.query("SELECT set_config('app.current_tenant', $1, true)", [tenant]);
    return work(manager);
  });
}
