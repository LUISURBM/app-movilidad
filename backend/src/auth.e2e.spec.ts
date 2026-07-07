/**
 * E2E de spec-015 por HTTP real, CON SECRETO JWT (modo producción del middleware):
 *
 *   POST /tenants (password) → /auth/login → Bearer en /tenants/me
 *   → sin token 401 → credenciales malas 401 → invitar (código una sola vez)
 *   → /auth/aceptar-invitacion (sesión inmediata; código de un solo uso)
 *   → /auth/password → la vieja deja de servir → suspendido no entra (403).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configurarApp } from "./bootstrap";

const SECRETO = "secreto-e2e-auth";
const PASSWORD = "clave-segura-123";

let app: INestApplication;
let base: string;
let tokenAdmin = "";
let usuarioInvitadoId = "";
let codigoInvitacion = "";
let tokenAna = "";

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

beforeAll(async () => {
  process.env.FLEETSPECIAL_JWT_SECRET = SECRETO;
  app = configurarApp(await NestFactory.create(AppModule, { logger: false }));
  await app.listen(0);
  base = (await app.getUrl()).replace("[::1]", "127.0.0.1");
});

afterAll(async () => {
  delete process.env.FLEETSPECIAL_JWT_SECRET;
  await app.close();
});

describe("E2E spec-015 — autenticación con credenciales", () => {
  it("registra la Empresa con la contraseña del primer admin (público)", async () => {
    const r = await api("POST", "/v1/tenants", {
      body: {
        empresa: { razonSocial: "Transporte Duster SAS", nit: "900123456" },
        administrador: { nombre: "Luis", correo: "luis@duster.co", password: PASSWORD },
        aceptaTratamientoDatos: true,
      },
    });
    expect(r.status).toBe(201);
  });

  it("422 si la contraseña del registro es débil", async () => {
    const r = await api("POST", "/v1/tenants", {
      body: {
        empresa: { razonSocial: "Otra SAS" },
        administrador: { nombre: "X", correo: "x@otra.co", password: "corta" },
        aceptaTratamientoDatos: true,
      },
    });
    expect(r.status).toBe(422);
    expect(r.json.type).toBe("password_debil");
  });

  it("login del admin devuelve token y el token abre la API", async () => {
    const login = await api("POST", "/v1/auth/login", {
      body: { correo: "luis@duster.co", password: PASSWORD },
    });
    expect(login.status).toBe(200);
    expect(login.json.tenant.razonSocial).toBe("Transporte Duster SAS");
    expect(login.json.usuario.roles).toContain("Administrador");
    tokenAdmin = login.json.token;

    const me = await api("GET", "/v1/tenants/me", { token: tokenAdmin });
    expect(me.status).toBe(200);
    expect(me.json.razonSocial).toBe("Transporte Duster SAS");
  });

  it("sin token la API rechaza (modo JWT del middleware)", async () => {
    const r = await api("GET", "/v1/tenants/me");
    expect(r.status).toBe(401);
  });

  it("credenciales inválidas: mismo 401 para correo inexistente y clave errada", async () => {
    const inexistente = await api("POST", "/v1/auth/login", {
      body: { correo: "nadie@x.co", password: PASSWORD },
    });
    const errada = await api("POST", "/v1/auth/login", {
      body: { correo: "luis@duster.co", password: "mala-clave-000" },
    });
    expect(inexistente.status).toBe(401);
    expect(errada.status).toBe(401);
    expect(inexistente.json.type).toBe("credenciales_invalidas");
    expect(errada.json.type).toBe("credenciales_invalidas");
  });

  it("invitar devuelve el código UNA sola vez", async () => {
    const r = await api("POST", "/v1/usuarios", {
      token: tokenAdmin,
      body: { nombre: "Ana", correo: "ana@duster.co", roles: ["Operador"] },
    });
    expect(r.status).toBe(201);
    expect(r.json.estado).toBe("invitado");
    expect(typeof r.json.invitacion).toBe("string");
    usuarioInvitadoId = r.json.id;
    codigoInvitacion = r.json.invitacion;
  });

  it("aceptar la invitación activa a Ana y le da sesión; el código es de un solo uso", async () => {
    const r = await api("POST", "/v1/auth/aceptar-invitacion", {
      body: { codigo: codigoInvitacion, password: "clave-de-ana-77" },
    });
    expect(r.status).toBe(200);
    expect(r.json.usuario.estado).toBe("activo");
    tokenAna = r.json.token;

    const repetido = await api("POST", "/v1/auth/aceptar-invitacion", {
      body: { codigo: codigoInvitacion, password: "clave-de-ana-77" },
    });
    expect(repetido.status).toBe(410);

    const me = await api("GET", "/v1/tenants/me", { token: tokenAna });
    expect(me.status).toBe(200);
  });

  it("cambio de contraseña: la nueva sirve, la vieja no", async () => {
    const cambio = await api("POST", "/v1/auth/password", {
      token: tokenAna,
      body: { actual: "clave-de-ana-77", nueva: "clave-nueva-de-ana" },
    });
    expect(cambio.status).toBe(204);

    const vieja = await api("POST", "/v1/auth/login", {
      body: { correo: "ana@duster.co", password: "clave-de-ana-77" },
    });
    expect(vieja.status).toBe(401);

    const nueva = await api("POST", "/v1/auth/login", {
      body: { correo: "ana@duster.co", password: "clave-nueva-de-ana" },
    });
    expect(nueva.status).toBe(200);
  });

  it("una usuaria suspendida no puede iniciar sesión (403)", async () => {
    const patch = await api("PATCH", `/v1/usuarios/${usuarioInvitadoId}`, {
      token: tokenAdmin,
      body: { estado: "suspendido" },
    });
    expect(patch.status).toBe(200);

    const login = await api("POST", "/v1/auth/login", {
      body: { correo: "ana@duster.co", password: "clave-nueva-de-ana" },
    });
    expect(login.status).toBe(403);
    expect(login.json.type).toBe("usuario_no_activo");
  });
});
