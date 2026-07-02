# spec-011 — Registrar Tanqueo (combustible) OFFLINE append-only con idempotencia

- **Bounded Context:** BC-6 Fuel Management — operación offline-first
- **Prioridad:** MVP
- **Estado:** Approved
- **Aprobada por:** Luis (Product Manager + dominio) · 2026-06-25
- **Specs relacionadas:** spec-003 (Vehículo, Odómetro), spec-010 (operación offline), spec-012 (Mantenimiento por umbral)

## Objetivo

Permitir que el **Conductor** registre un **Tanqueo (carga de combustible)** desde la app **sin señal**: litros/galones, **valor en COP**, **Odómetro** y fecha. El Tanqueo es **append-only** (un hecho inmutable que solo se añade; no se edita ni se borra). Cada registro lleva un **UUID de cliente** que garantiza **idempotencia**: reintentar no duplica. Al sincronizar, el Tanqueo actualiza el Odómetro del Vehículo (validando monotonía) y alimenta el **Costo por kilómetro** y la evaluación de **Umbral de mantenimiento**.

## Actor(es)

- **Conductor** (app Flutter, offline-first): registra Tanqueos de su Vehículo.
- **App local** (cola append-only): persiste y encola el registro.
- **Sincronizador** (segundo plano): sube los Tanqueos al reconectar.
- **Fuel Management (BC-6)** / **Fleet (BC-2)** / **Maintenance (BC-7)**: aplican efectos.

## Reglas de negocio

1. Un Tanqueo registra: cantidad (litros o galones), **valor en COP (Dinero)**, lectura de **Odómetro**, fecha/hora y el Vehículo.
2. El Tanqueo es **append-only**: una vez creado **no se edita ni se borra**; cada registro es un hecho inmutable (categoría B).
3. El registro se ejecuta y persiste **localmente sin red**, confirmándose de inmediato; la sincronización no bloquea la UX.
4. Cada Tanqueo lleva un **UUID generado en el dispositivo** que es su **clave de idempotencia** (`Idempotency-Key`).
5. **Idempotencia:** si el mismo Tanqueo se envía dos veces (reintento por confirmación perdida), el servidor **deduplica por UUID** y queda **un solo** registro.
6. El valor en COP debe ser **positivo**; la cantidad (litros/galones) debe ser **positiva**.
7. Al sincronizar, el Tanqueo emite `CombustibleRegistrado { tanqueoId, vehiculoId, litros, valorCop, odometro }`.
8. El Odómetro del Tanqueo actualiza la lectura autoritativa del Vehículo respetando **monotonía** (Política P8): si la lectura es **menor** a la última registrada en el servidor, se marca como **anomalía** y **no** retrocede el Odómetro (el hecho del Tanqueo se conserva, pero no degrada la lectura autoritativa).
9. `CombustibleRegistrado` dispara la evaluación del **Umbral de mantenimiento** (Política P6) y el recálculo del **Costo por kilómetro**.
10. Al ser append-only, **dos dispositivos nunca chocan**: cada uno añade los suyos; no hay resolución de conflictos (solo idempotencia para duplicados).
11. Todo Tanqueo pertenece a un único Tenant y al Vehículo del Conductor; el aislamiento se respeta vía el contexto del Conductor.

## Casos felices

- El Conductor, sin señal, registra un Tanqueo de 40 litros por $260.000 COP con Odómetro 152300; al reconectar, sube y actualiza el Odómetro.

## Casos alternativos

- El Conductor registra varios Tanqueos sin señal en distintos momentos; al reconectar, todos suben en orden de captura.
- El Conductor registra el Tanqueo en **galones** en lugar de litros.

## Casos de error / offline

- Reintento del mismo Tanqueo por confirmación perdida: el servidor deduplica por UUID (un solo registro).
- El Odómetro del Tanqueo es menor a la última lectura del servidor: se marca anomalía y no retrocede el Odómetro autoritativo.
- Se intenta registrar un Tanqueo con valor en COP cero o negativo: se rechaza localmente.

## Criterios de aceptación (Gherkin)

```gherkin
# language: es
Característica: Registrar Tanqueo de combustible offline, append-only e idempotente
  Como Conductor que tanquea en ruta sin señal
  Quiero registrar el Tanqueo y que sincronice sin duplicar
  Para llevar el control de combustible y el Costo por kilómetro

  Antecedentes:
    Dado que existe la Empresa "Transporte Duster SAS" como Tenant
    Y que el Conductor "Juan Pérez" opera el Vehículo "ABC123"
    Y que la última lectura autoritativa del Odómetro del Vehículo "ABC123" es 152000

  Escenario: Registrar un Tanqueo sin señal y sincronizar
    Dado que el dispositivo del Conductor no tiene señal
    Cuando el Conductor registra un Tanqueo de 40 litros por 260000 COP con Odómetro 152300
    Entonces el Tanqueo se guarda localmente y se confirma de inmediato
    Y se encola con un UUID como clave de idempotencia
    Cuando el dispositivo recupera la señal
    Entonces el Sincronizador sube el Tanqueo
    Y se emite el evento "CombustibleRegistrado" con 40 litros y 260000 COP
    Y el Odómetro del Vehículo "ABC123" se actualiza a 152300

  Escenario: Registrar varios Tanqueos offline y subirlos en orden
    Dado que el dispositivo del Conductor no tiene señal
    Cuando el Conductor registra un Tanqueo con Odómetro 152300
    Y registra otro Tanqueo con Odómetro 152600
    Cuando el dispositivo recupera la señal
    Entonces ambos Tanqueos se suben en el orden de captura
    Y el Odómetro del Vehículo "ABC123" queda en 152600

  Escenario: Registrar el Tanqueo en galones
    Dado que el dispositivo del Conductor no tiene señal
    Cuando el Conductor registra un Tanqueo de 10 galones por 260000 COP con Odómetro 152300
    Entonces el Tanqueo se guarda localmente con la cantidad en galones
    Y al reconectar se emite el evento "CombustibleRegistrado"

  Escenario: Reintento por confirmación perdida no duplica el Tanqueo
    Dado que el Conductor registró un Tanqueo offline con UUID "uuid-tanqueo-001"
    Y que el push llegó al servidor pero la confirmación se perdió
    Cuando el Sincronizador reintenta el mismo Tanqueo con UUID "uuid-tanqueo-001"
    Entonces el servidor deduplica por la clave de idempotencia
    Y queda un solo Tanqueo registrado
    Y el cambio local queda marcado como "confirmado"

  Escenario: Tanqueo append-only no genera conflicto entre dispositivos
    Dado que dos Conductores registran Tanqueos del mismo Vehículo en momentos distintos
    Cuando ambos dispositivos sincronizan
    Entonces ambos Tanqueos coexisten sin conflicto
    Y no se requiere resolución de conflictos

  Escenario: Odómetro del Tanqueo menor a la lectura del servidor se marca anomalía
    Dado que la última lectura autoritativa del Odómetro del Vehículo "ABC123" es 152300
    Cuando se sincroniza un Tanqueo con Odómetro 151900
    Entonces el Tanqueo se conserva como hecho registrado
    Y se marca una anomalía de Odómetro
    Y la lectura autoritativa del Odómetro no retrocede y sigue siendo 152300

  Escenario: Rechazo local por valor en COP no positivo
    Dado que el dispositivo del Conductor no tiene señal
    Cuando el Conductor intenta registrar un Tanqueo con valor 0 COP
    Entonces el registro se rechaza localmente
    Y se informa que el valor en COP debe ser positivo
```
