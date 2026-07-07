/**
 * Implementaciones de los puertos con TypeORM + PostgreSQL (capa infrastructure).
 * Traducen entidad <-> agregado y confían en RLS (ADR-0008) para el aislamiento de tenant;
 * además filtran por tenant_id en cada query (defensa en profundidad).
 *
 * NOTA: el aislamiento REAL requiere que la conexión tenga fijado `app.current_tenant`
 * (ver tenant-datasource.ts). Estas clases asumen que la sesión ya está en el tenant correcto.
 */
import { enTenant } from "../../../platform/tenant-sql";
import { DataSource, Repository } from "typeorm";
import { TenantId } from "../../../shared/kernel";
import { Documento, VersionHistorica } from "../domain/documento.aggregate";
import {
  SujetoRef,
  TipoDocumento,
  TipoSujeto,
  Vencimiento,
  UmbralAlerta,
} from "../domain/value-objects";
import { DateOnly } from "../../../shared/kernel";
import {
  CatalogoTiposRepository,
  DocumentoRepository,
} from "../application/ports";
import { DocumentoEntity, TipoDocumentoEntity } from "./entities";

// ---------- Mapeo entidad -> dominio ----------

function toDocumento(e: DocumentoEntity): Documento {
  return Documento.rehidratar({
    id: e.id,
    sujeto: SujetoRef.of(e.sujetoTipo as TipoSujeto, e.sujetoId),
    // El Tipo se rehidrata mínimamente; el catálogo completo se consulta aparte cuando hace falta.
    tipo: new TipoDocumento(e.tipoCodigo, e.sujetoTipo as TipoSujeto, false, true),
    vencimiento: Vencimiento.el(DateOnly.parse(e.vencimiento)),
    emision: DateOnly.parse(e.emision),
    adjuntoRef: e.adjuntoRef ?? undefined,
    version: e.version,
    historico: e.historico as VersionHistorica[],
    umbralesNotificados: e.umbralesNotificados as UmbralAlerta[],
    vencidoNotificado: e.vencidoNotificado,
  });
}

export class TypeOrmDocumentoRepository implements DocumentoRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Repositorio scoped a la transacción con el tenant fijado (RLS E1). */
  private conRepo<T>(tenant: TenantId, work: (repo: Repository<DocumentoEntity>) => Promise<T>): Promise<T> {
    return enTenant(this.dataSource, tenant, (m) => work(m.getRepository(DocumentoEntity)));
  }

  async save(tenant: TenantId, doc: Documento): Promise<void> {
    const s = doc.snapshot();
    await this.conRepo(tenant, (repo) => repo.save({
      id: s.id,
      tenantId: tenant,
      sujetoTipo: s.sujetoTipo as "vehiculo" | "conductor",
      sujetoId: s.sujetoId,
      tipoCodigo: s.tipoCodigo,
      emision: s.emision,
      vencimiento: s.vencimiento,
      adjuntoRef: s.adjuntoRef ?? null,
      version: s.version,
      vigente: true,
      umbralesNotificados: s.umbralesNotificados,
      vencidoNotificado: s.vencidoNotificado,
      historico: s.historico,
    }));
  }

  async findById(tenant: TenantId, id: string): Promise<Documento | null> {
    const e = await this.conRepo(tenant, (repo) => repo.findOne({ where: { id, tenantId: tenant } }));
    return e ? toDocumento(e) : null;
  }

  async findVigentesBySujeto(tenant: TenantId, sujeto: SujetoRef): Promise<Documento[]> {
    const rows = await this.conRepo(tenant, (repo) => repo.find({
      where: { tenantId: tenant, sujetoTipo: sujeto.tipo, sujetoId: sujeto.id, vigente: true },
    }));
    return rows.map(toDocumento);
  }

  async existsVigenteDelTipo(
    tenant: TenantId,
    sujeto: SujetoRef,
    tipoCodigo: string,
  ): Promise<boolean> {
    const n = await this.conRepo(tenant, (repo) => repo.count({
      where: {
        tenantId: tenant,
        sujetoTipo: sujeto.tipo,
        sujetoId: sujeto.id,
        tipoCodigo,
        vigente: true,
      },
    }));
    return n > 0;
  }

  async findAll(tenant: TenantId): Promise<Documento[]> {
    const rows = await this.conRepo(tenant, (repo) => repo.find({ where: { tenantId: tenant, vigente: true } }));
    return rows.map(toDocumento);
  }
}

export class TypeOrmCatalogoTiposRepository implements CatalogoTiposRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Repositorio scoped a la transacción con el tenant fijado (RLS E1). */
  private conRepo<T>(tenant: TenantId, work: (repo: Repository<TipoDocumentoEntity>) => Promise<T>): Promise<T> {
    return enTenant(this.dataSource, tenant, (m) => work(m.getRepository(TipoDocumentoEntity)));
  }

  private toDominio(e: TipoDocumentoEntity): TipoDocumento {
    return new TipoDocumento(e.codigo, e.aplicaA as TipoSujeto, e.requerido, e.activo);
  }

  async findByCodigo(tenant: TenantId, codigo: string): Promise<TipoDocumento | null> {
    const e = await this.conRepo(tenant, (repo) => repo.findOne({ where: { tenantId: tenant, codigo } }));
    return e ? this.toDominio(e) : null;
  }

  async findRequeridos(tenant: TenantId): Promise<TipoDocumento[]> {
    const rows = await this.conRepo(tenant, (repo) => repo.find({ where: { tenantId: tenant, requerido: true, activo: true } }));
    return rows.map((e) => this.toDominio(e));
  }

  async findAll(tenant: TenantId): Promise<TipoDocumento[]> {
    const rows = await this.conRepo(tenant, (repo) => repo.find({ where: { tenantId: tenant } }));
    return rows.map((e) => this.toDominio(e));
  }

  /** Upsert por (tenant, codigo) — la migración 0001 tiene UNIQUE(tenant_id, codigo). */
  async save(tenant: TenantId, tipo: TipoDocumento): Promise<void> {
    const existente = await this.conRepo(tenant, (repo) => repo.findOne({ where: { tenantId: tenant, codigo: tipo.codigo } }));
    await this.conRepo(tenant, (repo) => repo.save({
      id: existente?.id, // undefined ⇒ INSERT con DEFAULT gen_random_uuid()
      tenantId: tenant,
      codigo: tipo.codigo,
      aplicaA: tipo.aplicaA as "vehiculo" | "conductor",
      requerido: tipo.requerido,
      activo: tipo.activo,
    }));
  }
}
