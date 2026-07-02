# `sync_core` — motor de sincronización offline (spec-010, lado cliente)

Dart **puro y sin dependencias**: el corazón del offline-first del Conductor
(docs/06-offline-first.md), independiente de Flutter. La app (Fase 2) solo
implementa los puertos y pinta la UI.

## Qué implementa

| Pieza | Doc 06 | Qué garantiza |
|---|---|---|
| `CambioLocal` + `ColaOutbox` | §3.2 | Cola persistente FIFO, payload autocontenido, UUID = Idempotency-Key |
| Máquina de estados | §4.7 | `pendiente → enviando → confirmado \| conflicto→escalado \| fallido` |
| `Sincronizador.push()` | §4.2/§4.4 | Reintentos seguros (dedup por UUID), backoff 2s→5min ±20%, crash-resume (`enviando`→retomar), transitorio vs permanente vs conflicto |
| `Sincronizador.pull()` | §4.3/§5.3 | Cursor delta, server-gana (cat. A), y merge cat. C: la ejecución local del Conductor **no retrocede** mientras haya cambios sin confirmar; la planificación del admin sí se adopta |
| `AccionesConductor` | §1/R3-R5 | Captura local inmediata (la sync nunca bloquea la UX), S5 y transiciones validadas offline, `base_version` en el payload |
| `MiDia` | R1/R2 | Solo lo suyo, semáforo = peor estado, marca "datos de hace N min" |
| Escalamiento | §5.4 | Conflicto ⇒ `escalado` con el dato íntegro; **nunca** se descarta en silencio |

## Verificación (requiere Dart SDK; viene con Flutter)

```bash
cd mobile/sync_core
dart analyze
dart run tool/verificar.dart   # 13 escenarios Gherkin del lado cliente
```

> Este paquete se escribió en un entorno sin Dart SDK: la PRIMERA ejecución de
> los comandos de arriba (o el job `sync_core` del CI) es la verificación
> oficial. Cualquier fallo es un bug a corregir antes de construir la UI.

## Cómo lo consumirá la app Flutter (Fase 2)

- `ColaOutbox`, `EspejoLocal`, `EstadoSync` → tablas **Drift/SQLite** (cifrado
  SQLCipher, §3.4); cada captura = **una transacción** espejo+cola (§6.1).
- `SyncApi` → `package:http` contra `/v1/sync/*` con el Bearer del conductor.
- Triggers (§4.5): `connectivity_plus`, temporizador, pull-to-refresh y
  foreground → todos llaman `sincronizador.sincronizar()`.
