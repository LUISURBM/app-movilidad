-- =====================================================================
-- Migración 0004 — Contexto Fuel Management (BC-6, spec-011)
-- Tanqueo append-only e idempotente + lectura autoritativa de Odómetro.
-- Requiere 0001 (helper RLS `app_current_tenant()`, pgcrypto y tabla `outbox`).
--
-- Estrategia (igual que 0001/0003):
--   1) El código filtra por tenant_id (repos).
--   2) RLS lo GARANTIZA a nivel de base aunque el código tenga un bug.
-- =====================================================================

BEGIN;

-- ---------- Tanqueos (hechos inmutables, append-only) ----------
CREATE TABLE tanqueo (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  -- UUID de idempotencia generado en el dispositivo (spec-011 R4).
  client_id    uuid NOT NULL,
  vehiculo_id  uuid NOT NULL,
  cantidad     numeric(12,3) NOT NULL CHECK (cantidad > 0),        -- R6: positiva
  unidad       text NOT NULL CHECK (unidad IN ('litros','galones')),
  valor_cop    bigint NOT NULL CHECK (valor_cop > 0),              -- R6: positivo (pesos)
  odometro     int NOT NULL CHECK (odometro >= 0),
  ocurrido_en  timestamptz NOT NULL,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  -- Idempotencia (R5): un solo Tanqueo por (tenant, client_id). Dedupe físico ante carreras.
  UNIQUE (tenant_id, client_id)
);
CREATE INDEX idx_tanqueo_tenant_vehiculo ON tanqueo (tenant_id, vehiculo_id, ocurrido_en);

-- ---------- Lectura autoritativa del Odómetro por Vehículo ----------
-- Stand-in de BC-2 Fleet Management (spec-003) mientras ese contexto no exista.
-- La monotonía (Política P8, R8) se aplica con GREATEST al sincronizar: una lectura
-- menor a la autoritativa es anomalía y NO retrocede la lectura.
CREATE TABLE odometro_vehiculo (
  tenant_id      uuid NOT NULL,
  vehiculo_id    uuid NOT NULL,
  lectura        int  NOT NULL CHECK (lectura >= 0),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, vehiculo_id)
);

-- ---------- Row Level Security (mismo esquema que 0001/0003) ----------
ALTER TABLE tanqueo          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tanqueo          FORCE  ROW LEVEL SECURITY;
ALTER TABLE odometro_vehiculo ENABLE ROW LEVEL SECURITY;
ALTER TABLE odometro_vehiculo FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tanqueo ON tanqueo
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

CREATE POLICY tenant_isolation_odometro ON odometro_vehiculo
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

COMMIT;

-- Notas:
--  - El evento `CombustibleRegistrado` se escribe en `outbox` (creada en 0001) en la
--    MISMA transacción que el INSERT del Tanqueo (ADR-0004).
--  - Cuando exista BC-2 Fleet (spec-003), `odometro_vehiculo` se reemplaza por la
--    lectura autoritativa del Vehículo sin tocar el dominio de Fuel (puerto/ACL).
