# ADR 0006 — Independencia de nube vía contenedores + IaC

- **Estado:** Aceptada
- **Fecha:** 2026-06-24
- **Decisores:** Equipo de arquitectura

## Contexto y problema

El blueprint declara la **independencia de proveedor de nube** como principio no negociable. Al mismo tiempo, el bootstrapping exige correr el MVP **lo más barato posible**, y el time-to-market pide no perder semanas montando infraestructura compleja. Existe la tentación de adoptar servicios propietarios "mágicos" de un proveedor (su base serverless, su cola, su función gestionada, su auth) que aceleran al inicio pero **atan** el sistema a ese proveedor (lock-in): migrar después implicaría reescribir.

El problema: ¿cómo desplegamos FleetSpecial de forma **barata para el MVP** pero **portable**, de modo que podamos cambiar de proveedor o crecer a Kubernetes **sin reescribir la aplicación**?

## Drivers de decisión

- **Independencia de nube** (principio rector): nada que ate a un solo proveedor.
- **Bootstrapping**: costo operativo casi nulo en el MVP.
- **Time-to-market**: arranque simple, no un clúster desde el día 1.
- **Ruta de evolución sin reescritura**: poder pasar a Kubernetes/otro proveedor cambiando el *target* de despliegue, no el código.
- **Cloud Native / 12-factor**: configuración por entorno, procesos stateless, logs como flujo.
- **Reproducibilidad**: ambientes idénticos (dev/QA/prod) descritos como código.

## Opciones consideradas

1. **Contenedores (Docker) + IaC (Terraform), desplegados en un VPS/PaaS barato — elegida.** La app se empaqueta como imagen portable; la infraestructura se describe como código; el MVP corre en un VPS o PaaS económico y puede migrar a Kubernetes después.
2. **PaaS propietario con servicios gestionados específicos** (base, cola, funciones, auth del proveedor) sin contenedores portables.
3. **Serverless puro** (funciones gestionadas por evento) como arquitectura base.
4. **Kubernetes desde el día 1** (clúster gestionado).

## Decisión

Adoptamos **contenedores Docker + Infraestructura como Código con Terraform**, desplegando el MVP en **un VPS o PaaS económico**, con una **ruta explícita a Kubernetes sin reescribir**.

Lineamientos:

- **Todo es una imagen de contenedor**: API, worker, Keycloak, MinIO. La **misma imagen** corre en dev (Docker Compose), QA y producción; solo cambia la **configuración por entorno** (12-factor).
- **Infraestructura como código** con Terraform: la definición de servidores, red, DNS, base de datos gestionada y secretos vive versionada en el repo; nada se configura "a mano" en una consola.
- **Aplicación agnóstica al proveedor**: el código **no importa SDKs propietarios** de un proveedor. Los servicios externos se consumen detrás de **puertos** (almacenamiento S3-**compatible**, no "el bucket de X"; Postgres estándar, no una base propietaria; OIDC estándar, no un auth atado).
- **Stateless**: la API no guarda estado en memoria (sesión en el JWT, estado en Postgres y en el almacenamiento), por lo que escala horizontalmente y se reubica entre proveedores sin fricción.
- **Ruta a Kubernetes**: como ya está contenerizado y descrito en Terraform, migrar a un clúster K8s gestionado es **escribir manifiestos/Helm y apuntar el deploy allí** — un cambio de *target*, no de aplicación.

## Consecuencias (positivas y negativas)

**Positivas:**

- **Portabilidad real**: el sistema corre en cualquier nube o VPS que ejecute contenedores; sin lock-in.
- **Costo mínimo en MVP**: un VPS o PaaS con capa gratuita basta para la Duster y los primeros pilotos.
- **Paridad dev/prod**: la misma imagen en todos los ambientes reduce el "en mi máquina funciona".
- **Reproducibilidad y auditoría**: la infraestructura versionada se revisa, revierte y recrea como el código.
- **Evolución sin reescritura**: subir a Kubernetes o cambiar de proveedor no toca el dominio ni la API.
- **Coherencia con el resto del blueprint**: refuerza monolito modular ([ADR-0001](0001-monolito-modular-vs-microservicios.md)) y Postgres portable ([ADR-0003](0003-postgresql-unica-base-de-datos.md)).

**Negativas (honestas):**

- **Renunciamos a "magia" propietaria** que aceleraría ciertas tareas (escalado automático fino, colas gestionadas, auth llave-en-mano). *Mitigación:* a esta escala no las necesitamos; la portabilidad vale más que el atajo.
- **Algo más de trabajo inicial**: empaquetar, escribir Terraform y operar Keycloak/MinIO nosotros cuesta más que "hacer clic" en un panel. *Mitigación:* es trabajo único y reutilizable en todos los ambientes; paga con creces en independencia.
- **Operar Keycloak/MinIO self-host** añade superficie a mantener. *Mitigación:* en MVP son contenedores simples; si crecen, hay equivalentes gestionados **estándar** (OIDC, S3) a los que migrar sin reescribir.
- **VPS único es punto de fallo en MVP**: sin alta disponibilidad al inicio. *Aceptable:* el MVP no la exige; la ruta a múltiples réplicas/K8s ya está trazada.

## Alternativas descartadas y por qué

- **PaaS propietario con servicios gestionados específicos — descartada.** Acelera el arranque pero **ata** el sistema (base, cola, auth propietarios) y convierte una futura migración en **reescritura** — choca de frente con el principio de independencia de nube.
- **Serverless puro — descartada.** Atractivo por el costo a bajo tráfico, pero **introduce lock-in** del runtime del proveedor, complica el modelo de **sync offline** (cold starts, conexiones a DB, procesos efímeros) y dispersa el monolito modular. La portabilidad y la coherencia con offline-first pesan más.
- **Kubernetes desde el día 1 — descartada.** Es la herramienta correcta **más adelante**, no ahora: operar un clúster para una Duster es **sobreingeniería** y costo/complejidad que frenan el time-to-market. Gracias a esta decisión, K8s queda disponible **cuando** se necesite, sin reescribir.

> **Principio que respeta:** *Cloud Native* e *Independencia de nube*. Contenedores + IaC dan un MVP barato y 12-factor, y garantizan que crecer o cambiar de proveedor sea un cambio de despliegue, no de código — tal como pide el blueprint ("portable a Kubernetes después").
