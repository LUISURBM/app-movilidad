import 'dart:math';

/// Backoff exponencial con jitter (doc 06 §4.4):
/// secuencia base 2s, 4s, 8s, 16s… hasta un techo (5 min), con jitter ±20%
/// para evitar tormentas sincronizadas cuando toda la flota recupera señal.
///
/// `intentos` es el número de envíos YA fallidos (>= 1).
/// `aleatorio` devuelve un double en [0,1); inyectable para pruebas.
int calcularEsperaMs(
  int intentos, {
  int baseMs = 2000,
  int techoMs = 5 * 60 * 1000,
  double jitter = 0.2,
  double Function()? aleatorio,
}) {
  assert(intentos >= 1, 'intentos debe ser >= 1');
  final rnd = aleatorio ?? Random().nextDouble;
  // base * 2^(intentos-1), acotado al techo ANTES del jitter.
  final exponente = min(intentos - 1, 30); // evita overflow en colas viejas
  final puro = min(baseMs * pow(2, exponente).toInt(), techoMs);
  // Factor en [1-jitter, 1+jitter].
  final factor = 1 - jitter + (rnd() * 2 * jitter);
  return (puro * factor).round();
}
