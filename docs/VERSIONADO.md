# Versionado y respaldo del repositorio

## Decisión (2026-07-02)

- **Git + GitHub, repositorio PRIVADO** bajo la cuenta **personal** del fundador.
- El monorepo se versiona completo tal como está (docs, specs, adr, contracts,
  backend, frontend, mobile, infrastructure): el blueprint es tan valioso como
  el código y evolucionan juntos.

## Por qué GitHub privado

1. **CI pendiente:** el siguiente track técnico es GitHub Actions (la suite de
   142 tests debe correr en cada push); tener el repo ahí elimina fricción.
2. **Costo cero** en plan free (repos privados ilimitados, 2.000 min/mes de
   Actions) — coherente con la restricción de bootstrapping.
3. Ecosistema: Dependabot, code scanning, PR reviews cuando crezca el equipo.

## Higiene

- El repo es **personal**: no mezclar con cuentas/organizaciones del empleador.
- **Nunca** commitear secretos: `.env*` ya está en `.gitignore`; el secreto JWT
  (`FLEETSPECIAL_JWT_SECRET`) y credenciales SMTP/DB viven solo en variables de
  entorno o en GitHub Secrets para CI.
- Archivos personales ajenos al producto (p. ej. cartas/correos .docx sueltos)
  van fuera del repo.

## Primer commit — comandos (PowerShell o Git Bash en Windows)

```powershell
cd C:\Users\luis.urbina\ws\app-movilidad

# (opcional) mover fuera lo que no es del producto
# move ".\Redaccion Correo Bladex_coellor.docx" "$HOME\Documents\"

git init -b main
git add .
git status          # revisar la lista antes del primer commit
git commit -m "feat: blueprint completo + backend CORE (specs 005-010) con 142 tests

- Compliance & Documents: documentos, semáforo, renovación, catálogo configurable
- Service Scheduling: servicios, regla de oro vía ACL, sync offline (idempotencia,
  bitácora, versión optimista)
- Plataforma: outbox dispatcher + notificaciones, job diario, auth JWT/dev
- Migraciones 0001-0003 (RLS, EXCLUDE, idempotencia) + contratos OpenAPI/AsyncAPI"

git tag v0.1.0-backend-core
```

Luego crear el repo privado en GitHub (sin README ni .gitignore, ya existen) y:

```powershell
git remote add origin https://github.com/<TU_USUARIO>/fleetspecial.git
git push -u origin main --tags
```

## Convenciones desde ahora

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`) —
  alineado con las specs: citar la spec en el cuerpo cuando aplique.
- **Trunk-based** simple mientras el equipo sea de 1: commits pequeños a `main`
  con la suite en verde; ramas + PR cuando llegue CI o un segundo dev.
- **Tags** por hito (`v0.1.x` backend, `v0.2.x` cuando exista la app Flutter).
