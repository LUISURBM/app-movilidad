# ADR 0009 — pnpm como gestor de paquetes del monorepo

- **Estado:** Aceptada
- **Fecha:** 2026-06-25
- **Decisores:** Equipo de arquitectura

## Contexto y problema

El repositorio es un **monorepo** (Fase 9) con varios paquetes TypeScript que comparten el contrato OpenAPI: el backend NestJS, el portal web Next.js y el SDK generado (`frontend/shared/api`). La app móvil es Flutter (Dart) y queda fuera del gestor JS. Necesitamos un gestor de paquetes para el lado JavaScript/TypeScript que: (a) maneje **workspaces** de forma robusta, (b) sea **rápido y eficiente en disco** —importa para bootstrapping y CI—, y (c) reduzca el riesgo de **cadena de suministro**, dado que somos un equipo de 1–3 personas que no puede auditar cada dependencia a mano.

## Drivers de decisión

- **Monorepo de primera clase** (varios paquetes que se referencian entre sí).
- **Bootstrapping:** instalación rápida y bajo uso de disco (un *store* compartido), CI veloz.
- **Cumplimiento / seguridad** (restricción del proyecto): defensas frente a paquetes maliciosos.
- **Equipo pequeño:** convenciones claras, poca ceremonia, "correcto por defecto".
- **Independencia:** no atarse a un runtime nuevo solo para instalar paquetes.

## Opciones consideradas

- **npm** (viene con Node): máxima compatibilidad, pero el más lento, workspaces básicos y manejo torpe de `overrides`.
- **pnpm 11.x:** workspaces excelentes, *store* global con enlaces duros (rápido y ahorra disco), y defensas de cadena de suministro: sin `postinstall` por defecto y `minimumReleaseAge` para retrasar la adopción de versiones recién publicadas.
- **Yarn (Berry/4.x):** sólido (PnP, plugins) pero perdió impulso para proyectos nuevos; sin ventaja decisiva sobre pnpm aquí.
- **Bun (1.3.x) como instalador:** el más rápido y un *toolkit* todo-en-uno; `bun install` funciona en proyectos Node. Muy atractivo, pero mezcla la decisión de **gestor** con la de **runtime/bundler/test**; preferimos no acoplar tantas decisiones a la vez en el MVP.

## Decisión

Adoptar **pnpm** como gestor de paquetes oficial del monorepo JS/TS. Se define un `pnpm-workspace.yaml` en la raíz que incluye `backend`, `frontend/*` y `frontend/shared/*`. Se habilitan, cuando estén disponibles en la versión instalada, las defensas de cadena de suministro (bloqueo de scripts de instalación no confiables y `minimumReleaseAge`).

## Consecuencias

**Positivas**
- Workspaces robustos: dependencias internas (p. ej. el SDK) se enlazan sin publicar.
- Instalaciones rápidas y `node_modules` compacto → CI más barato (bootstrapping).
- Mejor postura de seguridad por defecto (sin postinstall, ventana de maduración de versiones).
- El `node_modules` estricto de pnpm **destapa dependencias mal declaradas** (phantom deps), forzando correctitud.

**Negativas / costos**
- Curva de aprendizaje mínima para quien venga de npm; comandos equivalentes (`pnpm install`, `pnpm -r`, `pnpm --filter`).
- El layout con enlaces simbólicos ocasionalmente rompe herramientas que asumen el `node_modules` plano de npm (mitigable con `node-linker=hoisted` si fuese necesario).
- Hay que tener `pnpm` instalado (vía Corepack) en dev y CI.

## Alternativas descartadas y por qué

- **npm:** suficiente para un paquete único, pero su pobre manejo de monorepo y `overrides`, y su menor velocidad, no encajan con un monorepo en bootstrapping.
- **Yarn:** sin ventaja clara sobre pnpm para empezar de cero; más complejidad (PnP) sin beneficio proporcional.
- **Bun como gestor:** excelente rendimiento, pero adoptarlo arrastra la tentación de cambiar también runtime/test/bundler; se mantiene como **opción futura** (ver Fase 10, costuras). Si se decidiera, su `bun install` es compatible y la migración desde pnpm es directa.

> **Principio que respeta:** *No sobreingeniería* (una sola herramienta de paquetes, sin cambiar de runtime), *bootstrapping* (rápido y barato) y la restricción de **cumplimiento/seguridad** del proyecto. No introduce lock-in: el `package.json` es estándar y se puede migrar a otro gestor.
