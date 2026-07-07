-- =====================================================================
-- Migración 0010 — Autenticación con credenciales (BC-1, spec-015)
-- credencial_acceso + invitacion_pendiente. Requiere 0007 (tenant/usuario).
--
-- SIN RLS a propósito (spec-015 regla 10): el login y la aceptación de
-- invitación ocurren ANTES de conocer el tenant (no hay app_current_tenant()).
-- Solo los casos de uso de autenticación consultan estas tablas; jamás se
-- exponen por la API. La contraseña vive únicamente como hash scrypt.
-- =====================================================================

BEGIN;

CREATE TABLE credencial_acceso (
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  usuario_id     uuid NOT NULL,
  correo         text NOT NULL,                -- normalizado a minúsculas
  password_hash  text NOT NULL,                -- scrypt$N$r$p$sal$hash (nunca la clave)
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, usuario_id)
);
-- Búsqueda del login: todas las credenciales de un correo (una por tenant).
CREATE INDEX idx_credencial_correo ON credencial_acceso (correo);

CREATE TABLE invitacion_pendiente (
  codigo_hash text PRIMARY KEY,                -- SHA-256 hex del código de un solo uso
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  usuario_id  uuid NOT NULL,
  expira_en   timestamptz NOT NULL             -- 7 días (spec-002 R9 / spec-015 regla 6)
);
CREATE INDEX idx_invitacion_tenant ON invitacion_pendiente (tenant_id);

COMMIT;

-- Notas:
--  - `consumir` una invitación = DELETE ... RETURNING (un solo uso, atómico).
--  - Deudas anotadas en spec-015: rate-limiting/lockout, "olvidé mi contraseña"
--    (requiere canal de email real), refresh tokens, OIDC como emisor alterno.
