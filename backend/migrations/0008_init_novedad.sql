-- =====================================================================
-- Migración 0008 — Novedades (BC-5 Service Scheduling, spec-014)
-- Novedad append-only e idempotente, asociada a un Servicio.
-- Requiere 0001 (helper RLS + pgcrypto + outbox) y 0002 (tabla servicio).
-- =====================================================================

BEGIN;

CREATE TABLE novedad (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  client_id    uuid NOT NULL,                         -- UUID de idempotencia (spec-014 R7)
  servicio_id  uuid NOT NULL,                         -- R1: pertenece a un Servicio existente
  tipo         text NOT NULL CHECK (tipo IN ('incidente','retraso','siniestro')),
  descripcion  text NOT NULL DEFAULT '',
  foto_ref     text,                                  -- R5/R6: URL/ID de la foto (subida en 2 pasos)
  ocurrido_en  timestamptz NOT NULL,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, client_id)                        -- dedupe físico (R7)
);
CREATE INDEX idx_novedad_tenant_servicio ON novedad (tenant_id, servicio_id, ocurrido_en);

ALTER TABLE novedad ENABLE ROW LEVEL SECURITY;
ALTER TABLE novedad FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_novedad ON novedad
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

COMMIT;

-- Notas:
--  - La foto se sube en dos pasos desde el cliente (binario -> URL, luego la Novedad
--    referenciando la URL en `foto_ref`): el servidor solo persiste el metadato (R6).
--  - Evento NovedadReportada -> `outbox` (0001).
