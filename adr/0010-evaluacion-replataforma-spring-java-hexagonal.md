# ADR 0010 — Mantener NestJS/TypeScript tras evaluar la re-plataforma a un stack hexagonal Spring/Java

- **Estado:** Aceptada
- **Fecha:** 2026-07-08
- **Decisores:** Equipo de arquitectura
- **Relacionada con:** [ADR-0001](0001-monolito-modular-vs-microservicios.md), [ADR-0002](0002-stack-backend.md), [ADR-0004](0004-eventos-outbox-pattern-sin-broker.md), [ADR-0006](0006-independencia-de-nube-contenedores-iac.md), [ADR-0008](0008-multi-tenant-shared-db-rls.md)

> **Esta ADR no supersede a la [0002](0002-stack-backend.md).** La **reafirma** tras una evaluación explícita del stack alternativo y le añade **condiciones de reapertura** (triggers). Si en el futuro se dispara uno de esos triggers, la decisión se revisará en un ADR nuevo que sí superseda a la 0002.

## Contexto y problema

En una sesión de investigación reciente se produjo un estudio a fondo de una **arquitectura hexagonal sobre un stack JVM/Spring** (carpeta `investigacion-stack/`: 4 documentos, ~5.900 líneas, 40 patrones + 40 antipatrones, ~170 bloques de código con referencias verificadas). El stack estudiado, con versiones verificadas a julio de 2026, es:

| Componente | Versión estudiada | Rol propuesto |
|---|---|---|
| Spring Boot | 4.1.0 | Framework de aplicación |
| Spring Modulith | 2.1.0 | Monolito modular con **verificación de fronteras** y **tests de módulo** nativos |
| Apache KIE / Drools | 10.2.0 (DMN 1.6) | **Motor de reglas** de negocio (semáforo, regla de oro) editable como DMN |
| PostgreSQL / Flyway | 18.4 / 12.x | Persistencia y migraciones |
| Apache Kafka / Debezium | 4.3.0 / 3.6 | Eventos y **CDC** (Change Data Capture) |

El estudio plantea, de forma implícita, una pregunta de arquitectura de primer orden: **¿debe FleetSpecial re-plataformar su backend desde el actual NestJS/TypeScript ([ADR-0002](0002-stack-backend.md)) hacia este stack Spring/Java hexagonal?**

El **contexto del momento** es decisivo y no puede ignorarse:

- El **MVP (horizonte H0) está prácticamente code-complete y probado**: 7 bounded contexts implementados (Identidad, Flota, Conductores, Cumplimiento, Programación, Combustible, Mantenimiento), **suite E2E en verde** para la *regla de oro* (spec-005→009) y para el *flujo offline* del conductor (spec-010), portal web en Next.js, app Flutter, multi-tenant con **RLS** real y **outbox** para eventos.
- Estamos **en la puerta del dogfooding** con la Duster real —el hito que valida (o refuta) el negocio (Fase 1, roadmap H0).
- El equipo es de **1–3 personas** en **bootstrapping** con **time-to-market** como restricción dominante (las mismas premisas de [ADR-0001](0001-monolito-modular-vs-microservicios.md) y [ADR-0002](0002-stack-backend.md)).

> Nota de trazabilidad: los artefactos de la investigación quedaron en outputs efímeros de aquella sesión, **fuera del repositorio**. Esta ADR destila su esencia para dejar memoria de la decisión; se recomienda commitear una versión resumida del estudio en `docs/` (ver Consecuencias).

## Drivers de decisión

- **No sobreingeniería** (principio rector explícito del blueprint).
- **Costo de oportunidad / time-to-market**: no descartar un MVP que ya funciona y está probado.
- **Realidad de talento y contratación**: ¿el equipo que sostendrá el producto es predominantemente TypeScript o JVM/Spring? Este driver puede **invertir** la premisa de "un solo cerebro" de [ADR-0002](0002-stack-backend.md).
- **Independencia de framework** y **costura de extracción de módulos** ([ADR-0001](0001-monolito-modular-vs-microservicios.md)): el dominio es Clean Architecture y portable.
- **Ajuste al dominio (DDD)** y a las **reglas de negocio** (semáforo, regla de oro): ¿justifican hoy un motor de reglas?
- **Costo operativo en un VPS barato** (bootstrapping): footprint de Node vs JVM.
- **Evolución a escala** (H2/H3): eventos/CDC y rendimiento.

