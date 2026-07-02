# spec-008 — Crear un Servicio y asignar Vehículo + Conductor con detección de choques de Ventana horaria

- **Bounded Context:** BC-5 Service Scheduling (CORE)
- **Prioridad:** MVP
- **Estado:** Approved
- **Aprobada por:** Luis (Product Manager + dominio) · 2026-06-25
- **Specs relacionadas:** spec-003 (Vehículo), spec-004 (Conductor), spec-009 (regla de oro), spec-010 (ejecución offline), spec-014 (Novedad)

## Objetivo

Permitir crear un **Servicio** (origen, destino, fecha/hora, cliente) y **asignarle** un **Vehículo** y un **Conductor** para una **Ventana horaria**, garantizando que **no haya choques**: ninguna **Asignación** puede solaparse con otra activa del mismo Vehículo o del mismo Conductor. El Servicio sigue el ciclo de vida `Planificado → Iniciado → Finalizado` (o `Planificado → Cancelado`). La verificación de cumplimiento documental (regla de oro) se especifica en spec-009.

## Actor(es)

- **Administrador/Owner** u **Operador**: crean Servicios y realizan Asignaciones.
- **Sistema** (BC-5 Service Scheduling): valida no solapamiento, gestiona transiciones de estado y emite eventos.

## Reglas de negocio

1. Solo los Roles Administrador/Owner u Operador pueden crear Servicios y asignar recursos.
2. Un Servicio se crea con **Ruta** (origen, destino), **Ventana horaria** `[inicio, fin)` y cliente; nace en estado **Planificado**.
3. Una **Asignación** vincula el Servicio con un **Vehículo** y un **Conductor** para la Ventana horaria del Servicio.
4. **Invariante S4 (no double-booking):** la Ventana horaria de una Asignación **no puede solaparse** con otra Asignación activa del mismo Vehículo ni del mismo Conductor.
5. La Ventana horaria es un intervalo **semiabierto** `[inicio, fin)`: dos ventanas que solo comparten el instante de borde (una termina justo cuando la otra empieza) **no** se consideran choque.
6. **Invariante S1:** un Servicio solo puede pasar a **Iniciado** si tiene una Asignación válida.
7. **Invariante S2:** las transiciones válidas son únicamente `Planificado → Iniciado → Finalizado` o `Planificado → Cancelado`; no se salta ni se retrocede.
8. Al crear el Servicio se emite `ServicioCreado { servicioId, ruta, ventana, clienteRef }`.
9. Al asignar con éxito se emite `ServicioAsignado { servicioId, vehiculoId, conductorId, ventana }`.
10. Si la Asignación se rechaza por choque, se emite `AsignacionRechazada { servicioId, motivo: choque }` (Política P4).
11. Se puede **reasignar** un Servicio (cambiar Vehículo/Conductor) mientras esté Planificado, respetando de nuevo la regla de no solapamiento.
12. Todo Servicio y Asignación pertenecen a un único Tenant; no hay choques entre Empresas distintas (un Vehículo de Empresa A nunca colisiona con uno de Empresa B).

## Casos felices

- El Operador crea un Servicio Bogotá→Tunja de 08:00 a 11:00 y le asigna el Vehículo "ABC123" y el conductor "Juan Pérez" sin choques.

## Casos alternativos

- El Operador asigna al mismo Vehículo dos Servicios **consecutivos** (08:00–10:00 y 10:00–12:00): no hay choque porque la ventana es semiabierta.
- El Operador **reasigna** un Servicio Planificado a otro Conductor disponible.
- El Operador **cancela** un Servicio Planificado.

## Casos de error

- Se intenta asignar un Vehículo cuya Ventana horaria se solapa con otra Asignación activa: se rechaza por choque.
- Se intenta asignar un Conductor cuya Ventana horaria se solapa con otra Asignación activa: se rechaza por choque.
- Se intenta **iniciar** un Servicio sin Asignación válida: se rechaza (S1).
- Se intenta **finalizar** un Servicio que está Planificado (sin pasar por Iniciado): se rechaza (S2).

