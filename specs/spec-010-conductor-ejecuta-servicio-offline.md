# spec-010 — El Conductor ejecuta su Servicio OFFLINE (ver "mi día", iniciar/finalizar, sincronizar)

- **Bounded Context:** BC-5 Service Scheduling (CORE) — operación offline-first
- **Prioridad:** MVP
- **Estado:** Implemented
- **Aprobada por:** Luis (Product Manager + dominio) · 2026-06-25
- **Specs relacionadas:** spec-008 (Asignación), spec-011 (Tanqueo offline), spec-014 (Novedad offline)

## Objetivo

Permitir que el **Conductor** opere su jornada **sin señal** desde la app móvil: ver **"mi día"** (sus Servicios asignados, los Documentos y el Semáforo de su Vehículo) con datos cacheados, **marcar un Servicio iniciado y finalizado** offline (registrando inicio/fin reales y Odómetro), y que todo **sincronice** al recuperar conexión sin perder datos ni duplicar. El estado del Servicio es **estado mutable compartido (categoría C)**: el Conductor en campo tiene **autoridad** sobre la ejecución real.

## Actor(es)

- **Conductor** (app Flutter, offline-first): ve su día y opera sus propios Servicios.
- **App local** (cola de cambios + tablas espejo en SQLite): persiste localmente y encola.
- **Sincronizador** (segundo plano): sube cambios y baja actualizaciones al reconectar.
- **Sistema servidor** (BC-5): aplica transiciones, deduplica por idempotencia y resuelve conflictos.

## Reglas de negocio

1. El Conductor **solo ve lo suyo**: sus Servicios asignados, no toda la operación (alcance "propio").
2. **"Mi día" es categoría A (solo lectura, server-authoritative):** se descarga y se muestra; el Conductor nunca lo edita. Sin señal se muestra lo último descargado con marca de "datos de hace N min".
3. **Toda acción del Conductor se ejecuta y persiste localmente sin red** y se confirma de inmediato; la sincronización **nunca** bloquea la UX.
4. El Conductor puede **iniciar** un Servicio asignado (registra `inicioReal` y, opcionalmente, Odómetro de inicio) y **finalizar**lo (registra `finReal` y Odómetro de fin), offline.
5. **Invariante S5:** `inicioReal <= finReal`; no se finaliza un Servicio que no fue iniciado.
6. El cambio de estado del Servicio se encola en el **outbox del cliente** con un **UUID** que actúa como **clave de idempotencia** (`Idempotency-Key`) y su `base_version`.
7. Al reconectar, el Sincronizador hace **push** de la cola y **pull** de cambios; los reintentos usan **backoff exponencial**.
8. **Idempotencia:** si un cambio se envía dos veces (confirmación perdida), el servidor **deduplica por UUID** y no aplica la transición dos veces.
9. **Conflicto (categoría C) por versión:** si la `base_version` del cambio no coincide con la versión del servidor, hay conflicto (HTTP 409); se resuelve por **regla de dominio**: el **Conductor** tiene autoridad sobre la ejecución real, y un estado **terminal (Finalizado)** gana sobre intentos posteriores de reabrirlo.
10. Cambios del **admin** sobre la planificación (cliente, ventana, reasignación) son **server-authoritative**: si tocaron campos distintos, **ambos** sobreviven; si tocaron el mismo campo de estado, manda la regla de dominio (Conductor) y el otro intento se registra en **bitácora**.
11. **No pérdida de datos del Conductor:** ningún cambio local se borra hasta que el servidor lo **confirma**; un conflicto no resoluble se **escala**, nunca se descarta en silencio.
12. Al aplicar `ServicioIniciado`/`ServicioFinalizado` con Odómetro, el servidor actualiza el Odómetro del Vehículo validando monotonía (Política P8).

## Casos felices

- El Conductor, con señal, ve su día, inicia su Servicio a las 08:05 y lo finaliza a las 11:10 con Odómetro; todo sincroniza.

## Casos alternativos

- El Conductor, **sin señal**, inicia y finaliza el Servicio; al reconectar, ambos cambios suben en orden.
- El Conductor abre la app sin señal y ve su día con la marca "datos de hace N min".

## Casos de error / offline

- Se pierde la confirmación del push y el cambio se reintenta: el servidor deduplica por UUID (sin doble transición).
- El admin reprograma la **ventana** del Servicio mientras el Conductor (offline) lo marca **finalizado**: ambos campos sobreviven (autoridad de campo).
- El admin intenta **reabrir** un Servicio que el Conductor ya marcó **finalizado** offline: gana el estado terminal del Conductor; el intento queda en bitácora.
- Crash de la app a media sincronización: al reabrir, el Sincronizador retoma desde la cola sin perder ni duplicar.

