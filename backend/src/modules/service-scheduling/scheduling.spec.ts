/**
 * Pruebas del módulo Service Scheduling, DERIVADAS de los criterios Gherkin de
 * spec-008 (crear Servicio + Asignación sin choques) y spec-009 (regla de oro).
 * Cada `describe` cita su spec y cada `it` refleja un Escenario.
 *
 * La sección "spec-009 con ACL real" atraviesa la colaboración entre los DOS
 * contextos CORE: Scheduling → ComplianceAcl → ConsultarSemaforo (Compliance).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  DateOnly,
  FixedClock,
  SequentialIdGenerator,
  TenantId,
} from "../../shared/kernel";
import { EstadoServicio, VentanaHoraria } from "./domain/value-objects";
import {
  InMemoryBitacoraSync,
  InMemoryEventPublisher,
  InMemoryIdempotencyStore,
  InMemoryNovedadRepository,
  InMemoryServicioRepository,
  StubCumplimientoGateway,
} from "./application/in-memory.adapters";
import {
  AsignarServicio,
  CambiarEstadoServicio,
  ConsultarMiDia,
  CrearServicio,
  SchedulingDeps,
  SincronizarCambios,
} from "./application/use-cases";
import { servicioToDto } from "./interface/mappers";
import { ComplianceAcl } from "./infrastructure/compliance.acl";
import { TanqueoAcl } from "./infrastructure/tanqueo.acl";

// Fuel (spec-011): la ACL real de tanqueo delega en su caso de uso público.
import {
  InMemoryTanqueoRepository,
  InMemoryOdometroVehiculo,
  InMemoryEventPublisher as FuelEventPublisher,
} from "../fuel-management/application/in-memory.adapters";
import { RegistrarTanqueo } from "../fuel-management/application/use-cases";

// Compliance (solo para la sección de ACL real; alias para evitar choque de nombres).
import {
  InMemoryCatalogoTiposRepository,
  InMemoryDocumentoRepository,
  InMemoryEventPublisher as ComplianceEventPublisher,
} from "../compliance-documents/application/in-memory.adapters";
import {
  ComplianceDeps,
  ConsultarSemaforo,
  RegistrarDocumento,
  RenovarDocumento,
} from "../compliance-documents/application/use-cases";
import {
  SujetoRef,
  TipoDocumento,
  TipoSujeto,
} from "../compliance-documents/domain/value-objects";

// ---------- utilidades de prueba ----------
const TENANT = TenantId("tenant-duster");
const OTRO_TENANT = TenantId("tenant-otro");
const VEH_ABC123 = "veh-abc123"; // Vehículo "ABC123"
const COND_JUAN = "cond-juan"; // Conductor "Juan Pérez"
const COND_ANA = "cond-ana"; // Conductora "Ana Gómez"

/** Ventana del 2026-07-01 entre horas UTC (spec-008 usa 08:00–11:00 Bogotá→Tunja). */
const v = (desde: number, hasta: number) =>
  ({ inicio: `2026-07-01T${String(desde).padStart(2, "0")}:00:00Z`, fin: `2026-07-01T${String(hasta).padStart(2, "0")}:00:00Z` });

/** ACL real de tanqueo (spec-011) sobre adaptadores en memoria de Fuel. */
function nuevoRegistradorTanqueo() {
  const tanqueoRepo = new InMemoryTanqueoRepository();
  const odometro = new InMemoryOdometroVehiculo();
  const tanqueo = new TanqueoAcl(
    new RegistrarTanqueo({
      tanqueos: tanqueoRepo,
      odometro,
      publisher: new FuelEventPublisher(),
      ids: new SequentialIdGenerator("tanq"),
    }),
  );
  return { tanqueo, tanqueoRepo, odometro };
}

