# spec-012 — Programar Mantenimiento preventivo por Umbral de Odómetro/fecha

- **Bounded Context:** BC-7 Maintenance Management
- **Prioridad:** MVP
- **Estado:** Implemented
- **Aprobada por:** Luis (Product Manager + dominio) · 2026-07-02 (Draft → Approved → Implemented en la misma sesión, autorizado por el PM)
- **Specs relacionadas:** spec-003 (Vehículo, Odómetro), spec-011 (Tanqueo que actualiza Odómetro), spec-010 (Servicio que actualiza Odómetro)

## Objetivo

Permitir definir un **Umbral de mantenimiento** (cada N kilómetros o cada T tiempo) para un **Vehículo** y **programar automáticamente** un **Mantenimiento preventivo** cuando el **Odómetro** supera el umbral de km o se alcanza la fecha objetivo. También permite registrar la **ejecución** del mantenimiento (que reinicia el ciclo) y registrar un **Mantenimiento correctivo** reactivo. Evita reaccionar tarde a la falla.

## Actor(es)

- **Administrador/Owner** u **Operador**: definen Umbrales y registran ejecuciones; el **Dueño de Vehículo** ve los de sus Vehículos.
- **Maintenance Management (BC-7)**: evalúa Umbrales ante avances del Odómetro y dispara la programación.
- **Sistema** (reloj de dominio): evalúa los Umbrales por fecha.

## Reglas de negocio

1. Un **Umbral de mantenimiento** se define por **kilometraje** (cada N km), por **fecha** (cada T tiempo), o ambos.
2. **Política P6 (disparo por km):** cuando un avance del Odómetro (`OdometroActualizado`, originado por Tanqueo o Servicio) hace que el Odómetro **supere** el Umbral de km, se programa un Mantenimiento preventivo.
3. **Política P7 (disparo por fecha):** cuando se alcanza la fecha objetivo de un preventivo programado y no se ha registrado su ejecución, se emite `MantenimientoVencido`.
4. Al programar un preventivo se emite `MantenimientoProgramado { mantenimientoId, vehiculoId, tipo, dispararPor }` con `dispararPor` igual a `km` o `fecha`.
5. El Odómetro que evalúa el Umbral es la **lectura autoritativa** del Vehículo (monótona, BC-2); no retrocede.
6. Registrar la **ejecución** de un Mantenimiento reinicia el ciclo del Umbral (el siguiente preventivo se calcula desde la nueva base de km/fecha) y emite `MantenimientoRegistrado { mantenimientoId, vehiculoId, costoCop, odometro }`.
7. Un **Mantenimiento correctivo** se registra de forma reactiva ante una falla, con su costo en COP y Odómetro; no depende del Umbral.
8. Si el Vehículo ya tiene un preventivo programado y pendiente para el mismo Umbral, no se duplica la programación (idempotencia de la programación).
9. El sistema **no bloquea** automáticamente la operación por un mantenimiento vencido en el MVP; **advierte** (Scheduling puede mostrar la advertencia).
10. Todo Umbral, programación y registro pertenece a un único Tenant.

## Casos felices

- Con Umbral cada 10.000 km, el Vehículo "ABC123" pasa de 149.000 a 152.000 km vía Tanqueos y se programa un preventivo al superar 150.000.

## Casos alternativos

- Se define un Umbral por fecha (cada 6 meses) y se programa el preventivo al llegar la fecha objetivo.
- Se registra la ejecución del preventivo y el ciclo se reinicia desde la nueva base.
- Se registra un Mantenimiento correctivo tras una falla, sin Umbral asociado.

## Casos de error / límite

- El Odómetro supera el Umbral exactamente en el valor límite: se programa el preventivo (umbral alcanzado).
- Ya hay un preventivo pendiente para el mismo Umbral: no se duplica la programación.
- Llega la fecha objetivo sin ejecución registrada: se emite `MantenimientoVencido`.

## Criterios de aceptación (Gherkin)

