/**
 * Adaptador SQL (producción) del puerto NovedadRepository (spec-014): tabla `novedad` de
 * la migración 0008, con RLS por tenant. Append-only + dedupe físico por (tenant, client_id).
 */
import { DataSource } from "typeorm";
import { TenantId } from "../../../shared/kernel";
import { Novedad } from "../domain/novedad.aggregate";
import { NovedadRepository } from "../application/ports";

interface FilaNovedad {
  id: string;
  client_id: string;
  servicio_id: string;
  tipo: string;
  descripcion: string;
  foto_ref: string | null;
  ocurrido_en: string;
}

function toNovedad(f: FilaNovedad): Novedad {
  return Novedad.rehidratar({
    id: f.id,
    clientId: f.client_id,
    servicioId: f.servicio_id,
    tipo: f.tipo,
    descripcion: f.descripcion,
    fotoRef: f.foto_ref ?? undefined,
    ocurridoEn: new Date(f.ocurrido_en).toISOString(),
  });
}

const SELECT = `SELECT id, client_id, servicio_id, tipo, descripcion, foto_ref, ocurrido_en FROM novedad`;

export class SqlNovedadRepository implements NovedadRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findByClientId(tenant: TenantId, clientId: string): Promise<Novedad | null> {
    const rows: FilaNovedad[] = await this.dataSource.query(`${SELECT} WHERE tenant_id = $1 AND client_id = $2`, [tenant, clientId]);
    return rows[0] ? toNovedad(rows[0]) : null;
  }

  async append(tenant: TenantId, n: Novedad): Promise<void> {
    const s = n.snapshot();
    await this.dataSource.query(
      `INSERT INTO novedad (id, tenant_id, client_id, servicio_id, tipo, descripcion, foto_ref, ocurrido_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, client_id) DO NOTHING`,
      [s.id, tenant, s.clientId, s.servicioId, s.tipo, s.descripcion, s.fotoRef ?? null, s.ocurridoEn],
    );
  }

  async listByServicio(tenant: TenantId, servicioId: string): Promise<Novedad[]> {
    const rows: FilaNovedad[] = await this.dataSource.query(
      `${SELECT} WHERE tenant_id = $1 AND servicio_id = $2 ORDER BY ocurrido_en ASC, creado_en ASC`,
      [tenant, servicioId],
    );
    return rows.map(toNovedad);
  }
}
