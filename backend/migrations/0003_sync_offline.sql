-- =====================================================================
-- Migración 0003 — Sincronización offline (spec-010, lado servidor)
-- Requiere 0001 (helper RLS) y 0002 (tabla servicio).
--
--  1) `servicio.version`: control optimista (los cambios offline llevan base_version).
--  2) `idempotencia`: deduplicación por clientId (R6/R8) — misma respuesta, sin
--     doble transición. PK (tenant, client_id) hace el dedupe también físico.
--  3) `bitacora_sync`: intentos rechazados contra estados terminales (R9/R10);
--     nada se descarta en silencio (R11).
-- =====================================================================

BEGIN;

-- ---------- 1) Versión optimista del Servicio ----------
ALTER TABLE servicio ADD COLUMN version int NOT NULL DEFAULT 1;

-- ---------- 2) Deduplicación idempotente ----------
CREATE TABLE idempotencia (
  tenant_id  uuid  NOT NULL,
  client_id  uuid  NOT NULL,
  respuesta  jsonb NOT NULL,
  creado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, client_id)
);

-- ---------- 3) Bitácora de conflictos de sincronización ----------
CREATE TABLE bitacora_sync (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  servicio_id uuid,
  usuario_id  text NOT NULL,
  detalle     text NOT NULL,
  ocurrido_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bitacora_tenant_servicio ON bitacora_sync (tenant_id, servicio_id);

-- ---------- Row Level Security (mismo esquema que 0001/0002) ----------
ALTER TABLE idempotencia  ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotencia  FORCE  ROW LEVEL SECURITY;
ALTER TABLE bitacora_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE bitacora_sync FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_idempotencia ON idempotencia
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

CREATE POLICY tenant_isolation_bitacora ON bitacora_sync
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

COMMIT;

-- Notas:
--  - La limpieza de `idempotencia` (TTL, p. ej. 30 días) es tarea del worker de
--    plataforma; los clientes no reintentan cambios más viejos que su cola local.
--  - `bitacora_sync` alimenta la vista de conflictos del portal (escalamiento R11).