## Criterios de aceptación (Gherkin)

```gherkin
# language: es
Característica: El Conductor ejecuta su Servicio offline y sincroniza al reconectar
  Como Conductor que opera sin señal en carretera
  Quiero ver mi día e iniciar/finalizar mis Servicios offline
  Para trabajar sin depender de la conexión y sin perder datos

  Antecedentes:
    Dado que existe la Empresa "Transporte Duster SAS" como Tenant
    Y que el Conductor "Juan Pérez" tiene un Servicio asignado para hoy con el Vehículo "ABC123"
    Y que la app del Conductor descargó su día previamente

  Escenario: Ver "mi día" sin señal con datos cacheados
    Dado que el dispositivo del Conductor no tiene señal
    Cuando el Conductor abre la pantalla "mi día"
    Entonces ve su Servicio asignado, los Documentos y el Semáforo del Vehículo "ABC123"
    Y se muestra la marca "datos de hace N min"
    Y el Conductor solo ve sus propios Servicios

  Escenario: Iniciar y finalizar un Servicio offline y sincronizar
    Dado que el dispositivo del Conductor no tiene señal
    Cuando el Conductor marca el Servicio como "Iniciado" a las "08:05" con Odómetro 152000
    Entonces el cambio se guarda localmente y se confirma de inmediato
    Y se encola en el outbox del cliente con un UUID y su base_version
    Cuando el Conductor marca el Servicio como "Finalizado" a las "11:10" con Odómetro 152180
    Entonces el cambio se guarda localmente y se confirma de inmediato
    Cuando el dispositivo recupera la señal
    Entonces el Sincronizador sube los cambios en orden
    Y el Servicio queda "Iniciado" y luego "Finalizado" en el servidor
    Y el Odómetro del Vehículo "ABC123" se actualiza a 152180 respetando la monotonía

  Escenario: No se puede finalizar un Servicio que no fue iniciado
    Dado que el Servicio asignado está en estado "Planificado"
    Cuando el Conductor intenta marcarlo como "Finalizado" sin haberlo iniciado
    Entonces la acción se rechaza por no respetar inicioReal <= finReal

  Escenario: Reintento por confirmación perdida no duplica la transición
    Dado que el Conductor marcó el Servicio como "Finalizado" offline con UUID "uuid-fin-001"
    Y que el push llegó al servidor pero la confirmación se perdió
    Cuando el Sincronizador reintenta el mismo cambio con UUID "uuid-fin-001"
    Entonces el servidor deduplica por la clave de idempotencia
    Y el Servicio se finaliza una sola vez
    Y el cambio local queda marcado como "confirmado"

  Escenario: Autoridad de campo - el admin cambia la ventana mientras el Conductor finaliza
    Dado que el Conductor, sin señal, marca el Servicio como "Finalizado" a las "16:05"
    Y que el admin, en el portal, cambia la Ventana horaria del mismo Servicio a las "16:00"
    Cuando el dispositivo del Conductor reconecta y sincroniza
    Entonces el estado "Finalizado" del Conductor se conserva
    Y el cambio de Ventana horaria del admin también se conserva
    Y ambos campos sobreviven por tocar columnas distintas

  Escenario: El estado terminal del Conductor gana sobre intentos de reabrir
    Dado que el Conductor marcó el Servicio como "Finalizado" offline
    Cuando el admin intenta reabrir el mismo Servicio a "Iniciado"
    Y el dispositivo sincroniza
    Entonces gana el estado terminal "Finalizado" del Conductor
    Y el intento del admin queda registrado en la bitácora de sincronización

  Escenario: Crash a media sincronización no pierde ni duplica
    Dado que el Conductor tiene un cambio "enviando" en la cola
    Cuando la app se cierra abruptamente y se vuelve a abrir
    Entonces el Sincronizador retoma el cambio desde la cola
    Y por idempotencia no se duplica
    Y no se pierde ningún dato del Conductor

  Escenario: Conflicto no resoluble se escala sin descartar el dato del Conductor
    Dado que un cambio de estado del Conductor entra en conflicto que no puede resolverse automáticamente
    Cuando el Sincronizador procesa el conflicto
    Entonces el dato del Conductor se conserva íntegro
    Y el conflicto se escala al admin en el portal para resolución manual
    Y nunca se descarta en silencio
`