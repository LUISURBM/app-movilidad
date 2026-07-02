/// Runner de verificación de sync_core — escenarios Gherkin de spec-010 (lado
/// cliente) + docs/06-offline-first.md, SIN dependencias (ni package:test).
///
///   dart run tool/verificar.dart
///
/// Sale con código 1 si algún escenario falla (apto para CI).
library;

import 'dart:io';

import 'package:sync_core/sync_core.dart';

int _ok = 0;
int _fallos = 0;

void chequear(bool condicion, String descripcion) {
  if (!condicion) throw StateError('FALLÓ: $descripcion');
}

Future<void> escenario(String nombre, Future<void> Function() cuerpo) async {
  try {
    await cuerpo();
    _ok += 1;
    stdout.writeln('  ✓ $nombre');
  } catch (e) {
    _fallos += 1;
    stdout.writeln('  ✗ $nombre\n      $e');
  }
}

// ─────────────────────────── entorno de prueba ───────────────────────────

class Entorno {
  Entorno()
      : reloj = RelojFijo(DateTime.utc(2026, 7, 3, 6, 0)),
        cola = ColaOutboxMemoria(),
        espejo = EspejoLocalMemoria(),
        estadoSync = EstadoSyncMemoria(),
        api = SyncApiFalsa() {
    var n = 0;
    acciones = AccionesConductor(
      cola: cola,
      espejo: espejo,
      reloj: reloj,
      tenantId: 'tenant-duster',
      generarId: () => 'uuid-${++n}',
    );
    sincronizador = Sincronizador(
      cola: cola,
      espejo: espejo,
      estadoSync: estadoSync,
      api: api,
      reloj: reloj,
      backoffBaseMs: 2000,
      aleatorio: () => 0.5, // jitter neutro (factor 1.0): determinista
    );
  }

  final RelojFijo reloj;
  final ColaOutboxMemoria cola;
  final EspejoLocalMemoria espejo;
  final EstadoSyncMemoria estadoSync;
  final SyncApiFalsa api;
  late final AccionesConductor acciones;
  late final Sincronizador sincronizador;

  /// Siembra un Servicio asignado en el espejo (como si vinera de un pull).
  Future<ServicioLocal> conServicio({
    String id = 'srv-1',
    String estado = 'Planificado',
    int version = 2,
  }) async {
    final s = ServicioLocal(
      id: id,
      origen: 'Bogotá',
      destino: 'Tunja',
      ventanaInicioIso: '2026-07-03T08:00:00.000Z',
      ventanaFinIso: '2026-07-03T11:00:00.000Z',
      estado: estado,
      version: version,
      vehiculoId: 'veh-abc123',
      conductorId: 'cond-juan',
    );
    await espejo.guardarServicio(s);
    return s;
  }
}

// ─────────────────────────── escenarios ───────────────────────────

