/**
 * Entidades TypeORM del contexto Compliance & Documents (capa infrastructure).
 *
 * Regla de Clean Architecture: estas clases son detalle de persistencia; el dominio
 * NO las conoce. Los repos (typeorm.repositories.ts) traducen entidad <-> agregado.
 *
 * Multi-tenant (ADR-0008): TODA tabla lleva `tenant_id`; el aislamiento lo garantiza
 * Row Level Security a nivel de base (ver migración 0001_init_compliance.sql), además
 * del filtrado en código.
 */
import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "tipo_documento" })
@Index(["tenantId", "codigo"], { unique: true })
export class TipoDocumentoEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("uuid", { name: "tenant_id" })
  tenantId!: string;

  @Column("text")
  codigo!: string;

  @Column("text", { name: "aplica_a" })
  aplicaA!: "vehiculo" | "conductor";

  @Column("boolean", { default: false })
  requerido!: boolean;

  @Column("boolean", { default: true })
  activo!: boolean;
}

@Entity({ name: "documento" })
@Index(["tenantId", "sujetoTipo", "sujetoId"])
// Invariante I2 a nivel de base: un solo Documento vigente por Tipo+sujeto.
// (Se aplica con un índice único parcial en la migración: WHERE vigente = true.)
export class DocumentoEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("uuid", { name: "tenant_id" })
  tenantId!: string;

  @Column("text", { name: "sujeto_tipo" })
  sujetoTipo!: "vehiculo" | "conductor";

  @Column("uuid", { name: "sujeto_id" })
  sujetoId!: string;

  @Column("text", { name: "tipo_codigo" })
  tipoCodigo!: string;

  @Column("date")
  emision!: string; // YYYY-MM-DD

  @Column("date")
  vencimiento!: string; // YYYY-MM-DD

  @Column("text", { name: "adjunto_ref", nullable: true })
  adjuntoRef!: string | null;

  @Column("int", { default: 1 })
  version!: number;

  @Column("boolean", { default: true })
  vigente!: boolean;

  /** Umbrales de alerta ya notificados (persistir R5). */
  @Column("int", { array: true, name: "umbrales_notificados", default: () => "'{}'" })
  umbralesNotificados!: number[];

  @Column("boolean", { name: "vencido_notificado", default: false })
  vencidoNotificado!: boolean;

  /** Histórico de versiones (JSONB) — inmutable (spec-007). */
  @Column("jsonb", { default: () => "'[]'" })
  historico!: Array<{
    version: number;
    vencimiento: string;
    emision: string;
    adjuntoRef?: string;
    reemplazadoEn: string;
  }>;

  @CreateDateColumn({ name: "creado_en" })
  creadoEn!: Date;

  @UpdateDateColumn({ name: "actualizado_en" })
  actualizadoEn!: Date;
}

/**
 * Tabla OUTBOX (ADR-0004): los eventos de dominio se escriben aquí en la MISMA
 * transacción que el cambio de estado; un worker los publica después.
 */
@Entity({ name: "outbox" })
@Index(["estado", "proximoIntento"])
export class OutboxEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("uuid", { name: "tenant_id" })
  tenantId!: string;

  @Column("text", { name: "tipo_evento" })
  tipoEvento!: string;

  @Column("text", { name: "aggregate_id" })
  aggregateId!: string;

  @Column("jsonb")
  payload!: unknown;

  @Column("text", { default: "pendiente" })
  estado!: "pendiente" | "publicado" | "fallido";

  @Column("int", { default: 0 })
  intentos!: number;

  @Column("timestamptz", { name: "proximo_intento", default: () => "now()" })
  proximoIntento!: Date;

  @CreateDateColumn({ name: "creado_en" })
  creadoEn!: Date;
}
