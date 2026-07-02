/**
 * Pruebas del JWT HS256 (bearerAuth del contrato) y del middleware de auth:
 * firma/verificación, expiración, manipulación, y precedencia Bearer vs headers dev.
 */
import { describe, it, expect, afterEach } from "vitest";
import { firmarJwtHS256, verificarJwtHS256 } from "./jwt";
import { devAuthMiddleware } from "./dev-auth.middleware";

const SECRETO = "secreto-de-prueba-largo-y-aleatorio";
const AHORA = new Date("2026-07-02T12:00:00Z");

const claims = { sub: "user-1", tenant_id: "tenant-duster", roles: ["Operador"] };

describe("verificarJwtHS256 — falla cerrado", () => {
  it("firma y verifica un token válido con claims del contrato", () => {
    const token = firmarJwtHS256(claims, SECRETO, { expiraEnSegundos: 3600, ahora: AHORA });
    const v = verificarJwtHS256(token, SECRETO, AHORA);
    expect(v).not.toBeNull();
    expect(v!.tenant_id).toBe("tenant-duster");
    expect(v!.sub).toBe("user-1");
    expect(v!.roles).toEqual(["Operador"]);
  });

  it("rechaza un token con firma de OTRO secreto", () => {
    const token = firmarJwtHS256(claims, "otro-secreto", { expiraEnSegundos: 3600, ahora: AHORA });
    expect(verificarJwtHS256(token, SECRETO, AHORA)).toBeNull();
  });

  it("rechaza un token EXPIRADO", () => {
    const token = firmarJwtHS256(claims, SECRETO, { expiraEnSegundos: 60, ahora: AHORA });
    const despues = new Date(AHORA.getTime() + 61_000);
    expect(verificarJwtHS256(token, SECRETO, despues)).toBeNull();
  });

  it("rechaza payload MANIPULADO (cambiar tenant_id invalida la firma)", () => {
    const token = firmarJwtHS256(claims, SECRETO, { expiraEnSegundos: 3600, ahora: AHORA });
    const [h, , s] = token.split(".");
    const otroPayload = Buffer.from(JSON.stringify({ ...claims, tenant_id: "tenant-ajeno" }))
      .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(verificarJwtHS256(`${h}.${otroPayload}.${s}`, SECRETO, AHORA)).toBeNull();
  });

  it("rechaza tokens malformados y sin claims mínimos", () => {
    expect(verificarJwtHS256("no-es-un-jwt", SECRETO, AHORA)).toBeNull();
    expect(verificarJwtHS256("a.b", SECRETO, AHORA)).toBeNull();
    const sinTenant = firmarJwtHS256({ sub: "u", tenant_id: "", roles: [] }, SECRETO, { ahora: AHORA });
    expect(verificarJwtHS256(sinTenant, SECRETO, AHORA)).toBeNull();
  });
});

describe("devAuthMiddleware — Bearer y fallback de headers", () => {
  afterEach(() => {
    delete process.env.FLEETSPECIAL_JWT_SECRET;
  });

  function correr(headers: Record<string, string>, url = "/v1/servicios") {
    const req: any = { headers, url, originalUrl: url };
    let statusCode = 0;
    let enviado: unknown;
    const res: any = {
      status(c: number) { statusCode = c; return this; },
      set() { return this; },
      send(b: unknown) { enviado = b; },
    };
    let paso = false;
    devAuthMiddleware(req, res, () => { paso = true; });
    return { req, statusCode, enviado, paso };
  }

  it("con FLEETSPECIAL_JWT_SECRET: un Bearer válido fija tenant/usuario/roles desde los claims", () => {
    process.env.FLEETSPECIAL_JWT_SECRET = SECRETO;
    const token = firmarJwtHS256(claims, SECRETO, { expiraEnSegundos: 3600 });
    const r = correr({ authorization: `Bearer ${token}` });
    expect(r.paso).toBe(true);
    expect(r.req.tenantId).toBe("tenant-duster");
    expect(r.req.usuarioId).toBe("user-1");
    expect(r.req.roles).toEqual(["Operador"]);
  });

  it("con secreto definido, los headers x-tenant-id YA NO autentican (401)", () => {
    process.env.FLEETSPECIAL_JWT_SECRET = SECRETO;
    const r = correr({ "x-tenant-id": "tenant-duster" });
    expect(r.paso).toBe(false);
    expect(r.statusCode).toBe(401);
  });

  it("con secreto definido, un Bearer inválido devuelve 401", () => {
    process.env.FLEETSPECIAL_JWT_SECRET = SECRETO;
    const r = correr({ authorization: "Bearer basura.claramente.invalida" });
    expect(r.paso).toBe(false);
    expect(r.statusCode).toBe(401);
  });

  it("SIN secreto (dev), los headers siguen funcionando como stand-in", () => {
    const r = correr({ "x-tenant-id": "tenant-duster", "x-usuario-id": "luis", "x-roles": "Administrador" });
    expect(r.paso).toBe(true);
    expect(r.req.tenantId).toBe("tenant-duster");
    expect(r.req.roles).toEqual(["Administrador"]);
  });

  it("/health pasa sin autenticación en ambos modos", () => {
    process.env.FLEETSPECIAL_JWT_SECRET = SECRETO;
    const r = correr({}, "/v1/health");
    expect(r.paso).toBe(true);
  });
});
