# ADR 0007 — Independencia de proveedor de IA mediante capa de abstracción

- **Estado:** Aceptada
- **Fecha:** 2026-06-24
- **Decisores:** Equipo de arquitectura

## Contexto y problema

FleetSpecial es **AI Agent Friendly** por principio y prevé funciones potenciadas por IA: asistentes para el operador, extracción de datos de documentos (OCR/comprensión de un SOAT o una tarjeta de operación), clasificación de novedades, resúmenes de cumplimiento, y la **capa de agentes IA** descrita en la [Fase 8](../agents/README.md). Además, durante la construcción del propio blueprint, agentes (Claude, ChatGPT/OpenAI, Gemini, Cursor, etc.) son ciudadanos de primera clase.

El mercado de IA es **volátil**: los modelos, precios, límites y proveedores cambian mes a mes, y ninguno es claramente "el ganador" a largo plazo. Acoplar el código directamente al SDK de un proveedor produciría **lock-in**: cambiar de Claude a OpenAI o a un modelo local exigiría tocar el dominio y media base de código, además de atar el costo a un solo proveedor.

El problema: ¿cómo integramos IA de forma que podamos **intercambiar de proveedor (o usar varios)** sin reescribir el dominio ni la lógica de negocio?

## Drivers de decisión

- **Independencia de proveedor de IA** (principio rector explícito).
- **AI Agent Friendly**: la IA debe ser fácil de incorporar y de orquestar.
- **Clean Architecture**: el dominio no puede depender de un SDK externo.
- **Bootstrapping**: poder elegir el proveedor más barato/capaz en cada momento, o un modelo local para tareas baratas.
- **Cumplimiento (Habeas Data)**: poder controlar **qué** datos salen hacia un proveedor de IA, y poder elegir uno con garantías o un modelo local para datos sensibles.
- **Evolución**: el panorama de modelos cambiará; la arquitectura debe absorberlo sin dolor.

## Opciones consideradas

1. **Capa de abstracción: una interfaz `AIProvider` (puerto) con adaptadores por proveedor — elegida.** El dominio/aplicación dependen solo de la interfaz; las implementaciones concretas (Claude, OpenAI, Gemini, local) viven en infraestructura y se eligen por configuración.
2. **Acoplar directamente el SDK de un proveedor** en los casos de uso.
3. **Usar un router/gateway de IA de terceros** como única vía (un servicio externo que abstrae proveedores).
4. **No abstraer y decidir más tarde** (integrar lo más rápido posible con cualquier SDK y refactorizar si hace falta).

## Decisión

Adoptamos una **capa de abstracción de IA**: un **puerto `AIProvider`** (interfaz) definido en la capa de aplicación, con **adaptadores intercambiables** por proveedor en la capa de infraestructura.

Lineamientos:

- **El puerto expone capacidades del dominio, no del proveedor**: por ejemplo `completarTexto(prompt, opciones)`, `extraerDatosDeDocumento(archivo, esquema)`, `clasificar(texto, categorias)`, `generarEmbedding(texto)`. Nada en la firma menciona a un proveedor concreto.
- **Adaptadores por proveedor** implementan el puerto: `ClaudeAIProvider`, `OpenAIProvider`, `GeminiAIProvider`, `LocalAIProvider` (modelo open-source self-host). Se seleccionan por **configuración/entorno** (12-factor), sin recompilar lógica de negocio.
- **El dominio nunca importa un SDK de IA**: coherente con Clean Architecture ([ADR-0002](0002-stack-backend.md)). La IA es, para el dominio, "un colaborador detrás de una interfaz".
- **Control de datos**: la capa de abstracción es el punto único donde se aplica **minimización y redacción** de datos personales antes de enviarlos a un proveedor externo (Habeas Data), y donde se puede **enrutar tareas sensibles a un modelo local**.
- **Posibilidad de múltiples proveedores a la vez**: enrutar por costo/capacidad (p. ej. tareas simples a un modelo barato/local; tareas complejas a uno premium).
- **Conexión con Fase 8**: la orquestación de agentes y los prompts/roles viven en [`agents/`](../agents/README.md); esos agentes consumen IA **a través de esta misma abstracción**.

## Consecuencias (positivas y negativas)

**Positivas:**

- **Cero lock-in de IA**: cambiar Claude↔OpenAI↔Gemini↔local es **cambiar un adaptador y una variable de entorno**.
- **Optimización de costo continua**: se elige el proveedor más conveniente en cada momento, o un modelo local para abaratar (bootstrapping).
- **Cumplimiento controlado**: un único punto para redactar/minimizar datos y para enrutar lo sensible a un modelo local (Habeas Data).
- **Dominio limpio y testeable**: los casos de uso se prueban con un **`AIProvider` falso** (mock), sin llamar a ninguna API real.
- **A prueba de futuro**: cuando surja un modelo nuevo, se añade un adaptador; el resto del sistema no se entera.
- **Coherencia AI-friendly**: los agentes de la Fase 8 heredan la misma independencia.

**Negativas (honestas):**

- **Abstracción de mínimo común denominador**: una interfaz uniforme puede **no exponer features muy específicas** de un proveedor (p. ej. una herramienta propietaria). *Mitigación:* el puerto cubre las capacidades comunes que necesitamos; si una feature específica aporta valor real, se modela como una capacidad nueva del puerto o un adaptador especializado, conscientemente.
- **Trabajo extra de diseño**: definir y mantener el puerto y varios adaptadores cuesta más que llamar a un SDK directo. *Mitigación:* el costo es pequeño frente al de un lock-in y se amortiza al primer cambio de proveedor.
- **Comportamiento no idéntico entre proveedores**: el mismo prompt rinde distinto según el modelo. *Mitigación:* pruebas de calidad por capacidad y posibilidad de fijar el proveedor por tarea.
- **Riesgo de sobre-abstraer**: una interfaz demasiado genérica se vuelve inútil. *Mitigación:* modelar el puerto desde casos de uso reales, no en abstracto.

## Alternativas descartadas y por qué

- **Acoplar el SDK de un proveedor directamente — descartada.** Es el camino al **lock-in** que el principio prohíbe: ata dominio, costo y cumplimiento a un solo proveedor en un mercado que cambia cada mes. Cualquier cambio futuro sería una reescritura.
- **Router/gateway de IA de terceros como única vía — descartada como dependencia obligatoria.** Útil como **uno** de los adaptadores (detrás de nuestro puerto), pero hacerlo la **única** vía simplemente **traslada el lock-in** a ese intermediario y añade costo/latencia. Preferimos que la abstracción sea **nuestra**; un gateway puede enchufarse como adaptador si conviene.
- **No abstraer y decidir más tarde — descartada.** "Refactorizar después" rara vez ocurre; el acoplamiento se esparce y el costo de revertirlo crece. La abstracción desde el inicio es barata; retrofitearla, cara — justo el error que el blueprint evita con sus capas de independencia.

> **Principio que respeta:** *AI Agent Friendly* e *Independencia de proveedor de IA*. Toda integración con IA pasa por la interfaz `AIProvider`, permitiendo intercambiar Claude/OpenAI/Gemini/local sin tocar el dominio, controlando los datos que salen y habilitando la capa de agentes de la [Fase 8](../agents/README.md).
