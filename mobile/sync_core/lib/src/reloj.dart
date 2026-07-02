/// Reloj inyectable — mismo patrón que el `Clock` del backend: todo cálculo de
/// tiempo (backoff, frescura de "mi día", marcas de la cola) es determinista en
/// pruebas. El cursor de sync usa el reloj del SERVIDOR (doc 06 §4.3); este
/// reloj es solo para tiempos LOCALES del dispositivo.
abstract class Reloj {
  int ahoraMs();
  DateTime ahora();
}

class RelojSistema implements Reloj {
  const RelojSistema();

  @override
  int ahoraMs() => DateTime.now().millisecondsSinceEpoch;

  @override
  DateTime ahora() => DateTime.now();
}

/// Reloj fijo y avanzable para pruebas.
class RelojFijo implements Reloj {
  RelojFijo(this._ahora);

  DateTime _ahora;

  @override
  int ahoraMs() => _ahora.millisecondsSinceEpoch;

  @override
  DateTime ahora() => _ahora;

  void avanzar(Duration d) {
    _ahora = _ahora.add(d);
  }
}
