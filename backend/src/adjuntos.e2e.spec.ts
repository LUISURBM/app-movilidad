/**
 * E2E de ADJUNTOS (spec-005 R5/R11) por HTTP real sobre el AppModule completo:
 *
 *   catálogo → documento → PUT adjunto (PDF) 204 → GET devuelve los MISMOS bytes
 *   y Content-Type → tieneAdjunto=true → reemplazo → 413 (>5MB) → 422 (mime)
 *   → 404 (sin documento / sin adjunto) → aislamiento por tenant (ADR-0008)
 *   → renovar deja la nueva vigencia SIN adjunto (el histórico conserva el suyo).
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
let documentoId: string;

const PDF = Buffer.from("%PDF-1.4\n%adjunto de prueba FleetSpecial\n%%EOF\n");

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

async function subir(
  documento: string,
  cuerpo: Buffer,
  contentType: string,
  tenant = TENANT_A,
): Promise<Response> {
  return fetch(`${base}/v1/documentos/${documento}/adjunto`, {
    method: "PUT",
    headers: { "Content-Type": contentType, "x-tenant-id": tenant },
    body: new Uint8Array(cuerpo),
  });
}

beforeAll(async () => {
  app = configurarApp(await NestFactory.create(AppModule, { logger: false }));
  await app.listen(0);
  base = (await app.getUrl()).replace("[::1]", "127.0.0.1");

  const cat = await api("POST", "/v1/catalogo/tipos", {
    tenant: TENANT_A,
    body: { codigo: "SOAT", aplicaA: "vehiculo" },
  });
  if (cat.status !== 201) throw new Error(`catálogo: ${cat.status}`);

  const doc = await api("POST", "/v1/documentos", {
    tenant: TENANT_A,
    body: {
      sujeto: { tipo: "vehiculo", id: "veh-adj-1" },
      tipo: "SOAT",
      expedicion: "2026-01-01",
      vencimiento: "2027-01-01",
    },
  });
  if (doc.status !== 201) throw new Error(`documento: ${doc.status}`);
  documentoId = doc.json.id;
});

afterAll(async () => {
  await app.close();
});

describe("E2E spec-005 — adjuntos de documento", () => {
  it("PUT sube un PDF (204) y GET devuelve los mismos bytes con su Content-Type", async () => {
    const up = await subir(documentoId, PDF, "application/pdf");
    expect(up.status).toBe(204);

    const down = await fetch(`${base}/v1/documentos/${documentoId}/adjunto`, {
      headers: { "x-tenant-id": TENANT_A },
    });
    expect(down.status).toBe(200);
    expect(down.headers.get("content-type")).toContain("application/pdf");
    const bytes = Buffer.from(await down.arrayBuffer());
    expect(bytes.equals(PDF)).toBe(true);
  });

  it("el documento reporta tieneAdjunto=true", async () => {
    const r = await api("GET", `/v1/documentos/${documentoId}`, { tenant: TENANT_A });
    expect(r.status).toBe(200);
    expect(r.json.tieneAdjunto).toBe(true);
  });

  it("reemplazar cambia el contenido servido (última versión gana en la vigencia)", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("png-de-prueba"),
    ]);
    const up = await subir(documentoId, png, "image/png");
    expect(up.status).toBe(204);

    const down = await fetch(`${base}/v1/documentos/${documentoId}/adjunto`, {
      headers: { "x-tenant-id": TENANT_A },
    });
    expect(down.headers.get("content-type")).toContain("image/png");
    expect(Buffer.from(await down.arrayBuffer()).equals(png)).toBe(true);
  });

  it("413 cuando supera 5 MB", async () => {
    const grande = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);
    const up = await subir(documentoId, grande, "application/pdf");
    expect(up.status).toBe(413);
    const problema = (await up.json()) as { type?: string };
    expect(problema.type).toBe("adjunto_demasiado_grande");
  });

  it("422 cuando el tipo no está permitido", async () => {
    const up = await subir(documentoId, Buffer.from("#!/bin/sh"), "application/x-sh");
    expect(up.status).toBe(422);
    const problema = (await up.json()) as { type?: string };
    expect(problema.type).toBe("adjunto_tipo_no_permitido");
  });

  it("404 al subir a un documento inexistente", async () => {
    const up = await subir("doc-no-existe", PDF, "application/pdf");
    expect(up.status).toBe(404);
  });

  it("aislamiento por tenant: B no puede descargar el adjunto de A", async () => {
    const down = await fetch(`${base}/v1/documentos/${documentoId}/adjunto`, {
      headers: { "x-tenant-id": TENANT_B },
    });
    // Para B ese documento NO existe (repos aislados por tenant).
    expect(down.status).toBe(404);
  });

  it("renovar deja la nueva vigencia sin adjunto (el histórico conserva el suyo)", async () => {
    const ren = await api("POST", `/v1/documentos/${documentoId}/renovaciones`, {
      tenant: TENANT_A,
      body: { expedicion: "2027-01-01", vencimiento: "2028-01-01" },
    });
    expect(ren.status).toBe(201);

    const doc = await api("GET", `/v1/documentos/${documentoId}`, { tenant: TENANT_A });
    expect(doc.json.tieneAdjunto).toBe(false);

    const down = await fetch(`${base}/v1/documentos/${documentoId}/adjunto`, {
      headers: { "x-tenant-id": TENANT_A },
    });
    expect(down.status).toBe(404);
    expect(((await down.json()) as { type?: string }).type).toBe("adjunto_no_encontrado");
  });
});
