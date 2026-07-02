/// El Sincronizador (doc 06 §4): push de la cola en orden FIFO + pull delta con
/// cursor, con la máquina de estados del §4.7 y backoff del §4.4.
///
/// Los TRIGGERS (conectividad, periódico, pull-to-refresh, foreground) viven en
/// la app Flutter (Fase 2); este motor solo expone `sincronizar()` y garantiza
/// que llamarlo N veces sea seguro (idempotencia extremo a extremo).
library;

import 'backoff.dart';
import 'modelos.dart';
import 'puertos.dart';
import 'reloj.dart';

class Sincronizador {
  Sincronizador({
    required this.cola,
    required this.espejo,
    required this.estadoSync,
    required this.api,
    required this.reloj,
    this.maxIntentos = 8,
    this.backoffBaseMs = 2000,
    this.backoffTechoMs = 5 * 60 * 1000,
    double Function()? aleatorio,
  }) : _aleatorio = aleatorio;

  final ColaOutbox cola;
  final EspejoLocal espejo;
  final EstadoSync estadoSync;
  final SyncApi api;
  final Reloj reloj;
  final int maxIntentos;
  final int backoffBaseMs;
  final int backoffTechoMs;
  final double Function()? _aleatorio;

  /// Ciclo completo: primero SUBIR lo capturado, luego BAJAR novedades
  /// (doc 06 §4.5 — recuperación de conectividad dispara push y luego pull).
  /// Un fallo TRANSITORIO del pull no tumba el ciclo: la cola ya quedó a salvo
  /// y el próximo trigger volverá a intentar (la sync nunca bloquea la UX).
  Future<void> sincronizar() async {
    await push();
    try {
      await pull();
    } on SinConexion {
      // Silencioso: frescura de "mi día" simplemente no avanza.
    }
  }

  // ─────────────────────────── PUSH ───────────────────────────

  /// Sube la cola pendiente EN ORDEN. Crash-safe: primero recupera cualquier
  /// cambio que quedó `enviando` por un cierre abrupto (doc 06 §6.1) — el
  /// reintento es seguro porque el servidor deduplica por UUID (R8).
  Future<ResumenPush> push() async {
    await _recuperarEnviando();

    final ahora = reloj.ahoraMs();
    final lote = await cola.listosParaEnviar(ahora);
    if (lote.isEmpty) return const ResumenPush();

    // Marcar `enviando` ANTES de tocar la red: si crasheamos a media llamada,
    // el próximo arranque sabe que ese lote pudo haber llegado al servidor.
    for (final cambio in lote) {
      cambio.estado = EstadoCambio.enviando;
      cambio.actualizadoEnMs = ahora;
      await cola.guardar(cambio);
    }

    List<ResultadoCambioApi> resultados;
    try {
      resultados = await api.push(lote);
    } on SinConexion catch (e) {
      // Transitorio (sin red/timeout/5xx/429): TODO el lote vuelve a pendiente
      // con backoff; tras maxIntentos pasa a fallido (sigue en la cola, no se
      // pierde — R11) y se expone para reintento manual.
      var reprogramados = 0;
      var fallidos = 0;
      for (final cambio in lote) {
        cambio.intentos += 1;
        cambio.lastError = e.toString();
        cambio.actualizadoEnMs = reloj.ahoraMs();
        if (cambio.intentos >= maxIntentos) {
          cambio.estado = EstadoCambio.fallido;
          fallidos += 1;
        } else {
          cambio.estado = EstadoCambio.pendiente;
          cambio.proximoIntentoEnMs = reloj.ahoraMs() +
              calcularEsperaMs(
                cambio.intentos,
                baseMs: backoffBaseMs,
                techoMs: backoffTechoMs,
                aleatorio: _aleatorio,
              );
          reprogramados += 1;
        }
        await cola.guardar(cambio);
      }
      return ResumenPush(reprogramados: reprogramados, fallidos: fallidos);
    }

    return _aplicarResultados(lote, resultados);
  }

  Future<void> _recuperarEnviando() async {
    final colgados = await cola.enEstado(EstadoCambio.enviando);
    for (final cambio in colgados) {
      cambio.estado = EstadoCambio.pendiente;
      cambio.proximoIntentoEnMs = 0; // reintentar ya: la dedup lo hace seguro
      cambio.actualizadoEnMs = reloj.ahoraMs();
      await cola.guardar(cambio);
    }
  }

