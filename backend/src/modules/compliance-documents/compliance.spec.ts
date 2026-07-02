/**
 * Pruebas del módulo Compliance & Documents, DERIVADAS de los criterios Gherkin
 * de las specs aprobadas (Fase 3). Cada `describe` cita su spec y cada `it` refleja
 * un Escenario/Esquema del escenario. Spec Driven Development: la spec es la fuente.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  DateOnly,
  FixedClock,
  SequentialIdGenerator,
  TenantId,
} from "../../shared/kernel";
import { Semaforo, SujetoRef, TipoDocumento, TipoSujeto } from "./domain/value-objects";
import {
  InMemoryCatalogoTiposRepository,
  InMemoryDocumentoRepository,
  InMemoryEventPublisher,
} from "./application/in-memory.adapters";
import {
  ComplianceDeps,
  ConsultarSemaforo,
  EvaluarVencimientos,
  RegistrarDocumento,
  RenovarDocumento,
} from "./application/use-cases";

// ---------- utilidades de prueba ----------
const TENANT = TenantId("tenant-duster");
const ABC123 = SujetoRef.vehiculo("veh-abc123"); // Vehículo "ABC123"

/** Construye fecha hoy + N días como YYYY-MM-DD (para "vence en N días"). */
function hoyMas(hoy: DateOnly, dias: number): string {
  const base = hoy.toDate();
  base.setUTCDate(base.getUTCDate() + dias);
  return DateOnly.fromDate(base).toISO();
}

function nuevoEntorno(hoyISO = "2026-06-25") {
  const hoy = DateOnly.parse(hoyISO);
  const documentos = new InMemoryDocumentoRepository();
  const catalogo = new InMemoryCatalogoTiposRepository();
  const publisher = new InMemoryEventPublisher();
  const deps: ComplianceDeps = {
    documentos,
    catalogo,
    publisher,
    clock: new FixedClock(hoy),
    ids: new SequentialIdGenerator("doc"),
  };
  // Catálogo: SOAT y RTM aplican a Vehículo; RTM marcada como requerida (para I3).
  catalogo.seed(TENANT, new TipoDocumento("SOAT", TipoSujeto.Vehiculo, false, true));
  catalogo.seed(TENANT, new TipoDocumento("RTM", TipoSujeto.Vehiculo, true, true));
  catalogo.seed(TENANT, new TipoDocumento("LICENCIA", TipoSujeto.Conductor, true, true));
  return { hoy, documentos, catalogo, publisher, deps };
}

