/// Pantalla "MI DÍA" (spec-010 R1/R2): los Servicios del Conductor, el semáforo
/// de su Vehículo y la marca de frescura. SIEMPRE pinta desde el espejo local;
/// la sincronización corre detrás y nunca bloquea.
library;

import 'package:flutter/material.dart';
import 'package:sync_core/sync_core.dart' as nucleo;

import '../datos/composicion.dart';

class MiDiaScreen extends StatefulWidget {
  const MiDiaScreen({super.key, required this.capa, this.alSalir});

  final CapaDatos capa;
  final VoidCallback? alSalir;

  @override
  State<MiDiaScreen> createState() => _MiDiaScreenState();
}

class _MiDiaScreenState extends State<MiDiaScreen>
    with WidgetsBindingObserver {
  nucleo.MiDia? _miDia;
  int _enCola = 0;
  int _escalados = 0;
  final _reloj = const nucleo.RelojSistema();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.capa.disparadores.iniciar();
    _recargar();
  }

  @override
  void dispose() {
    widget.capa.disparadores.detener();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      widget.capa.disparadores.alPrimerPlano();
      _recargar();
    }
  }

  Future<void> _recargar() async {
    final miDia = await widget.capa.miDia();
    final pendientes =
        await widget.capa.cola.enEstado(nucleo.EstadoCambio.pendiente);
    final fallidos =
        await widget.capa.cola.enEstado(nucleo.EstadoCambio.fallido);
    final escalados =
        await widget.capa.cola.enEstado(nucleo.EstadoCambio.escalado);
    if (!mounted) return;
    setState(() {
      _miDia = miDia;
      _enCola = pendientes.length + fallidos.length;
      _escalados = escalados.length;
    });
  }

  Future<void> _refrescar() async {
    await widget.capa.disparadores.manual(); // push + pull
    await _recargar();
  }

  Future<void> _accion(String servicioId, String accion) async {
    final odometro = await _pedirOdometro(accion);
    if (odometro == _cancelado) return;
    try {
      if (accion == 'iniciar') {
        await widget.capa.iniciarServicio(servicioId, odometro: odometro);
      } else {
        await widget.capa.finalizarServicio(servicioId, odometro: odometro);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Guardado en el dispositivo ✓ (se sincroniza solo)'),
      ));
      await _recargar();
      // Sync oportunista en segundo plano; si no hay señal, quedó en la cola.
      widget.capa.disparadores.manual().then((_) => _recargar());
    } on nucleo.ErrorAccion catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.mensaje)));
    }
  }

  static const int _cancelado = -999999;

  /// Pide el odómetro (opcional). Devuelve null si lo dejó vacío,
  /// [_cancelado] si canceló el diálogo.
  Future<int?> _pedirOdometro(String accion) async {
    final controlador = TextEditingController();
    final resultado = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(accion == 'iniciar' ? 'Iniciar servicio' : 'Finalizar servicio'),
        content: TextField(
          controller: controlador,
          keyboardType: TextInputType.number,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Odómetro (km) — opcional',
            hintText: 'p. ej. 152000',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controlador.text),
            child: Text(accion == 'iniciar' ? 'Iniciar' : 'Finalizar'),
          ),
        ],
      ),
    );
    if (resultado == null) return _cancelado;
    return int.tryParse(resultado.trim());
  }

  @override
  Widget build(BuildContext context) {
    final miDia = _miDia;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mi día'),
        actions: [
          if (_enCola > 0)
            _Insignia(texto: '$_enCola por subir', color: Colors.amber.shade700),
          if (_escalados > 0)
            _Insignia(texto: '$_escalados en conflicto', color: Colors.red.shade700),
          if (widget.alSalir != null)
            IconButton(
              onPressed: widget.alSalir,
              icon: const Icon(Icons.settings),
              tooltip: 'Configuración',
            ),
        ],
      ),
      body: miDia == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _refrescar,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(12),
                children: [
                  _BannerFrescura(miDia: miDia, reloj: _reloj),
                  const SizedBox(height: 8),
                  _TarjetaSemaforo(miDia: miDia),
                  const SizedBox(height: 12),
                  if (miDia.servicios.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 48),
                      child: Center(
                          child: Text('Sin servicios asignados para hoy.\n'
                              'Desliza hacia abajo para sincronizar.')),
                    ),
                  for (final s in miDia.servicios)
                    _TarjetaServicio(
                      servicio: s,
                      alIniciar: () => _accion(s.id, 'iniciar'),
                      alFinalizar: () => _accion(s.id, 'finalizar'),
                    ),
                ],
              ),
            ),
    );
  }
}

