/**
 * Casos de uso del contexto Service Scheduling (CORE) — spec-008/009.
 * Orquestan el dominio y los puertos; sin dependencias de framework.
 */
import {
  Clock,
  DomainError,
  IdGenerator,
  Result,
  TenantId,
  err,
  ok,
} from "../../../shared/kernel";
import { Servicio } from "../domain/servicio.aggregate";
import { Asignacion, EstadoServicio, Ruta, VentanaHoraria } from "../domain/value-objects";
import { detectarChoque } from "../domain/agenda.service";
import { AsignacionRechazada, nowIso } from "../domain/events";
import { Novedad } from "../domain/novedad.aggregate";
import {
  BitacoraSync,
  CumplimientoGateway,
  EventPublisher,
  IdempotencyStore,
  NovedadRepository,
  RegistradorTanqueo,
  ServicioRepository,
} from "./ports";

export interface SchedulingDeps {
  servicios: ServicioRepository;
  cumplimiento: CumplimientoGateway;
  publisher: EventPublisher;
  idempotencia: IdempotencyStore;
  bitacora: BitacoraSync;
  /** ACL hacia Fuel (spec-011): resuelve los cambios `entidad: "tanqueo"` del lote. */
  tanqueo: RegistradorTanqueo;
  /** Repositorio de Novedades append-only (spec-014). */
  novedades: NovedadRepository;
  clock: Clock;
  ids: IdGenerator;
}

// ───────────────────────── spec-008: Crear Servicio ─────────────────────────

export interface CrearServicioInput {
  tenant: TenantId;
  origen: string;
  destino: string;
  ventanaInicio: string; // ISO date-time
  ventanaFin: string; // ISO date-time
  cliente?: string;
}

export class CrearServicio {
  constructor(private readonly deps: SchedulingDeps) {}

  async execute(input: CrearServicioInput): Promise<Result<{ servicioId: string }>> {
    let ruta: Ruta;
    let ventana: VentanaHoraria;
    try {
      ruta = new Ruta(input.origen, input.destino);
      ventana = VentanaHoraria.parse(input.ventanaInicio, input.ventanaFin);
    } catch (e) {
      if (e instanceof DomainError) return err(e);
      throw e;
    }

    const servicio = Servicio.crear({
      id: this.deps.ids.next(),
      ruta,
      ventana,
      clienteRef: input.cliente,
    });

    await this.deps.servicios.save(input.tenant, servicio);
    await this.deps.publisher.publish(input.tenant, servicio.pullEventos());
    return ok({ servicioId: servicio.id });
  }
}

// ───────────── spec-008 + spec-009: Asignar Vehículo + Conductor ─────────────

export interface AsignarServicioInput {
  tenant: TenantId;
  servicioId: string;
  vehiculoId: string;
  conductorId: string;
}

export interface AsignarServicioOutput {
  servicioId: string;
  vehiculoId: string;
  conductorId: string;
  /** Advertencias no bloqueantes (semáforo amarillo — spec-009 P11). */
  advertencias: string[];
}

/**
 * Orquesta la Asignación aplicando AMBAS condiciones (spec-009 R7):
 *   1. Invariante S4 — sin choque de Ventana horaria (spec-008 R4), y
 *   2. Invariante S3 — REGLA DE ORO vía ACL a Compliance (spec-009 R1/R2).
 * En rechazo emite `AsignacionRechazada { motivo: choque | incumplimiento }`.
 */
export class AsignarServicio {
  constructor(private readonly deps: SchedulingDeps) {}

