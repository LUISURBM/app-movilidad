# spec-015 — Autenticación con credenciales (login de correo y contraseña)

- **Bounded Context:** BC-1 Identity & Access
- **Prioridad:** MVP (bloquea uso real multi-usuario y el camino a producción E0)
- **Estado:** Implemented
- **Aprobada por:** Luis (Product Manager + dominio) · 2026-07-06 (Draft → Approved → Implemented en la misma sesión, autorizado por el PM — mismo esquema que spec-012/014)
- **Specs relacionadas:** spec-001 (onboarding crea el primer admin), spec-002 (invitación y ciclo de vida de usuarios)

## Objetivo

Que las personas entren al portal con **correo y contraseña**, sin pegar tokens generados por CLI. Cierra el ciclo de spec-001/002: el administrador define su contraseña al registrar la Empresa; un invitado la define al **aceptar la invitación con un código de un solo uso**; cualquier usuario puede **cambiar su contraseña**. El resultado del login es el mismo **JWT HS256** que ya protege toda la API (claims `sub`, `tenant_id`, `roles`).

## Actor(es)

- **Visitante** (pre-tenant): inicia sesión o acepta una invitación.
- **Administrador/Owner**: invita usuarios y entrega el código de invitación.
- **Usuario autenticado**: cambia su propia contraseña.

## Reglas de negocio

1. La contraseña se almacena SOLO como hash **scrypt** (`node:crypto`, sal por credencial, verificación en tiempo constante). Nunca en claro, nunca reversible. Mínimo **10 caracteres**.
2. **Login** (`POST /auth/login`, público): correo + contraseña. El correo puede existir en **varios tenants** (spec-002 permite el mismo correo por tenant): si hay más de una credencial para el correo, se responde `409 multiples_empresas` y el cliente reenvía con `empresaNit` para desambiguar.
3. Ante credenciales inválidas la respuesta es **401 `credenciales_invalidas`** sin distinguir si falló el correo o la contraseña (no filtrar existencia de cuentas).
4. Solo un usuario **Activo** puede iniciar sesión: invitado sin aceptar, suspendido, removido o expirado → `403 usuario_no_activo` (el mensaje no distingue el motivo exacto).
5. El token emitido expira (por defecto **8 horas**). La renovación es volver a iniciar sesión (refresh tokens = V1).
6. **Invitación con código de un solo uso**: `POST /usuarios` (spec-002) ahora genera un código aleatorio de alta entropía que se muestra **una sola vez** al Administrador (el canal de entrega es humano mientras no haya email — spec-006 gap). En la base solo se guarda el **hash** del código, con expiración de **7 días** (R9 de spec-002).
7. **Aceptar invitación** (`POST /auth/aceptar-invitacion`, público): código + contraseña nueva → el usuario pasa a Activo (transición de spec-002), queda con credencial y **recibe sesión de inmediato** (mismo response del login). Código usado o vencido → `410 invitacion_no_valida`.
8. **Cambiar contraseña** (`POST /auth/password`, autenticado): exige la contraseña actual; `401 credenciales_invalidas` si no coincide.
9. El registro de Empresa (spec-001, `POST /tenants`) ahora exige la **contraseña del primer administrador** en el contrato. (En el caso de uso es opcional para soportar importaciones/legacy; el REST siempre la envía.)
10. Las credenciales e invitaciones son **pre-tenant** por naturaleza (el login ocurre antes de conocer el tenant): viven en tablas SIN RLS, accesibles únicamente por los casos de uso de autenticación. Todo lo demás sigue tenant-scoped.
11. Si el backend no tiene `FLEETSPECIAL_JWT_SECRET` configurado (modo dev por headers), los endpoints de auth responden `503 auth_no_configurada`: el login real requiere el emisor de tokens.
12. Deudas anotadas (no MVP): rate-limiting/lockout de intentos, "olvidé mi contraseña" (requiere canal de email real), refresh tokens, OIDC/Keycloak como emisor alternativo (el puerto `EmisorTokens` es la costura).

## Criterios de aceptación (Gherkin)

```gherkin
# language: es
Característica: Autenticación con correo y contraseña
  Como persona de una Empresa
  Quiero iniciar sesión con mis credenciales
  Para usar el portal sin tokens manuales

  Escenario: El administrador entra con la contraseña definida al registrar la Empresa
    Dado que se registró la Empresa "Transporte Duster SAS" con administrador "luis@duster.co" y contraseña válida
    Cuando inicia sesión con ese correo y contraseña
    Entonces recibe un token de sesión con sus roles y su tenant
    Y puede consultar la API con ese token

  Escenario: Credenciales inválidas no revelan qué falló
    Cuando alguien inicia sesión con un correo inexistente o una contraseña errada
    Entonces recibe 401 "credenciales_invalidas" en ambos casos

  Escenario: Invitación aceptada con código de un solo uso
    Dado que el Administrador invitó a "ana@duster.co" y obtuvo el código una sola vez
    Cuando Ana acepta la invitación con el código y define su contraseña
    Entonces queda Activa, recibe sesión de inmediato
    Y el mismo código ya no sirve una segunda vez

  Escenario: Un suspendido no puede iniciar sesión
    Dado que "ana@duster.co" fue suspendida
    Cuando intenta iniciar sesión con credenciales correctas
    Entonces recibe 403 "usuario_no_activo"

  Escenario: Cambio de contraseña exige la actual
    Dado que Ana está autenticada
    Cuando cambia su contraseña enviando la actual correcta y una nueva válida
    Entonces la nueva contraseña sirve para entrar y la anterior deja de servir

  Escenario: Mismo correo en dos Empresas exige desambiguar
    Dado que "conta@externa.co" tiene credenciales en dos Empresas
    Cuando inicia sesión sin indicar la Empresa
    Entonces recibe 409 "multiples_empresas"
    Y al reenviar con el NIT de la Empresa entra a esa Empresa
```

## Notas de implementación (2026-07-06)

- **Puertos nuevos** (`application/auth.ports.ts`): `CredencialRepository` (por correo global y por tenant+usuario), `InvitacionRepository` (por hash de código), `HasherPassword` (scrypt), `EmisorTokens` (JWT HS256 sobre `platform/jwt.ts`), `GeneradorCodigos`.
- **Casos de uso nuevos** (`application/auth.use-cases.ts`): `IniciarSesion`, `AceptarInvitacionConCodigo`, `CambiarPassword`. `RegistrarTenant` e `InvitarUsuario` se extendieron con `auth?`/código de invitación (campos opcionales en `IdentityDeps` — sin ripple en tests previos).
- **REST**: `AuthController` (`/auth/*`); `POST /usuarios` responde ahora `Usuario & { invitacion? }`. El middleware dev exenta `/auth/login` y `/auth/aceptar-invitacion`.
- **Persistencia**: migración `0010_auth_credenciales.sql` — `credencial_acceso` e `invitacion_pendiente` sin RLS (regla 10) + adaptadores SQL en `infrastructure/auth.sql-adapters.ts`.
- **AceptarInvitacion (spec-002, por id) se conserva** como override administrativo vía `PATCH /usuarios {estado:"activo"}`; sin credencial, ese usuario aún no puede iniciar sesión.
- **Portal**: login por correo/contraseña (el modo token queda como "avanzado"), código de invitación mostrado una sola vez con copiar, y cambio de contraseña desde la cabecera.
- **seed-demo/token-dev**: el seed envía la contraseña del admin; `token-dev.ts` sigue vigente para la app móvil y soporte.