class _Insignia extends StatelessWidget {
  const _Insignia({required this.texto, required this.color});
  final String texto;
  final Color color;

  @override
  Widget build(BuildContext context) => Center(
        child: Container(
          margin: const EdgeInsets.only(right: 8),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(texto,
              style: const TextStyle(color: Colors.white, fontSize: 12)),
        ),
      );
}

class _BannerFrescura extends StatelessWidget {
  const _BannerFrescura({required this.miDia, required this.reloj});
  final nucleo.MiDia miDia;
  final nucleo.Reloj reloj;

  @override
  Widget build(BuildContext context) {
    final minutos = miDia.datosDeHaceMin(reloj);
    final texto = miDia.nuncaSincronizado
        ? 'Aún sin sincronizar: desliza hacia abajo con señal.'
        : 'Datos de hace ${minutos ?? 0} min';
    return Row(
      children: [
        const Icon(Icons.sync, size: 16),
        const SizedBox(width: 6),
        Text(texto, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

class _TarjetaSemaforo extends StatelessWidget {
  const _TarjetaSemaforo({required this.miDia});
  final nucleo.MiDia miDia;

  static const _colores = {
    'Vigente': Colors.green,
    'PorVencer': Colors.amber,
    'Vencido': Colors.red,
  };
  static const _titulos = {
    'Vigente': 'Vehículo al día',
    'PorVencer': 'Documentos por vencer',
    'Vencido': 'Vehículo BLOQUEADO: documento vencido',
  };

  @override
  Widget build(BuildContext context) {
    final color = _colores[miDia.semaforoVehiculo] ?? Colors.grey;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(Icons.circle, color: color, size: 18),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _titulos[miDia.semaforoVehiculo] ?? miDia.semaforoVehiculo,
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
              ),
            ]),
            for (final d in miDia.documentos)
              Padding(
                padding: const EdgeInsets.only(left: 26, top: 4),
                child: Text(
                  d.diasRestantes == null
                      ? '${d.tipo}: ${d.estado}'
                      : '${d.tipo}: ${d.estado} (${d.diasRestantes} días)',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _TarjetaServicio extends StatelessWidget {
  const _TarjetaServicio({
    required this.servicio,
    required this.alIniciar,
    required this.alFinalizar,
  });

  final nucleo.ServicioLocal servicio;
  final VoidCallback alIniciar;
  final VoidCallback alFinalizar;

  String _hora(String iso) {
    final t = DateTime.tryParse(iso)?.toLocal();
    if (t == null) return iso;
    final hh = t.hour.toString().padLeft(2, '0');
    final mm = t.minute.toString().padLeft(2, '0');
    return '$hh:$mm';
  }

  @override
  Widget build(BuildContext context) {
    final estado = servicio.estado;
    final colorEstado = switch (estado) {
      'Iniciado' => Colors.amber.shade800,
      'Finalizado' => Colors.green.shade700,
      'Cancelado' => Colors.grey,
      _ => Colors.blueGrey,
    };
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${servicio.origen} → ${servicio.destino}',
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: colorEstado,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(estado,
                      style:
                          const TextStyle(color: Colors.white, fontSize: 12)),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              'Ventana ${_hora(servicio.ventanaInicioIso)}–${_hora(servicio.ventanaFinIso)}'
              '${servicio.cliente == null ? '' : ' · ${servicio.cliente}'}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                if (estado == 'Planificado')
                  FilledButton.icon(
                    onPressed: alIniciar,
                    icon: const Icon(Icons.play_arrow),
                    label: const Text('Iniciar'),
                  ),
                if (estado == 'Iniciado')
                  FilledButton.icon(
                    onPressed: alFinalizar,
                    style:
                        FilledButton.styleFrom(backgroundColor: Colors.green),
                    icon: const Icon(Icons.flag),
                    label: const Text('Finalizar'),
                  ),
                if (estado == 'Finalizado')
                  const Text('✓ Jornada cumplida',
                      style: TextStyle(color: Colors.green)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
