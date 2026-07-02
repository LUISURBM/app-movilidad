# ADR 0005 — Offline-first con SQLite (Drift) + cola de cambios y sincronización

- **Estado:** Aceptada
- **Fecha:** 2026-06-24
- **Decisores:** Equipo de arquitectura

## Contexto y problema

El conductor de transporte especial **opera sin señal** la mayor parte del tiempo: carretera, zonas rurales, parqueaderos cerrados. La Fase 1 lo establece como dolor central y como **diferenciador defendible**: "cualquier herramienta que exija conexión permanente es inservible para quien está al volante". Por tanto, la app móvil (Flutter) **no puede depender de la red** para sus operaciones cotidianas: ver el servicio del día, consultar documentos del vehículo, registrar combustible y novedades.

El problema: ¿qué arquitectura de datos en el dispositivo y qué estrategia de sincronización adoptamos para que la app sea **plenamente funcional offline** y reconcilie con el servidor al recuperar señal, **sin** que la sincronización se convierta en un monstruo de conflictos?

> Este ADR fija la **decisión**; el diseño detallado de sincronización, resolución de conflictos, recuperación y casos límite vive en **[Fase 6 — Offline First](../docs/06-offline-first.md)**.

## Drivers de decisión

- **Offline First** (principio rector): el dispositivo es **fuente de verdad temporal**; la nube reconcilia.
- **Experiencia del conductor**: nunca bloquear esperando red; "un flujo a la vez", baja fricción (Fase 1 §3).
- **Flutter ya definido**: la solución debe ser idiomática y madura en el ecosistema Flutter/Dart.
- **Datos relacionales locales**: servicios, vehículos, documentos y registros tienen relaciones; el almacén local debe manejarlas.
- **Simplicidad de conflictos en MVP**: minimizar el problema más difícil del offline empezando por datos que casi no chocan.
- **Tipado y reactividad**: que la UI se actualice sola cuando cambia el dato local.
- **Independencia de framework** en la lógica de cliente (Clean Architecture también en móvil).

## Opciones consideradas

1. **SQLite local vía Drift + cola de cambios (outbox del cliente) + sync incremental — elegida.** Base relacional embebida, tipada y reactiva; cada mutación local se encola y se envía al reconectar; los cambios del servidor se aplican incrementalmente.
2. **Almacén NoSQL embebido (Hive / Isar).** Rápido y simple para clave-valor/objetos, pero peor para datos relacionales y consultas complejas.
3. **Servicio de sync gestionado (p. ej. PowerSync / Firebase / Couchbase Lite).** Sincronización "lista para usar".
4. **Sin offline real**: caché ligera y exigir conexión para escribir.

## Decisión

Adoptamos **SQLite como base de datos local en el dispositivo, accedida mediante Drift**, con una **cola de cambios local (outbox del cliente)** y **sincronización incremental** contra la API REST del backend.

Lineamientos (alto nivel; detalle en [Fase 6](../docs/06-offline-first.md)):

- **Lectura/escritura siempre local**: la app **nunca** bloquea al usuario esperando red. La UI lee de SQLite (reactivo vía Drift) y escribe en SQLite.
- **Cola de cambios**: cada mutación local (combustible, novedad, cambio de estado de servicio) se registra en una tabla de cambios pendientes con su **`Idempotency-Key`** generada en el dispositivo. Un **sincronizador** la envía a la API cuando hay conexión; la idempotencia de la API ([ADR-0004](0004-eventos-outbox-pattern-sin-broker.md), Fase 5 §7) evita duplicados si un reintento se solapa.
- **Sync incremental de bajada**: la app pide al servidor los cambios desde su último cursor/marca de tiempo y los aplica localmente.
- **Estrategia de conflictos por fases**: empezar con datos **append-only** (combustible, novedades) que **casi no generan conflictos**; para entidades editables, reglas de *last-write-wins* con marca de tiempo del servidor y bitácora. Los detalles y casos límite → **Fase 6**.
- **Clean Architecture en móvil**: las reglas de negocio del cliente (validar un registro, detectar que un servicio ya inició) viven en `domain/`/`application/` y **no importan Flutter ni Drift**; Drift es una implementación de infraestructura detrás de un puerto de repositorio.
- **Sesión persistente**: refresh token seguro para no exigir red en cada arranque.

## Consecuencias (positivas y negativas)

**Positivas:**

- **App plenamente usable sin señal**: cumple el diferenciador central del producto.
- **Datos relacionales bien modelados** en el cliente (SQLite + Drift), con consultas y joins, no un almacén clave-valor improvisado.
- **Tipado y reactividad** de Drift: menos bugs y UI que se refresca sola.
- **Sin lock-in de un servicio de sync**: la sincronización es **nuestra**, contra nuestra propia API; portabilidad e independencia.
- **Conflictos minimizados al inicio**: arrancar con datos append-only baja drásticamente el riesgo del problema más difícil del offline.
- **Coherencia conceptual**: "outbox del cliente" en móvil rima con el "outbox" del backend — un mismo patrón mental.

**Negativas (honestas):**

- **La sincronización es trabajo propio y es difícil**: cursores, reintentos, idempotencia, conflictos y recuperación los construimos nosotros. *Mitigación:* empezar simple (append-only), iterar; todo el rigor en [Fase 6](../docs/06-offline-first.md). Es la decisión consciente de cambiar costo de licencia/lock-in por control.
- **Esquema duplicado**: hay un esquema local (Drift) y uno de servidor (Postgres) que evolucionan en paralelo; las migraciones deben coordinarse. *Mitigación:* versionado de esquema local y compatibilidad hacia atrás del contrato.
- **Riesgo de divergencia de datos** si las reglas de conflicto no son claras. *Mitigación:* reglas explícitas por entidad y bitácora de sync (Fase 6); el riesgo R2 de la Fase 1 ya lo señala.
- **Tamaño de la app y del almacén** crecen con datos locales. *Mitigación:* sincronizar solo el subconjunto relevante del conductor/vehículo, con poda de datos antiguos.

## Alternativas descartadas y por qué

- **NoSQL embebido (Hive/Isar) — descartada.** Excelentes para clave-valor/objetos simples, pero el dominio del conductor es **relacional** (servicio↔vehículo↔documentos↔registros); forzarlo a NoSQL complicaría consultas e integridad local. SQLite/Drift encaja mejor con el dominio y con la paridad conceptual frente a Postgres.
- **Servicio de sync gestionado (PowerSync/Firebase/Couchbase Lite) — descartada para el MVP.** Acelera el arranque, pero introduce **costo creciente y lock-in** (atan el modelo de datos y el proveedor), en contra de los principios de bootstrapping e independencia. Construir el sync sobre nuestra propia API nos da control y portabilidad; se podría reconsiderar un componente puntual si el costo de mantener el sync propio superara su beneficio.
- **Sin offline real (solo caché + exigir red para escribir) — descartada de plano.** **Contradice el principio Offline First** y mata el diferenciador del producto: un conductor sin señal no podría registrar combustible ni novedades. Inaceptable.

> **Principio que respeta:** *Offline First*. El dispositivo es fuente de verdad temporal (SQLite/Drift), las mutaciones se encolan y reconcilian con idempotencia, y la lógica de cliente queda libre de framework (Clean Architecture). El detalle profundo se delega a la [Fase 6](../docs/06-offline-first.md), como exige el encargo.
