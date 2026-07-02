# ADR 0002 — Backend en NestJS sobre TypeScript

- **Estado:** Aceptada
- **Fecha:** 2026-06-24
- **Decisores:** Equipo de arquitectura

## Contexto y problema

Necesitamos elegir **un** lenguaje y framework para el backend de FleetSpecial. El móvil ya está definido (Flutter, ver [ADR-0005](0005-offline-first-sqlite-sync.md)) y el frontend web se inclina por React/Next.js (Fase 5). Falta decidir el corazón del servidor: la API, los casos de uso, la persistencia y el worker.

Las restricciones son las del blueprint: **equipo de 1–3 personas**, **bootstrapping** (costo bajo), **time-to-market agresivo**, **tipado fuerte** (para que el dominio sea seguro y los agentes IA generen código fiable), y **independencia de framework** (el dominio no debe acoplarse al framework elegido). No buscamos el pico de rendimiento de un sistema de alto tráfico; buscamos el **máximo throughput de un equipo diminuto** sin sacrificar calidad ni portabilidad.

## Drivers de decisión

- **Velocidad de un solo desarrollador full-stack** (el factor dominante en bootstrapping).
- **Tipado fuerte** end-to-end.
- **Tamaño del ecosistema** (librerías para Postgres, OpenAPI, OTel, JWT, etc.).
- **Costo de contratación**: cuántos perfiles del mercado pueden tomar el proyecto.
- **Ajuste a Clean Architecture y DDD modular** (un framework que no estorbe los límites).
- **Independencia de framework**: poder cambiar de framework sin reescribir el dominio.

## Opciones consideradas

1. **NestJS sobre TypeScript (Node.js) — elegida.** Framework con arquitectura modular nativa (módulos, providers, inyección de dependencias) que mapea casi 1:1 a bounded contexts y a Clean Architecture; mismo lenguaje que el web.
2. **.NET 8 (C#).** Tipado excelente, runtime muy rápido, ecosistema maduro, gran tooling. Lenguaje distinto del web.
3. **Spring Boot (Java/Kotlin).** Extremadamente maduro, robusto en entornos enterprise, vasto ecosistema. Más verboso y pesado; lenguaje distinto del web.
4. **Go.** Simple, rápido, binarios livianos. Ecosistema de dominio/ORM menos ergonómico para CRUD intensivo y DDD; tipado bueno pero menos expresivo para modelar dominio rico.

## Decisión

Elegimos **NestJS sobre TypeScript**.

La razón decisiva es **compartir lenguaje y modelos de tipos entre el frontend web y el backend**: un único perfil full-stack puede moverse entre las dos capas sin cambiar de contexto mental, se **comparten los tipos del contrato** (DTOs generados desde OpenAPI), y la contratación se simplifica a un solo stack. A eso se suma que la **arquitectura modular de NestJS** (módulos + inyección de dependencias) es un molde natural para el monolito modular ([ADR-0001](0001-monolito-modular-vs-microservicios.md)) y para Clean Architecture: los **puertos** (interfaces) se definen en la capa de aplicación y NestJS inyecta las **implementaciones** de infraestructura, sin que el dominio importe nada del framework.

Para honrar la **independencia de framework**, imponemos una regla: las capas `domain/` y `application/` son **TypeScript puro** sin imports de NestJS; los decoradores y la inyección viven solo en `adapters/` e `infrastructure/`. Así, si un día se cambia NestJS por otro framework (o se extrae un módulo a otro runtime), el dominio viaja intacto.

## Consecuencias (positivas y negativas)

**Positivas:**

- **Un cerebro, no dos**: web y backend en TypeScript; tipos del contrato compartidos; menos carga cognitiva para el equipo pequeño → **time-to-market**.
- **Ecosistema enorme**: librerías maduras para Postgres (Prisma/TypeORM/Drizzle), OpenAPI, OTel, JWT/OIDC, validación, colas — casi todo con planes gratuitos/OSS.
- **Modularidad nativa** que encaja con monolito modular + Clean Architecture.
- **Contratación barata**: TypeScript/Node es uno de los stacks más extendidos del mercado.
- **Excelente integración API First**: generación de OpenAPI y de clientes tipados es de primera clase.

**Negativas (honestas):**

- **Rendimiento de CPU inferior** a .NET o JVM en cargas intensivas (Node es single-thread por proceso). *Mitigación:* a la escala objetivo (1–30 vehículos/tenant) sobra; se escala horizontalmente (backend stateless) y los jobs pesados van al worker. Si algún módulo se volviera CPU-bound, puede extraerse a otro runtime gracias a los límites del [ADR-0001](0001-monolito-modular-vs-microservicios.md).
- **Tipado de TypeScript es "gradual"** (se borra en runtime) y menos estricto que C#/Java; un `any` descuidado puede colarse. *Mitigación:* configuración estricta del compilador, validación de entrada por el contrato OpenAPI, y lint que prohíbe `any`.
- **Fatiga del ecosistema Node** (muchas opciones, decisiones que tomar). *Mitigación:* NestJS impone convenciones que reducen esa entropía.
- **Disciplina para mantener el dominio libre de NestJS**: requiere vigilancia (lint de imports). *Mitigación:* regla de arquitectura verificada en CI.

## Alternativas descartadas y por qué

- **.NET 8 — descartada (a pesar de ser técnicamente excelente).** Mejor rendimiento y tipado más estricto, pero **lenguaje distinto del frontend**: rompería el "un solo cerebro" y obligaría al equipo pequeño a dominar dos stacks, encareciendo desarrollo y contratación. Para *este* equipo y *este* momento, el beneficio de rendimiento no compensa el costo de productividad. Es la alternativa más fuerte y se reconsideraría si el equipo fuera de perfil .NET.
- **Spring Boot (Java/Kotlin) — descartada.** Madurez y robustez incuestionables, pero **verboso y pesado** para un MVP de bootstrapping; mayor ceremonia, arranque más lento, lenguaje distinto del web. Sobredimensionado para el time-to-market que necesitamos.
- **Go — descartada.** Excelente para servicios simples y de alta concurrencia, pero **menos ergonómico para modelar un dominio rico** (DDD con agregados, VOs) y para CRUD intensivo con ORM; además, lenguaje distinto del web. La ganancia de simplicidad operativa no supera la pérdida de expresividad de dominio y de unificación de lenguaje.

> **Principio que respeta:** *Time-to-market* e *Independencia de framework*. La elección optimiza la velocidad de un equipo diminuto (lenguaje unificado web+backend) y, mediante la regla "dominio sin imports de framework", mantiene el dominio portable — fiel a Clean Architecture.