  async execute(input: AsignarServicioInput): Promise<Result<AsignarServicioOutput>> {
    const { tenant } = input;

    const servicio = await this.deps.servicios.findById(tenant, input.servicioId);
    if (!servicio) {
      return err(new DomainError("servicio_no_encontrado", "El Servicio no existe en este Tenant."));
    }
    if (servicio.estado !== EstadoServicio.Planificado) {
      return err(
        new DomainError(
          "servicio_no_planificado",
          `Solo se puede (re)asignar un Servicio Planificado; estado actual: ${servicio.estado}.`,
        ),
      );
    }

    // ── 1) Invariante S4: no double-booking del Vehículo ni del Conductor. ──
    // Se excluye el propio Servicio para permitir la reasignación (R11).
    const [ocupadasVehiculo, ocupadasConductor] = await Promise.all([
      this.deps.servicios.ventanasOcupadasDeVehiculo(tenant, input.vehiculoId),
      this.deps.servicios.ventanasOcupadasDeConductor(tenant, input.conductorId),
    ]);
    const choque =
      detectarChoque(servicio.ventana, ocupadasVehiculo, servicio.id) ??
      detectarChoque(servicio.ventana, ocupadasConductor, servicio.id);
    if (choque) {
      return this.rechazar(tenant, servicio.id, "choque",
        `La Ventana horaria se solapa con la Asignación del Servicio ${choque.servicioId}.`);
    }

    // ── 2) Invariante S3 (REGLA DE ORO): consulta vía ACL a Compliance. ──
    const operabilidad = await this.deps.cumplimiento.puedeOperar(
      tenant,
      input.vehiculoId,
      input.conductorId,
      servicio.ventana,
    );
    if (!operabilidad.permitido) {
      return this.rechazar(tenant, servicio.id, "incumplimiento", operabilidad.motivoBloqueo);
    }

    // ── Ambas condiciones OK → asignar (amarillo: se permite con advertencia). ──
    const asignacion = new Asignacion(
      input.vehiculoId,
      input.conductorId,
      operabilidad.advertencias,
    );
    const r = servicio.asignar(asignacion);
    if (!r.ok) return r;

    await this.deps.servicios.save(tenant, servicio);
    await this.deps.publisher.publish(tenant, servicio.pullEventos());

    return ok({
      servicioId: servicio.id,
      vehiculoId: input.vehiculoId,
      conductorId: input.conductorId,
      advertencias: [...operabilidad.advertencias],
    });
  }

  /** Publica `AsignacionRechazada` (P3/P4) y devuelve el error de dominio. */
  private async rechazar(
    tenant: TenantId,
    servicioId: string,
    motivo: "choque" | "incumplimiento",
    detalle?: string,
  ): Promise<Result<never>> {
    await this.deps.publisher.publish(tenant, [
      <AsignacionRechazada>{
        tipo: "AsignacionRechazada",
        ocurridoEn: nowIso(),
        servicioId,
        motivo,
        detalle,
      },
    ]);
    const code = motivo === "choque" ? "conflicto_horario" : "incumplimiento";
    const msg =
      motivo === "choque"
        ? detalle ?? "La Ventana horaria se solapa con otra Asignación activa (Invariante S4)."
        : detalle ?? "El Vehículo o el Conductor no está al día documentalmente (regla de oro, Invariante S3).";
    return err(new DomainError(code, msg));
  }
}

// ───────── spec-008 (S1/S2) + spec-010 (offline): Cambiar estado del Servicio ─────────

export type AccionServicio = "iniciar" | "finalizar" | "cancelar";

export interface CambiarEstadoInput {
  tenant: TenantId;
  servicioId: string;
  accion: AccionServicio;
  ocurridoEn?: string; // ISO date-time (marca del cliente; offline)
  odometro?: number;
  /** UUID de idempotencia del cambio offline (spec-010 R6/R8). */
  clientId?: string;
  /** Quién intenta el cambio (para la bitácora de conflictos, R10). */
  usuarioId?: string;
}

export interface CambiarEstadoOutput {
  estado: string;
  version: number;
  /** true si el cambio ya se había aplicado y se devolvió la respuesta original. */
  duplicado: boolean;
}

export class CambiarEstadoServicio {
  constructor(private readonly deps: SchedulingDeps) {}

  async execute(input: CambiarEstadoInput): Promise<Result<CambiarEstadoOutput>> {
    // Deduplicación idempotente (R8): mismo clientId → misma respuesta, sin doble transición.
    if (input.clientId) {
      const previa = await this.deps.idempotencia.get(input.tenant, input.clientId);
      if (previa) return ok({ estado: previa.estado, version: previa.version, duplicado: true });
    }

    const servicio = await this.deps.servicios.findById(input.tenant, input.servicioId);
    if (!servicio) {
      return err(new DomainError("servicio_no_encontrado", "El Servicio no existe en este Tenant."));
    }
    const eraTerminal = servicio.esTerminal;

    const ocurridoEn = input.ocurridoEn ? new Date(input.ocurridoEn) : undefined;
    let r: Result<void>;
    switch (input.accion) {
      case "iniciar":
        r = servicio.iniciar({ ocurridoEn, odometro: input.odometro });
        break;
      case "finalizar":
        r = servicio.finalizar({ ocurridoEn, odometro: input.odometro });
        break;
      case "cancelar":
        r = servicio.cancelar();
        break;
      default:
        return err(new DomainError("accion_desconocida", `Acción desconocida: ${String(input.accion)}.`));
    }

    if (!r.ok) {
      // R9/R10: un intento contra estado TERMINAL queda en bitácora (autoridad de
      // campo: el estado del Conductor gana y el intento NO se descarta en silencio).
      if (eraTerminal) {
        await this.deps.bitacora.registrar(input.tenant, {
          servicioId: servicio.id,
          usuarioId: input.usuarioId ?? "desconocido",
          detalle: `Intento de "${input.accion}" rechazado: el Servicio está en estado terminal ${servicio.estado} (autoridad de campo).`,
          ocurridoEn: this.deps.clock.now().toISOString(),
        });
      }
      return r;
    }

    await this.deps.servicios.save(input.tenant, servicio);
    await this.deps.publisher.publish(input.tenant, servicio.pullEventos());

    const salida = { estado: servicio.estado as string, version: servicio.version };
    if (input.clientId) {
      await this.deps.idempotencia.save(input.tenant, input.clientId, salida);
    }
    return ok({ ...salida, duplicado: false });
  }
}

