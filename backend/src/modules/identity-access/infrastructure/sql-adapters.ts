/**
 * Adaptadores SQL (producción) de los puertos de Identity & Access (spec-001 / spec-002):
 * tablas `tenant` (registro global) y `usuario` (RLS por tenant) de la migración 0007.
 * SQL parametrizado directo. El `usuario` asume la sesión con `app.current_tenant` fijado.
 */
import { DataSource } from "typeorm";
import { TenantId } from "../../../shared/kernel";
import { Rol } from "../../../platform/tenant-context";
import { Tenant } from "../domain/tenant.aggregate";
import { Usuario } from "../domain/usuario.aggregate";
import { Consentimiento, Correo, EstadoUsuario, PlanSuscripcion } from "../domain/value-objects";
import { DomainEvent } from "../domain/events";
import { EventPublisher, TenantRepository, UsuarioRepository } from "../application/ports";

interface FilaTenant {
  id: string;
  razon_social: string;
  nit: string | null;
  correo_registro: string;
  plan: string;
  consentimiento_version: string;
  consentimiento_en: string;
  consentimiento_titular: string;
  creado_en: string;
}

export class SqlTenantRepository implements TenantRepository {
  constructor(private readonly dataSource: DataSource) {}

  async save(t: Tenant): Promise<void> {
    const s = t.snapshot();
    await this.dataSource.query(
      `INSERT INTO tenant
         (id, razon_social, nit, correo_registro, plan,
          consentimiento_version, consentimiento_en, consentimiento_titular, creado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [s.id, s.razonSocial, s.nit ?? null, s.correoRegistro, s.plan,
       s.consentimientoVersion, s.consentimientoEn, s.consentimientoTitular, s.creadoEn],
    );
  }

  async findById(id: string): Promise<Tenant | null> {
    const rows: FilaTenant[] = await this.dataSource.query(
      `SELECT id, razon_social, nit, correo_registro, plan, consentimiento_version,
        consentimiento_en::text AS consentimiento_en, consentimiento_titular,
        creado_en::text AS creado_en FROM tenant WHERE id = $1`,
      [id],
    );
    const f = rows[0];
    if (!f) return null;
    return Tenant.rehidratar({
      id: f.id,
      razonSocial: f.razon_social,
      nit: f.nit ?? undefined,
      correoRegistro: Correo.de(f.correo_registro),
      plan: f.plan as PlanSuscripcion,
      consentimiento: Consentimiento.aceptar({ version: f.consentimiento_version, aceptadoEn: f.consentimiento_en, titular: f.consentimiento_titular }),
      creadoEn: f.creado_en,
    });
  }

  async existsCorreoRegistro(correo: string): Promise<boolean> {
    const rows: Array<{ n: number }> = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM tenant WHERE correo_registro = $1`,
      [correo],
    );
    return rows[0].n > 0;
  }
}

interface FilaUsuario {
  id: string;
  tenant_id: string;
  nombre: string;
  correo: string;
  roles: string[];
  estado: string;
}

function toUsuario(f: FilaUsuario): Usuario {
  return Usuario.rehidratar({
    id: f.id,
    tenantId: f.tenant_id,
    nombre: f.nombre,
    correo: Correo.de(f.correo),
    roles: f.roles as Rol[],
    estado: f.estado as EstadoUsuario,
  });
}

const SELECT_U = `SELECT id, tenant_id, nombre, correo, roles, estado FROM usuario`;

export class SqlUsuarioRepository implements UsuarioRepository {
  constructor(private readonly dataSource: DataSource) {}

  async save(tenant: TenantId, u: Usuario): Promise<void> {
    const s = u.snapshot();
    await this.dataSource.query(
      `INSERT INTO usuario (id, tenant_id, nombre, correo, roles, estado)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET
         nombre = EXCLUDED.nombre, roles = EXCLUDED.roles, estado = EXCLUDED.estado,
         actualizado_en = now()`,
      [s.id, tenant, s.nombre, s.correo, s.roles, s.estado],
    );
  }

  async findById(tenant: TenantId, id: string): Promise<Usuario | null> {
    const rows: FilaUsuario[] = await this.dataSource.query(`${SELECT_U} WHERE tenant_id = $1 AND id = $2`, [tenant, id]);
    return rows[0] ? toUsuario(rows[0]) : null;
  }

  async findByCorreo(tenant: TenantId, correo: string): Promise<Usuario | null> {
    const rows: FilaUsuario[] = await this.dataSource.query(`${SELECT_U} WHERE tenant_id = $1 AND correo = $2`, [tenant, correo]);
    return rows[0] ? toUsuario(rows[0]) : null;
  }

  async list(tenant: TenantId): Promise<Usuario[]> {
    const rows: FilaUsuario[] = await this.dataSource.query(`${SELECT_U} WHERE tenant_id = $1 ORDER BY creado_en ASC`, [tenant]);
    return rows.map(toUsuario);
  }
}

export class SqlIdentityEventPublisher implements EventPublisher {
  constructor(private readonly dataSource: DataSource) {}

  async publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void> {
    for (const e of eventos) {
      const aggregateId = e.tipo === "TenantCreado" ? e.tenantId : e.usuarioId;
      await this.dataSource.query(
        `INSERT INTO outbox (tenant_id, tipo_evento, aggregate_id, payload) VALUES ($1,$2,$3,$4)`,
        [tenant, e.tipo, aggregateId, JSON.stringify(e)],
      );
    }
  }
}
