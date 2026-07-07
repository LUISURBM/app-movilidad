-- =====================================================================
-- Migración 0012 — Recuperación de contraseña (spec-015, ahora con email real)
-- Igual que invitacion_pendiente: pre-tenant, SIN RLS (regla 10), solo hash.
-- =====================================================================

BEGIN;

CREATE TABLE recuperacion_pendiente (
  codigo_hash text PRIMARY KEY,                -- SHA-256 hex del código enviado por email
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  usuario_id  uuid NOT NULL,
  expira_en   timestamptz NOT NULL             -- 1 hora
);
CREATE INDEX idx_recuperacion_usuario ON recuperacion_pendiente (tenant_id, usuario_id);

COMMIT;
