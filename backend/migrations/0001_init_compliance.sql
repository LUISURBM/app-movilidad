-- =====================================================================
-- Migración 0001 — Contexto Compliance & Documents (CORE)
-- Multi-tenant con Row Level Security (ADR-0008) + outbox (ADR-0004).
--
-- Estrategia de aislamiento (defensa en profundidad):
--   1) El código filtra por tenant_id (repos).
--   2) RLS en la base GARANTIZA que ninguna query cruce tenants aunque el código
--      tenga un bug: cada sesión fija `app.current_tenant` y las políticas lo aplican.
--
-- La aplicación debe ejecutar, por transacción/conexión:
--     SET LOCAL app.current_tenant = '<tenant_uuid>';
-- El rol de aplicación NO debe ser superusuario ni tener BYPASSRLS.
-- =====================================================================

BEGIN;

-- Requerido para gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Catálogo de Tipos de documento ----------
CREATE TABLE tipo_documento (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  codigo     text NOT NULL,
  aplica_a   text NOT NULL CHECK (aplica_a IN ('vehiculo','conductor')),
  requerido  boolean NOT NULL DEFAULT false,
  activo     boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, codigo)     -- código único POR tenant (no global)
);
CREATE INDEX idx_tipo_documento_tenant ON tipo_documento (tenant_id);

-- ---------- Documentos ----------
CREATE TABLE documento (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  sujeto_tipo          text NOT NULL CHECK (sujeto_tipo IN ('vehiculo','conductor')),
  sujeto_id            uuid NOT NULL,
  tipo_codigo          text NOT NULL,
  emision              date NOT NULL,
  vencimiento          date NOT NULL,
  adjunto_ref          text,
  version              int  NOT NULL DEFAULT 1,
  vigente              boolean NOT NULL DEFAULT true,
  umbrales_notificados int[] NOT NULL DEFAULT '{}',
  vencido_notificado   boolean NOT NULL DEFAULT false,
  historico            jsonb NOT NULL DEFAULT '[]',
  creado_en            timestamptz NOT NULL DEFAULT now(),
  actualizado_en       timestamptz NOT NULL DEFAULT now(),
  -- spec-005 R4 / spec-007 I4: el vencimiento no puede ser anterior a la emisión.
  CONSTRAINT chk_vencimiento_ge_emision CHECK (vencimiento >= emision)
);
CREATE INDEX idx_documento_tenant_sujeto ON documento (tenant_id, sujeto_tipo, sujeto_id);

-- Invariante I2 a nivel de base: un ÚNICO Documento vigente por (tenant, sujeto, tipo).
CREATE UNIQUE INDEX uq_documento_vigente
  ON documento (tenant_id, sujeto_tipo, sujeto_id, tipo_codigo)
  WHERE vigente = true;

-- ---------- Outbox de eventos (ADR-0004) ----------
CREATE TABLE outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  tipo_evento     text NOT NULL,
  aggregate_id    text NOT NULL,
  payload         jsonb NOT NULL,
  estado          text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','publicado','fallido')),
  intentos        int NOT NULL DEFAULT 0,
  proximo_intento timestamptz NOT NULL DEFAULT now(),
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbox_pendientes ON outbox (estado, proximo_intento);
CREATE INDEX idx_outbox_tenant ON outbox (tenant_id);

-- =====================================================================
-- Row Level Security
-- =====================================================================

-- Helper: tenant actual de la sesión (lanza si no está fijado → falla cerrado).
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.current_tenant', false)::uuid
$$;

-- Activar RLS y forzarla también para el dueño de la tabla (defensa extra).
ALTER TABLE tipo_documento ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipo_documento FORCE ROW LEVEL SECURITY;
ALTER TABLE documento      ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento      FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox         ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox         FORCE ROW LEVEL SECURITY;

-- Políticas: por defecto DENEGAR; solo se ven/escriben filas del tenant actual.
CREATE POLICY tenant_isolation_tipo_documento ON tipo_documento
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

CREATE POLICY tenant_isolation_documento ON documento
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

CREATE POLICY tenant_isolation_outbox ON outbox
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

COMMIT;

-- =====================================================================
-- Notas de operación
--  - Crear un rol de aplicación sin BYPASSRLS, p. ej.:
--      CREATE ROLE fleetspecial_app LOGIN PASSWORD '***' NOSUPERUSER NOBYPASSRLS;
--      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fleetspecial_app;
--  - El worker del outbox también corre bajo un tenant fijado por lote (o un rol
--    dedicado con política específica) para respetar el aislamiento al publicar.
-- =====================================================================
