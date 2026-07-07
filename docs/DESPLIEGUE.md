# Despliegue E0 — un VPS barato, Docker Compose y TLS automático

Camino a producción **bootstrapping** (ADR-0006: contenedores portables, sin atadura de
nube): un VPS de ~2 vCPU / 4 GB (Hetzner/Contabo/DigitalOcean, USD 5–15/mes) corre
Postgres + API + portal + Caddy. Migrar de proveedor = mover el volumen y el `.env`.

## 1. Requisitos

- VPS con Ubuntu 22+/Debian 12 y Docker + plugin compose (`curl -fsSL https://get.docker.com | sh`).
- Dominio con DOS registros A hacia la IP del VPS: `DOMINIO` y `api.DOMINIO`.
- Puertos 80 y 443 abiertos.

## 2. Instalar

```bash
git clone <repo> fleetspecial && cd fleetspecial/infrastructure/docker
cp .env.example .env
openssl rand -base64 32   # → POSTGRES_PASSWORD
openssl rand -base64 32   # → FLEETSPECIAL_JWT_SECRET
nano .env                 # DOMINIO, CORREO_TLS y los dos secretos
docker compose up -d --build
```

El servicio `migrador` aplica `backend/migrations/*.sql` en orden (tabla de control
`esquema_migracion`, candado consultivo, transacción por archivo) y termina; la API
arranca después con `FLEETSPECIAL_PERSISTENCIA=postgres`.

## 3. Humo (2 minutos)

```bash
curl -s https://api.$DOMINIO/v1/health          # {"status":"ok"}

# Registrar la Empresa (spec-001 + spec-015: con la contraseña del primer admin):
curl -s https://api.$DOMINIO/v1/tenants -H 'Content-Type: application/json' -d '{
  "empresa": { "razonSocial": "Transporte Duster SAS", "nit": "900123456" },
  "administrador": { "nombre": "Luis", "correo": "luis@sudominio.co", "password": "UNA-CLAVE-LARGA" },
  "aceptaTratamientoDatos": true
}'
```

Portal: `https://$DOMINIO` → URL de la API `https://api.$DOMINIO/v1` → correo y
contraseña. Desde ahí: catálogo (SOAT/RTM…), vehículo, documentos, servicios.

App del conductor: URL `https://api.$DOMINIO/v1` + token (invitar al conductor y
usar su sesión, o `backend/tool/token-dev.ts` con el MISMO `FLEETSPECIAL_JWT_SECRET`).

## 4. Operación

```bash
docker compose logs -f api            # logs (notificaciones salen por consola aún)
docker compose ps                     # estado
docker compose up -d --build          # actualizar tras un git pull (migra solo lo nuevo)
```

**Backups (crontab diario, retiene 14):**

```bash
0 2 * * * cd /ruta/fleetspecial/infrastructure/docker && docker compose exec -T db pg_dump -U fleetspecial fleetspecial | gzip > /var/backups/fleetspecial-$(date +\%F).sql.gz && ls -t /var/backups/fleetspecial-*.gz | tail -n +15 | xargs -r rm
```

Los adjuntos viven en el volumen `datos_adjuntos` (respáldelo con `docker run --rm
-v fleetspecial_datos_adjuntos:/d -v /var/backups:/b alpine tar czf /b/adjuntos-$(date +%F).tgz -C /d .`).

## 5. Decisiones y deudas (honestas, para E1)

- **Rol de base de datos**: la API conecta como `fleetspecial` (dueño de la BD). Las
  políticas RLS de las migraciones NO aplican a ese rol; el aislamiento por tenant lo
  garantizan los adaptadores (filtro explícito `tenant_id` en cada query, verificado por
  suites) y RLS protege cualquier acceso con roles normales (psql, reportes, futuros
  servicios). **Deuda E1**: rol dedicado sin bypass + `runInTenant` en los adaptadores.
- **tsx en runtime** (sin build a dist/): despliegue = el código TS. Simple y suficiente
  hoy; compilar cuando duela el arranque o la memoria.
- **Alertas por email**: con `FLEETSPECIAL_SMTP_URL` en `.env` (Brevo gratis, Gmail app
  password o cualquier SMTP), los vencimientos y asignaciones rechazadas llegan al correo
  de los usuarios Activos Admin/Operador de cada Empresa. Sin SMTP, salen por
  `docker compose logs api`. Si el SMTP falla, el outbox reintenta con backoff (nada se pierde).
- **Escalar**: la API es stateless (estado en Postgres + volumen de adjuntos); el
  dispatcher del outbox usa `SKIP LOCKED` (varios workers sin pisarse). Réplicas o
  Kubernetes (infrastructure/k8s) sin reescribir — solo cambia el target.
- **La suite completa y las integraciones PGlite validan los adaptadores SQL**; la
  composición postgres end-to-end se ensaya con este compose (paso 3). No hay entorno
  de staging aún: es deliberado (un solo tenant real operando).
