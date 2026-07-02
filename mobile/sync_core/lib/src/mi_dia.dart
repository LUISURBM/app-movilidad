/// Read model "MI DÍA" (spec-010 R1/R2): lo que el Conductor ve al abrir la app,
/// SIEMPRE desde el espejo local (categoría A: solo lectura, server-authoritative).
/// Sin señal muestra lo último descargado con la marca "datos de hace N min".
library;

import 'modelos.dart';
import 'puertos.dart';
import 'reloj.dart';

/// Orden de severidad del semáforo (igual que el dominio del backend).
const _severidad = <String, int>{
  'Vigente': 0,
  'PorVencer': 1,
  'Vencido': 2,
};

String peorSemaforo(Iterable<String> estados) {
  var peor = 'Vigente';
  for (final e in estados) {
    if ((_severidad[e] ?? 0) > (_severidad[peor] ?? 0)) peor = e;
  }
  return peor;
}

class MiDia {
  const MiDia({
    required this.servicios,
    required this.documentos,
    required this.semaforoVehiculo,
    required this.ultimaSyncMs,
  });

  final List<ServicioLocal> servicios;
  final List<DocumentoLocal> documentos;

  /// Peor estado entre los documentos descargados (verde/amarillo/rojo).
  final String semaforoVehiculo;

  final int? ultimaSyncMs;

  bool get nuncaSincronizado => ultimaSyncMs == null;

  /// "Datos de hace N min" (spec-010, escenario 'mi día sin señal').
  int? datosDeHaceMin(Reloj reloj) {
    final ultima = ultimaSyncMs;
    if (ultima == null) return null;
    final ms = reloj.ahoraMs() - ultima;
    return ms < 0 ? 0 : ms ~/ 60000;
  }
}

Future<MiDia> cargarMiDia(EspejoLocal espejo, EstadoSync estadoSync) async {
  final servicios = await espejo.servicios();
  final documentos = await espejo.documentos();
  return MiDia(
    servicios: servicios,
    documentos: documentos,
    semaforoVehiculo: peorSemaforo(documentos.map((d) => d.estado)),
    ultimaSyncMs: await estadoSync.ultimaSyncMs(),
  );
}
