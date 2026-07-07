#!/bin/bash
# Crea el rol de la API SIN BYPASS de RLS (E1). Corre SOLO en el primer arranque
# del volumen de datos (docker-entrypoint-initdb.d). Para una base ya existente,
# ejecutar el CREATE ROLE manualmente y re-correr el migrador (ver DESPLIEGUE.md).
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE fleetspecial_app LOGIN NOSUPERUSER NOBYPASSRLS
  PASSWORD '${FLEETSPECIAL_APP_DB_PASSWORD}';
SQL
echo "Rol fleetspecial_app creado (los GRANT los aplica la migración 0011)."