// ───────────── spec-010: Sincronización — push del lote offline ─────────────

export interface CambioSync {
  clientId: string;
  entidad: "estado_servicio" | "tanqueo" | "novedad";
  operacion: "crear" | "actualizar";
  payload: Record<string, unknown>;
  ocurridoEn?: string;
}

export interface ResultadoCambioSync {
  clientId: string;
  resultado: "confirmado" | "duplicado" | "conflicto" | "error";
  serverId?: string;
  version?: number;
  problema?: { type: string; title: string; status: number };
}

/**
 * Aplica EN ORDEN un lote de cambios generados offline (spec-010 R7/R8/R9).
 * Cada cambio se resuelve de forma aislada: un conflicto no frena el resto.
 * `tanqueo`/`novedad` llegan con spec-011/spec-014 (resultado `error` explícito).
 */
export class SincronizarCambios {
  constructor(private readonly deps: SchedulingDeps) {}

  async execute(input: {
    tenant: TenantId;
    usuarioId: string;
    cambios: CambioSync[];
  }): Promise<ResultadoCambioSync[]> {
    const resultados: ResultadoCambioSync[] = [];
    const cambiarEstado = new CambiarEstadoServicio(this.deps);

    for (const cambio of input.cambios) {
      if (cambio.entidad === "estado_servicio") {
        resultados.push(await this.aplicarEstadoServicio(input, cambio, cambiarEstado));
        continue;
      }
      if (cambio.entidad === "tanqueo") {
        // spec-011: append-only e idempotente, vía la ACL hacia Fuel (aislada del resto).
        resultados.push(await this.aplicarTanqueo(input.tenant, cambio));
        continue;
      }
      if (cambio.entidad === "novedad") {
        // spec-014: append-only e idempotente; valida que el Servicio exista.
        resultados.push(await this.aplicarNovedad(input.tenant, cambio));
        continue;
      }
      // Entidades desconocidas: no soportadas.
      resultados.push({
        clientId: cambio.clientId,
        resultado: "error",
        problema: {
          type: "entidad_no_soportada",
          title: `La entidad "${cambio.entidad}" no está soportada.`,
          status: 422,
        },
      });
    }
    return resultados;
  }

  private async aplicarEstadoServicio(
    input: { tenant: TenantId; usuarioId: string },
    cambio: CambioSync,
    cambiarEstado: CambiarEstadoServicio,
  ): Promise<ResultadoCambioSync> {
    const p = cambio.payload as {
      servicioId?: string;
      accion?: AccionServicio;
      odometro?: number;
    };
    const r = await cambiarEstado.execute({
      tenant: input.tenant,
      servicioId: p.servicioId ?? "",
      accion: p.accion as AccionServicio,
      ocurridoEn: cambio.ocurridoEn,
      odometro: p.odometro,
      clientId: cambio.clientId,
      usuarioId: input.usuarioId,
    });

    if (r.ok) {
      return {
        clientId: cambio.clientId,
        resultado: r.value.duplicado ? "duplicado" : "confirmado",
        serverId: p.servicioId,
        version: r.value.version,
      };
    }
    // Conflicto de dominio (terminal/transición/S5) vs error de datos.
    const esConflicto = ["transicion_invalida", "servicio_sin_asignacion", "fin_anterior_a_inicio"].includes(r.error.code);
    return {
      clientId: cambio.clientId,
      resultado: esConflicto ? "conflicto" : "error",
      problema: { type: r.error.code, title: r.error.message, status: esConflicto ? 409 : 422 },
    };
  }

