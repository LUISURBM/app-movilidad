# FleetSpecial — Blueprint Empresarial y Tecnológico

> Plataforma SaaS para **empresas de transporte especial y flotas pequeñas en Colombia**.
> Gestión de vehículos, conductores, documentos, programación de servicios, combustible, mantenimiento y GPS, con **operación offline** (app Flutter para conductores) y **portal web administrativo** bajo un **modelo multiempresa (multi-tenant)**.

Este repositorio es un **blueprint ejecutable, reutilizable y agnóstico a la plataforma**, construido sobre:

- **Spec Driven Development (SDD)** — el contrato manda; el código deriva de specs.
- **Domain Driven Design (DDD)** — lenguaje ubicuo y límites de dominio explícitos.
- **Clean Architecture** — dependencias hacia el dominio, no hacia frameworks.
- **API First** — el contrato OpenAsyncAPI antecede a la implementación.
- **Offline First** — el dispositivo es la fuente de verdad temporal del conductor.
- **Cloud Native** — contenedores, IaC, observabilidad, 12-factor.
- **AI Agent Friendly Development** — agentes (Claude, ChatGPT, Gemini, Cursor, etc.) son ciudadanos de primera clase.

---

## Cómo navegar este blueprint

El blueprint está organizado en **10 fases**. Cada fase es un documento independiente que puede leerse solo, pero juntas forman la cadena de trazabilidad **Negocio → Dominio → Spec → Trabajo → Arquitectura → Roadmap**.

| Fase | Documento | Qué responde |
|------|-----------|--------------|
| 1 | [`docs/01-analisis-negocio.md`](docs/01-analisis-negocio.md) | ¿Vale la pena? Problema, mercado, MVP, riesgos. |
| 2 | [`docs/02-domain-driven-design.md`](docs/02-domain-driven-design.md) | ¿Cómo se estructura el dominio? Contextos, agregados, eventos. |
| 3 | [`specs/`](specs/) | ¿Qué debe hacer exactamente? Specs en Gherkin. |
| 4 | [`docs/04-edt-wbs.md`](docs/04-edt-wbs.md) | ¿Cómo se descompone el trabajo? Epic → Subtask con estimación. |
| 5 | [`docs/05-arquitectura-tecnica.md`](docs/05-arquitectura-tecnica.md) | ¿Cómo se construye? Frontend, backend, infra. |
| 6 | [`docs/06-offline-first.md`](docs/06-offline-first.md) | ¿Cómo funciona sin señal? Sync, conflictos, recuperación. |
| 7 | [`docs/07-saas-multitenant.md`](docs/07-saas-multitenant.md) | ¿Cómo se vende como SaaS? Tenancy, roles, planes. |
| 8 | [`agents/`](agents/) | ¿Cómo colaboran los agentes IA? 8 roles + prompts. |
| 9 | [`docs/09-estructura-repositorio.md`](docs/09-estructura-repositorio.md) | ¿Dónde vive cada cosa? Árbol del monorepo. |
| 10 | [`docs/10-roadmap.md`](docs/10-roadmap.md) | ¿En qué orden? MVP → Enterprise con hitos. |

**Decisiones de arquitectura** transversales están en [`adr/`](adr/) (Architecture Decision Records).

---

## Contexto del negocio en una frase

Un fundador operará **una Renault Duster afiliada** a una empresa transportadora para validar el dolor real (papeleo, planilla, mantenimiento, control), construir la herramienta usándola él mismo, y **solo entonces** escalar a empresa propia y comercializar el software como SaaS.

> **Principio rector del MVP:** la herramienta debe ser útil para **un solo vehículo** antes de ser útil para mil. Si no le ahorra tiempo al fundador con su Duster, no le ahorrará tiempo a nadie.

---

## Restricciones (confirmadas con el fundador)

1. **Presupuesto ajustado (bootstrapping).** Presupuesto mínimo y autofinanciado. Preferir open-source, planes gratuitos y arquitectura de bajo costo operativo. Evitar sobreingeniería.
2. **Cumplimiento normativo Colombia.** Habeas Data (Ley 1581 de 2012), facturación electrónica DIAN, y normativa de transporte especial (Decreto 1079 de 2015 y reglamentación de planilla/SECOP de viaje ocasional). *Ver `docs/01-analisis-negocio.md` §Supuestos legales — confirmar con abogado.*
3. **Time-to-market agresivo.** MVP usable en 8–12 semanas operando la Duster.
4. **Equipo pequeño (1–3 desarrolladores).** Pocos recursos de desarrollo, posiblemente un único fundador apoyado por agentes IA. Favorecer stacks productivos, un solo lenguaje donde se pueda, y un monolito modular sobre microservicios (ver `adr/0001`, `adr/0002`).
5. **Dependencia de la empresa afiliadora.** En la fase de validación, el vehículo (la Duster) opera afiliado a una transportadora; la planilla/extracto de viaje y parte de la documentación dependen de ella, **sin integración formal todavía**. El MVP debe aportar valor por gestión propia aunque no exista integración con la afiliadora, y dejar la costura para integrarla después (ver `docs/01-analisis-negocio.md` R7 y `docs/07-saas-multitenant.md` §Modelo de Tenant).

---

## Principios de diseño (no negociables)

- **No sobreingeniería.** Monolito modular antes que microservicios. Postgres antes que 5 bases de datos. Un solo backend antes que BFFs.
- **Independencia de proveedor de IA.** Toda integración IA pasa por una capa de abstracción (ver `agents/README.md` y `adr/0007`).
- **Independencia de nube.** Contenedores + IaC portable; nada que ate a un solo proveedor (ver `adr/0006`).
- **Independencia de framework.** El dominio no importa Flutter, ni el ORM, ni el web framework (Clean Architecture).
- **Diseñar para evolución.** Costuras (seams) explícitas donde el producto crecerá: tenancy, eventos, capa de sync.

---

## Estado

**MVP (H0) code-complete y en verificación, a las puertas del _dogfooding_ con la Duster.** El repositorio contiene código funcional en los tres componentes:

- **Backend (NestJS + Clean Architecture):** 7 bounded contexts, multiempresa c