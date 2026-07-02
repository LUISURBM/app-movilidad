-- =====================================================================
-- Migración 0002 — Contexto Service Scheduling (CORE) — spec-008/009
-- Multi-tenant con Row Level Security (ADR-0008). Requiere la 0001 (outbox, helper).
--
-- Defensa en profundidad de la Invariante S4 (no double-booking):
--   1) La capa de aplicación detecta choques ANTES de asignar (agenda.service).
--   2) La base los IMPIDE físicamente ante condiciones de carrera, con
--      EXCLUDE USING gist sobre tstzrange(ventana) por vehículo y por conductor.
--      La ventana es SEMIABIERTA `[inicio, fin)` — igual que en el dominio —
--      por lo que dos ventanas consecutivas NO chocan.
-- =====================================================================

BEGIN;

-- Requerido para EXCLUDE con igualdad sobre uuid dentro de índices GiST.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------- Servicios (Asignación embebida, 1:1 como en el contrato) ----------
CREATE TABLE servicio (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  origen          text NOT NULL,
  destino         text NOT NULL,
  ventana_inicio  timestamptz NOT NULL,
  ventana_fin     timestamptz NOT NULL,
  cliente         text,
  estado          text NOT NULL DEFAULT 'Planificado'
                  CHECK (estado IN ('Planificado','Iniciado','Finalizado','Cancelado')),
  -- Asignación (spec-008 R3): ambos o ninguno.
  vehiculo_id     uuid,
  conductor_id    uuid,
  advertencias    jsonb NOT NULL DEFAULT '[]',
  inicio_real     timestamptz,
  fin_real        timestamptz,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  -- La ventana es un intervalo válido (spec-008 R5).
  CONSTRAINT chk_ventana_valida CHECK (ventana_fin > ventana_inicio),
  -- Asignación completa o ausente (Vehículo Y Conductor van juntos).
  CONSTRAINT chk_asignacion_completa CHECK (
    (vehiculo_id IS NULL AND conductor_id IS NULL) OR
    (vehiculo_id IS NOT NULL AND conductor_id IS NOT NULL)
  )
);

CREATE INDEX idx_servicio_tenant_estado    ON servicio (tenant_id, estado);
CREATE INDEX idx_servicio_tenant_vehiculo  ON servicio (tenant_id, vehiculo_id);
CREATE INDEX idx_servicio_tenant_conductor ON servicio (tenant_id, conductor_id);
CREATE INDEX idx_servicio_tenant_ventana   ON servicio (tenant_id, ventana_inicio);

-- Invariante S4 a nivel de base: ninguna Asignación ACTIVA (Planificado|Iniciado)
-- del mismo Vehículo puede solapar su ventana con otra. `tstzrange(...,'[)')` es
-- semiabierto: consecutivas NO chocan (spec-008 R5). El tenant participa con
-- igualdad: recursos de Empresas distintas jamás chocan entre sí (R12).
ALTER TABLE servicio ADD CONSTRAINT excl_vehiculo_sin_solape
  EXCLUDE USING gist (
    tenant_id   WITH =,
    vehiculo_id WITH =,
    tstzrange(ventana_inicio, ventana_fin, '[)') WITH &&
  )
  WHERE (vehiculo_id IS NOT NULL AND estado IN ('Planificado','Iniciado'));

-- Ídem para el Conductor.
ALTER TABLE servicio ADD CONSTRAINT excl_conductor_sin_solape
  EXCLUDE USING gist (
    tenant_id    WITH =,
    conductor_id WITH =,
    tstzrange(ventana_inicio, ventana_fin, '[)') WITH &&
  )
  WHERE (conductor_id IS NOT NULL AND estado IN ('Planificado','Iniciado'));

-- =====================================================================
-- Row Level Security (mismo esquema que la 0001; usa app_current_tenant()).
-- =====================================================================

ALTER TABLE servicio ENABLE ROW LEVEL SECURITY;
ALTER TABLE servicio FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_servicio ON servicio
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

COMMIT;

-- =====================================================================
-- Notas de operación
--  - La regla de oro (S3, spec-009) NO se refuerza en base: es una colaboración
--    entre contextos (ACL a Compliance) y se decide en la capa de aplicación.
--    El estado documental cambia con el tiempo; la base solo persiste la decisión.
--  - Recordar GRANT al rol de aplicación (ver notas de la 0001).
-- =====================================================================