function nuevoEntorno() {
  const servicios = new InMemoryServicioRepository();
  const cumplimiento = new StubCumplimientoGateway();
  const publisher = new InMemoryEventPublisher();
  const idempotencia = new InMemoryIdempotencyStore();
  const bitacora = new InMemoryBitacoraSync();
  const { tanqueo, tanqueoRepo, odometro } = nuevoRegistradorTanqueo();
  const deps: SchedulingDeps = {
    servicios,
    cumplimiento,
    publisher,
    idempotencia,
    bitacora,
    tanqueo,
    novedades: new InMemoryNovedadRepository(),
    clock: new FixedClock(DateOnly.parse("2026-07-01")),
    ids: new SequentialIdGenerator("srv"),
  };
  return { servicios, cumplimiento, publisher, idempotencia, bitacora, tanqueoRepo, odometro, deps };
}

/** Crea un Servicio Planificado y devuelve su id. */
async function crearServicio(
  deps: SchedulingDeps,
  ventana = v(8, 11),
  tenant = TENANT,
): Promise<string> {
  const r = await new CrearServicio(deps).execute({
    tenant,
    origen: "Bogotá",
    destino: "Tunja",
    ventanaInicio: ventana.inicio,
    ventanaFin: ventana.fin,
    cliente: "Colegio San José",
  });
  if (!r.ok) throw r.error;
  return r.value.servicioId;
}

/** Crea + asigna en un paso (para poblar la agenda). */
async function crearYAsignar(
  deps: SchedulingDeps,
  ventana: { inicio: string; fin: string },
  vehiculoId = VEH_ABC123,
  conductorId = COND_JUAN,
  tenant = TENANT,
): Promise<string> {
  const id = await crearServicio(deps, ventana, tenant);
  const r = await new AsignarServicio(deps).execute({ tenant, servicioId: id, vehiculoId, conductorId });
  if (!r.ok) throw r.error;
  return id;
}

