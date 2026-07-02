/// Modelos del motor de sync — espejan el CONTRATO (backend/contracts/openapi.yaml)
/// y el esquema de la cola del doc 06 §3.2.
///
/// Nota de fidelidad: donde el doc 06 y el contrato difieren en literales
/// (`servicio_estado` vs `estado_servicio`, `create/update` vs `crear/actualizar`),
/// GANA EL CONTRATO (API-first): el cliente envía exactamente lo que el servidor
/// declara en `SyncCambio`.
library;

/// Máquina de estados de un cambio en la cola (doc 06 §4.7).
enum EstadoCambio {
  pendiente,
  enviando,
  confirmado,
  fallido,
  conflicto,
  escalado,
}

/// Una fila de `outbox_cambios`: lo ÚNICO irreemplazable del dispositivo.
class CambioLocal {
  CambioLocal({
    required this.id,
    required this.entidad,
    required this.operacion,
    required this.payload,
    required this.tenantId,
    required this.creadoEnMs,
    this.ocurridoEnIso,
    this.estado = EstadoCambio.pendiente,
    int? actualizadoEnMs,
    this.intentos = 0,
    this.proximoIntentoEnMs = 0,
    this.lastError,
    this.versionServidor,
  }) : actualizadoEnMs = actualizadoEnMs ?? creadoEnMs;

  /// UUID v4 generado en el dispositivo = clave de idempotencia (`clientId`).
  final String id;

  /// `estado_servicio` | `tanqueo` | `novedad` (enum del contrato SyncCambio).
  final String entidad;

  /// `crear` | `actualizar` (enum del contrato).
  final String operacion;

  /// Autocontenido (doc 06 §3.2): todo lo necesario para reconstruir la
  /// mutación sin depender de las tablas espejo. Para `estado_servicio`:
  /// `{ servicioId, accion, odometro?, base_version }`.
  final Map<String, Object?> payload;

  /// Trazabilidad; el servidor deriva el tenant del JWT, no confía en esto.
  final String tenantId;

  /// Marca del cliente del momento de la captura (viaja como `ocurridoEn`).
  final String? ocurridoEnIso;

  final int creadoEnMs;

  EstadoCambio estado;
  int actualizadoEnMs;
  int intentos;
  int proximoIntentoEnMs;
  String? lastError;

  /// Versión que devolvió el servidor al confirmar (control optimista R9).
  int? versionServidor;

  String? get servicioId => payload['servicioId'] as String?;
}

/// Resultado por cambio del `POST /sync/push` (contrato SyncPushResultado).
class ResultadoCambioApi {
  const ResultadoCambioApi({
    required this.clientId,
    required this.resultado,
    this.version,
    this.problemaTipo,
    this.problemaTitulo,
  });

  final String clientId;

  /// `confirmado` | `duplicado` | `conflicto` | `error`.
  final String resultado;
  final int? version;
  final String? problemaTipo;
  final String? problemaTitulo;
}

/// Tabla espejo de Servicios (categoría A para planificación; C para estado).
class ServicioLocal {
  ServicioLocal({
    required this.id,
    required this.origen,
    required this.destino,
    required this.ventanaInicioIso,
    required this.ventanaFinIso,
    required this.estado,
    required this.version,
    this.cliente,
    this.vehiculoId,
    this.conductorId,
    this.inicioRealIso,
    this.finRealIso,
  });

  final String id;
  String origen;
  String destino;
  String ventanaInicioIso;
  String ventanaFinIso;
  String? cliente;
  String? vehiculoId;
  String? conductorId;

  /// `Planificado` | `Iniciado` | `Finalizado` | `Cancelado`.
  String estado;
  String? inicioRealIso;
  String? finRealIso;

  /// Versión del servidor conocida por el dispositivo (base_version al editar).
  int version;

  ServicioLocal copia() => ServicioLocal(
        id: id,
        origen: origen,
        destino: destino,
        ventanaInicioIso: ventanaInicioIso,
        ventanaFinIso: ventanaFinIso,
        cliente: cliente,
        vehiculoId: vehiculoId,
        conductorId: conductorId,
        estado: estado,
        inicioRealIso: inicioRealIso,
        finRealIso: finRealIso,
        version: version,
      );
}

/// Tabla espejo de Documentos del Vehículo (categoría A: server gana siempre).
class DocumentoLocal {
  const DocumentoLocal({
    required this.id,
    required this.tipo,
    required this.estado,
    this.vencimientoIso,
    this.diasRestantes,
  });

  final String id;
  final String tipo; // SOAT, RTM, LICENCIA...
  final String estado; // Vigente | PorVencer | Vencido (semáforo por documento)
  final String? vencimientoIso;
  final int? diasRestantes;
}

/// Respuesta de `GET /sync/pull` ya traducida a modelos locales.
class RespuestaPull {
  const RespuestaPull({
    required this.cursor,
    required this.servicios,
    required this.documentos,
  });

  final String cursor;
  final List<ServicioLocal> servicios;
  final List<DocumentoLocal> documentos;
}

/// Resumen de una pasada de push (para UI/observabilidad).
class ResumenPush {
  const ResumenPush({
    this.confirmados = 0,
    this.duplicados = 0,
    this.conflictos = 0,
    this.fallidos = 0,
    this.reprogramados = 0,
  });

  final int confirmados;
  final int duplicados;
  final int conflictos;
  final int fallidos;
  final int reprogramados;

  int get enviadosConExito => confirmados + duplicados;
}

class ResumenPull {
  const ResumenPull({required this.servicios, required this.documentos});

  final int servicios;
  final int documentos;
}
