/// Smoke test de la UI "mi día": renderiza desde el espejo local y el flujo
/// iniciar (diálogo de odómetro) escribe local + encola + sincroniza.
library;

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sync_core/sync_core.dart' as nucleo;

import 'package:fleetspecial_app/datos/composicion.dart';
import 'package:fleetspecial_app/ui/mi_dia_screen.dart';

void main() {
  testWidgets('mi día muestra semáforo, servicio y ejecuta INICIAR offline-first',
      (tester) async {
    final api = nucleo.SyncApiFalsa();
    final capa = CapaDatos.enMemoria(
      executor: NativeDatabase.memory(),
      api: api,
      tenantId: 'tenant-demo',
    );
    addTearDown(capa.cerrar);

    await capa.espejo.guardarServicio(nucleo.ServicioLocal(
      id: 'srv-1',
      origen: 'Bogotá',
      destino: 'Colegio San José',
      ventanaInicioIso: '2026-07-04T07:00:00.000Z',
      ventanaFinIso: '2026-07-04T09:00:00.000Z',
      estado: 'Planificado',
      version: 2,
      vehiculoId: 'veh-duster',
      conductorId: 'cond-luis',
    ));
    await capa.espejo.reemplazarDocumentos(const [
      nucleo.DocumentoLocal(
          id: 'd1', tipo: 'SOAT', estado: 'Vigente', diasRestantes: 300),
    ]);

    await tester.pumpWidget(MaterialApp(home: MiDiaScreen(capa: capa)));
    await tester.pumpAndSettle();

    // Render desde el espejo local (sin red).
    expect(find.text('Bogotá → Colegio San José'), findsOneWidget);
    expect(find.text('Vehículo al día'), findsOneWidget);
    expect(find.text('Planificado'), findsOneWidget);

    // Flujo INICIAR: botón → diálogo de odómetro → confirmar.
    await tester.tap(find.widgetWithText(FilledButton, 'Iniciar'));
    await tester.pumpAndSettle();
    expect(find.text('Iniciar servicio'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '152000');
    await tester.tap(find.descendant(
      of: find.byType(AlertDialog),
      matching: find.widgetWithText(FilledButton, 'Iniciar'),
    ));
    await tester.pumpAndSettle();

    // La verdad local cambió de inmediato y el cambio quedó en la cola.
    expect(find.text('Iniciado'), findsOneWidget);
    final confirmadosOPendientes = [
      ...await capa.cola.enEstado(nucleo.EstadoCambio.pendiente),
      ...await capa.cola.enEstado(nucleo.EstadoCambio.confirmado),
    ];
    expect(confirmadosOPendientes.length, 1);
    expect(confirmadosOPendientes.single.payload['odometro'], 152000);
    expect(find.widgetWithText(FilledButton, 'Finalizar'), findsOneWidget);
  });
}