  private async aplicarTanqueo(tenant: TenantId, cambio: CambioSync): Promise<ResultadoCambioSync> {
    const p = cambio.payload as {
      vehiculoId?: string;
      cantidad?: number;
      unidad?: "litros" | "galones";
      valorCop?: number;
      odometro?: number;
    };
    const r = await this.deps.tanqueo.registrar(tenant, {
      clientId: cambio.clientId,
      vehiculoId: p.vehiculoId ?? "",
      cantidad: Number(p.cantidad),
      unidad: p.unidad ?? "litros",
      valorCop: Number(p.valorCop),
      odometro: Number(p.odometro),
      ocurridoEn: cambio.ocurridoEn,
    });
    return {
      clientId: cambio.clientId,
      resultado: r.resultado,
      serverId: r.serverId,
      problema: r.problema,
    };
  }

  private async aplicarNovedad(tenant: TenantId, cambio: CambioSync): Promise<ResultadoCambioSync> {
    const p = cambio.payload as {
      servicioId?: string;
      tipo?: string;
      descripcion?: string;
      fotoRef?: string;
    };
    const r = await new RegistrarNovedad(this.deps).execute({
      tenant,
      clientId: cambio.clientId,
      servicioId: p.servicioId ?? "",
      tipo: p.tipo ?? "",
      descripcion: p.descripcion ?? "",
      fotoRef: p.fotoRef,
      ocurridoEn: cambio.ocurridoEn,
    });
    if (r.ok) {
      return {
        clientId: cambio.clientId,
        resultado: r.value.duplicado ? "duplicado" : "confirmado",
        serverId: r.value.novedadId,
      };
    }
    return {
      clientId: cambio.clientId,
      resultado: "error",
      problema: { type: r.error.code, title: r.error.message, status: 422 },
    };
  }
}

// ───────────── spec-014: Registrar Novedad (append-only, idempotente) ─────────────

export interface RegistrarNovedadInput {
  tenant: TenantId;
  clientId: string;
  servicioId: string;
  tipo: string;
  descripcion: string;
  fotoRef?: string;
  ocurridoEn?: string;
}

export class RegistrarNovedad {
  constructor(private readonly deps: SchedulingDeps) {}

  async execute(input: RegistrarNovedadInput): Promise<Result<{ novedadId: string; duplicado: boolean }>> {
    // Idempotencia (R7): mismo clientId → una sola Novedad.
    const previa = await this.deps.novedades.findByClientId(input.tenant, input.clientId);
    if (previa) return ok({ novedadId: previa.id, duplicado: true });

    // R1: la Novedad pertenece SIEMPRE a un Servicio existente.
    const servicio = await this.deps.servicios.findById(input.tenant, input.servicioId);
    if (!servicio) {
      return err(new DomainError("servicio_no_encontrado", "La Novedad debe pertenecer a un Servicio existente."));
    }

    const creada = Novedad.registrar({
      id: this.deps.ids.next(),
      clientId: input.clientId,
      servicioId: input.servicioId,
      tipo: input.tipo,
      descripcion: input.descripcion,
      fotoRef: input.fotoRef,
      ocurridoEn: input.ocurridoEn,
    });
    if (!creada.ok) return creada;

    await this.deps.novedades.append(input.tenant, creada.value);
    await this.deps.publisher.publish(input.tenant, creada.value.pullEventos());
    return ok({ novedadId: creada.value.id, duplicado: false });
  }
}

// ───────────── spec-010: Sincronización — pull de "mi día" ─────────────

/**
 * "Mi día" del Conductor (R1: solo lo suyo). v1 devuelve el snapshot completo del
 * alcance propio con un cursor nuevo (delta-sync degenerado pero correcto según el
 * contrato: el cursor es opaco). El delta real llega con el repo SQL (actualizado_en).
 */
export class ConsultarMiDia {
  constructor(private readonly deps: SchedulingDeps) {}

  async execute(input: { tenant: TenantId; conductorId: string }): Promise<{
    servicios: Servicio[];
    vehiculoIds: string[];
    cursor: string;
  }> {
    const servicios = await this.deps.servicios.listAsignadosAConductor(
      input.tenant,
      input.conductorId,
    );
    const vehiculoIds = [...new Set(servicios.map((s) => s.asignacion!.vehiculoId))];
    return { servicios, vehiculoIds, cursor: this.deps.clock.now().toISOString() };
  }
}
