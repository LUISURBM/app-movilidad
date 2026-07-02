/// Tests de la capa de datos (fase 2a): los adaptadores Drift cumplen los
/// puertos de sync_core con la MISMA semántica que los in-memory verificados,
/// el HttpSyncApi habla el contrato /v1/sync/*, y el ciclo completo
/// captura→push→confirmado funciona sobre SQLite real (en memoria).
library;

import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sync_core/sync_core.dart' as nucleo;

import 'package:fleetspecial_app/datos/adaptadores_drift.dart';
import 'package:fleetspecial_app/datos/base_local.dart';
import 'package:fleetspecial_app/datos/composicion.dart';
import 'package:fleetspecial_app/datos/http_sync_api.dart';

nucleo.ServicioLocal servicioDePrueba({String id = 'srv-1'}) =>
    nucleo.ServicioLocal(
      id: id,
      origen: 'Bogotá',
      destino: 'Tunja',
      ventanaInicioIso: '2026-07-03T08:00:00.000Z',
      ventanaFinIso: '2026-07-03T11:00:00.000Z',
      estado: 'Planificado',
      version: 2,
      vehiculoId: 'veh-abc123',
      conductorId: 'cond-juan',
    );

void main() {
  group('ColaOutboxDrift — semántica de la cola (doc 06 §3.2/§4.7)', () {
    late BaseLocal db;
    late ColaOutboxDrift cola;

    setUp(() {
      db = BaseLocal(NativeDatabase.memory());
      cola = ColaOutboxDrift(db);
    });
    tearDown(() => db.close());

    nucleo.CambioLocal cambio(String id, int creadoEnMs) => nucleo.CambioLocal(
          id: id,
          entidad: 'estado_servicio',
          operacion: 'actualizar',
          payload: {'servicioId': 'srv-1', 'accion': 'iniciar', 'base_version': 2},
          tenantId: 'tenant-duster',
          creadoEnMs: creadoEnMs,
          ocurridoEnIso: '2026-07-03T06:00:00.000Z',
        );

    test('round-trip completo: payload JSON, enum de estado y contadores', () async {
      final c = cambio('uuid-1', 1000);
      c.estado = nucleo.EstadoCambio.conflicto;
      c.intentos = 3;
      c.proximoIntentoEnMs = 9999;
      c.lastError = 'transicion_invalida: S2';
      c.versionServidor = 7;
      await cola.guardar(c);

      final leido = (await cola.porId('uuid-1'))!;
      expect(leido.estado, nucleo.EstadoCambio.conflicto);
      expect(leido.payload['base_version'], 2);
      expect(leido.payload['servicioId'], 'srv-1');
      expect(leido.intentos, 3);
      expect(leido.proximoIntentoEnMs, 9999);
      expect(leido.lastError, contains('S2'));
      expect(leido.versionServidor, 7);
      expect(leido.tenantId, 'tenant-duster');
    });

    test('listosParaEnviar: solo pendientes vencidos, en orden FIFO', () async {
      final tarde = cambio('uuid-tarde', 2000);
      final temprano = cambio('uuid-temprano', 1000);
      final futuro = cambio('uuid-futuro', 500)..proximoIntentoEnMs = 99999;
      final confirmado = cambio('uuid-ok', 100)
        ..estado = nucleo.EstadoCambio.confirmado;
      for (final c in [tarde, temprano, futuro, confirmado]) {
        await cola.guardar(c);
      }

      final listos = await cola.listosParaEnviar(5000);
      expect(listos.map((c) => c.id).toList(), ['uuid-temprano', 'uuid-tarde']);
    });

    test('sinConfirmarDeServicio filtra por servicio y excluye confirmados', () async {
      await cola.guardar(cambio('uuid-1', 1));
      await cola.guardar(cambio('uuid-2', 2)..estado = nucleo.EstadoCambio.confirmado);
      final otro = cambio('uuid-3', 3);
      otro.payload['servicioId'] = 'srv-OTRO';
      await cola.guardar(otro);

      final enVuelo = await cola.sinConfirmarDeServicio('srv-1');
      expect(enVuelo.map((c) => c.id).toList(), ['uuid-1']);
    });
  });

  group('EspejoLocalDrift + EstadoSyncDrift', () {
    late BaseLocal db;
    late EspejoLocalDrift espejo;
    late EstadoSyncDrift estadoSync;

    setUp(() {
      db = BaseLocal(NativeDatabase.memory());
      espejo = EspejoLocalDrift(db);
      estadoSync = EstadoSyncDrift(db);
    });
    tearDown(() => db.close());

    test('upsert de Servicio y orden por ventana', () async {
      await espejo.guardarServicio(servicioDePrueba(id: 'srv-b')
        ..ventanaInicioIso = '2026-07-03T12:00:00.000Z');
      await espejo.guardarServicio(servicioDePrueba(id: 'srv-a'));
      expect(await espejo.servicio('srv-a'), isNotNull);
      final lista = await espejo.servicios();
      expect(lista.map((s) => s.id).toList(), ['srv-a', 'srv-b']);

      final actualizado = servicioDePrueba(id: 'srv-a')..estado = 'Iniciado';
      await espejo.guardarServicio(actualizado); // upsert
      expect((await espejo.servicio('srv-a'))!.estado, 'Iniciado');
    });

    test('reemplazarDocumentos es total (categoría A: server gana)', () async {
      await espejo.reemplazarDocumentos(const [
        nucleo.DocumentoLocal(id: 'd1', tipo: 'SOAT', estado: 'Vigente'),
        nucleo.DocumentoLocal(id: 'd2', tipo: 'RTM', estado: 'Vencido'),
      ]);
      await espejo.reemplazarDocumentos(const [
        nucleo.DocumentoLocal(id: 'd3', tipo: 'SOAT', estado: 'PorVencer', diasRestantes: 12),
      ]);
      final docs = await espejo.documentos();
      expect(docs.length, 1);
      expect(docs.single.tipo, 'SOAT');
      expect(docs.single.diasRestantes, 12);
    });

    test('cursor y ultimaSync se guardan sin pisarse entre sí', () async {
      expect(await estadoSync.cursor(), isNull);
      await estadoSync.guardarCursor('cursor-7');
      await estadoSync.guardarUltimaSyncMs(123456);
      expect(await estadoSync.cursor(), 'cursor-7');
      expect(await estadoSync.ultimaSyncMs(), 123456);
      await estadoSync.guardarCursor('cursor-8'); // no borra ultimaSync
      expect(await estadoSync.ultimaSyncMs(), 123456);
    });
  });

  group('Ciclo completo sobre SQLite real (captura→push→confirmado)', () {
    test('idéntico al motor verificado: confirmado, luego duplicado; espejo adopta versión', () async {
      final api = nucleo.SyncApiFalsa();
      final capa = CapaDatos.enMemoria(
        executor: NativeDatabase.memory(),
        api: api,
        tenantId: 'tenant-duster',
        reloj: nucleo.RelojFijo(DateTime.utc(2026, 7, 3, 6)),
      );
      addTearDown(capa.cerrar);

      await capa.espejo.guardarServicio(servicioDePrueba());
      final cambio = await capa.iniciarServicio('srv-1', odometro: 152000);
      expect(cambio.estado, nucleo.EstadoCambio.pendiente);
      expect((await capa.espejo.servicio('srv-1'))!.estado, 'Iniciado');

      final r1 = await capa.sincronizador.push();
      expect(r1.confirmados, 1);
      expect((await capa.espejo.servicio('srv-1'))!.version, 99);

      // Reintento del MISMO cambio (simulando cola re-procesada): dedup.
      final relanzado = (await capa.cola.porId(cambio.id))!;
      relanzado.estado = nucleo.EstadoCambio.pendiente;
      relanzado.proximoIntentoEnMs = 0;
      await capa.cola.guardar(relanzado);
      final r2 = await capa.sincronizador.push();
      expect(r2.duplicados, 1);
      expect(r2.confirmados, 0);
    });

    test('mi día desde el espejo con frescura', () async {
      final api = nucleo.SyncApiFalsa();
      api.respuestaPull = nucleo.RespuestaPull(
        cursor: 'cursor-1',
        servicios: [servicioDePrueba()],
        documentos: const [
          nucleo.DocumentoLocal(id: 'd1', tipo: 'SOAT', estado: 'PorVencer', diasRestantes: 12),
        ],
      );
      final reloj = nucleo.RelojFijo(DateTime.utc(2026, 7, 3, 6));
      final capa = CapaDatos.enMemoria(
        executor: NativeDatabase.memory(),
        api: api,
        reloj: reloj,
      );
      addTearDown(capa.cerrar);

      await capa.sincronizador.pull();
      reloj.avanzar(const Duration(minutes: 9));
      final miDia = await capa.miDia();
      expect(miDia.servicios.single.id, 'srv-1');
      expect(miDia.semaforoVehiculo, 'PorVencer');
      expect(miDia.datosDeHaceMin(reloj), 9);
    });
  });

  group('HttpSyncApi — contrato /v1/sync/* y taxonomía de errores', () {
    HttpSyncApi conMock(Future<http.Response> Function(http.Request) handler) =>
        HttpSyncApi(
          baseUrl: 'https://api.test/v1',
          tokenActual: () async => 'token-123',
          cliente: MockClient(handler),
        );

    test('push serializa el lote según el contrato y parsea los resultados', () async {
      late http.Request capturado;
      final api = conMock((req) async {
        capturado = req;
        return http.Response(
          jsonEncode({
            'resultados': [
              {'clientId': 'uuid-1', 'resultado': 'confirmado', 'version': 5},
              {
                'clientId': 'uuid-2',
                'resultado': 'conflicto',
                'problema': {'type': 'transicion_invalida', 'title': 'S2', 'status': 409},
              },
            ],
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });

      final cambio = nucleo.CambioLocal(
        id: 'uuid-1',
        entidad: 'estado_servicio',
        operacion: 'actualizar',
        payload: {'servicioId': 'srv-1', 'accion': 'iniciar', 'base_version': 2},
        tenantId: 't1',
        creadoEnMs: 1,
        ocurridoEnIso: '2026-07-03T06:00:00.000Z',
      );
      final resultados = await api.push([cambio]);

      expect(capturado.url.path, '/v1/sync/push');
      expect(capturado.headers['Authorization'], 'Bearer token-123');
      final cuerpo = jsonDecode(capturado.body) as Map<String, dynamic>;
      final enviado = (cuerpo['cambios'] as List).single as Map<String, dynamic>;
      expect(enviado['clientId'], 'uuid-1');
      expect(enviado['entidad'], 'estado_servicio');
      expect(enviado['operacion'], 'actualizar');
      expect(enviado['ocurridoEn'], '2026-07-03T06:00:00.000Z');
      expect((enviado['payload'] as Map)['base_version'], 2);

      expect(resultados[0].resultado, 'confirmado');
      expect(resultados[0].version, 5);
      expect(resultados[1].resultado, 'conflicto');
      expect(resultados[1].problemaTipo, 'transicion_invalida');
    });

    test('pull parsea servicios (asignación embebida) y documentos del contrato', () async {
      final api = conMock((req) async {
        expect(req.url.path, '/v1/sync/pull');
        expect(req.url.queryParameters['cursor'], 'cursor-3');
        return http.Response(
          jsonEncode({
            'cursor': 'cursor-4',
            'servicios': [
              {
                'id': 'srv-1',
                'origen': 'Bogotá',
                'destino': 'Sopó',
                'ventana': {'inicio': '2026-07-11T08:00:00.000Z', 'fin': '2026-07-11T11:00:00.000Z'},
                'estado': 'Planificado',
                'asignacion': {'servicioId': 'srv-1', 'vehiculoId': 'veh-1', 'conductorId': 'cond-1'},
              },
            ],
            'documentos': [
              {'id': 'd1', 'tipo': 'SOAT', 'estado': 'Vigente', 'vencimiento': '2027-12-31'},
            ],
            'vehiculos': [],
          }),
          200,
        );
      });

      final r = await api.pull('cursor-3');
      expect(r.cursor, 'cursor-4');
      expect(r.servicios.single.vehiculoId, 'veh-1');
      expect(r.servicios.single.conductorId, 'cond-1');
      expect(r.servicios.single.version, 1); // el contrato aún no la expone
      expect(r.documentos.single.vencimientoIso, '2027-12-31');
    });

    test('taxonomía: 503 y 429 → SinConexion (backoff); 400 → error permanente', () async {
      final api503 = conMock((_) async => http.Response('caído', 503));
      await expectLater(api503.pull(null), throwsA(isA<nucleo.SinConexion>()));

      final api429 = conMock((_) async => http.Response('rate limit', 429));
      await expectLater(api429.pull(null), throwsA(isA<nucleo.SinConexion>()));

      final api400 = conMock((_) async => http.Response('malo', 400));
      await expectLater(api400.pull(null), throwsA(isA<StateError>()));
    });
  });
}