## Opciones consideradas

1. **Mantener NestJS/TypeScript (elegida).** Consolidar el MVP existente; **cosechar ideas** del estudio como costuras y triggers, sin cambiar de runtime.
2. **Re-plataforma *big-bang* a Spring Modulith/Java hexagonal.** Reescribir el backend completo sobre el stack estudiado antes de continuar.
3. **Híbrido / extracción parcial a JVM.** Mantener el monolito TS y extraer a un servicio JVM/Spring **solo un contexto concreto** cuando un driver real lo exija (p. ej. Telemetry en H2, o un motor de reglas DMN si la complejidad regulatoria explota), usando la costura de [ADR-0001](0001-monolito-modular-vs-microservicios.md).

## Decisión

**Mantenemos NestJS/TypeScript para H0 y H1. No re-plataformamos ahora.**

Razones:

1. **El MVP ya está construido y probado.** Una reescritura *big-bang* significaría **tirar software que funciona justo antes de validarlo** con la Duster. Eso viola frontalmente el time-to-market y el principio rector *"útil para un vehículo antes que para mil"*. El costo de oportunidad no tiene contrapartida técnica que lo justifique **hoy**.
2. **Drools + Kafka + Debezium es maquinaria que el blueprint difirió a propósito.** [ADR-0004](0004-eventos-outbox-pattern-sin-broker.md) decidió **outbox ahora, broker solo cuando el volumen lo pida (H3)**. Adoptar CDC/streaming en el MVP es sobreingeniería de manual.
3. **Las reglas de negocio actuales son simples.** El semáforo (umbrales 30/15/3 días) y la regla de oro (rojo bloquea, amarillo advierte) se expresan en pocas líneas de dominio ya probadas. Un motor de reglas (Drools/DMN) resuelve una combinatoria regulatoria que **aún no existe**.
4. **A la escala objetivo (1–30 vehículos/tenant), Node sobra.** El análisis de rendimiento de [ADR-0002](0002-stack-backend.md) sigue vigente; el backend es stateless y escala horizontalmente.
5. **Se preserva "un solo cerebro" web+backend en TypeScript** y los tipos de contrato compartidos (OpenAPI → cliente tipado), la ventaja decisiva de [ADR-0002](0002-stack-backend.md).

**Pero la investigación no se descarta:** se cosechan ideas concretas, baratas y alineadas con costuras ya previstas:

- **Verificación de fronteras de módulos en CI** (lo que Spring Modulith da nativo) usando tooling TS —`dependency-cruiser` o `eslint-plugin-boundaries`— para prohibir por build que un módulo alcance el dominio o las tablas de otro. Endurece [ADR-0001](0001-monolito-modular-vs-microservicios.md) sin cambiar de stack.
- **El outbox como costura de CDC.** Se mantiene el patrón outbox; si el volumen lo pide (H3) se migra a broker (Kafka/NATS) y se evalúa Debezium —ya previsto en [ADR-0004](0004-eventos-outbox-pattern-sin-broker.md).
- **Reglas de cumplimiento como datos/tablas** (inspiración DMN) aunque sea en TS: modelar umbrales y tipos requeridos como configuración editable —no como código— para que cambien sin desplegar. Esto prepara una eventual adopción de un motor de reglas **sin acoplarse a él**.

## Triggers de reconsideración

Estas son las condiciones que **reabren** la decisión (posiblemente vía un ADR nuevo que superseda a [ADR-0002](0002-stack-backend.md)):

