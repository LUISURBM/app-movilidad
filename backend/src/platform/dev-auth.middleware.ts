/**
 * Middleware de autenticación — bearerAuth del contrato con fallback de desarrollo.
 *
 * Modos (decidido por la env FLEETSPECIAL_JWT_SECRET):
 *  - CON secreto: SOLO se acepta `Authorization: Bearer <JWT HS256>` (claims
 *    sub/tenant_id/roles/exp — ver platform/jwt.ts). Los headers x-* se ignoran.
 *  - SIN secreto (dev): stand-in por headers, para operar antes del epic E0:
 *      x-tenant-id  (OBLIGATORIO → 401 si falta)
 *      x-usuario-id (opcional, default "dev")
 *      x-roles      (CSV, default "Operador")
 *
 * REGLA de producción que se conserva en ambos modos: el tenant JAMÁS viaja en el
 * body/query (ADR-0008); siempre sale del contexto de autenticación.
 */
import { Rol } from "./tenant-context";
import { verificarJwtHS256 } from "./jwt";

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  /** Express conserva aquí la URL completa aunque el middleware esté montado en un sub-path. */
  originalUrl?: string;
  tenantId?: string;
  usuarioId?: string;
  roles?: Rol[];
}

interface ResponseLike {
  status(code: number): ResponseLike;
  set(name: string, value: string): ResponseLike;
  send(body: unknown): void;
}

function rechazar401(res: ResponseLike): void {
  res
    .status(401)
    .set("Content-Type", "application/problem+json")
    .send({
      type: "no_autenticado",
      title: "Falta o es inválido el token de autenticación.",
      status: 401,
    });
}

export function devAuthMiddleware(req: RequestLike, res: ResponseLike, next: () => void): void {
  // El health check no requiere autenticación (probes de infraestructura).
  if ((req.originalUrl ?? req.url ?? "").split("?")[0].endsWith("/health")) {
    next();
    return;
  }

  const header = (name: string): string | undefined => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const secreto = process.env.FLEETSPECIAL_JWT_SECRET;

  // ── Modo JWT (producción/staging): solo Bearer. ──
  if (secreto) {
    const auth = header("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const claims = token ? verificarJwtHS256(token, secreto) : null;
    if (!claims) {
      rechazar401(res);
      return;
    }
    req.tenantId = claims.tenant_id;
    req.usuarioId = claims.sub;
    req.roles = (claims.roles ?? []) as Rol[];
    next();
    return;
  }

  // ── Modo DEV (sin secreto): stand-in por headers. ──
  const tenantId = header("x-tenant-id");
  if (!tenantId || !tenantId.trim()) {
    rechazar401(res);
    return;
  }

  req.tenantId = tenantId.trim();
  req.usuarioId = header("x-usuario-id")?.trim() || "dev";
  req.roles = (header("x-roles") ?? "Operador")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean) as Rol[];
  next();
}
