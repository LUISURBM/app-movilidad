/**
 * Adaptador SQL de las recuperaciones de contraseña (tabla 0012, pre-tenant sin
 * RLS — spec-015 regla 10). Mismo contrato que las invitaciones: un solo uso.
 */
import { DataSource } from "typeorm";
import { InvitacionPendiente, InvitacionRepository } from "../application/auth.ports";

export class SqlRecuperacionRepository implements InvitacionRepository {
  constructor(private readonly dataSource: DataSource) {}

  async guardar(r: InvitacionPendiente): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO recuperacion_pendiente (codigo_hash, tenant_id, usuario_id, expira_en)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (codigo_hash) DO NOTHING`,
      [r.codigoHash, r.tenantId, r.usuarioId, r.expiraEn],
    );
  }

  async consumir(codigoHash: string, ahora: Date): Promise<InvitacionPendiente | null> {
    const filas: Array<{ tenant_id: string; usuario_id: string; expira_en: string }> =
      await this.dataSource.query(
        `DELETE FROM recuperacion_pendiente WHERE codigo_hash = $1
         RETURNING tenant_id, usuario_id, expira_en::text AS expira_en`,
        [codigoHash],
      );
    const f = filas[0];
    if (!f) return null;
    if (new Date(f.expira_en).getTime() <= ahora.getTime()) return null;
    return { codigoHash, tenantId: f.tenant_id, usuarioId: f.usuario_id, expiraEn: f.expira_en };
  }
}
