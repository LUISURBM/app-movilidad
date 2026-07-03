-- =====================================================================
-- Migración 0007 — Contexto Identity & Access (BC-1, spec-001 / spec-002)
-- Tenant (Empresa) + Usuario con roles y ciclo de vida.
-- Requiere 0001 (helper RLS `app_current_tenant()`, pgcrypto, outbox).
-- =====================================================================

BEGIN;

-- ---------- Tenants (el REGISTRO de empresas) ----------
-- NO lleva RLS por tenant: es el registro global y el onboarding (spec-001) es PÚBLICO
-- (se crea sin contexto de tenant aún). El aislamiento de datos de negocio lo dan las
-- demás tablas vía RLS. La unicidad del correo de registro (R7) se impone con UNIQUE.
CREATE TABLE tenant (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razon_social            text NOT NULL,
  nit                     text,
  correo_registro         text NOT NULL UNIQUE,          -- R7: único global
  plan                    text NOT NULL DEFAULT 'Free'
                            CHECK (plan IN ('Free','Starter','Pro','Enterprise')),
  consentimiento_version  text NOT NULL,                 -- R4: evidencia del consentimiento
  consentimiento_en       timestamptz NOT NULL,
  consentimiento_titular  text NOT NULL,
  creado_en               timestamptz NOT NULL DEFAULT now()
);

-- ---------- Usuarios (tenant-scoped) ----------
CREATE TABLE usuario (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  nombre         text NOT NULL,
  correo         text NOT NULL,
  roles          text[] NOT NULL,                        -- R4: uno o más Roles
  estado         text NOT NULL DEFAULT 'invitado'
                   CHECK (estado IN ('invitado','activo','suspendido','removido','expirado')),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_usuario_tenant ON usuario (tenant_id);
-- Un solo Usuario VIGENTE por (tenant, correo): permite re-invitar tras remover/expirar.
CREATE UNIQUE INDEX uq_usuario_correo_vigente
  ON usuario (tenant_id, correo)
  WHERE estado NOT IN ('removido','expirado');

-- ---------- Row Level Security (solo usuario; tenant es el registro) ----------
ALTER TABLE usuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_usuario ON usuario
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

COMMIT;

-- Notas:
--  - El onboarding (spec-001) crea el Tenant y, dentro de una transacción que fija
--    `app.current_tenant` al nuevo tenant, inserta su primer Usuario Administrador.
--  - Evento TenantCreado / UsuarioInvitado -> `outbox` (0001).
--  - Verificación de correo (spec-001 R2) NO se modela aquí: el contrato hace el
--    onboarding en un solo POST /tenants (decisión anotada en la spec).
