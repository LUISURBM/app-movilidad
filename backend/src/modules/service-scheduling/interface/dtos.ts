/**
 * DTOs de la capa interface (REST) — reflejan EXACTAMENTE los esquemas de
 * `backend/contracts/openapi.yaml` (API First). Tipos planos de transporte;
 * los mappers (mappers.ts) traducen dominio <-> DTO.
 *
 * Nota de acoplamiento: `ProblemDto`/`PaginaDto` se repiten a propósito respecto
 * del módulo Compliance; cada bounded context posee sus DTOs (la única dependencia
 * sancionada entre módulos es la ACL de aplicación, spec-009 R2).
 */

// ---- Comunes (contrato) ----
export interface ProblemDto {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

export interface PaginaDto<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface VentanaHorariaDto {
  inicio: string; // date-time
  fin: string; // date-time
}

export type EstadoServicioDto = "Planificado" | "Iniciado" | "Finalizado" | "Cancelado";

// ---- spec-008: Crear Servicio ----
export interface CrearServicioRequestDto {
  origen: string;
  destino: string;
  ventana: VentanaHorariaDto;
  cliente?: string;
}

// ---- spec-008/009: Asignación ----
export interface AsignarServicioRequestDto {
  vehiculoId: string;
  conductorId: string;
}

export interface AsignacionDto {
  servicioId: string;
  vehiculoId: string;
  conductorId: string;
  /** Advertencias no bloqueantes (p. ej. semáforo amarillo — spec-009). */
  advertencias?: string[];
}

// ---- spec-010 (transiciones protegidas desde spec-008) ----
export interface CambiarEstadoServicioRequestDto {
  accion: "iniciar" | "finalizar" | "cancelar";
  ocurridoEn?: string; // date-time del cliente (offline)
  odometro?: number;
  clientId?: string; // UUID de idempotencia (se usa plenamente en spec-010)
}

// ---- Servicio (respuesta) ----
export interface ServicioDto {
  id: string;
  origen: string;
  destino: string;
  ventana: VentanaHorariaDto;
  cliente?: string;
  estado: EstadoServicioDto;
  asignacion?: AsignacionDto;
  inicioReal?: string;
  finReal?: string;
}

// ---- spec-010: Sincronización offline ----
export interface SyncCambioDto {
  clientId: string; // UUID idempotente del cambio
  entidad: "tanqueo" | "novedad" | "estado_servicio";
  operacion: "crear" | "actualizar";
  payload: Record<string, unknown>;
  ocurridoEn?: string; // date-time
}

export interface SyncPushRequestDto {
  cambios: SyncCambioDto[];
}

export interface SyncPushResultadoDto {
  clientId: string;
  resultado: "confirmado" | "duplicado" | "conflicto" | "error";
  serverId?: string;
  version?: number;
  problema?: ProblemDto;
}

export interface SyncPushResponseDto {
  resultados: SyncPushResultadoDto[];
}

/**
 * SyncPullResponse del contrato. `documentos` usa la forma del contrato `Documento`
 * (la produce el mapper público de Compliance); `vehiculos` queda vacío hasta que
 * exista el módulo Fleet (spec-003).
 */
export interface SyncPullResponseDto {
  cursor: string;
  servicios: ServicioDto[];
  documentos: unknown[];
  vehiculos: unknown[];
}
