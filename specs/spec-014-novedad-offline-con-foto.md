# spec-014 — Registrar una Novedad OFFLINE con foto (append-only)

- **Bounded Context:** BC-5 Service Scheduling (CORE) — operación offline-first
- **Prioridad:** MVP
- **Estado:** Implemented
- **Aprobada por:** Luis (Product Manager + dominio) · 2026-07-02 (Draft → Approved → Implemented en la misma sesión, autorizado por el PM)
- **Specs relacionadas:** spec-008 (Servicio), spec-010 (operación offline del Conductor), spec-011 (Tanqueo append-only)

## Objetivo

Permitir que el **Conductor** reporte una **Novedad** (incidente, retraso, siniestro) durante un **Servicio**, **sin señal**, opcionalmente con **foto**. La Novedad es **append-only** (un hecho inmutable que solo se añade). La foto se guarda como blob local y se sube en dos pasos (primero el binario, luego el metadato que lo referencia), con **idempotencia** por UUID. Aporta la "memoria operativa" del negocio.

## Actor(es)

- **Conductor** (app Flutter, offline-first): reporta Novedades de sus Servicios.
- **App local** (cola append-only + blob store): persiste la Novedad y la foto.
- **Sincronizador** (segundo plano): sube blob y luego metadato al reconectar.
- **Service Scheduling (BC-5)**: registra la Novedad asociada a un Servicio existente.

## Reglas de negocio

1. Una Novedad pertenece **siempre** a un **Servicio existente** del Conductor (Invariante S5: las Novedades pertenecen a un Servicio).
2. La Novedad registra: tipo (incidente/retraso/siniestro), descripción, fecha/hora y, opcionalmente, una **foto**.
3. La Novedad es **append-only**: una vez creada no se edita ni se borra; es un hecho inmutable (categoría B).
4. El reporte se ejecuta y persiste **localmente sin red** y se confirma de inmediato; la sincronización no bloquea la UX.
5. La **foto** se guarda como **blob** en el sistema de archivos del dispositivo con un UUID local; la Novedad la **referencia por ese UUID**, no incrusta el binario.
6. La subida es en **dos pasos**: primero se sube el binario (el servidor responde con una URL/ID), y **luego** se sube la Novedad referenciando esa URL; así el metadato nunca apunta a un archivo inexistente.
7. Cada Novedad lleva un **UUID de cliente** como **clave de idempotencia**; reintentar **no duplica**.
8. El blob local **no se borra** hasta que su subida está **confirmada** (invariante de no pérdida).
9. Al sincronizar, la Novedad emite `NovedadReportada { servicioId, tipo, fotoRef? }`.
10. Al ser append-only, **no hay conflictos** entre dispositivos; solo idempotencia para duplicados.
11. La foto, al contener posibles datos personales, se almacena **aislada por Tenant** (prefijo `<tenant_id>/`) y solo se accede por URL prefirmada tras validar contexto.

## Casos felices

- El Conductor, sin señal, reporta un "pinchazo en la vía" con foto; al reconectar, sube la foto y luego la Novedad.

## Casos alternativos

- El Conductor reporta una Novedad de tipo "retraso" **sin foto**.
- El Conductor reporta varias Novedades del mismo Servicio sin señal; al reconectar, todas suben.

## Casos de error / offline

- Reintento de la misma Novedad por confirmación perdida: el servidor deduplica por UUID (una sola Novedad).
- La subida de la foto falla pero el metadato no se sube hasta que la foto esté confirmada (orden de dos pasos).
- Se intenta reportar una Novedad para un Servicio inexistente: se rechaza.

## Criterios de aceptación (Gherkin)

```gherkin
# language: es
Característica: Registrar una Novedad offline con foto, append-only e idempotente
  Como Conductor que enfrenta un incidente en ruta sin señal
  Quiero reportar la Novedad con foto y que sincronice sin duplicar
  Para dejar memoria operativa del Servicio

  Antecedentes:
    Dado que existe la Empresa "Transporte Duster SAS" como Tenant
    Y que el Conductor "Juan Pérez" tiene un Servicio en estado "Iniciado"

  Escenario: Reportar una Novedad con foto sin señal y sincronizar en dos pasos
    Dado que el dispositivo del Conductor no tiene señal
    Cuando el Conductor reporta una Novedad de tipo "incidente" con descripción "pinchazo en la vía" y una foto
    Entonces la Novedad se guarda localmente y se confirma de inmediato
    Y la foto se guarda como blob local con un UUID
    Y la Novedad referencia la foto por ese UUID
    Cuando el dispositivo recupera la señal
    Entonces el Sincronizador sube primero el binario de la foto
    Y luego sube la Novedad referenciando la URL de la foto
    Y se emite el evento "NovedadReportada" para el Servicio

  Escenario: Reportar una Novedad sin foto
    Dado que el dispositivo del Conductor no tiene señal
    Cuando el Conductor reporta una Novedad de tipo "retraso" con descripción "trancón en la vía" sin foto
    Entonces la Novedad se guarda localmente
    Y al reconectar se emite el evento "NovedadReportada" sin referencia de foto

  Escenario: Reportar varias Novedades del mismo Servicio offline
    Dado que el dispositivo del Conductor no tiene señal
    Cuando el Conductor reporta una Novedad de tipo "retraso"
    Y reporta una Novedad de tipo "incidente"
    Cuando el dispositivo recupera la señal
    Entonces ambas Novedades se suben
    Y ambas quedan asociadas al mismo Servicio

  Escenario: Reintento por confirmación perdida no duplica la Novedad
    Dado que el Conductor reportó una Novedad offline con UUID "uuid-novedad-001"
    Y que el push llegó al servidor pero la confirmación se perdió
    Cuando el Sincronizador reintenta la misma Novedad con UUID "uuid-novedad-001"
    Entonces el servidor deduplica por la clave de idempotencia
    Y queda una sola Novedad registrada

  Escenario: El metadato no se sube hasta confirmar la foto
    Dado que el Conductor reportó una Novedad con foto offline
    Y que la subida del binario de la foto aún no se confirma
    Cuando el Sincronizador procesa la cola
    Entonces no se sube la Novedad antes que su foto
    Y el blob local no se borra hasta que su subida esté confirmada

  Escenario: Rechazo de Novedad para un Servicio inexistente
    Cuando se intenta sincronizar una Novedad para un Servicio que no existe
    Entonces el registro se rechaza
    Y se informa que la Novedad debe pertenecer a un Servicio existente
```

## Notas de implementación (2026-07-02)

Implementada (lado servidor) en `backend/src/modules/service-scheduling` (BC-5): agregado
`Novedad` append-only + `RegistrarNovedad` (idempotente por clientId, valida Servicio
existente R1) + enrutamiento de `entidad: "novedad"` en `SincronizarCambios` (spec-010) +
migración 0008. Evento `NovedadReportada`. Tests verdes (novedad.spec, derivados de los
Gherkin). La spec pasó de Draft a Implemented con autorización del PM. Decisiones:

1. **Foto en dos pasos (R5/R6) = cliente.** La subida binario→URL y el blob local con no-pérdida
   (R8) son responsabilidad de la app Flutter; el servidor solo persiste `fotoRef` (metadato).
2. **Tercer tipo de sync.** Con Novedad, el lote offline (spec-010) soporta los tres:
   `estado_servicio`, `tanqueo` (spec-011) y `novedad`. `entidad_no_soportada` queda solo para
   entidades realmente desconocidas.
3. **Servicio inexistente (R1)** → resultado `error` con `servicio_no_encontrado` en el lote.
