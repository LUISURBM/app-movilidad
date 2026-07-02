/// Los CUATRO gatillos de sincronización del doc 06 §4.5, todos en segundo
/// plano y sin bloquear jamás la UX:
///   1. Recuperación de conectividad (connectivity_plus) — el más importante.
///   2. Periódico (Timer) solo si hay red.
///   3. Manual (pull-to-refresh) → [manual].
///   4. App a primer plano (lifecycle) → [alPrimerPlano].
///
/// Serializa las corridas (un solo `sincronizar()` a la vez): los triggers se
/// solapan en la vida real y el motor no necesita esa complejidad.
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:sync_core/sync_core.dart' as nucleo;

class DisparadoresSync {
  DisparadoresSync({
    required this.sincronizador,
    Stream<List<ConnectivityResult>>? conectividad,
    this.intervaloPeriodico = const Duration(minutes: 5),
  }) : _conectividad =
            conectividad ?? Connectivity().onConnectivityChanged;

  final nucleo.Sincronizador sincronizador;
  final Stream<List<ConnectivityResult>> _conectividad;
  final Duration intervaloPeriodico;

  StreamSubscription<List<ConnectivityResult>>? _subConectividad;
  Timer? _timer;
  bool _hayRed = true;
  bool _corriendo = false;
  Object? ultimoError;

  void iniciar() {
    _subConectividad ??= _conectividad.listen((resultados) {
      final habiaRed = _hayRed;
      _hayRed = resultados.any((r) => r != ConnectivityResult.none);
      if (!habiaRed && _hayRed) {
        _disparar(); // volvió la señal: push de la cola y luego pull
      }
    });
    _timer ??= Timer.periodic(intervaloPeriodico, (_) {
      if (_hayRed) _disparar();
    });
  }

  void detener() {
    _subConectividad?.cancel();
    _subConectividad = null;
    _timer?.cancel();
    _timer = null;
  }

  /// Pull-to-refresh del Conductor: fuerza un ciclo YA y espera su fin
  /// (para poder cerrar el indicador de refresco).
  Future<void> manual() => _disparar();

  /// La app volvió a primer plano: sync oportunista.
  void alPrimerPlano() {
    if (_hayRed) _disparar();
  }

  Future<void> _disparar() async {
    if (_corriendo) return; // serializar: ya hay un ciclo en curso
    _corriendo = true;
    try {
      await sincronizador.sincronizar();
      ultimoError = null;
    } catch (e) {
      // El arranque nunca depende del sync; los errores quedan visibles para
      // la UI/diagnóstico y el próximo trigger lo reintenta.
      ultimoError = e;
    } finally {
      _corriendo = false;
    }
  }
}
