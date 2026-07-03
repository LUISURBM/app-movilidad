-- =====================================================================
-- Migración 0009 — Contexto Maintenance Management (BC-7, spec-012)
-- Umbral de mantenimiento por Vehículo (por km y/o por fecha) + estado del ciclo.
-- Requiere 0001 (helper RLS + pgcrypto + outbox).
-- =====================================================================

BEGIN;

CREATE TABLE umbral_mantenimiento (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  vehiculo_id  uuid NOT NULL,
  cada_km      int  CHECK (cada_km IS NULL OR cada_km > 0),
  base_km      int  NOT NULL DEFAULT 0 CHECK (base_km >= 0),
  cada_meses   int  CHECK (cada_meses IS NULL OR cada_meses > 0),
  base_fecha   date,
  pendiente    boolean NOT NULL DEFAULT false,  -- preventivo programado y pendiente (idempotencia R8)
  vencido      boolean NOT NULL DEFAULT false,  -- vencido por fecha (P7)
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  -- Un Umbral por (tenant, vehículo).
  UNIQUE (tenant_id, vehiculo_id),
  -- Debe definirse por km, por fecha, o ambos (spec-012 R1).
  CHECK (cada_km IS NOT NULL OR cada_meses IS NOT NULL)
);
CREATE INDEX idx_umbral_tenant ON umbral_mantenimiento (tenant_id);

ALTER TABLE umbral_mantenimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE umbral_mantenimiento FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_umbral ON umbral_mantenimiento
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

COMMIT;

-- Notas:
--  - La programación por km (P6) reacciona al evento OdometroActualizado (Fuel/Fleet/Servicio):
--    el disparo se cableará vía el bus de eventos (seam pendiente).
--  - La evaluación por fecha (P7) la ejecuta el job diario de plataforma por tenant.
--  - Eventos MantenimientoProgramado/Vencido/Registrado -> `outbox` (0001).
