# spec-009 — Regla de oro: bloquear Asignación si el Vehículo/Conductor no está al día (Semáforo en rojo)

- **Bounded Context:** BC-5 Service Scheduling (CORE) ← consulta a BC-4 Compliance & Documents vía ACL
- **Prioridad:** MVP
- **Estado:** Implemented
- **Aprobada por:** Luis (Product Manager + dominio) · 2026-06-25
- **Specs relacionadas:** spec-006 (Semáforo), spec-007 (Renovación — rehabilitación), spec-008 (crear Servicio y asignar)

## Objetivo

Implementar la **REGLA DE ORO** del negocio: **no se puede asignar un Servicio a un Vehículo o Conductor que no esté al día documentalmente**. Si el **Estado de cumplimiento (Semáforo)** del recurso está en **rojo (Vencido)**, la Asignación se **bloquea**; si está en **amarillo (Por vencer)**, la Asignación se **permite pero advierte**; si está en **verde (Vigente)**, se asigna normalmente. La verificación es parte de la creación de la Asignación y se hace consultando a Compliance a través de una **Anti-Corruption Layer (ACL)**.

## Actor(es)

- **Administrador/Owner** u **Operador**: intentan la Asignación.
- **Service Scheduling (BC-5)**: orquesta la verificación y decide.
- **ACL de Cumplimiento**: traduce el estado de Compliance al lenguaje propio (`puedeAsignarse`).
- **Compliance & Documents (BC-4)**: oráculo del Estado de cumplimiento del recurso.

## Reglas de negocio

1. **Invariante S3 (regla de oro):** una Asignación solo es válida si, en el momento de asignar, **tanto el Vehículo como el Conductor** están al día documentalmente (no en rojo).
2. La verificación se hace vía **ACL** hacia Compliance: Scheduling pregunta `puedeOperar(vehiculoId, conductorId, ventana)` y no importa a su modelo los Vencimientos ni el Semáforo.
3. **Semáforo en rojo (Vencido) → BLOQUEA (Política P3):** la Asignación se **rechaza** y se emite `AsignacionRechazada { servicioId, motivo: incumplimiento }`.
4. **Semáforo en amarillo (Por vencer) → ADVIERTE, no bloquea (Política P11):** la Asignación **se crea** y se emite una **advertencia** visible al Operador.
5. **Semáforo en verde (Vigente) → PERMITE:** la Asignación se crea sin advertencia.
6. Si **cualquiera** de los dos recursos (Vehículo **o** Conductor) está en rojo, la Asignación se bloquea (basta uno para bloquear).
7. La regla de oro se evalúa **junto con** la detección de choques de Ventana horaria (spec-008): ambas condiciones deben cumplirse para asignar.
8. **Política P5 (rehabilitación):** tras una Renovación que devuelve el recurso a Vigente (spec-007), el bloqueo se levanta y el recurso vuelve a ser asignable.
9. La advertencia por amarillo informa **qué** Documento está por vencer y en cuántos días, sin exponer datos de otro Tenant.
10. La verificación respeta el aislamiento por Tenant: solo consulta el cumplimiento de recursos de la propia Empresa.

## Casos felices

- El Operador asigna un Vehículo y un Conductor ambos en verde: la Asignación se crea sin advertencia.

## Casos alternativos

- El Operador asigna un Conductor en amarillo (licencia por vencer en 12 días): la Asignación se crea con advertencia.
- Tras renovar el Documento vencido del Vehículo, el Operador logra asignarlo (recurso rehabilitado).

## Casos de error

- El Operador intenta asignar un Vehículo en rojo (SOAT vencido): la Asignación se bloquea por incumplimiento.
- El Operador intenta asignar un Conductor en rojo (licencia vencida): la Asignación se bloquea por incumplimiento.
- El Vehículo está verde pero el Conductor está rojo: la Asignación se bloquea (basta uno).

## Criterios de aceptación (Gherkin)

