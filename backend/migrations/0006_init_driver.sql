-- =====================================================================
-- Migración 0006 — Contexto Driver Management (BC-3, spec-004)
-- Conductor con documento de identidad único por Tenant (R9) y su Licencia.
-- Requiere 0001 (helper RLS `app_current_tenant()`, pgcrypto y tabla `outbox`).
--
-- Habeas Data (R3): se persisten solo los datos mínimos necesarios para la habilitación
-- (nombre, documento, licencia). El Tenant es el Responsable del tratamiento.
-- =====================================================================

BEGIN;

CREATE TABLE conductor (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  nombre                text NOT NULL,
  documento             text NOT NULL,
  licencia_numero       text NOT NULL,
  licencia_categoria    text NOT NULL,
  licencia_vencimiento  date NOT NULL,
  usuario_id            uuid,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now(),
  -- R9: documento de identidad ÚNICO POR TENANT (no global).
  UNIQUE (tenant_id, documento)
);
CREATE INDEX idx_conductor_tenant ON conductor (tenant_id);

-- ---------- Row Level Security (mismo esquema que 0001) ----------
ALTER TABLE conductor ENABLE ROW LEVEL SECURITY;
ALTER TABLE conductor FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_conductor ON conductor
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

COMMIT;

-- Notas:
--  - La vigencia de la Licencia se gestiona como Documento en BC-4 (spec-004 R5): al
--    registrar el Conductor, Driver crea el Documento "LICENCIA" vía ACL. Esta tabla
--    guarda el dato de la Licencia (número/categoría/vencimiento) para la vista del Conductor.
--  - Evento ConductorRegistrado -> `outbox` (0001).
