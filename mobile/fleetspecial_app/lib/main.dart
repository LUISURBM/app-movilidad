/// FleetSpecial — app del Conductor (offline-first, spec-010).
///
/// Arranque: si el dispositivo ya tiene configuración (URL del servidor +
/// token del conductor), abre "Mi día"; si no, muestra la pantalla de
/// configuración. La config vive en shared_preferences (el token de DEMO se
/// genera con `backend/tool/token-dev.ts` — ver docs/DEMO-APK.md).
library;

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'datos/composicion.dart';
import 'ui/mi_dia_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const FleetSpecialApp());
}

class FleetSpecialApp extends StatelessWidget {
  const FleetSpecialApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'FleetSpecial Conductor',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1B5E20)),
        useMaterial3: true,
      ),
      home: const _Raiz(),
    );
  }
}

class _Raiz extends StatefulWidget {
  const _Raiz();

  @override
  State<_Raiz> createState() => _RaizState();
}

class _RaizState extends State<_Raiz> {
  CapaDatos? _capa;
  bool _cargando = true;

  @override
  void initState() {
    super.initState();
    _arrancar();
  }

  Future<void> _arrancar() async {
    final prefs = await SharedPreferences.getInstance();
    final baseUrl = prefs.getString('baseUrl');
    final token = prefs.getString('token');
    if (baseUrl != null && token != null) {
      _capa = CapaDatos.produccion(
        baseUrl: baseUrl,
        tokenActual: () async => token,
        tenantId: prefs.getString('tenantId') ?? 'tenant-demo',
      );
    }
    if (mounted) setState(() => _cargando = false);
  }

  Future<void> _salirAConfiguracion() async {
    await _capa?.cerrar();
    setState(() => _capa = null);
  }

  @override
  Widget build(BuildContext context) {
    if (_cargando) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final capa = _capa;
    if (capa == null) {
      return PantallaConfiguracion(alGuardar: () {
        setState(() => _cargando = true);
        _arrancar();
      });
    }
    return MiDiaScreen(capa: capa, alSalir: _salirAConfiguracion);
  }
}

/// Configuración del dispositivo: URL del backend y token del Conductor.
class PantallaConfiguracion extends StatefulWidget {
  const PantallaConfiguracion({super.key, required this.alGuardar});
  final VoidCallback alGuardar;

  @override
  State<PantallaConfiguracion> createState() => _PantallaConfiguracionState();
}

class _PantallaConfiguracionState extends State<PantallaConfiguracion> {
  final _url = TextEditingController(text: 'http://192.168.1.10:3000/v1');
  final _token = TextEditingController();
  String? _error;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Conectar con FleetSpecial')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Configura una sola vez este dispositivo. El token del conductor '
            'lo genera el administrador (ver docs/DEMO-APK.md).',
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _url,
            decoration: const InputDecoration(
              labelText: 'URL del servidor',
              hintText: 'http://IP-DE-TU-PC:3000/v1',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _token,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'Token del conductor (JWT)',
              hintText: 'Pega aquí el token generado',
              border: OutlineInputBorder(),
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _guardar,
            icon: const Icon(Icons.check),
            label: const Text('Guardar y entrar'),
          ),
        ],
      ),
    );
  }

  Future<void> _guardar() async {
    final url = _url.text.trim().replaceAll(RegExp(r'/+$'), '');
    final token = _token.text.trim();
    if (url.isEmpty || token.isEmpty) {
      setState(() => _error = 'La URL y el token son obligatorios.');
      return;
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('baseUrl', url);
    await prefs.setString('token', token);
    widget.alGuardar();
  }
}
