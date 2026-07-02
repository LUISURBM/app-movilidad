/**
 * SDK tipado de FleetSpecial — cliente HTTP generado a partir del contrato OpenAPI.
 *
 * API First: este cliente NO inventa tipos; los importa de `schema.d.ts`, que se
 * regenera desde `backend/contracts/openapi.yaml` (script `npm run gen:api`).
 *
 * Envuelve `openapi-fetch` y añade las convenciones del contrato (Fase 5):
 *  - Bearer JWT (el tenant se deriva del token en el backend; nunca se envía en el body).
 *  - Cabecera `Idempotency-Key` para escrituras reintentables (offline-first).
 *  - Base URL configurable por entorno (prod / staging / local / mock).
 *
 * Uso:
 *   const api = createFleetSpecialClient({ baseUrl: 'http://localhost:4010', getToken: () => token });
 *   const { data, error } = await api.GET('/vehiculos', { params: { query: { page: 1 } } });
 */
import createClient, { type Client, type ClientOptions } from "openapi-fetch";
import type { paths, components } from "./schema";

/** Re-export de los tipos del dominio del contrato, para consumo cómodo en la app. */
export type schemas = components["schemas"];
export type Vehiculo = schemas["Vehiculo"];
export type Conductor = schemas["Conductor"];
export type Documento = schemas["Documento"];
export type Servicio = schemas["Servicio"];
export type Tanqueo = schemas["Tanqueo"];
export type EstadoCumplimiento = schemas["EstadoCumplimiento"];
export type Problem = schemas["Problem"];
export type { paths, components };

export interface FleetSpecialClientOptions {
  /** URL base de la API, incluyendo el prefijo de versión, p. ej. `https://api.fleetspecial.co/v1`. */
  baseUrl: string;
  /**
   * Provee el JWT actual (o null si no hay sesión). Se evalúa en cada request,
   * de modo que el cliente sigue funcionando tras refrescar el token.
   */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Cabeceras adicionales por defecto (opcional). */
  headers?: Record<string, string>;
  /** Permite inyectar un fetch personalizado (tests, RN, etc.). */
  fetch?: ClientOptions["fetch"];
}

/** Genera un UUID v4 para usar como `Idempotency-Key` desde el dispositivo. */
export function newIdempotencyKey(): string {
  // Usa crypto.randomUUID cuando está disponible (navegador/Node moderno/RN reciente).
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback simple (no criptográficamente fuerte, suficiente para idempotencia).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Cliente tipado de FleetSpecial. */
export type FleetSpecialClient = Client<paths>;

/**
 * Crea un cliente tipado contra el contrato OpenAPI de FleetSpecial.
 *
 * Inyecta automáticamente `Authorization: Bearer <jwt>` cuando `getToken` devuelve un valor.
 */
export function createFleetSpecialClient(
  options: FleetSpecialClientOptions,
): FleetSpecialClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    headers: options.headers,
  });

  // Middleware: añade el Bearer token en cada request.
  client.use({
    async onRequest({ request }) {
      const token = options.getToken ? await options.getToken() : undefined;
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      return request;
    },
  });

  return client;
}

/**
 * Helper para escrituras idempotentes (offline-first): adjunta `Idempotency-Key`.
 *
 * Ejemplo:
 *   await api.POST('/combustible', withIdempotency({ body: tanqueo }, clientUuid));
 */
export function withIdempotency<T extends { headers?: Record<string, string> }>(
  init: T,
  key: string = newIdempotencyKey(),
): T {
  return {
    ...init,
    headers: { ...(init.headers ?? {}), "Idempotency-Key": key },
  };
}