| # | Trigger | Respuesta recomendada |
|---|---|---|
| **T1** | **Talento JVM.** El equipo que sostiene el producto (p. ej. staffing de la organización) resulta ser predominantemente Java/Spring, invirtiendo el driver "un solo cerebro / contratación barata" de [ADR-0002](0002-stack-backend.md). | Reconsiderar, **preferentemente por extracción incremental (opción 3), no *big-bang***. Confirmar este driver **pronto** es lo más importante de esta ADR. |
| **T2** | **Contexto CPU-bound o de reglas complejas.** GPS live/Telemetry (H2) o un motor de cumplimiento cuya lógica se vuelve combinatoria. | Extraer **ese** módulo a un servicio JVM/Spring propio (costura de [ADR-0001](0001-monolito-modular-vs-microservicios.md)), no reescribir todo. |
| **T3** | **Requisito enterprise (H5).** Un cliente que paga exige capacidades donde el ecosistema JVM es netamente superior (ciertos SSO/SAML, integraciones reguladas). | Evaluar JVM **para ese componente**, bajo demanda concreta y pagada. |
| **T4** | **Volumen/CDC en H3.** El outbox in-process no alcanza. | Adoptar broker + evaluar Debezium. **No requiere cambiar de lenguaje.** |

## Consecuencias (positivas y negativas)

**Positivas:**

- **Cero costo de oportunidad**: el MVP entra a dogfooding ya; se valida el negocio antes de gastar capital en una re-plataforma.
- **Se preserva "un solo cerebro"** web+backend en TS y los tipos de contrato compartidos.
- **Costo operativo mínimo** en un VPS barato (Node ligero frente al footprint de la JVM), alineado con [ADR-0006](0006-independencia-de-nube-contenedores-iac.md).
- **La investigación queda capitalizada**: define costuras y triggers explícitos, y motiva mejoras baratas (fronteras en CI, reglas como datos).
- **Coherencia** con los ADRs vigentes (0001, 0002, 0004) y con los principios rectores.

**Negativas (honestas):**

- **Se posterga el acceso a ventajas reales del ecosistema JVM**: los *module tests* nativos de Spring Modulith, Drools/DMN para reglas editables por negocio, y la madurez enterprise. *Mitigación:* cosechar equivalentes en TS y mantener triggers claros.
- **Si el talento resulta ser JVM (T1), habremos invertido en TS más de lo ideal.** *Mitigación:* confirmar el driver de talento cuanto antes; como el dominio es Clean Architecture y portable, una extracción futura es **refactor acotado, no reescritura** ([ADR-0001](0001-monolito-modular-vs-microservicios.md)).
- **Riesgo percibido de "investigación desperdiciada".** *Mitigación:* commitear una versión destilada del estudio en `docs/` y ejecutar las ideas cosechadas (fronteras en CI, reglas como datos).
- **Disciplina de fronteras sin las herramientas nativas de Modulith.** *Mitigación:* lint de fronteras en CI como acción concreta de seguimiento.

## Alternativas descartadas y por qué

- **Re-plataforma *big-bang* a Spring/Java — descartada (ahora).** Tirar un MVP probado justo antes de validarlo es el antipatrón de bootstrapping por excelencia. El beneficio técnico del stack JVM es real, pero **no compensa el costo de oportunidad ni el riesgo** en este momento. Reconsiderable bajo T1/T2/T3.
- **Híbrido / extracción parcial YA — descartada (ahora, por prematura).** Introducir un segundo runtime (políglota) añade complejidad operativa —dos pipelines, dos entornos de ejecución, dos perfiles— **sin un driver real presente**. Es la forma **correcta** de adoptar JVM cuando T2/T3 se disparen, pero **hoy no hay disparador**.

> **Principios que respeta:** *No sobreingeniería*, *Time-to-market* e *Independencia de framework*. La decisión protege el MVP ya construido y su validación con la Duster, capitaliza la investigación como costuras y triggers, y mantiene el dominio portable para que —si un trigger se dispara— la evolución hacia JVM sea incremental y acotada, nunca una reescritura especulativa.