// ════════════════════════════ spec-008 ════════════════════════════
describe("spec-008 — Crear Servicio y asignar sin choques de Ventana horaria", () => {
  let env: ReturnType<typeof nuevoEntorno>;
  beforeEach(() => (env = nuevoEntorno()));

  it("creación y asignación exitosa: Planificado, ServicioCreado y ServicioAsignado", async () => {
    const id = await crearServicio(env.deps);
    const servicio = await env.servicios.findById(TENANT, id);
    expect(servicio!.estado).toBe(EstadoServicio.Planificado);
    expect(env.publisher.porTipo("ServicioCreado")).toHaveLength(1);

    const r = await new AsignarServicio(env.deps).execute({
      tenant: TENANT,
      servicioId: id,
      vehiculoId: VEH_ABC123,
      conductorId: COND_JUAN,
    });
    expect(r.ok).toBe(true);
    const asignados = env.publisher.porTipo("ServicioAsignado");
    expect(asignados).toHaveLength(1);
    expect(asignados[0].vehiculoId).toBe(VEH_ABC123);
    expect(asignados[0].conductorId).toBe(COND_JUAN);
  });

  it("dos Servicios consecutivos NO chocan (ventana semiabierta, R5)", async () => {
    await crearYAsignar(env.deps, v(8, 10));
    const id2 = await crearServicio(env.deps, v(10, 12));
    const r = await new AsignarServicio(env.deps).execute({
      tenant: TENANT,
      servicioId: id2,
      vehiculoId: VEH_ABC123,
      conductorId: COND_JUAN,
    });
    expect(r.ok).toBe(true);
    expect(env.publisher.porTipo("AsignacionRechazada")).toHaveLength(0);
  });

  it("rechazo por choque de Ventana del VEHÍCULO (S4) y emite AsignacionRechazada", async () => {
    await crearYAsignar(env.deps, v(8, 11));
    const id2 = await crearServicio(env.deps, v(10, 12));
    const r = await new AsignarServicio(env.deps).execute({
      tenant: TENANT,
      servicioId: id2,
      vehiculoId: VEH_ABC123,
      conductorId: COND_ANA, // conductor distinto: el choque es del vehículo
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("conflicto_horario");
    const rechazos = env.publisher.porTipo("AsignacionRechazada");
    expect(rechazos).toHaveLength(1);
    expect(rechazos[0].motivo).toBe("choque");
  });

  it("rechazo por choque de Ventana del CONDUCTOR (S4), ventana contenida", async () => {
    await crearYAsignar(env.deps, v(8, 11), VEH_ABC123, COND_JUAN);
    const id2 = await crearServicio(env.deps, v(9, 10)); // [9,10) ⊂ [8,11)
    const r = await new AsignarServicio(env.deps).execute({
      tenant: TENANT,
      servicioId: id2,
      vehiculoId: "veh-otro", // vehículo distinto: el choque es del conductor
      conductorId: COND_JUAN,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("conflicto_horario");
    expect(env.publisher.porTipo("AsignacionRechazada")[0].motivo).toBe("choque");
  });

  it("reasignar un Servicio Planificado a otro Conductor (R11) sin chocar consigo mismo", async () => {
    const id = await crearYAsignar(env.deps, v(8, 11), VEH_ABC123, COND_JUAN);
    const r = await new AsignarServicio(env.deps).execute({
      tenant: TENANT,
      servicioId: id, // mismo Servicio: su propia ventana no cuenta como choque
      vehiculoId: VEH_ABC123,
      conductorId: COND_ANA,
    });
    expect(r.ok).toBe(true);
    const servicio = await env.servicios.findById(TENANT, id);
    expect(servicio!.asignacion!.conductorId).toBe(COND_ANA);
  });

  it("no se puede INICIAR un Servicio sin Asignación válida (S1)", async () => {
    const id = await crearServicio(env.deps);
    const r = await new CambiarEstadoServicio(env.deps).execute({
      tenant: TENANT,
      servicioId: id,
      accion: "iniciar",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("servicio_sin_asignacion");
  });

  it("transición inválida: FINALIZAR un Planificado sin pasar por Iniciado (S2)", async () => {
    const id = await crearYAsignar(env.deps, v(8, 11));
    const r = await new CambiarEstadoServicio(env.deps).execute({
      tenant: TENANT,
      servicioId: id,
      accion: "finalizar",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("transicion_invalida");
  });

  it("ciclo de vida feliz: Planificado → Iniciado → Finalizado emite eventos", async () => {
    const id = await crearYAsignar(env.deps, v(8, 11));
    const cambiar = new CambiarEstadoServicio(env.deps);
    expect((await cambiar.execute({ tenant: TENANT, servicioId: id, accion: "iniciar" })).ok).toBe(true);
    expect((await cambiar.execute({ tenant: TENANT, servicioId: id, accion: "finalizar", odometro: 45210 })).ok).toBe(true);
    expect(env.publisher.porTipo("ServicioIniciado")).toHaveLength(1);
    const fin = env.publisher.porTipo("ServicioFinalizado");
    expect(fin).toHaveLength(1);
    expect(fin[0].odometroFin).toBe(45210);
  });

  it("cancelar un Servicio Planificado lo deja en Cancelado", async () => {
    const id = await crearServicio(env.deps);
    const r = await new CambiarEstadoServicio(env.deps).execute({
      tenant: TENANT,
      servicioId: id,
      accion: "cancelar",
    });
    expect(r.ok).toBe(true);
    const servicio = await env.servicios.findById(TENANT, id);
    expect(servicio!.estado).toBe(EstadoServicio.Cancelado);
  });

  it("un Servicio Cancelado libera la agenda: su ventana ya no choca", async () => {
    const id = await crearYAsignar(env.deps, v(8, 11));
    await new CambiarEstadoServicio(env.deps).execute({ tenant: TENANT, servicioId: id, accion: "cancelar" });
    const id2 = await crearServicio(env.deps, v(9, 10));
    const r = await new AsignarServicio(env.deps).execute({
      tenant: TENANT,
      servicioId: id2,
      vehiculoId: VEH_ABC123,
      conductorId: COND_JUAN,
    });
    expect(r.ok).toBe(true);
  });

  it("rechaza una Ventana horaria inválida (fin <= inicio)", async () => {
    const r = await new CrearServicio(env.deps).execute({
      tenant: TENANT,
      origen: "Bogotá",
      destino: "Tunja",
      ventanaInicio: "2026-07-01T11:00:00Z",
      ventanaFin: "2026-07-01T08:00:00Z",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ventana_invalida");
  });

  it("aislamiento multi-tenant (R12): un Vehículo 'igual' de OTRA Empresa no genera choque", async () => {
    await crearYAsignar(env.deps, v(8, 11), VEH_ABC123, COND_JUAN, OTRO_TENANT);
    const id = await crearServicio(env.deps, v(9, 10), TENANT);
    const r = await new AsignarServicio(env.deps).execute({
      tenant: TENANT,
      servicioId: id,
      vehiculoId: VEH_ABC123, // mismo id de recurso, tenant distinto
      conductorId: COND_JUAN,
    });
    expect(r.ok).toBe(true);
  });
});

// ════════════════════════════ spec-009 ════════════════════════════
describe("spec-009 — Regla de oro: bloquear Asignación si el recurso no está al día", () => {
  let env: ReturnType<typeof nuevoEntorno>;
  let servicioId: string;
  beforeEach(async () => {
    env = nuevoEntorno();
    servicioId = await crearServicio(env.deps);
    env.publisher.limpiar();
  });

  const asignar = (vehiculoId = VEH_ABC123, conductorId = COND_JUAN) =>
    new AsignarServicio(env.deps).execute({ tenant: TENANT, servicioId, vehiculoId, conductorId });

  it("recursos en VERDE: asignación sin advertencias y emite ServicioAsignado", async () => {
    const r = await asignar();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.advertencias).toEqual([]);
    expect(env.publisher.porTipo("ServicioAsignado")).toHaveLength(1);
  });

  it("VEHÍCULO en rojo (SOAT vencido): bloquea con motivo incumplimiento (P3)", async () => {
    env.cumplimiento.bloquear(TENANT, VEH_ABC123, "Vehículo no está al día documentalmente: SOAT vencido.");
    const r = await asignar();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("incumplimiento");
    const rechazos = env.publisher.porTipo("AsignacionRechazada");
    expect(rechazos).toHaveLength(1);
    expect(rechazos[0].motivo).toBe("incumplimiento");
    expect(env.publisher.porTipo("ServicioAsignado")).toHaveLength(0);
  });

  it("CONDUCTOR en rojo (Licencia vencida): bloquea con motivo incumplimiento", async () => {
    env.cumplimiento.bloquear(TENANT, COND_JUAN, "Conductor no está al día documentalmente: LICENCIA vencida.");
    const r = await asignar();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("incumplimiento");
    expect(env.publisher.porTipo("AsignacionRechazada")[0].motivo).toBe("incumplimiento");
  });

  it("basta UN recurso en rojo para bloquear (R6)", async () => {
    env.cumplimiento.bloquear(TENANT, COND_ANA, "Conductor no está al día documentalmente.");
    const r = await asignar(VEH_ABC123, COND_ANA); // vehículo verde, conductora roja
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("incumplimiento");
  });

  it("recurso en AMARILLO advierte pero NO bloquea (P11): asigna con advertencia", async () => {
    env.cumplimiento.advertir(TENANT, COND_JUAN, "LICENCIA del Conductor vence en 12 día(s).");
    const r = await asignar();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.advertencias).toHaveLength(1);
      expect(r.value.advertencias[0]).toContain("12");
    }
    expect(env.publisher.porTipo("ServicioAsignado")).toHaveLength(1);
  });

  it("la regla de oro y el choque se evalúan JUNTOS (R7): con solape el motivo es choque", async () => {
    // Vehículo VIGENTE pero con Asignación previa que se solapa.
    await crearYAsignar(env.deps, v(8, 11), VEH_ABC123, COND_ANA);
    env.publisher.limpiar();
    const r = await asignar(VEH_ABC123, COND_JUAN); // servicio original [8,11): choca
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("conflicto_horario");
    expect(env.publisher.porTipo("AsignacionRechazada")[0].motivo).toBe("choque");
  });
});

// ═════════════ spec-009 con ACL REAL sobre Compliance (colaboración CORE↔CORE) ═════════════
describe("spec-009 — ACL real: Scheduling consulta el Semáforo de Compliance", () => {
  const HOY = "2026-07-01";

  function entornoIntegrado() {
    // Lado Compliance (in-memory).
    const documentos = new InMemoryDocumentoRepository();
    const catalogo = new InMemoryCatalogoTiposRepository();
    const compliancePublisher = new ComplianceEventPublisher();
    const complianceDeps: ComplianceDeps = {
      documentos,
      catalogo,
      publisher: compliancePublisher,
      clock: new FixedClock(DateOnly.parse(HOY)),
      ids: new SequentialIdGenerator("doc"),
    };
    catalogo.seed(TENANT, new TipoDocumento("SOAT", TipoSujeto.Vehiculo, false, true));
    catalogo.seed(TENANT, new TipoDocumento("LICENCIA", TipoSujeto.Conductor, false, true));

    // Lado Scheduling, con la ACL REAL apuntando al caso de uso de Compliance.
    const servicios = new InMemoryServicioRepository();
    const publisher = new InMemoryEventPublisher();
    const deps: SchedulingDeps = {
      servicios,
      cumplimiento: new ComplianceAcl(new ConsultarSemaforo(complianceDeps)),
      publisher,
      idempotencia: new InMemoryIdempotencyStore(),
      bitacora: new InMemoryBitacoraSync(),
      tanqueo: nuevoRegistradorTanqueo().tanqueo,
      novedades: new InMemoryNovedadRepository(),
      clock: new FixedClock(DateOnly.parse(HOY)),
      ids: new SequentialIdGenerator("srv"),
    };
    return { complianceDeps, deps, servicios, publisher };
  }

  /** hoy + N días como YYYY-MM-DD. */
  function hoyMas(dias: number): string {
    const base = DateOnly.parse(HOY).toDate();
    base.setUTCDate(base.getUTCDate() + dias);
    return DateOnly.fromDate(base).toISO();
  }

  it("REHABILITACIÓN (P5): SOAT vencido bloquea; tras renovar (spec-007) la asignación procede", async () => {
    const env = entornoIntegrado();
    // SOAT del Vehículo VENCIDO (venció hace 30 días) → Semáforo rojo.
    const reg = await new RegistrarDocumento(env.complianceDeps).execute({
      tenant: TENANT,
      sujeto: SujetoRef.vehiculo(VEH_ABC123),
      tipoCodigo: "SOAT",
      emision: "2025-06-01",
      vencimiento: hoyMas(-30),
    });
    expect(reg.ok).toBe(true);
    const documentoId = reg.ok ? reg.value.documentoId : "";

    const servicioId = await crearServicio(env.deps);
    const asignar = new AsignarServicio(env.deps);

    // 1) Bloqueo por regla de oro, con detalle traducido por la ACL.
    const r1 = await asignar.execute({ tenant: TENANT, servicioId, vehiculoId: VEH_ABC123, conductorId: COND_JUAN });
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error.code).toBe("incumplimiento");
      expect(r1.error.message).toContain("SOAT");
    }
    expect(env.publisher.porTipo("AsignacionRechazada")[0].motivo).toBe("incumplimiento");

    // 2) Renovación del Documento (spec-007) → recurso rehabilitado.
    const ren = await new RenovarDocumento(env.complianceDeps).execute({
      tenant: TENANT,
      documentoId,
      nuevaEmision: HOY,
      nuevoVencimiento: hoyMas(365),
    });
    expect(ren.ok).toBe(true);

    // 3) La misma asignación ahora procede (P5: el bloqueo se levanta).
    const r2 = await asignar.execute({ tenant: TENANT, servicioId, vehiculoId: VEH_ABC123, conductorId: COND_JUAN });
    expect(r2.ok).toBe(true);
    expect(env.publisher.porTipo("ServicioAsignado")).toHaveLength(1);
  });

  it("AMARILLO vía ACL: Licencia vence en 12 días → asigna con advertencia que indica qué y cuántos días (R9)", async () => {
    const env = entornoIntegrado();
    await new RegistrarDocumento(env.complianceDeps).execute({
      tenant: TENANT,
      sujeto: SujetoRef.conductor(COND_JUAN),
      tipoCodigo: "LICENCIA",
      emision: "2020-07-01",
      vencimiento: hoyMas(12),
    });

    const servicioId = await crearServicio(env.deps);
    const r = await new AsignarServicio(env.deps).execute({
      tenant: TENANT,
      servicioId,
      vehiculoId: VEH_ABC123, // sin documentos ni requeridos → verde
      conductorId: COND_JUAN,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.advertencias).toHaveLength(1);
      expect(r.value.advertencias[0]).toContain("LICENCIA");
      expect(r.value.advertencias[0]).toContain("12");
    }
  });

  it("ROJO por documento requerido AUSENTE (I3 de Compliance) también bloquea", async () => {
    const env = entornoIntegrado();
    // RTM requerida para vehículos; ABC123 no la tiene → rojo por ausencia.
    (env.complianceDeps.catalogo as InMemoryCatalogoTiposRepository).seed(
      TENANT,
      new TipoDocumento("RTM", TipoSujeto.Vehiculo, true, true),
    );
    const servicioId = await crearServicio(env.deps);
    const r = await new AsignarServicio(env.deps).execute({
      tenant: TENANT,
      servicioId,
      vehiculoId: VEH_ABC123,
      conductorId: COND_JUAN,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("incumplimiento");
      expect(r.error.message).toContain("RTM");
      expect(r.error.message).toContain("ausente");
    }
  });
});

// ════════════════════════════ spec-010 (lado servidor) ════════════════════════════
describe("spec-010 — ejecución offline: idempotencia, S5, sync push/pull y bitácora", () => {
  let env: ReturnType<typeof nuevoEntorno>;
  let servicioId: string;
  beforeEach(async () => {
    env = nuevoEntorno();
    servicioId = await crearYAsignar(env.deps, v(8, 11));
    env.publisher.limpiar();
  });

  it("la versión del agregado incrementa con cada mutación (control optimista R9)", async () => {
    const s = await env.servicios.findById(TENANT, servicioId);
    expect(s!.version).toBe(2); // crear=1, asignar=2
    await new CambiarEstadoServicio(env.deps).execute({ tenant: TENANT, servicioId, accion: "iniciar" });
    expect((await env.servicios.findById(TENANT, servicioId))!.version).toBe(3);
  });

  it("Invariante S5: no se puede finalizar con finReal anterior al inicioReal", async () => {
    const cambiar = new CambiarEstadoServicio(env.deps);
    await cambiar.execute({ tenant: TENANT, servicioId, accion: "iniciar", ocurridoEn: "2026-07-01T08:05:00Z" });
    const r = await cambiar.execute({ tenant: TENANT, servicioId, accion: "finalizar", ocurridoEn: "2026-07-01T07:00:00Z" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("fin_anterior_a_inicio");
  });

  it("idempotencia (R8): el mismo clientId no aplica la transición dos veces", async () => {
    const cambiar = new CambiarEstadoServicio(env.deps);
    const r1 = await cambiar.execute({ tenant: TENANT, servicioId, accion: "iniciar", clientId: "uuid-ini-001" });
    const r2 = await cambiar.execute({ tenant: TENANT, servicioId, accion: "iniciar", clientId: "uuid-ini-001" });
    expect(r1.ok && !r1.value.duplicado).toBe(true);
    expect(r2.ok && r2.value.duplicado).toBe(true);
    if (r1.ok && r2.ok) expect(r2.value.version).toBe(r1.value.version); // misma respuesta original
    expect(env.publisher.porTipo("ServicioIniciado")).toHaveLength(1); // UN solo evento
  });

  it("sync push aplica el lote EN ORDEN: iniciado a las 08:05 y finalizado a las 11:10 con odómetro", async () => {
    const resultados = await new SincronizarCambios(env.deps).execute({
      tenant: TENANT,
      usuarioId: COND_JUAN,
      cambios: [
        {
          clientId: "uuid-ini-001", entidad: "estado_servicio", operacion: "actualizar",
          payload: { servicioId, accion: "iniciar", odometro: 152000 }, ocurridoEn: "2026-07-01T08:05:00Z",
        },
        {
          clientId: "uuid-fin-001", entidad: "estado_servicio", operacion: "actualizar",
          payload: { servicioId, accion: "finalizar", odometro: 152180 }, ocurridoEn: "2026-07-01T11:10:00Z",
        },
      ],
    });
    expect(resultados.map((r) => r.resultado)).toEqual(["confirmado", "confirmado"]);
    const s = await env.servicios.findById(TENANT, servicioId);
    expect(s!.estado).toBe(EstadoServicio.Finalizado);
    expect(env.publisher.porTipo("ServicioFinalizado")[0].odometroFin).toBe(152180);
  });

  it("reintento por confirmación perdida: el mismo lote devuelve 'duplicado' sin doble transición", async () => {
    const lote = {
      tenant: TENANT,
      usuarioId: COND_JUAN,
      cambios: [
        {
          clientId: "uuid-fin-001", entidad: "estado_servicio" as const, operacion: "actualizar" as const,
          payload: { servicioId, accion: "iniciar" },
        },
      ],
    };
    const sync = new SincronizarCambios(env.deps);
    const r1 = await sync.execute(lote);
    const r2 = await sync.execute(lote); // reintento (confirmación perdida)
    expect(r1[0].resultado).toBe("confirmado");
    expect(r2[0].resultado).toBe("duplicado");
    expect(env.publisher.porTipo("ServicioIniciado")).toHaveLength(1);
  });

  it("el estado TERMINAL del Conductor gana: el intento de reabrir queda en bitácora (R9/R10)", async () => {
    const cambiar = new CambiarEstadoServicio(env.deps);
    await cambiar.execute({ tenant: TENANT, servicioId, accion: "iniciar" });
    await cambiar.execute({ tenant: TENANT, servicioId, accion: "finalizar" });

    // El admin intenta reabrir el Servicio ya Finalizado.
    const r = await cambiar.execute({ tenant: TENANT, servicioId, accion: "iniciar", usuarioId: "admin-luis" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("transicion_invalida");
    expect((await env.servicios.findById(TENANT, servicioId))!.estado).toBe(EstadoServicio.Finalizado);

    const bitacora = env.bitacora.deTenant(TENANT);
    expect(bitacora).toHaveLength(1);
    expect(bitacora[0].usuarioId).toBe("admin-luis");
    expect(bitacora[0].detalle).toContain("terminal");
  });

  it("un conflicto en el lote NO frena los demás cambios; novedad → error explícito", async () => {
    const otro = await crearYAsignar(env.deps, v(12, 14), "veh-otro", COND_JUAN);
    const resultados = await new SincronizarCambios(env.deps).execute({
      tenant: TENANT,
      usuarioId: COND_JUAN,
      cambios: [
        { clientId: "c1", entidad: "estado_servicio", operacion: "actualizar", payload: { servicioId, accion: "finalizar" } }, // Planificado→Finalizado: conflicto S2
        { clientId: "c2", entidad: "novedad", operacion: "crear", payload: { servicioId: "no-existe", tipo: "incidente", descripcion: "x" } }, // spec-014: Servicio inexistente → error
        { clientId: "c3", entidad: "estado_servicio", operacion: "actualizar", payload: { servicioId: otro, accion: "iniciar" } },
      ],
    });
    expect(resultados.map((r) => r.resultado)).toEqual(["conflicto", "error", "confirmado"]);
    expect(resultados[0].problema!.type).toBe("transicion_invalida");
    expect(resultados[1].problema!.type).toBe("servicio_no_encontrado");
  });

  it("spec-011: un Tanqueo en el lote se confirma vía la ACL de Fuel (append-only)", async () => {
    const resultados = await new SincronizarCambios(env.deps).execute({
      tenant: TENANT,
      usuarioId: COND_JUAN,
      cambios: [
        {
          clientId: "uuid-tanqueo-001", entidad: "tanqueo", operacion: "crear",
          payload: { vehiculoId: VEH_ABC123, cantidad: 40, unidad: "litros", valorCop: 260000, odometro: 152300 },
          ocurridoEn: "2026-07-01T09:00:00Z",
        },
      ],
    });
    expect(resultados[0].resultado).toBe("confirmado");
    expect(resultados[0].serverId).toBeTruthy();
    // El Odómetro autoritativo del Vehículo avanzó con el Tanqueo (R8).
    expect(await env.odometro.lecturaActual(TENANT, VEH_ABC123)).toBe(152300);
  });

  it("spec-011: reintento del mismo Tanqueo (mismo clientId) → 'duplicado', un solo registro", async () => {
    const lote = {
      tenant: TENANT,
      usuarioId: COND_JUAN,
      cambios: [
        {
          clientId: "uuid-tanqueo-001", entidad: "tanqueo" as const, operacion: "crear" as const,
          payload: { vehiculoId: VEH_ABC123, cantidad: 40, unidad: "litros", valorCop: 260000, odometro: 152300 },
        },
      ],
    };
    const sync = new SincronizarCambios(env.deps);
    expect((await sync.execute(lote))[0].resultado).toBe("confirmado");
    expect((await sync.execute(lote))[0].resultado).toBe("duplicado"); // confirmación perdida
    expect(await env.tanqueoRepo.listByVehiculo(TENANT, VEH_ABC123)).toHaveLength(1);
  });

  it("spec-011: Tanqueo con valor COP no positivo → 'error' (rechazo local R6)", async () => {
    const resultados = await new SincronizarCambios(env.deps).execute({
      tenant: TENANT,
      usuarioId: COND_JUAN,
      cambios: [
        {
          clientId: "uuid-tanqueo-cero", entidad: "tanqueo", operacion: "crear",
          payload: { vehiculoId: VEH_ABC123, cantidad: 40, unidad: "litros", valorCop: 0, odometro: 152300 },
        },
      ],
    });
    expect(resultados[0].resultado).toBe("error");
    expect(resultados[0].problema!.type).toBe("valor_cop_no_positivo");
  });

  it("pull 'mi día' (R1): el Conductor solo ve SUS Servicios, con cursor", async () => {
    await crearYAsignar(env.deps, v(12, 14), "veh-otro", COND_ANA); // de otra persona
    const r = await new ConsultarMiDia(env.deps).execute({ tenant: TENANT, conductorId: COND_JUAN });
    expect(r.servicios).toHaveLength(1);
    expect(r.servicios[0].id).toBe(servicioId);
    expect(r.vehiculoIds).toEqual([VEH_ABC123]);
    expect(r.cursor).toBeTruthy();
  });
});

// ════════════════════════════ mappers (contrato REST) ════════════════════════════
describe("mappers — servicioToDto cumple el contrato openapi.yaml", () => {
  it("serializa Servicio con Asignación embebida, ventana ISO y advertencias", async () => {
    const env = nuevoEntorno();
    env.cumplimiento.advertir(TENANT, COND_JUAN, "LICENCIA del Conductor vence en 12 día(s).");
    const id = await crearYAsignar(env.deps, v(8, 11));
    const dto = servicioToDto((await env.servicios.findById(TENANT, id))!);

    expect(dto.estado).toBe("Planificado");
    expect(dto.origen).toBe("Bogotá");
    expect(dto.ventana.inicio).toBe("2026-07-01T08:00:00.000Z");
    expect(dto.ventana.fin).toBe("2026-07-01T11:00:00.000Z");
    expect(dto.asignacion).toEqual({
      servicioId: id,
      vehiculoId: VEH_ABC123,
      conductorId: COND_JUAN,
      advertencias: ["LICENCIA del Conductor vence en 12 día(s)."],
    });
  });

  it("sin Asignación ni advertencias, los campos opcionales quedan ausentes", async () => {
    const env = nuevoEntorno();
    const id = await crearServicio(env.deps);
    const dto = servicioToDto((await env.servicios.findById(TENANT, id))!);
    expect(dto.asignacion).toBeUndefined();
    expect(dto.inicioReal).toBeUndefined();
  });

  it("la VentanaHoraria semiabierta detecta solape solo con intersección real", () => {
    const a = VentanaHoraria.parse("2026-07-01T08:00:00Z", "2026-07-01T10:00:00Z");
    const b = VentanaHoraria.parse("2026-07-01T10:00:00Z", "2026-07-01T12:00:00Z");
    const c = VentanaHoraria.parse("2026-07-01T09:59:00Z", "2026-07-01T10:30:00Z");
    expect(a.seSolapaCon(b)).toBe(false); // borde compartido: no choca
    expect(a.seSolapaCon(c)).toBe(true);
    expect(c.seSolapaCon(a)).toBe(true); // simétrico
  });
});
