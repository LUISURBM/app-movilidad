-- =====================================================================
-- Migración 0011 — RLS con rol de aplicación SIN BYPASS (E1)
-- Requiere 0001 (helper + políticas). Cierra la deuda anotada en DESPLIEGUE.md.
-- =====================================================================

BEGIN;

-- 1) El helper deja de LANZAR cuando la sesión no fijó tenant: devuelve NULL.
--    Sigue siendo FAIL-CLOSED (NULL nunca iguala un tenant_id) y permite que
--    sesiones de PLATAFORMA (sin tenant) evalúen políticas sin excepción.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid
$$;

-- 2) El worker del outbox (dispatcher) es transversal por diseño (ADR-0004):
--    lee/actualiza filas de TODOS los tenants para despachar. Se habilita con
--    un ámbito explícito de plataforma (SET LOCAL app.rol='plataforma'), nunca
--    por defecto. Las políticas permisivas se OR-ean con la de tenant.
CREATE POLICY plataforma_outbox ON outbox
  USING (current_setting('app.rol', true) = 'plataforma')
  WITH CHECK (current_setting('app.rol', true) = 'plataforma');

-- 3) Permisos del rol de aplicación (creado por el init del despliegue con
--    LOGIN NOSUPERUSER NOBYPASSRLS; condicional para entornos de prueba).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fleetspecial_app') THEN
    GRANT USAGE ON SCHEMA public TO fleetspecial_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fleetspecial_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fleetspecial_app;
  END IF;
END $$;

COMMIT;

-- Notas:
--  - La API debe conectar como `fleetspecial_app` (DATABASE_URL del compose);
--    el migrador sigue conectando como dueño (DDL).
--  - Los adaptadores envuelven cada operación con `enTenant`/`comoPlataforma`
--    (backend/src/platform/tenant-sql.ts): SET LOCAL por transacción.
--  - `credencial_acceso`, `invitacion_pendiente` y `tenant` son pre-tenant a
--    propósito (spec-015 regla 10) y no llevan RLS.