```gherkin
# language: es
Característica: Programar Mantenimiento preventivo por Umbral de Odómetro o fecha
  Como Operador de una Empresa
  Quiero que el sistema programe el mantenimiento preventivo según el Umbral
  Para anticipar el mantenimiento y no reaccionar a la falla

  Antecedentes:
    Dado que existe la Empresa "Transporte Duster SAS" como Tenant
    Y que un Usuario con rol "Operador" está autenticado en esa Empresa
    Y que existe el Vehículo con placa "ABC123"

  Escenario: Programación por superar el Umbral de kilometraje
    Dado que el Vehículo "ABC123" tiene un Umbral de mantenimiento cada 10000 km con base en 140000
    Y que la lectura autoritativa del Odómetro es 149000
    Cuando se sincroniza un Tanqueo que actualiza el Odómetro a 152000
    Entonces se programa un Mantenimiento preventivo
    Y se emite el evento "MantenimientoProgramado" con dispararPor "km"

  Escenario: El Umbral alcanzado exactamente dispara la programación
    Dado que el Vehículo "ABC123" tiene un Umbral de mantenimiento cada 10000 km con base en 140000
    Y que la lectura autoritativa del Odómetro es 149500
    Cuando un Servicio finalizado actualiza el Odómetro a 150000
    Entonces se programa un Mantenimiento preventivo
    Y se emite el evento "MantenimientoProgramado" con dispararPor "km"

  Escenario: Programación por fecha objetivo
    Dado que el Vehículo "ABC123" tiene un Umbral de mantenimiento cada 6 meses
    Cuando el reloj de dominio alcanza la fecha objetivo sin ejecución registrada
    Entonces se emite el evento "MantenimientoVencido" para el Vehículo "ABC123"

  Escenario: No se duplica un preventivo ya programado para el mismo Umbral
    Dado que el Vehículo "ABC123" ya tiene un Mantenimiento preventivo programado y pendiente por km
    Cuando un nuevo avance del Odómetro vuelve a superar el mismo Umbral
    Entonces no se programa un segundo Mantenimiento preventivo para el mismo Umbral

  Escenario: Registrar la ejecución reinicia el ciclo del Umbral
    Dado que el Vehículo "ABC123" tiene un Mantenimiento preventivo programado
    Cuando el Operador registra la ejecución del Mantenimiento con costo 350000 COP y Odómetro 152000
    Entonces se emite el evento "MantenimientoRegistrado" con costo 350000 COP
    Y el siguiente preventivo se calcula desde la nueva base de 152000 km

  Escenario: Registrar un Mantenimiento correctivo reactivo
    Dado que el Vehículo "ABC123" presentó una falla
    Cuando el Operador registra un Mantenimiento correctivo con costo 480000 COP y Odómetro 152400
    Entonces el Mantenimiento correctivo queda registrado
    Y se emite el evento "MantenimientoRegistrado" con costo 480000 COP

  Escenario: Mantenimiento vencido advierte, no bloquea en el MVP
    Dado que el Vehículo "ABC123" tiene un Mantenimiento preventivo vencido
    Cuando el Operador consulta la programación del Vehículo
    Entonces se muestra una advertencia de mantenimiento vencido
    Y la operación del Vehículo no se bloquea automáticamente
```

## Notas de implementación (2026-07-02)

Implementada en `backend/src/modules/maintenance-management` (BC-7) en Clean Architecture.
Dominio + aplicación + migración 0009 + tests verdes (unitarias derivadas de los Gherkin:
programación por km/fecha, idempotencia R8, reinicio de ciclo, correctivo; + integración
PGlite: RLS, unicidad, CHECK de criterio). Decisiones tomadas al implementar, **para
ratificación del dominio** (la spec pasó de Draft a Implemented con autorización del PM):

1. **Disparo por km (P6) — seam.** `EvaluarUmbralPorOdometro` es el caso de uso que reacciona
   a un avance del Odómetro; su **cableado al evento `OdometroActualizado`** (Fuel/Fleet/
   Servicio) vía outbox/ACL queda pendiente. Hoy se prueba invocándolo directamente.
2. **Disparo por fecha (P7) — job diario.** `EvaluarVencimientosPorFecha(tenant)` lo invocará
   el `DailyTenantJob` de plataforma (como con Compliance); wiring pendiente.
3. **Sin REST aún.** El OpenAPI **no** define rutas `/mantenimiento`; fiel a API-First, no se
   crearon endpoints. El módulo expone los casos de uso, listos para el controller cuando el
   contrato defina las rutas. El módulo aún no se importa en AppModule (sin REST ni disparadores).
4. **Sin bloqueo (R9).** El vencido queda como estado consultable (advierte); no bloquea.
