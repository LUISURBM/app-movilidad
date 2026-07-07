/**
 * Adaptadores SQL (producción) de los puertos de autenticación (spec-015):
 * tablas `credencial_acceso` e `invitacion_pendiente` de la migración 0010,
 * SIN RLS a propósito (pre-tenant, regla 10 de la spec). SQL parametrizado.
 */
import { DataSource } from "typeorm";
import {
  Credencial,
  CredencialRepository,
  InvitacionPendiente,
  InvitacionRepository,
} from "../application/auth.ports";

interface FilaCredencial {
  tenant_id: string;
  usuario_id: string;
  correo: string;
  password_hash: string;
}

export class SqlCredencialRepository implements CredencialRepository {
  constructor(private readonly dataSource: DataSource) {}

  async guardar(c: Credencial): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO credencial_acceso (tenant_id, usuario_id, correo, password_hash)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, usuario_id) DO UPDATE SET
         correo = EXCLUDED.correo,
         password_hash = EXCLUDED.password_hash,
         actualizado_en = now()`,
      [c.tenantId, c.usuarioId, c.correo, c.passwordHash],
    );
  }

  async buscarPorCorreo(correo: string): Promise<Credencial[]> {
    const filas: FilaCredencial[] = await this.dataSource.query(
      `SELECT tenant_id, usuario_id, correo, password_hash
         FROM credencial_acceso WHERE correo = $1`,
      [correo],
    );
    return filas.map((f) => ({
      tenantId: f.tenant_id,
      usuarioId: f.usuario_id,
      correo: f.correo,
      passwordHash: f.password_hash,
    }));
  }

  async obtener(tenantId: string, usuarioId: string): Promise<Credencial | null> {
    const filas: FilaCredencial[] = await this.dataSource.query(
      `SELECT tenant_id, usuario_id, correo, password_hash
         FROM credencial_acceso WHERE tenant_id = $1 AND usuario_id = $2`,
      [tenantId, usuarioId],
    );
    const f = filas[0];
    return f
      ? { tenantId: f.tenant_id, usuarioId: f.usuario_id, correo: f.correo, passwordHash: f.password_hash }
      : null;
  }
}

export class SqlInvitacionRepository implements InvitacionRepository {
  constructor(private readonly dataSource: DataSource) {}

  async guardar(i: InvitacionPendiente): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO invitacion_pendiente (codigo_hash, tenant_id, usuario_id, expira_en)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (codigo_hash) DO NOTHING`,
      [i.codigoHash, i.tenantId, i.usuarioId, i.expiraEn],
    );
  }

  async consumir(codigoHash: string, ahora: Date): Promise<InvitacionPendiente | null> {
    // Un solo uso, atómico: elimina y devuelve; vencida también se elimina pero no vale.
    const resultado: Array<{ tenant_id: string; usuario_id: string; expira_en: string }> =
      await this.dataSource.query(
        `DELETE FROM invitacion_pendiente WHERE codigo_hash = $1
         RETURNING tenant_id, usuario_id, expira_en::text AS expira_en`,
        [codigoHash],
      );
    const f = resultado[0];
    if (!f) return null;
    if (new Date(f.expira_en).getTime() <= ahora.getTime()) return null;
    return {
      codigoHash,
      tenantId: f.tenant_id,
      usuarioId: f.usuario_id,
      expiraEn: f.expira_en,
    };
  }
}
