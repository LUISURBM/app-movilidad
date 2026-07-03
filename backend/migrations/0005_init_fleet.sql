-- =====================================================================
-- Migración 0005 — Contexto Fleet Management (BC-2, spec-003)
-- Vehículo con Placa única por Tenant (R2) e inmutable (R3) y Odómetro monótono (R6).
-- Requiere 0001 (helper RLS `app_current_tenant()`, pgcrypto y tabla `outbox`).
-- =====================================================================

BEGIN;

CREATE TABLE vehiculo (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  placa                 text NOT NULL,
  clase                 text NOT NULL CHECK (clase IN
                          ('automovil','camioneta','van','microbus','bus','campero','otro')),
  marca                 text,
  modelo                text,
  anio                  int CHECK (anio IS NULL OR (anio BETWEEN 1950 AND 2100)),
  propietario_id        uuid,
  odometro              int CHECK (odometro IS NULL OR odometro >= 0),
  afiliacion_empresa_id uuid,
  afiliacion_desde      date,
  estado                text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo')),
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now(),
  -- R2: Placa ÚNICA POR TENANT (no global) — dos Empresas pueden tener la misma placa.
  UNIQUE (tenant_id, placa)
);
CREATE INDEX idx_vehiculo_tenant ON vehiculo (tenant_id);

-- ---------- Row Level Security (mismo esquema que 0001) ----------
ALTER TABLE vehiculo ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehiculo FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_vehiculo ON vehiculo
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

COMMIT;

-- Notas:
--  - La Placa es inmutable (R3): el dominio no la muta y no hay endpoint que la cambie.
--  - El Odómetro monótono (R6) se impone en el dominio (una lectura menor se rechaza);
--    la columna solo guarda la última lectura autoritativa.
--  - Eventos VehiculoRegistrado/VehiculoAfiliado/OdometroActualizado -> `outbox` (0001).
