import 'dart:math';

/// UUID v4 generado en el dispositivo (doc 06 §3.2): identidad del cambio y
/// clave de idempotencia que el servidor usa para deduplicar. Implementación
/// mínima sobre `Random.secure()` para mantener el paquete sin dependencias.
String uuidV4({Random? aleatorio}) {
  final rnd = aleatorio ?? Random.secure();
  final bytes = List<int>.generate(16, (_) => rnd.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  final hex =
      bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