// ════════════════════════════ spec-005 ════════════════════════════
describe("spec-005 — Registrar un Documento con Vencimiento", () => {
  let env: ReturnType<typeof nuevoEntorno>;
  beforeEach(() => (env = nuevoEntorno()));

  it("registro exitoso de un Documento (caso feliz) y emite DocumentoRegistrado", async () => {
    const uc = new RegistrarDocumento(env.deps);
    const r = await uc.execute({
      tenant: TENANT,
      sujeto: ABC123,
      tipoCodigo: "SOAT",
      emision: "2025-12-31",
      vencimiento: "2026-12-31",
      adjuntoRef: "soat-2026.pdf",
    });
    expect(r.ok).toBe(true);
    expect(env.publisher.porTipo("DocumentoRegistrado")).toHaveLength(1);
  });

  it("rechaza Vencimiento anterior a la emisión (caso de error, R4)", async () => {
    const uc = new RegistrarDocumento(env.deps);
    const r = await uc.execute({
      tenant: TENANT,
      sujeto: ABC123,
      tipoCodigo: "SOAT",
      emision: "2026-12-31",
      vencimiento: "2026-01-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("vencimiento_anterior_a_emision");
  });

  it("rechaza un segundo Documento vigente del mismo Tipo (Invariante I2, R6)", async () => {
    const uc = new RegistrarDocumento(env.deps);
    await uc.execute({ tenant: TENANT, sujeto: ABC123, tipoCodigo: "SOAT", emision: "2025-12-31", vencimiento: "2026-12-31" });
    const segundo = await uc.execute({ tenant: TENANT, sujeto: ABC123, tipoCodigo: "SOAT", emision: "2026-01-01", vencimiento: "2027-01-01" });
    expect(segundo.ok).toBe(false);
    if (!segundo.ok) expect(segundo.error.code).toBe("documento_vigente_duplicado");
  });

  it("rechaza un Tipo que no aplica al sujeto (tarjeta/licencia a Vehículo)", async () => {
    const uc = new RegistrarDocumento(env.deps);
    const r = await uc.execute({
      tenant: TENANT,
      sujeto: ABC123, // Vehículo
      tipoCodigo: "LICENCIA", // aplica a Conductor
      emision: "2025-01-01",
      vencimiento: "2030-01-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("tipo_no_aplica_al_sujeto");
  });

  it("acepta un Documento cuyo Vencimiento es hoy mismo (caso alternativo)", async () => {
    const uc = new RegistrarDocumento(env.deps);
    const r = await uc.execute({
      tenant: TENANT,
      sujeto: ABC123,
      tipoCodigo: "SOAT",
      emision: "2025-01-01",
      vencimiento: env.hoy.toISO(),
    });
    expect(r.ok).toBe(true);
  });
});

// ════════════════════════════ spec-006 ════════════════════════════
describe("spec-006 — Semáforo y alertas anticipadas", () => {
  let env: ReturnType<typeof nuevoEntorno>;
  beforeEach(() => (env = nuevoEntorno()));

  // Esquema del escenario: Estado del Documento según días restantes
  const casos: Array<{ dias: number; estado: Semaforo; semaforo: Semaforo }> = [
    { dias: 45, estado: Semaforo.Vigente, semaforo: Semaforo.Vigente },
    { dias: 30, estado: Semaforo.PorVencer, semaforo: Semaforo.PorVencer },
    { dias: 15, estado: Semaforo.PorVencer, semaforo: Semaforo.PorVencer },
    { dias: 3, estado: Semaforo.PorVencer, semaforo: Semaforo.PorVencer },
    { dias: 0, estado: Semaforo.PorVencer, semaforo: Semaforo.PorVencer }, // vence hoy
    { dias: -1, estado: Semaforo.Vencido, semaforo: Semaforo.Vencido },
    { dias: -10, estado: Semaforo.Vencido, semaforo: Semaforo.Vencido },
  ];

  for (const c of casos) {
    it(`Documento que vence en ${c.dias} días → estado ${c.estado} / semáforo ${c.semaforo}`, async () => {
      // Sin RTM requerida para aislar el caso del SOAT: usamos un catálogo sin requeridos.
      const reg = new RegistrarDocumento(env.deps);
      await reg.execute({
        tenant: TENANT,
        sujeto: ABC123,
        tipoCodigo: "SOAT",
        emision: "2020-01-01",
        vencimiento: hoyMas(env.hoy, c.dias),
      });
      // Quitar RTM requerida del catálogo para este cálculo puntual:
      const catalogoSinRequeridos = new InMemoryCatalogoTiposRepository();
      catalogoSinRequeridos.seed(TENANT, new TipoDocumento("SOAT", TipoSujeto.Vehiculo, false, true));
      const consultar = new ConsultarSemaforo({ ...env.deps, catalogo: catalogoSinRequeridos });
      const res = await consultar.execute(TENANT, ABC123);
      expect(res.semaforo).toBe(c.semaforo);
      expect(res.detalles.find((d) => d.tipoDocumento === "SOAT")?.estado).toBe(c.estado);
    });
  }

  // Esquema del escenario: Emisión de alerta anticipada por umbral
  for (const dias of [30, 15, 3]) {
    it(`emite DocumentoPorVencer(${dias}) al evaluar con ${dias} días restantes`, async () => {
      const reg = new RegistrarDocumento(env.deps);
      await reg.execute({ tenant: TENANT, sujeto: ABC123, tipoCodigo: "SOAT", emision: "2020-01-01", vencimiento: hoyMas(env.hoy, dias) });
      env.publisher.limpiar();
      await new EvaluarVencimientos(env.deps).execute(TENANT);
      const alertas = env.publisher.porTipo("DocumentoPorVencer").filter((e) => e.diasRestantes === dias && e.tipoDocumento === "SOAT");
      expect(alertas).toHaveLength(1);
    });
  }

  it("Documento vigente (45 días) no genera alerta y semáforo Vigente", async () => {
    const reg = new RegistrarDocumento(env.deps);
    await reg.execute({ tenant: TENANT, sujeto: ABC123, tipoCodigo: "SOAT", emision: "2020-01-01", vencimiento: hoyMas(env.hoy, 45) });
    env.publisher.limpiar();
    await new EvaluarVencimientos(env.deps).execute(TENANT);
    expect(env.publisher.porTipo("DocumentoPorVencer").filter((e) => e.tipoDocumento === "SOAT")).toHaveLength(0);
  });

  it("cada umbral notifica una sola vez (R5): evaluar a 30 y luego a 29 días no duplica la alerta de 30", async () => {
    // Documento que vence en 30 días respecto del 2026-06-25.
    const reg = new RegistrarDocumento(env.deps);
    const vto = hoyMas(env.hoy, 30);
    await reg.execute({ tenant: TENANT, sujeto: ABC123, tipoCodigo: "SOAT", emision: "2020-01-01", vencimiento: vto });
    env.publisher.limpiar();

    // Día 1: 30 días restantes.
    await new EvaluarVencimientos(env.deps).execute(TENANT);
    // Día 2: 29 días restantes (mismo documento persistido conserva el umbral notificado).
    const env2dias = new EvaluarVencimientos({
      ...env.deps,
      clock: new FixedClock(DateOnly.parse(hoyMas(env.hoy, 1))),
    });
    await env2dias.execute(TENANT);

    const alertas30 = env.publisher.porTipo("DocumentoPorVencer").filter((e) => e.diasRestantes === 30 && e.tipoDocumento === "SOAT");
    expect(alertas30).toHaveLength(1);
  });

  it("el Semáforo toma el peor estado entre Documentos (SOAT verde + RTM amarillo = amarillo)", async () => {
    const reg = new RegistrarDocumento(env.deps);
    await reg.execute({ tenant: TENANT, sujeto: ABC123, tipoCodigo: "SOAT", emision: "2020-01-01", vencimiento: hoyMas(env.hoy, 60) });
    await reg.execute({ tenant: TENANT, sujeto: ABC123, tipoCodigo: "RTM", emision: "2020-01-01", vencimiento: hoyMas(env.hoy, 10) });
    const res = await new ConsultarSemaforo(env.deps).execute(TENANT, ABC123);
    expect(res.semaforo).toBe(Semaforo.PorVencer);
  });

  it("Documento que vence hoy exactamente está Por vencer, no Vencido (R3)", async () => {
    const reg = new RegistrarDocumento(env.deps);
    await reg.execute({ tenant: TENANT, sujeto: ABC123, tipoCodigo: "SOAT", emision: "2020-01-01", vencimiento: env.hoy.toISO() });
    const catalogoSinRequeridos = new InMemoryCatalogoTiposRepository();
    catalogoSinRequeridos.seed(TENANT, new TipoDocumento("SOAT", TipoSujeto.Vehiculo, false, true));
    const res = await new ConsultarSemaforo({ ...env.deps, catalogo: catalogoSinRequeridos }).execute(TENANT, ABC123);
    expect(res.semaforo).toBe(Semaforo.PorVencer);
  });

  it("Documento vencido (venció ayer) emite DocumentoVencido y pone el semáforo en rojo (R6)", async () => {
    const reg = new RegistrarDocumento(env.deps);
    await reg.execute({ tenant: TENANT, sujeto: ABC123, tipoCodigo: "SOAT", emision: "2020-01-01", vencimiento: hoyMas(env.hoy, -1) });
    env.publisher.limpiar();
    await new EvaluarVencimientos(env.deps).execute(TENANT);
    expect(env.publisher.porTipo("DocumentoVencido").filter((e) => e.tipoDocumento === "SOAT")).toHaveLength(1);
    const catalogoSinRequeridos = new InMemoryCatalogoTiposRepository();
    catalogoSinRequeridos.seed(TENANT, new TipoDocumento("SOAT", TipoSujeto.Vehiculo, false, true));
    const res = await new ConsultarSemaforo({ ...env.deps, catalogo: catalogoSinRequeridos }).execute(TENANT, ABC123);
    expect(res.semaforo).toBe(Semaforo.Vencido);
  });

  it("Documento requerido ausente cuenta como Vencido (Invariante I3)", async () => {
    // No registramos RTM (requerida en el catálogo del entorno) → semáforo rojo.
    const res = await new ConsultarSemaforo(env.deps).execute(TENANT, ABC123);
    expect(res.semaforo).toBe(Semaforo.Vencido);
    expect(res.detalles.find((d) => d.tipoDocumento === "RTM")?.ausente).toBe(true);
  });
});

// ════════════════════════════ spec-007 ════════════════════════════
describe("spec-007 — Renovación de un Documento con histórico", () => {
  let env: ReturnType<typeof nuevoEntorno>;
  beforeEach(() => (env = nuevoEntorno()));

  it("renovación exitosa: queda un vigente nuevo, histórico inmutable y emite DocumentoRenovado", async () => {
    const reg = new RegistrarDocumento(env.deps);
    const r = await reg.execute({ tenant: TENANT, sujeto: ABC123, tipoCodigo: "SOAT", emision: "2025-12-15", vencimiento: hoyMas(env.hoy, 10) });
    expect(r.ok).toBe(true);
    const documentoId = r.ok ? r.value.documentoId : "";
    env.publisher.limpiar();

    const renov = await new RenovarDocumento(env.deps).execute({
      tenant: TENANT,
      documentoId,
      nuevaEmision: "2026-06-15",
      nuevoVencimiento: "2027-12-31",
      adjuntoRef: "soat-2027.pdf",
    });
    expect(renov.ok).toBe(true);
    if (renov.ok) expect(renov.value.version).toBe(2);

    const doc = await env.documentos.findById(TENANT, documentoId);
    expect(doc?.vencimiento.fecha.toISO()).toBe("2027-12-31");
    expect(doc?.historico).toHaveLength(1); // versión anterior conservada
    expect(doc?.historico[0]?.version).toBe(1);

    const renovados = env.publisher.porTipo("DocumentoRenovado");
    expect(renovados).toHaveLength(1);
    expect(renovados[0]?.nuevoVencimiento).toBe("2027-12-31");
  });

  it("renovar un Documento vencido lo rehabilita a Vigente (caso alternativo)", async () => {
    const reg = new RegistrarDocumento(env.deps);
    const r = await reg.execute({ tenant: TENANT, sujeto: ABC123, tipoCodigo: "SOAT", emision: "2020-01-01", vencimiento: hoyMas(env.hoy, -5) });
    const documentoId = r.ok ? r.value.documentoId : "";

    await new RenovarDocumento(env.deps).execute({
      tenant: TENANT,
      documentoId,
      nuevaEmision: env.hoy.toISO(),
      nuevoVencimiento: hoyMas(env.hoy, 365),
    });

    const catalogoSinRequeridos = new InMemoryCatalogoTiposRepository();
    catalogoSinRequeridos.seed(TENANT, new TipoDocumento("SOAT", TipoSujeto.Vehiculo, false, true));
    const res = await new ConsultarSemaforo({ ...env.deps, catalogo: catalogoSinRequeridos }).execute(TENANT, ABC123);
    expect(res.semaforo).toBe(Semaforo.Vigente);
  });

  it("rechaza renovación con nueva Vigencia anterior a la nueva emisión (caso de error, I4)", async () => {
    const reg = new RegistrarDocumento(env.deps);
    const r = await reg.execute({ tenant: TENANT, sujeto: ABC123, tipoCodigo: "SOAT", emision: "2025-01-01", vencimiento: hoyMas(env.hoy, 10) });
    const documentoId = r.ok ? r.value.documentoId : "";
    const renov = await new RenovarDocumento(env.deps).execute({
      tenant: TENANT,
      documentoId,
      nuevaEmision: "2026-06-15",
      nuevoVencimiento: "2026-01-01",
    });
    expect(renov.ok).toBe(false);
    if (!renov.ok) expect(renov.error.code).toBe("vencimiento_anterior_a_emision");
  });
});

// ════════════════════════════ multi-tenant ════════════════════════════
describe("Aislamiento multi-tenant (ADR-0008): un tenant no ve datos de otro", () => {
  it("el Semáforo de un tenant no se ve afectado por Documentos de otro tenant", async () => {
    const env = nuevoEntorno();
    const OTRO = TenantId("tenant-otro");
    // Catálogo del otro tenant sin requeridos, con SOAT vencido.
    env.catalogo.seed(OTRO, new TipoDocumento("SOAT", TipoSujeto.Vehiculo, false, true));
    const reg = new RegistrarDocumento(env.deps);
    await reg.execute({ tenant: OTRO, sujeto: ABC123, tipoCodigo: "SOAT", emision: "2020-01-01", vencimiento: hoyMas(env.hoy, -30) });

    // En el tenant original, ese mismo "sujeto" no tiene Documentos → RTM requerida ausente = rojo,
    // pero el SOAT del OTRO tenant NO debe contar aquí.
    const docsTenantOriginal = await env.documentos.findVigentesBySujeto(TENANT, ABC123);
    expect(docsTenantOriginal).toHaveLength(0);
  });
});
