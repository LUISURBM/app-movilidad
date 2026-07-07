/**
 * Adaptadores SQL (producción) de los puertos de Driver Management (spec-004):
 * tabla `conductor` de la migración 0006, con RLS por tenant. SQL parametrizado directo.
 */
import { DataSource } from "typeorm";
import { q } from "../../../platform/tenant-sql";
import { TenantId } from "../../../shared/kernel";
import { Conductor } from "../domain/conductor.aggregate";
import { DocumentoIdentidad, Licencia } from "../domain/value-objects";
import { DomainEvent } from "../domain/events";
import { ConductorRepository, EventPublisher } from "../application/ports";

interface FilaConductor {
  id: string;
  nombre: string;
  documento: string;
  licencia_numero: string;
  licencia_categoria: string;
  licencia_vencimiento: string;
  usuario_id: string | null;
}

function toConductor(f: FilaConductor): Conductor {
  return Conductor.rehidratar({
    id: f.id,
    nombre: f.nombre,
    documento: DocumentoIdentidad.de(f.documento),
    licencia: Licencia.de({
      numero: f.licencia_numero,
      categoria: f.licencia_categoria,
      vencimiento: f.licencia_vencimiento,
    }),
    usuarioId: f.usuario_id ?? undefined,
  });
}

const SELECT = `SELECT id, nombre, documento, licencia_numero, licencia_categoria,
  licencia_vencimiento::text AS licencia_vencimiento, usuario_id FROM conductor`;

export class SqlConductorRepository implements ConductorRepository {
  constructor(private readonly dataSource: DataSource) {}

  async save(tenant: TenantId, c: Conductor): Promise<void> {
    const s = c.snapshot();
    await q(this.dataSource, tenant).query(
      `INSERT INTO conductor
         (id, tenant_id, nombre, documento, licencia_numero, licencia_categoria, licencia_vencimiento, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         nombre = EXCLUDED.nombre, licencia_numero = EXCLUDED.licencia_numero,
         licencia_categoria = EXCLUDED.licencia_categoria,
         licencia_vencimiento = EXCLUDED.licencia_vencimiento,
         usuario_id = EXCLUDED.usuario_id, actualizado_en = now()`,
      [s.id, tenant, s.nombre, s.documento, s.licenciaNumero, s.licenciaCategoria, s.licenciaVencimiento, s.usuarioId ?? null],
    );
  }

  async findById(tenant: TenantId, id: string): Promise<Conductor | null> {
    const rows: FilaConductor[] = await q(this.dataSource, tenant).query(
      `${SELECT} WHERE tenant_id = $1 AND id = $2`,
      [tenant, id],
    );
    return rows[0] ? toConductor(rows[0]) : null;
  }

  async findByDocumento(tenant: TenantId, documento: string): Promise<Conductor | null> {
    const rows: FilaConductor[] = await q(this.dataSource, tenant).query(
      `${SELECT} WHERE tenant_id = $1 AND documento = $2`,
      [tenant, documento],
    );
    return rows[0] ? toConductor(rows[0]) : null;
  }

  async list(tenant: TenantId): Promise<Conductor[]> {
    const rows: FilaConductor[] = await q(this.dataSource, tenant).query(
      `${SELECT} WHERE tenant_id = $1 ORDER BY creado_en ASC`,
      [tenant],
    );
    return rows.map(toConductor);
  }
}

export class SqlDriverEventPublisher implements EventPublisher {
  constructor(private readonly dataSource: DataSource) {}

  async publish(tenant: TenantId, eventos: readonly DomainEvent[]): Promise<void> {
    for (const e of eventos) {
      await q(this.dataSource, tenant).query(
        `INSERT INTO outbox (tenant_id, tipo_evento, aggregate_id, payload)
         VALUES ($1,$2,$3,$4)`,
        [tenant, e.tipo, (e as { conductorId: string }).conductorId, JSON.stringify(e)],
      );
    }
  }
}
