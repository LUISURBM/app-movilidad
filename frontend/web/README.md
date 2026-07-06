# @fleetspecial/web — Portal administrativo

Portal del operador (Next.js App Router, CSR): **listas claras + semáforo de cumplimiento**, no dashboards de BI. Consume la API **solo** vía el SDK generado del contrato (`@fleetspecial/api`, API First — cero tipos a mano).

## Correr

```bash
# 1. Backend con JWT (mismo flujo del demo, runbook docs/DEMO-APK.md §1-2)
FLEETSPECIAL_JWT_SECRET=<secreto> pnpm start:backend

# 2. Token de operador/admin
npx tsx backend/tool/token-dev.ts   # línea 'eyJ…'

# 3. Portal
pnpm --filter @fleetspecial/web dev  # http://localhost:3001
```

En `/login`: URL de la API (`http://localhost:3000/v1`) + token. Se valida contra `GET /tenants/me`.

## Estructura (docs/09 §4)

- `app/` — rutas: `login/` pública; `(portal)/` autenticada (guardia en su `layout.tsx`).
- `features/` — una carpeta por bounded context (cumplimiento, vehiculos, conductores, documentos, servicios, combustible, usuarios): hooks de datos (TanStack Query) + formularios.
- `shared/ui/` — design system mínimo (`SemaforoBadge`, `Tabla`, `Modal`, `ProblemAlert`…).
- `lib/` — sesión + cliente API (`api.tsx`), presentación es-CO (`format.ts`).

Decisiones: TanStack Query para estado de servidor, sin Redux (anti-sobreingeniería); todo CSR — el portal es interno y vive detrás del JWT, SSR no aporta; errores RFC 7807 con encabezados del dominio (`incumplimiento` → "Bloqueado por la regla de oro", `conflicto_horario` → "Choque de agenda"); asignación con `advertencias` (semáforo amarillo) se muestra tras asignar, tal como manda spec-009.

## Deudas conscientes

- **Login v0 por token pegado** (localStorage). El contrato aún no define login con credenciales; cuando exista la spec (OIDC o password), solo cambia `lib/api.tsx` + `app/login/`. Riesgo XSS de localStorage aceptado para uso interno dev.
- **Adjuntos de documentos**: el contrato define `POST /documentos/{id}/adjunto` pero el backend no lo implementa aún; la UI no ofrece subir (solo mostraría `tieneAdjunto`).
- **Paginación**: las listas piden `pageSize` alto y no pintan paginador (flota pequeña). Añadirlo cuando un tenant supere ~50 filas.
- **`useMapaSujetos`** resuelve nombres con 2 listados (≤200); si la flota crece, pedir al contrato un `include` o endpoint de búsqueda.
- **RBAC en UI**: los 403 del backend se muestran tal cual; ocultar secciones por rol cuando el JWT traiga roles al front.

## Verificación

`pnpm --filter @fleetspecial/web typecheck | test | build` — mismo trío que corre el job `frontend_web` del CI. Tests: formato es-CO, semáforo, mapeo Problem→mensaje y guardia de sesión (17).