```gherkin
# language: es
Característica: Regla de oro - bloquear la Asignación si el recurso no está al día
  Como Operador de una Empresa
  Quiero que el sistema impida asignar recursos con Documentos vencidos
  Para no poner en operación un Vehículo o Conductor que no esté al día

  Antecedentes:
    Dado que existe la Empresa "Transporte Duster SAS" como Tenant
    Y que un Usuario con rol "Operador" está autenticado en esa Empresa
    Y que existe un Servicio "Planificado" sin choques de Ventana horaria

  Escenario: Asignación permitida con recursos en verde
    Dado que el Vehículo "ABC123" tiene Estado de cumplimiento "Vigente"
    Y que el Conductor "Juan Pérez" tiene Estado de cumplimiento "Vigente"
    Cuando el Operador asigna el Vehículo "ABC123" y el Conductor "Juan Pérez" al Servicio
    Entonces la Asignación se crea correctamente
    Y no se muestra ninguna advertencia
    Y se emite el evento "ServicioAsignado"

  Escenario: Bloqueo por Vehículo en rojo (regla de oro)
    Dado que el Vehículo "ABC123" tiene Estado de cumplimiento "Vencido" por SOAT vencido
    Y que el Conductor "Juan Pérez" tiene Estado de cumplimiento "Vigente"
    Cuando el Operador intenta asignar el Vehículo "ABC123" y el Conductor "Juan Pérez" al Servicio
    Entonces la Asignación se rechaza
    Y se emite el evento "AsignacionRechazada" con motivo "incumplimiento"

  Escenario: Bloqueo por Conductor en rojo (regla de oro)
    Dado que el Vehículo "ABC123" tiene Estado de cumplimiento "Vigente"
    Y que el Conductor "Juan Pérez" tiene Estado de cumplimiento "Vencido" por Licencia vencida
    Cuando el Operador intenta asignar el Vehículo "ABC123" y el Conductor "Juan Pérez" al Servicio
    Entonces la Asignación se rechaza
    Y se emite el evento "AsignacionRechazada" con motivo "incumplimiento"

  Escenario: Basta un recurso en rojo para bloquear
    Dado que el Vehículo "ABC123" tiene Estado de cumplimiento "Vigente"
    Y que el Conductor "Ana Gómez" tiene Estado de cumplimiento "Vencido"
    Cuando el Operador intenta asignar el Vehículo "ABC123" y el Conductor "Ana Gómez" al Servicio
    Entonces la Asignación se rechaza por incumplimiento

  Escenario: Advertencia por recurso en amarillo (no bloquea)
    Dado que el Vehículo "ABC123" tiene Estado de cumplimiento "Vigente"
    Y que el Conductor "Juan Pérez" tiene Estado de cumplimiento "Por vencer" porque su Licencia vence en 12 días
    Cuando el Operador asigna el Vehículo "ABC123" y el Conductor "Juan Pérez" al Servicio
    Entonces la Asignación se crea correctamente
    Y se muestra una advertencia indicando que la Licencia del Conductor vence en 12 días
    Y se emite el evento "ServicioAsignado"

  Escenario: Rehabilitación tras Renovación permite asignar
    Dado que el Vehículo "ABC123" tenía Estado de cumplimiento "Vencido" y su Asignación estaba bloqueada
    Cuando se renueva el Documento vencido y el Vehículo pasa a "Vigente"
    Y el Operador asigna el Vehículo "ABC123" al Servicio
    Entonces la Asignación se crea correctamente

  Escenario: La regla de oro y el choque de horario se evalúan juntos
    Dado que el Vehículo "ABC123" tiene Estado de cumplimiento "Vigente"
    Y que el Vehículo "ABC123" ya tiene una Asignación que se solapa con la Ventana del Servicio
    Cuando el Operador intenta asignar el Vehículo "ABC123" al Servicio
    Entonces la Asignación se rechaza
    Y el motivo del rechazo es "choque"
`