Future<void> main() async {
  stdout.writeln('sync_core — verificación de spec-010 (cliente) y doc 06\n');

  stdout.writeln('CAPTURA OFFLINE (R3/R4: local primero, confirmación inmediata)');

  await escenario(
      'iniciar offline actualiza el espejo YA y encola con UUID + base_version',
      () async {
    final env = Entorno();
    await env.conServicio();
    final cambio =
        await env.acciones.iniciarServicio('srv-1', odometro: 152000);

    final local = await env.espejo.servicio('srv-1');
    chequear(local!.estado == 'Iniciado', 'espejo local pasa a Iniciado sin red');
    chequear(local.inicioRealIso != null, 'inicioReal registrado');
    chequear(cambio.estado == EstadoCambio.pendiente, 'cambio queda pendiente');
    chequear(cambio.entidad == 'estado_servicio', 'entidad del CONTRATO');
    chequear(cambio.operacion == 'actualizar', 'operación del CONTRATO');
    chequear(cambio.payload['base_version'] == 2, 'lleva base_version (R9)');
    chequear(cambio.payload['odometro'] == 152000, 'payload autocontenido');
  });

  await escenario('S5 local: finalizar antes del inicioReal falla rápido y NO encola',
      () async {
    final env = Entorno();
    await env.conServicio();
    await env.acciones.iniciarServicio('srv-1');
    env.reloj.avanzar(const Duration(minutes: -10)); // reloj retrocede
    var codigo = '';
    try {
      await env.acciones.finalizarServicio('srv-1');
    } on ErrorAccion catch (e) {
      codigo = e.codigo;
    }
    chequear(codigo == 'fin_anterior_a_inicio', 'invariante S5 en el cliente');
    chequear(env.cola.total == 1, 'solo el iniciar quedó encolado');
  });

  await escenario('transición local inválida (iniciar dos veces) no encola basura',
      () async {
    final env = Entorno();
    await env.conServicio();
    await env.acciones.iniciarServicio('srv-1');
    var codigo = '';
    try {
      await env.acciones.iniciarServicio('srv-1');
    } on ErrorAccion catch (e) {
      codigo = e.codigo;
    }
    chequear(codigo == 'transicion_invalida', 'S2 defensivo local');
    chequear(env.cola.total == 1, 'un solo cambio en cola');
  });

  stdout.writeln('\nPUSH EN ORDEN + IDEMPOTENCIA (R7/R8)');

  await escenario('el lote sube FIFO por creado_en y confirma; espejo adopta versión server',
      () async {
    final env = Entorno();
    await env.conServicio();
    await env.acciones.iniciarServicio('srv-1', odometro: 152000);
    env.reloj.avanzar(const Duration(hours: 3));
    await env.acciones.finalizarServicio('srv-1', odometro: 152180);

    final resumen = await env.sincronizador.push();
    chequear(resumen.confirmados == 2, 'confirmado x2');
    chequear(env.api.lotesRecibidos.length == 1, 'un solo POST /sync/push');
    final lote = env.api.lotesRecibidos.first;
    chequear(lote[0].payload['accion'] == 'iniciar', '1º iniciar (FIFO)');
    chequear(lote[1].payload['accion'] == 'finalizar', '2º finalizar (FIFO)');
    final local = await env.espejo.servicio('srv-1');
    chequear(local!.version == 99, 'espejo adopta la versión del servidor');
    chequear((await env.cola.listosParaEnviar(env.reloj.ahoraMs())).isEmpty,
        'cola drenada');
  });

  await escenario(
      'confirmación perdida (escenario Gherkin): el reintento llega como duplicado, sin doble transición',
      () async {
    final env = Entorno();
    await env.conServicio();
    await env.acciones.iniciarServicio('srv-1', odometro: 152000);
    env.reloj.avanzar(const Duration(hours: 3));
    await env.acciones.finalizarServicio('srv-1', odometro: 152180);
    env.api.programarConfirmacionPerdida(); // servidor procesa, respuesta se pierde

    final r1 = await env.sincronizador.push();
    chequear(r1.reprogramados == 2, 'transitorio: lote reprogramado con backoff');
    final colaTrasFallo = await env.cola.enEstado(EstadoCambio.pendiente);
    chequear(colaTrasFallo.length == 2, 'nada se pierde (R11)');
    chequear(colaTrasFallo.first.intentos == 1, 'intentos=1');

    env.reloj.avanzar(const Duration(seconds: 10)); // pasa el backoff (2s)
    final r2 = await env.sincronizador.push();
    chequear(r2.duplicados == 2, 'el servidor dedupe por UUID → duplicado x2');
    chequear(r2.confirmados == 0, 'sin doble transición');
    chequear((await env.cola.enEstado(EstadoCambio.confirmado)).length == 2,
        'cambios locales marcados confirmado');
  });

  await escenario('crash a media sync: filas `enviando` se retoman al reabrir, sin duplicar',
      () async {
    final env = Entorno();
    await env.conServicio();
    final cambio = await env.acciones.iniciarServicio('srv-1');
    // Simular crash: quedó `enviando` de una corrida anterior…
    cambio.estado = EstadoCambio.enviando;
    await env.cola.guardar(cambio);
    // …y el servidor YA lo había procesado (confirmación perdida).
    env.api.programarPush(<ResultadoCambioApi>[
      ResultadoCambioApi(clientId: cambio.id, resultado: 'duplicado', version: 3),
    ]);

    final resumen = await env.sincronizador.push(); // "reabrir la app"
    chequear(resumen.duplicados == 1, 'retomado y deduplicado');
    chequear((await env.cola.porId(cambio.id))!.estado == EstadoCambio.confirmado,
        'termina confirmado: ni perdido ni duplicado');
  });

  stdout.writeln('\nBACKOFF Y ERRORES (doc 06 §4.4)');

  await escenario('backoff exponencial 2s→4s→8s con techo 5min (jitter neutro)',
      () async {
    chequear(calcularEsperaMs(1, aleatorio: () => 0.5) == 2000, '1º = 2s');
    chequear(calcularEsperaMs(2, aleatorio: () => 0.5) == 4000, '2º = 4s');
    chequear(calcularEsperaMs(3, aleatorio: () => 0.5) == 8000, '3º = 8s');
    chequear(calcularEsperaMs(20, aleatorio: () => 0.5) == 300000, 'techo 5min');
    final conJitter = calcularEsperaMs(1, aleatorio: () => 1.0 - 1e-9);
    chequear(conJitter >= 2399 && conJitter <= 2400, 'jitter +20% ≈ 2400ms');
    chequear(calcularEsperaMs(1, aleatorio: () => 0.0) == 1600, 'jitter -20% = 1600ms');
  });

  await escenario('sin red: reintenta con backoff creciente y a maxIntentos pasa a fallido (sin perderse)',
      () async {
    final env = Entorno();
    await env.conServicio();
    final cambio = await env.acciones.iniciarServicio('srv-1');

    for (var i = 1; i <= 8; i++) {
      env.api.programarFalloTransporte();
      env.reloj.avanzar(const Duration(minutes: 10)); // supera cualquier backoff
      await env.sincronizador.push();
      if (i < 8) {
        final fila = (await env.cola.porId(cambio.id))!;
        chequear(fila.estado == EstadoCambio.pendiente, 'intento $i: sigue pendiente');
        chequear(fila.intentos == i, 'intento $i registrado');
        chequear(fila.proximoIntentoEnMs > env.reloj.ahoraMs(),
            'intento $i: próximo intento en el futuro');
      }
    }
    final fila = (await env.cola.porId(cambio.id))!;
    chequear(fila.estado == EstadoCambio.fallido, 'a los 8 intentos → fallido');
    chequear(fila.lastError != null, 'con last_error para soporte');
  });

  await escenario('resultado `error` (validación permanente) → fallido SIN reintento ciego',
      () async {
    final env = Entorno();
    await env.conServicio();
    final cambio = await env.acciones.iniciarServicio('srv-1');
    env.api.programarPush(<ResultadoCambioApi>[
      ResultadoCambioApi(
        clientId: cambio.id,
        resultado: 'error',
        problemaTipo: 'entidad_no_soportada',
        problemaTitulo: 'La entidad "x" se implementa en spec-011.',
      ),
    ]);
    await env.sincronizador.push();
    final fila = (await env.cola.porId(cambio.id))!;
    chequear(fila.estado == EstadoCambio.fallido, 'permanente → fallido');
    chequear(fila.lastError!.contains('entidad_no_soportada'), 'last_error diagnóstico');
    chequear((await env.cola.listosParaEnviar(env.reloj.ahoraMs() + 999999)).isEmpty,
        'no vuelve a la banda de envío');
  });

  stdout.writeln('\nCONFLICTOS (categoría C, §5.4: marcar, no perder)');

  await escenario('resultado `conflicto` → escalado con el dato ÍNTEGRO (nunca descartado en silencio)',
      () async {
    final env = Entorno();
    await env.conServicio();
    final cambio = await env.acciones.iniciarServicio('srv-1', odometro: 152000);
    env.api.programarPush(<ResultadoCambioApi>[
      ResultadoCambioApi(
        clientId: cambio.id,
        resultado: 'conflicto',
        problemaTipo: 'transicion_invalida',
        problemaTitulo: 'Transición inválida (Invariante S2).',
      ),
    ]);
    final resumen = await env.sincronizador.push();
    chequear(resumen.conflictos == 1, 'reportado como conflicto');
    final fila = (await env.cola.porId(cambio.id))!;
    chequear(fila.estado == EstadoCambio.escalado, 'escalado al admin (portal)');
    chequear(fila.payload['odometro'] == 152000, 'payload del Conductor íntegro');
    chequear(fila.lastError!.contains('transicion_invalida'), 'con el motivo');
  });

  stdout.writeln('\nPULL / MI DÍA (R1/R2 + merge categoría C)');

  await escenario('pull aplica snapshot, guarda cursor y frescura; mi día calcula semáforo y "hace N min"',
      () async {
    final env = Entorno();
    env.api.respuestaPull = RespuestaPull(
      cursor: 'cursor-7',
      servicios: [
        ServicioLocal(
          id: 'srv-1',
          origen: 'Bogotá',
          destino: 'Tunja',
          ventanaInicioIso: '2026-07-03T08:00:00.000Z',
          ventanaFinIso: '2026-07-03T11:00:00.000Z',
          estado: 'Planificado',
          version: 2,
          vehiculoId: 'veh-abc123',
          conductorId: 'cond-juan',
        ),
      ],
      documentos: const [
        DocumentoLocal(id: 'doc-1', tipo: 'SOAT', estado: 'Vigente', diasRestantes: 200),
        DocumentoLocal(id: 'doc-2', tipo: 'RTM', estado: 'PorVencer', diasRestantes: 12),
      ],
    );

    await env.sincronizador.pull();
    chequear(await env.estadoSync.cursor() == 'cursor-7', 'cursor persistido');
    chequear(env.api.ultimoCursorRecibido == null, 'bootstrap inicial sin cursor');

    env.reloj.avanzar(const Duration(minutes: 17)); // se va la señal…
    final miDia = await cargarMiDia(env.espejo, env.estadoSync);
    chequear(miDia.servicios.length == 1, 've su Servicio');
    chequear(miDia.semaforoVehiculo == 'PorVencer', 'peor estado = amarillo');
    chequear(miDia.datosDeHaceMin(env.reloj) == 17, '"datos de hace 17 min"');

    await env.sincronizador.pull();
    chequear(env.api.ultimoCursorRecibido == 'cursor-7', 'el 2º pull manda el cursor');
  });

  await escenario('el pull NO retrocede la verdad local en vuelo; sí adopta la planificación del admin',
      () async {
    final env = Entorno();
    await env.conServicio();
    await env.acciones.iniciarServicio('srv-1'); // local: Iniciado, pendiente de push

    // El servidor aún dice Planificado, pero el admin cambió la VENTANA.
    env.api.respuestaPull = RespuestaPull(
      cursor: 'cursor-8',
      servicios: [
        ServicioLocal(
          id: 'srv-1',
          origen: 'Bogotá',
          destino: 'Tunja',
          ventanaInicioIso: '2026-07-03T09:00:00.000Z', // ← reprogramada
          ventanaFinIso: '2026-07-03T12:00:00.000Z',
          estado: 'Planificado', // ← el servidor no sabe del inicio offline
          version: 3,
          vehiculoId: 'veh-abc123',
          conductorId: 'cond-juan',
        ),
      ],
      documentos: const [],
    );

    await env.sincronizador.pull();
    final local = (await env.espejo.servicio('srv-1'))!;
    chequear(local.estado == 'Iniciado', 'la ejecución del Conductor NO retrocede');
    chequear(local.ventanaInicioIso == '2026-07-03T09:00:00.000Z',
        'la ventana del admin SÍ se adopta (ambos sobreviven)');
    chequear(local.version == 3, 'versión del servidor adoptada');
  });

  await escenario('tras confirmar el push, el pull siguiente ya puede pisar el estado (server = verdad)',
      () async {
    final env = Entorno();
    await env.conServicio();
    await env.acciones.iniciarServicio('srv-1');
    await env.sincronizador.push(); // confirmado (default de la API falsa)

    env.api.respuestaPull = RespuestaPull(
      cursor: 'c',
      servicios: [
        ServicioLocal(
          id: 'srv-1',
          origen: 'Bogotá',
          destino: 'Tunja',
          ventanaInicioIso: '2026-07-03T08:00:00.000Z',
          ventanaFinIso: '2026-07-03T11:00:00.000Z',
          estado: 'Iniciado', // el servidor ya lo refleja
          version: 99,
          inicioRealIso: '2026-07-03T06:00:00.000Z',
        ),
      ],
      documentos: const [],
    );
    await env.sincronizador.pull();
    final local = (await env.espejo.servicio('srv-1'))!;
    chequear(local.estado == 'Iniciado' && local.version == 99,
        'sin cambios en vuelo: server gana completo');
  });

  await escenario('uuidV4 tiene formato y unicidad razonables', () async {
    final re = RegExp(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
    final vistos = <String>{};
    for (var i = 0; i < 500; i++) {
      final u = uuidV4();
      chequear(re.hasMatch(u), 'formato v4: $u');
      chequear(vistos.add(u), 'sin repetidos en 500');
    }
  });

  stdout.writeln('\n══════════════════════════════════════════');
  stdout.writeln('  $_ok escenarios en verde, $_fallos fallidos');
  stdout.writeln('══════════════════════════════════════════');
  if (_fallos > 0) exitCode = 1;
}