## Criterios de aceptación (Gherkin)

```gherkin
# language: es
Característica: Crear un Servicio y asignar Vehículo y Conductor sin choques de Ventana horaria
  Como Operador de una Empresa
  Quiero crear Servicios y asignar recursos sin solapamientos
  Para evitar el double-booking de Vehículos y Conductores

  Antecedentes:
    Dado que existe la Empresa "Transporte Duster SAS" como Tenant
    Y que un Usuario con rol "Operador" está autenticado en esa Empresa
    Y que existe el Vehículo con placa "ABC123" al día documentalmente
    Y que existe el Conductor "Juan Pérez" al día documentalmente

  Escenario: Creación y asignación exitosa de un Servicio
    Cuando el Operador crea un Servicio de "Bogotá" a "Tunja" con Ventana horaria de "2026-07-01 08:00" a "2026-07-01 11:00" para el cliente "Colegio San José"
    Entonces el Servicio queda en estado "Planificado"
    Y se emite el evento "ServicioCreado"
    Cuando el Operador asigna el Vehículo "ABC123" y el Conductor "Juan Pérez"
    Entonces la Asignación se crea correctamente
    Y se emite el evento "ServicioAsignado" con el Vehículo "ABC123" y el Conductor "Juan Pérez"

  Escenario: Dos Servicios consecutivos no generan choque (ventana semiabierta)
    Dado que el Vehículo "ABC123" tiene una Asignación de "2026-07-01 08:00" a "2026-07-01 10:00"
    Cuando el Operador crea otro Servicio y asigna el Vehículo "ABC123" de "2026-07-01 10:00" a "2026-07-01 12:00"
    Entonces la Asignación se crea correctamente
    Y no se reporta choque de Ventana horaria

  Escenario: Rechazo por choque de Ventana horaria del Vehículo
    Dado que el Vehículo "ABC123" tiene una Asignación de "2026-07-01 08:00" a "2026-07-01 11:00"
    Cuando el Operador intenta asignar el Vehículo "ABC123" a otro Servicio de "2026-07-01 10:00" a "2026-07-01 12:00"
    Entonces la Asignación se rechaza
    Y se emite el evento "AsignacionRechazada" con motivo "choque"

  Escenario: Rechazo por choque de Ventana horaria del Conductor
    Dado que el Conductor "Juan Pérez" tiene una Asignación de "2026-07-01 08:00" a "2026-07-01 11:00"
    Cuando el Operador intenta asignar al Conductor "Juan Pérez" a otro Servicio de "2026-07-01 09:00" a "2026-07-01 10:00"
    Entonces la Asignación se rechaza
    Y se emite el evento "AsignacionRechazada" con motivo "choque"

  Escenario: Reasignar un Servicio Planificado a otro Conductor
    Dado que existe un Servicio Planificado asignado al Conductor "Juan Pérez"
    Y que existe el Conductor "Ana Gómez" disponible y al día documentalmente
    Cuando el Operador reasigna el Servicio al Conductor "Ana Gómez"
    Entonces la Asignación queda con el Conductor "Ana Gómez"
    Y se respeta la regla de no solapamiento

  Escenario: No se puede iniciar un Servicio sin Asignación válida
    Dado que existe un Servicio "Planificado" sin Asignación
    Cuando se intenta marcar el Servicio como "Iniciado"
    Entonces la transición se rechaza por no tener Asignación válida

  Escenario: Transición de estado inválida
    Dado que existe un Servicio en estado "Planificado" con Asignación válida
    Cuando se intenta marcar el Servicio como "Finalizado" sin pasar por "Iniciado"
    Entonces la transición se rechaza por no respetar el ciclo de vida del Servicio

  Escenario: Cancelar un Servicio Planificado
    Dado que existe un Servicio en estado "Planificado"
    Cuando el Operador cancela el Servicio
    Entonces el Servicio queda en estado "Cancelado"
```
