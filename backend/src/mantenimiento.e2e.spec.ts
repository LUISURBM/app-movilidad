/**
 * E2E de spec-012 por HTTP REAL — mantenimiento end-to-end sobre el AppModule
 * completo (misma configuración de main.ts vía configurarApp):
 *
 *   registrar Vehículo → PUT umbral (cada 10.000 km, base 140.000)
 *   → POST odómetro 152.000 (Fleet) → el preventivo queda PENDIENTE (costura P6)
 *   → POST ejecución (reinicia ciclo R6: base 152.000, pendiente=false)
 *   → POST correctivo 201 (R7) → validaciones 422 y aislamiento por tenant.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configurarApp } from "./bootstrap";

const TENANT_A = "tenant-duster";
const TENANT_B = "tenant-otro";

let app: INestApplication;
let base: string;
let vehiculoId: string;

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
  await app.listen(0);
  base = (await app.getUrl()).replace("[::1]", "127.0.0.1");

  const r = await api("POST", "/v1/vehiculos", {
    tenant: TENANT_A,
    body: { placa: "MNT123", clase: "camioneta", odometroInicial: 149000 },
  });
  if (r.status !== 201) throw new Error(`No se pudo registrar el vehículo: ${r.status}`);
  vehiculoId = r.json.id;
});

afterAll(async () => {
  await app.close();
});

describe("E2E spec-012 — mantenimiento preventivo por Umbral", () => {
  it("PUT /mantenimiento/umbrales/{vehiculoId} define el Umbral", async () => {
    const r = await api("PUT", `/v1/mantenimiento/umbrales/${vehiculoId}`, {
      tenant: TENANT_A,
      body: { cadaKm: 10000, baseKm: 140000 },
    });
    expect(r.status).toBe(200);
    expect(r.json.vehiculoId).toBe(vehiculoId);
    expect(r.json.baseKm).toBe(140000);
    expect(r.json.pendiente).toBe(false);
  });

  it("422 si el Umbral no trae criterio (ni km ni meses)", async () => {
    const r = await api("PUT", `/v1/mantenimiento/umbrales/${vehiculoId}`, {
      tenant: TENANT_A,
      body: {},
    });
    expect(r.status).toBe(422);
    expect(r.json.type).toBe("umbral_sin_criterio");
  });

  it("el avance del odómetro por Fleet programa el preventivo (costura P6)", async () => {
    const odo = await api("POST", `/v1/vehiculos/${vehiculoId}/odometro`, {
      tenant: TENANT_A,
      body: { lectura: 152000, fuente: "manual" },
    });
    expect(odo.status).toBe(201);

    const r = await api("GET", "/v1/mantenimiento/umbrales", { tenant: TENANT_A });
    expect(r.status).toBe(200);
    const umbral = r.json.find((u: any) => u.vehiculoId === vehiculoId);
    expect(umbral?.pendiente).toBe(true); // programado al superar 150.000
  });

  it("otro tenant no ve el Umbral (aislamiento ADR-0008)", async () => {
    const r = await api("GET", "/v1/mantenimiento/umbrales", { tenant: TENANT_B });
    expect(r.status).toBe(200);
    expect(r.json).toHaveLength(0);
  });

  it("registrar la ejecución reinicia el ciclo (R6)", async () => {
    const r = await api("POST", "/v1/mantenimiento/ejecuciones", {
      tenant: TENANT_A,
      body: { vehiculoId, odometro: 152000, costo: { moneda: "COP", valor: 350000 } },
    });
    expect(r.status).toBe(200);
    expect(r.json.baseKm).toBe(152000);
    expect(r.json.pendiente).toBe(false);
    expect(r.json.vencido).toBe(false);
  });

  it("404 al registrar ejecución sin Umbral definido", async () => {
    const r = await api("POST", "/v1/mantenimiento/ejecuciones", {
      tenant: TENANT_B,
      body: { vehiculoId: "veh-sin-umbral", odometro: 100, costo: { moneda: "COP", valor: 1000 } },
    });
    expect(r.status).toBe(404);
    expect(r.json.type).toBe("umbral_no_encontrado");
  });

  it("el correctivo reactivo queda registrado (R7)", async () => {
    const r = await api("POST", "/v1/mantenimiento/correctivos", {
      tenant: TENANT_A,
      body: { vehiculoId, odometro: 152400, costo: { moneda: "COP", valor: 480000 } },
    });
    expect(r.status).toBe(201);
    expect(r.json.mantenimientoId).toBeTruthy();
  });

  it("422 si el costo del correctivo no es positivo", async () => {
    const r = await api("POST", "/v1/mantenimiento/correctivos", {
      tenant: TENANT_A,
      body: { vehiculoId, odometro: 152500, costo: { moneda: "COP", valor: 0 } },
    });
    expect(r.status).toBe(422);
    expect(r.json.type).toBe("costo_invalido");
  });

  it("tras la ejecución, superar el NUEVO umbral vuelve a programar", async () => {
    const odo = await api("POST", `/v1/vehiculos/${vehiculoId}/odometro`, {
      tenant: TENANT_A,
      body: { lectura: 162000, fuente: "manual" },
    });
    expect(odo.status).toBe(201);

    const r = await api("GET", "/v1/mantenimiento/umbrales", { tenant: TENANT_A });
    const umbral = r.json.find((u: any) => u.vehiculoId === vehiculoId);
    expect(umbral?.pendiente).toBe(true); // 152.000 + 10.000 = 162.000 alcanzado
  });
});
