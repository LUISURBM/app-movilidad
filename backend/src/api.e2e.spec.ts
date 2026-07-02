/**
 * E2E de la API por HTTP REAL — el gate de H0 del roadmap: "E2E verde para la
 * regla de oro". Bootea el AppModule COMPLETO (ambos CORE + plataforma, con la
 * MISMA configuración de main.ts vía configurarApp) y ejercita el flujo:
 *
 *   registrar SOAT vencido → asignación 409 incumplimiento (spec-009 P3)
 *   → renovar (spec-007) → la misma asignación 200 (rehabilitación P5)
 *   → choque de ventana 409 conflicto_horario (spec-008 S4)
 *   → consecutiva 200 (semiabierta R5) → aislamiento por tenant (ADR-0008).
 *
 * TODO el estado se construye por la API (incluido el catálogo, spec-005 R2/R10).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configurarApp } from "./bootstrap";
import { firmarJwtHS256 } from "./platform/jwt";

const TENANT_A = "tenant-duster";
const TENANT_B = "tenant-otro";
const VEH = "veh-e2e-abc123";
const COND = "cond-e2e-juan";
const COND2 = "cond-e2e-ana";

let app: INestApplication;
let base: string;

/** Llamada HTTP con el header de tenant del stand-in de auth. */
async function api(
  method: string,
  path: string,
  opts: { tenant?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.tenant ? { "x-tenant-id": opts.tenant } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

beforeAll(async () => {
  app = configurarApp(await NestFactory.create(AppModule, { logger: false }));
  await app.listen(0); // puerto efímero
  base = (await app.getUrl()).replace("[::1]", "127.0.0.1");

  // Catálogo del tenant A por la API real (spec-005 R2): SOAT para vehículos.
  const r = await api("POST", "/v1/catalogo/tipos", {
    tenant: TENANT_A,
    body: { codigo: "SOAT", aplicaA: "vehiculo" },
  });
  if (r.status !== 201) throw new Error(`No se pudo sembrar el catálogo: ${r.status}`);
});

afterAll(async () => {
  await app.close();
});

describe("E2E API — bootstrap y autenticación", () => {
  it("GET /v1/health responde sin autenticación", async () => {
    const r = await api("GET", "/v1/health");
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("ok");
  });

  it("sin x-tenant-id la API devuelve 401 Problem (contrato bearerAuth)", async () => {
    const r = await api("GET", "/v1/servicios");
    expect(r.status).toBe(401);
    expect(r.json.status).toBe(401);
  });
});

describe("E2E API — REGLA DE ORO de punta a punta (spec-005→009 por HTTP)", () => {
  let documentoId: string;
  let servicioId: string;

  it("1) registra el SOAT VENCIDO del vehículo (spec-005) → 201", async () => {
    const r = await api("POST", "/v1/documentos", {
      tenant: TENANT_A,
      body: {
        sujeto: { tipo: "vehiculo", id: VEH },
        tipo: "SOAT",
        expedicion: "2025-01-01",
        vencimiento: "2026-01-01", // ya vencido
      },
    });
    expect(r.status).toBe(201);
    documentoId = r.json.id;
  });

  it("2) el Semáforo del vehículo está en ROJO (spec-006)", async () => {
    const r = await api("GET", `/v1/cumplimiento/vehiculos/${VEH}`, { tenant: TENANT_A });
    expect(r.status).toBe(200);
    expect(r.json.semaforo).toBe("Vencido");
  });

  it("3) crea un Servicio Planificado (spec-008) → 201", async () => {
    const r = await api("POST", "/v1/servicios", {
      tenant: TENANT_A,
      body: {
        origen: "Bogotá",
        destino: "Tunja",
        ventana: { inicio: "2026-07-10T08:00:00Z", fin: "2026-07-10T11:00:00Z" },
        cliente: "Colegio San José",
      },
    });
    expect(r.status).toBe(201);
    expect(r.json.estado).toBe("Planificado");
    servicioId = r.json.id;
  });

  it("4) la asignación se BLOQUEA por incumplimiento — regla de oro (spec-009 P3) → 409", async () => {
    const r = await api("PUT", `/v1/servicios/${servicioId}/asignacion`, {
      tenant: TENANT_A,
      body: { vehiculoId: VEH, conductorId: COND },
    });
    expect(r.status).toBe(409);
    expect(r.json.type).toBe("incumplimiento");
    expect(r.json.title).toContain("SOAT");
  });

  it("5) renueva el SOAT (spec-007) → 201 y el Semáforo vuelve a verde", async () => {
    const r = await api("POST", `/v1/documentos/${documentoId}/renovaciones`, {
      tenant: TENANT_A,
      body: { expedicion: "2026-07-01", vencimiento: "2027-12-31" },
    });
    expect(r.status).toBe(201);
    const semaforo = await api("GET", `/v1/cumplimiento/vehiculos/${VEH}`, { tenant: TENANT_A });
    expect(semaforo.json.semaforo).toBe("Vigente");
  });

  it("6) la MISMA asignación ahora procede — rehabilitación (P5) → 200", async () => {
    const r = await api("PUT", `/v1/servicios/${servicioId}/asignacion`, {
      tenant: TENANT_A,
      body: { vehiculoId: VEH, conductorId: COND },
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ servicioId, vehiculoId: VEH, conductorId: COND });
  });

  it("7) una ventana SOLAPADA del mismo vehículo se rechaza por choque (S4) → 409", async () => {
    const s2 = await api("POST", "/v1/servicios", {
      tenant: TENANT_A,
      body: {
        origen: "Bogotá",
        destino: "Chía",
        ventana: { inicio: "2026-07-10T10:00:00Z", fin: "2026-07-10T12:00:00Z" }, // solapa [8,11)
      },
    });
    const r = await api("PUT", `/v1/servicios/${s2.json.id}/asignacion`, {
      tenant: TENANT_A,
      body: { vehiculoId: VEH, conductorId: COND2 },
    });
    expect(r.status).toBe(409);
    expect(r.json.type).toBe("conflicto_horario");
  });

  it("8) una ventana CONSECUTIVA no choca (semiabierta, R5) → 200", async () => {
    const s3 = await api("POST", "/v1/servicios", {
      tenant: TENANT_A,
      body: {
        origen: "Tunja",
        destino: "Bogotá",
        ventana: { inicio: "2026-07-10T11:00:00Z", fin: "2026-07-10T14:00:00Z" }, // empieza donde termina [8,11)
      },
    });
    const r = await api("PUT", `/v1/servicios/${s3.json.id}/asignacion`, {
      tenant: TENANT_A,
      body: { vehiculoId: VEH, conductorId: COND },
    });
    expect(r.status).toBe(200);
  });

  it("9) AISLAMIENTO multi-tenant: la Empresa B no ve nada de A (ADR-0008)", async () => {
    const servicios = await api("GET", "/v1/servicios", { tenant: TENANT_B });
    expect(servicios.status).toBe(200);
    expect(servicios.json.total).toBe(0);

    // El mismo vehículo consultado desde B no arrastra los documentos de A.
    const semaforo = await api("GET", `/v1/cumplimiento/vehiculos/${VEH}`, { tenant: TENANT_B });
    expect(semaforo.json.semaforo).toBe("Vigente");
    expect(semaforo.json.documentos).toHaveLength(0);
  });

  it("10) la agenda de A muestra los Servicios con su Asignación", async () => {
    const r = await api("GET", "/v1/servicios", { tenant: TENANT_A });
    expect(r.json.total).toBe(3);
    const asignados = r.json.items.filter((s: any) => s.asignacion);
    expect(asignados.length).toBe(2);
  });
});

describe("E2E API — ejecución OFFLINE del Conductor (spec-010, lado servidor)", () => {
  const OFF_COND = "cond-e2e-offline";
  let servicioId: string;

  /** Como el Conductor: el dev-auth deriva conductorId de x-usuario-id. */
  async function comoConductor(method: string, path: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": TENANT_A,
        "x-usuario-id": OFF_COND,
        "x-roles": "Conductor",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  }

  it("1) fixture: servicio asignado al conductor offline (vehículo ya rehabilitado)", async () => {
    const s = await api("POST", "/v1/servicios", {
      tenant: TENANT_A,
      body: {
        origen: "Bogotá",
        destino: "Sopó",
        ventana: { inicio: "2026-07-11T08:00:00Z", fin: "2026-07-11T11:00:00Z" },
      },
    });
    servicioId = s.json.id;
    const asig = await api("PUT", `/v1/servicios/${servicioId}/asignacion`, {
      tenant: TENANT_A,
      body: { vehiculoId: VEH, conductorId: OFF_COND },
    });
    expect(asig.status).toBe(200);
  });

  it("2) push del lote offline: iniciar 08:05 + finalizar 11:10 → confirmado x2", async () => {
    const r = await comoConductor("POST", "/v1/sync/push", {
      cambios: [
        {
          clientId: "11111111-0000-0000-0000-000000000001",
          entidad: "estado_servicio",
          operacion: "actualizar",
          payload: { servicioId, accion: "iniciar", odometro: 152000 },
          ocurridoEn: "2026-07-11T08:05:00Z",
        },
        {
          clientId: "11111111-0000-0000-0000-000000000002",
          entidad: "estado_servicio",
          operacion: "actualizar",
          payload: { servicioId, accion: "finalizar", odometro: 152180 },
          ocurridoEn: "2026-07-11T11:10:00Z",
        },
      ],
    });
    expect(r.status).toBe(201); // POST NestJS default; el contrato acepta el lote
    expect(r.json.resultados.map((x: any) => x.resultado)).toEqual(["confirmado", "confirmado"]);
  });

  it("3) reintento del MISMO lote (confirmación perdida) → duplicado x2, sin doble transición", async () => {
    const r = await comoConductor("POST", "/v1/sync/push", {
      cambios: [
        {
          clientId: "11111111-0000-0000-0000-000000000001",
          entidad: "estado_servicio",
          operacion: "actualizar",
          payload: { servicioId, accion: "iniciar" },
        },
        {
          clientId: "11111111-0000-0000-0000-000000000002",
          entidad: "estado_servicio",
          operacion: "actualizar",
          payload: { servicioId, accion: "finalizar" },
        },
      ],
    });
    expect(r.json.resultados.map((x: any) => x.resultado)).toEqual(["duplicado", "duplicado"]);
    const s = await api("GET", "/v1/servicios", { tenant: TENANT_A });
    const mio = s.json.items.find((x: any) => x.id === servicioId);
    expect(mio.estado).toBe("Finalizado");
    expect(mio.inicioReal).toBe("2026-07-11T08:05:00.000Z"); // la marca original del cliente
  });

  it("4) el admin intenta REABRIR el Servicio finalizado → 409, gana el estado del Conductor", async () => {
    const r = await api("POST", `/v1/servicios/${servicioId}/estado`, {
      tenant: TENANT_A,
      body: { accion: "iniciar" },
    });
    expect(r.status).toBe(409);
    expect(r.json.type).toBe("transicion_invalida");
  });

  it("5) pull 'mi día': el Conductor ve SUS servicios y los Documentos del Vehículo, con cursor", async () => {
    const r = await comoConductor("GET", "/v1/sync/pull");
    expect(r.status).toBe(200);
    expect(r.json.cursor).toBeTruthy();
    expect(r.json.servicios.map((s: any) => s.id)).toEqual([servicioId]); // solo lo suyo (R1)
    expect(r.json.documentos.map((d: any) => d.tipo)).toContain("SOAT");
    expect(r.json.documentos[0].estado).toBe("Vigente"); // el semáforo viaja en el Documento
    expect(r.json.vehiculos).toEqual([]); // Fleet llega con spec-003
  });
});

describe("E2E API — catálogo de Tipos configurable por tenant (spec-005 R2/R10)", () => {
  const TENANT_C = "tenant-catalogo";
  const VEH_C = "veh-cat-1";

  it("agrega un Tipo, lo lista, y rechaza el código duplicado con 409", async () => {
    const alta = await api("POST", "/v1/catalogo/tipos", {
      tenant: TENANT_C,
      body: { codigo: "RTM", aplicaA: "vehiculo", requerido: true },
    });
    expect(alta.status).toBe(201);
    expect(alta.json).toEqual({ codigo: "RTM", aplicaA: "vehiculo", requerido: true, activo: true });

    const lista = await api("GET", "/v1/catalogo/tipos", { tenant: TENANT_C });
    expect(lista.json.map((t: any) => t.codigo)).toEqual(["RTM"]);

    const dup = await api("POST", "/v1/catalogo/tipos", {
      tenant: TENANT_C,
      body: { codigo: "RTM", aplicaA: "vehiculo" },
    });
    expect(dup.status).toBe(409);
    expect(dup.json.type).toBe("tipo_documento_duplicado");
  });

  it("un Tipo REQUERIDO ausente pone el Semáforo en rojo (I3) y des-marcarlo lo libera", async () => {
    // RTM requerida (test anterior) y el vehículo no la tiene → rojo por ausencia.
    const rojo = await api("GET", `/v1/cumplimiento/vehiculos/${VEH_C}`, { tenant: TENANT_C });
    expect(rojo.json.semaforo).toBe("Vencido");

    const patch = await api("PATCH", "/v1/catalogo/tipos/RTM", {
      tenant: TENANT_C,
      body: { requerido: false },
    });
    expect(patch.status).toBe(200);
    expect(patch.json.requerido).toBe(false);

    const verde = await api("GET", `/v1/cumplimiento/vehiculos/${VEH_C}`, { tenant: TENANT_C });
    expect(verde.json.semaforo).toBe("Vigente");
  });

  it("PATCH de un Tipo inexistente devuelve 404; el catálogo es POR tenant", async () => {
    const r = await api("PATCH", "/v1/catalogo/tipos/NO-EXISTE", {
      tenant: TENANT_C,
      body: { activo: false },
    });
    expect(r.status).toBe(404);

    // El RTM de C no existe en el catálogo de A (aislamiento).
    const enA = await api("GET", "/v1/catalogo/tipos", { tenant: TENANT_A });
    expect(enA.json.map((t: any) => t.codigo)).not.toContain("RTM");
  });
});

describe("E2E API — bearerAuth con JWT HS256 (modo producción)", () => {
  const SECRETO = "secreto-e2e-suficientemente-largo";

  afterAll(() => {
    delete process.env.FLEETSPECIAL_JWT_SECRET;
  });

  it("con secreto activo: Bearer válido 200 con el tenant del claim; headers x-* 401", async () => {
    process.env.FLEETSPECIAL_JWT_SECRET = SECRETO;
    const token = firmarJwtHS256(
      { sub: "luis", tenant_id: TENANT_A, roles: ["Administrador"] },
      SECRETO,
      { expiraEnSegundos: 300 },
    );

    const conToken = await fetch(`${base}/v1/servicios`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(conToken.status).toBe(200);
    const cuerpo: any = await conToken.json();
    expect(cuerpo.total).toBeGreaterThan(0); // ve los servicios del tenant A (claim)

    const conHeaders = await api("GET", "/v1/servicios", { tenant: TENANT_A }); // x-tenant-id ya no vale
    expect(conHeaders.status).toBe(401);

    const tokenMalo = await fetch(`${base}/v1/servicios`, {
      headers: { Authorization: "Bearer token.claramente.falso" },
    });
    expect(tokenMalo.status).toBe(401);
  });

  it("al retirar el secreto, el modo dev por headers vuelve a operar", async () => {
    delete process.env.FLEETSPECIAL_JWT_SECRET;
    const r = await api("GET", "/v1/servicios", { tenant: TENANT_A });
    expect(r.status).toBe(200);
  });
});
