# ADR 0001 — Monolito modular en vez de microservicios

- **Estado:** Aceptada
- **Fecha:** 2026-06-24
- **Decisores:** Equipo de arquitectura

## Contexto y problema

FleetSpecial nace como un proyecto de **bootstrapping** validado por un fundador con **una sola Renault Duster** antes de escalar a un SaaS multiempresa. El dominio (Fase 2) tiene varios bounded contexts —Vehículos, Conductores, Gestión Documental, Programación de Servicios, Combustible, Mantenimiento, GPS/Telemetría, Notificaciones, Identidad/Tenancy— y existe la tentación, muy común en la industria, de mapear "un bounded context = un microservicio".

El problema a decidir es el **estilo de despliegue del backend**: ¿construimos un sistema distribuido de microservicios desde el día 1, o un único deployable que internamente respete los límites de dominio?

El contexto que pesa: equipo de **1–3 personas**, presupuesto bajo, **time-to-market agresivo** (MVP en 8–12 semanas), y volumen inicial de **1 a unas decenas de vehículos por tenant**. No hay equipos independientes que necesiten desplegar por separado, ni un cuello de botella de escalado que justifique aislar servicios.

## Drivers de decisión

- **No sobreingeniería** (principio rector explícito del blueprint).
- **Time-to-market**: cada hora cuenta para validar el negocio.
- **Costo operativo mínimo** (bootstrapping): menos infra que pagar y operar.
- **Carga cognitiva** para un equipo diminuto: un solo proceso es radicalmente más simple de razonar, depurar y desplegar.
- **DDD bien hecho**: necesitamos límites de dominio claros, pero los límites son **lógicos**, no necesariamente de red.
- **Preservar la opción** de extraer servicios más adelante sin reescribir el dominio.

## Opciones consideradas

1. **Microservicios desde el día 1.** Un servicio por bounded context, con su propia base de datos, comunicación por red y/o mensajería, despliegue independiente.
2. **Monolito "big ball of mud".** Un solo deployable sin límites internos: rápido al inicio, pero degenera en acoplamiento y se vuelve imposible de mantener o de partir después.
3. **Monolito modular (elegida).** Un único deployable, pero internamente dividido en **módulos por bounded context**, cada uno con sus capas de Clean Architecture (domain/application/adapters/infrastructure), comunicándose por eventos de dominio (outbox) o interfaces públicas, nunca alcanzando las tablas o el dominio de otro módulo.

## Decisión

Adoptamos el **monolito modular**: **un solo proceso de backend desplegable** (más un proceso *worker* hermano para jobs asíncronos, ver [ADR-0004](0004-eventos-outbox-pattern-sin-broker.md)), con **fronteras internas estrictas** entre módulos que reflejan los bounded contexts de la Fase 2.

Reglas que hacen "modular" al monolito:

- Cada módulo expone una **interfaz de aplicación pública**; los demás módulos solo la consumen a través de ella.
- **Prohibido** que un módulo lea las tablas o invoque el dominio interno de otro módulo.
- La comunicación entre contextos se prefiere **asíncrona vía eventos de dominio (outbox)** para bajar el acoplamiento.
- El dominio de cada módulo **no depende de frameworks** (Clean Architecture, ver [ADR-0002](0002-stack-backend.md)).

## Consecuencias (positivas y negativas)

**Positivas:**

- **Velocidad máxima de desarrollo y despliegue**: un repo, un build, un deploy; sin orquestar contratos de red entre servicios.
- **Costo operativo bajísimo**: una imagen de contenedor que cabe en un VPS barato (alineado con [ADR-0006](0006-independencia-de-nube-contenedores-iac.md)).
- **Transacciones simples**: operaciones que cruzan contextos pueden ser **una sola transacción ACID** en Postgres (ver [ADR-0003](0003-postgresql-unica-base-de-datos.md)), sin sagas ni consistencia eventual.
- **Depuración trivial**: un stack trace, no diez; trazas locales antes que distribuidas.
- **Opción de evolución preservada**: como los límites ya están dibujados, extraer un módulo a su propio servicio el día que de verdad haga falta es **refactor acotado, no reescritura**.

**Negativas (honestas):**

- **Escalado granular limitado**: no se puede escalar solo el módulo de GPS; se escala todo el monolito (mitigado: el backend es stateless y escala horizontalmente como un todo, suficiente a esta escala).
- **Aislamiento de fallos más débil**: un bug grave puede tumbar todo el proceso (mitigado: el worker está separado; pruebas y límites de módulo reducen el blast radius).
- **Disciplina requerida**: sin fronteras de red que fuercen el desacople, hay que **vigilar activamente** que los módulos no se enreden (mitigado: reglas de import/lint, revisiones de ADR antes de añadir dependencias cruzadas).
- **Un solo stack tecnológico**: todos los módulos comparten lenguaje/runtime (aceptable: es justo lo que queremos para un equipo pequeño).

## Alternativas descartadas y por qué

- **Microservicios desde el día 1 — descartada.** Es **sobreingeniería** de manual para 1–30 vehículos y un equipo de 1–3 personas. Introduce costo operativo (orquestación, service discovery, observabilidad distribuida), complejidad de datos (consistencia eventual, sagas) y fricción de despliegue que **mataría el time-to-market** sin resolver ningún problema real que tengamos hoy. Los microservicios resuelven problemas de **organización y escala** que aún no existen.
- **Monolito sin módulos ("big ball of mud") — descartada.** Rápido al inicio pero **deuda técnica garantizada**: se vuelve imposible de mantener y, peor, **imposible de partir** cuando el crecimiento lo exija. El monolito modular cuesta apenas un poco más de disciplina y conserva la opción de evolución.

> **Principio que respeta:** *No sobreingeniería* y *Domain Driven Design*. Esta decisión es la encarnación directa de "monolito modular antes que microservicios" del README, y preserva los límites de dominio sin pagar el costo de un sistema distribuido prematuro.
