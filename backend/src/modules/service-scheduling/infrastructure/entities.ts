/**
 * Entidades TypeORM del contexto Service Scheduling (capa infrastructure).
 *
 * Detalle de persistencia; el dominio NO las conoce. La Asignación vive embebida
 * en la fila del Servicio (1:1, igual que en el contrato openapi.yaml).
 *
 * Multi-tenant (ADR-0008): tenant_id + RLS (migración 0002).
 * Invariante S4 (no solapamiento) se refuerza ADEMÁS a nivel de base con
 * EXCLUDE USING gist sobre tstzrange(ventana) por vehículo y por conductor
 * (defensa en profundidad contra condiciones de carrera; ver migración 0002).
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "servicio" })
@Index(["tenantId", "estado"])
@Index(["tenantId", "vehiculoId"])
@Index(["tenantId", "conductorId"])
export class ServicioEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("uuid", { name: "tenant_id" })
  tenantId!: string;

  @Column("text")
  origen!: string;

  @Column("text")
  destino!: string;

  @Column("timestamptz", { name: "ventana_inicio" })
  ventanaInicio!: Date;

  @Column("timestamptz", { name: "ventana_fin" })
  ventanaFin!: Date;

  @Column("text", { nullable: true })
  cliente!: string | null;

  @Column("text", { default: "Planificado" })
  estado!: "Planificado" | "Iniciado" | "Finalizado" | "Cancelado";

  // ---- Asignación embebida (spec-008/009) ----
  @Column("uuid", { name: "vehiculo_id", nullable: true })
  vehiculoId!: string | null;

  @Column("uuid", { name: "conductor_id", nullable: true })
  conductorId!: string | null;

  /** Advertencias de la asignación (semáforo amarillo — spec-009 P11). */
  @Column("jsonb", { default: () => "'[]'" })
  advertencias!: string[];

  /** Control optimista para sync offline (spec-010 R9). */
  @Column("int", { default: 1 })
  version!: number;

  // ---- Ejecución (spec-010) ----
  @Column("timestamptz", { name: "inicio_real", nullable: true })
  inicioReal!: Date | null;

  @Column("timestamptz", { name: "fin_real", nullable: true })
  finReal!: Date | null;

  @CreateDateColumn({ name: "creado_en" })
  creadoEn!: Date;

  @UpdateDateColumn({ name: "actualizado_en" })
  actualizadoEn!: Date;
}