  Future<ResumenPush> _aplicarResultados(
    List<CambioLocal> lote,
    List<ResultadoCambioApi> resultados,
  ) async {
    final porId = <String, ResultadoCambioApi>{
      for (final r in resultados) r.clientId: r,
    };
    var confirmados = 0, duplicados = 0, conflictos = 0, fallidos = 0;

    for (final cambio in lote) {
      final r = porId[cambio.id];
      cambio.actualizadoEnMs = reloj.ahoraMs();

      if (r == null) {
        // El servidor no se pronunció sobre este cambio: tratar como transitorio.
        cambio.estado = EstadoCambio.pendiente;
        cambio.intentos += 1;
        cambio.proximoIntentoEnMs = reloj.ahoraMs() +
            calcularEsperaMs(cambio.intentos,
                baseMs: backoffBaseMs,
                techoMs: backoffTechoMs,
                aleatorio: _aleatorio);
        await cola.guardar(cambio);
        continue;
      }

      switch (r.resultado) {
        case 'confirmado':
        case 'duplicado':
          cambio.estado = EstadoCambio.confirmado;
          cambio.versionServidor = r.version;
          if (r.resultado == 'duplicado') {
            duplicados += 1;
          } else {
            confirmados += 1;
          }
          await _adoptarVersionServidor(cambio);
        case 'conflicto':
          // Categoría C: el servidor ya aplicó la regla de dominio (autoridad
          // de campo / estado terminal). Para `estado_servicio` no hay
          // re-aplicación automática en el cliente: se ESCALA con el dato
          // íntegro en el payload — NUNCA se descarta en silencio (R11/§5.4).
          cambio.estado = EstadoCambio.escalado;
          cambio.lastError = '${r.problemaTipo}: ${r.problemaTitulo}';
          conflictos += 1;
        case 'error':
        default:
          // Permanente (validación): reintentar daría lo mismo (§4.4).
          cambio.estado = EstadoCambio.fallido;
          cambio.lastError = '${r.problemaTipo}: ${r.problemaTitulo}';
          fallidos += 1;
      }
      await cola.guardar(cambio);
    }

    return ResumenPush(
      confirmados: confirmados,
      duplicados: duplicados,
      conflictos: conflictos,
      fallidos: fallidos,
    );
  }

  Future<void> _adoptarVersionServidor(CambioLocal cambio) async {
    final id = cambio.servicioId;
    final version = cambio.versionServidor;
    if (id == null || version == null) return;
    final servicio = await espejo.servicio(id);
    if (servicio != null && version > servicio.version) {
      servicio.version = version;
      await espejo.guardarServicio(servicio);
    }
  }

  // ─────────────────────────── PULL ───────────────────────────

  /// Delta sync con cursor (doc 06 §4.3). Categoría A (documentos, datos de
  /// planificación) = server gana. Categoría C (estado del Servicio): si hay
  /// cambios locales SIN confirmar para ese Servicio, la verdad local del
  /// Conductor NO se retrocede — solo se adoptan los campos del admin.
  Future<ResumenPull> pull() async {
    final cursorPrevio = await estadoSync.cursor();
    final respuesta = await api.pull(cursorPrevio);

    for (final delServidor in respuesta.servicios) {
      final local = await espejo.servicio(delServidor.id);
      final pendientes = await cola.sinConfirmarDeServicio(delServidor.id);

      if (local == null || pendientes.isEmpty) {
        // Sin verdad local en vuelo: server gana completo.
        await espejo.guardarServicio(delServidor.copia());
        continue;
      }

      // Merge por campos (doc 06 §5.3, caso ilustrativo): la PLANIFICACIÓN del
      // admin (ruta, ventana, cliente, asignación) se adopta; la EJECUCIÓN del
      // Conductor (estado, inicioReal, finReal) se conserva hasta confirmar.
      local
        ..origen = delServidor.origen
        ..destino = delServidor.destino
        ..ventanaInicioIso = delServidor.ventanaInicioIso
        ..ventanaFinIso = delServidor.ventanaFinIso
        ..cliente = delServidor.cliente
        ..vehiculoId = delServidor.vehiculoId
        ..conductorId = delServidor.conductorId;
      if (delServidor.version > local.version) {
        local.version = delServidor.version;
      }
      await espejo.guardarServicio(local);
    }

    await espejo.reemplazarDocumentos(respuesta.documentos); // cat. A

    await estadoSync.guardarCursor(respuesta.cursor);
    await estadoSync.guardarUltimaSyncMs(reloj.ahoraMs());

    return ResumenPull(
      servicios: respuesta.servicios.length,
      documentos: respuesta.documentos.length,
    );
  }
}
