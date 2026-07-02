/**
 * JWT HS256 mínimo y SIN dependencias (node:crypto) — puente hacia el bearerAuth
 * del contrato mientras llega la identidad completa del epic E0 (spec-001/002,
 * que traerá OIDC/rotación). Un secreto compartido (env) firma y verifica.
 *
 * Claims esperados (contrato openapi.yaml, securitySchemes.bearerAuth):
 *   sub        id del usuario
 *   tenant_id  tenant del request (NUNCA del body — ADR-0008)
 *   roles      arreglo de roles
 *   exp / nbf  segundos UNIX
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface JwtClaims {
  sub: string;
  tenant_id: string;
  roles: string[];
  exp?: number; // UNIX seconds
  nbf?: number;
  [k: string]: unknown;
}

const b64url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const deB64url = (s: string): Buffer => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
};

const firma = (contenido: string, secreto: string): Buffer =>
  createHmac("sha256", secreto).update(contenido).digest();

/** Firma un JWT HS256. Útil para pruebas y para emitir tokens de dev. */
export function firmarJwtHS256(
  claims: JwtClaims,
  secreto: string,
  opts: { expiraEnSegundos?: number; ahora?: Date } = {},
): string {
  const ahora = Math.floor((opts.ahora ?? new Date()).getTime() / 1000);
  const payload: JwtClaims = {
    ...claims,
    ...(opts.expiraEnSegundos ? { exp: ahora + opts.expiraEnSegundos } : {}),
  };
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(firma(`${header}.${body}`, secreto));
  return `${header}.${body}.${sig}`;
}

/**
 * Verifica un JWT HS256: firma (comparación de tiempo constante), alg, exp y nbf.
 * Devuelve los claims si es válido; null en cualquier otro caso (falla cerrado).
 */
export function verificarJwtHS256(token: string, secreto: string, ahora = new Date()): JwtClaims | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  const [h, p, s] = partes;

  try {
    const header = JSON.parse(deB64url(h).toString("utf8")) as { alg?: string };
    if (header.alg !== "HS256") return null; // no aceptar "none" ni otros algs

    const esperada = firma(`${h}.${p}`, secreto);
    const recibida = deB64url(s);
    if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;

    const claims = JSON.parse(deB64url(p).toString("utf8")) as JwtClaims;
    const t = Math.floor(ahora.getTime() / 1000);
    if (typeof claims.exp === "number" && t >= claims.exp) return null; // expirado
    if (typeof claims.nbf === "number" && t < claims.nbf) return null; // aún no válido
    if (!claims.tenant_id || !claims.sub) return null; // claims mínimos del contrato

    return claims;
  } catch {
    return null;
  }
}
