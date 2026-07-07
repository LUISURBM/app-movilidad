"use client";

/**
 * Sesión y acceso a la API del portal.
 *
 * Autenticación v0 (deuda consciente, ver README): el portal recibe un JWT ya
 * emitido (en dev: `backend/tool/token-dev.ts`) y lo valida contra
 * `GET /tenants/me`. No hay endpoint de login con credenciales en el contrato
 * todavía (spec futura); cuando exista, solo cambia esta capa.
 *
 * El tenant NUNCA se envía por el cliente: el backend lo deriva del JWT.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createFleetSpecialClient,
  type FleetSpecialClient,
  type schemas,
} from "@fleetspecial/api";
import { problemaAMensaje } from "@/lib/format";

export interface Sesion {
  /** URL base de la API incluyendo el prefijo, p. ej. http://localhost:3000/v1 */
  baseUrl: string;
  token: string;
  razonSocial: string;
  plan: string;
  /** Roles del usuario (spec-015). Ausente en el modo token (se muestra todo). */
  roles?: string[];
}

const CLAVE_SESION = "fleetspecial.sesion";

export const BASE_URL_POR_DEFECTO = "http://localhost:3000/v1";

function leerSesion(): Sesion | null {
  if (typeof window === "undefined") return null;
  try {
    const crudo = window.localStorage.getItem(CLAVE_SESION);
    if (!crudo) return null;
    const s = JSON.parse(crudo) as Partial<Sesion>;
    if (!s.baseUrl || !s.token) return null;
    return {
      baseUrl: s.baseUrl,
      token: s.token,
      razonSocial: s.razonSocial ?? "",
      plan: s.plan ?? "",
    };
  } catch {
    return null;
  }
}

interface ContextoSesion {
  /** null = sin sesión; undefined = aún hidratando desde localStorage. */
  sesion: Sesion | null | undefined;
  iniciarSesion: (s: Sesion) => void;
  cerrarSesion: () => void;
}

const SesionContext = createContext<ContextoSesion | null>(null);

export function SesionProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null | undefined>(undefined);

  useEffect(() => {
    setSesion(leerSesion());
  }, []);

  const iniciarSesion = useCallback((s: Sesion) => {
    window.localStorage.setItem(CLAVE_SESION, JSON.stringify(s));
    setSesion(s);
  }, []);

  const cerrarSesion = useCallback(() => {
    window.localStorage.removeItem(CLAVE_SESION);
    setSesion(null);
  }, []);

  const valor = useMemo(
    () => ({ sesion, iniciarSesion, cerrarSesion }),
    [sesion, iniciarSesion, cerrarSesion],
  );

  return (
    <SesionContext.Provider value={valor}>{children}</SesionContext.Provider>
  );
}

export function useSesion(): ContextoSesion {
  const ctx = useContext(SesionContext);
  if (!ctx) throw new Error("useSesion requiere <SesionProvider>");
  return ctx;
}

/** Cliente tipado contra el contrato. Requiere sesión activa. */
export function useApi(): FleetSpecialClient {
  const { sesion } = useSesion();
  return useMemo(() => {
    return createFleetSpecialClient({
      baseUrl: sesion?.baseUrl ?? BASE_URL_POR_DEFECTO,
      getToken: () => sesion?.token ?? null,
    });
  }, [sesion?.baseUrl, sesion?.token]);
}

/**
 * Login real (spec-015): correo + contraseña → sesión con el JWT emitido.
 * Lanza ErrorApi (con el Problem) para que la UI distinga p. ej.
 * `multiples_empresas` (pedir NIT) de `credenciales_invalidas`.
 */
export async function iniciarSesionConCredenciales(
  baseUrl: string,
  cuerpo: { correo: string; password: string; empresaNit?: string },
): Promise<Sesion> {
  const api = createFleetSpecialClient({ baseUrl });
  let r;
  try {
    r = await api.POST("/auth/login", { body: cuerpo });
  } catch {
    throw new Error(
      "No se pudo contactar la API. Verifique la URL y que el backend esté encendido.",
    );
  }
  if (r.error !== undefined || !r.data) {
    throw new ErrorApi(
      (r.error ?? null) as schemas["Problem"] | null,
      r.response?.status,
    );
  }
  return {
    baseUrl,
    token: r.data.token,
    razonSocial: r.data.tenant.razonSocial,
    plan: "",
    roles: r.data.usuario.roles,
  };
}

/**
 * RBAC visual: el backend hace cumplir los permisos (403); esto solo evita
 * mostrar secciones/acciones que van a fallar. Sin roles (modo token) se
 * muestra todo.
 */
export function useEsAdministrador(): boolean {
  const { sesion } = useSesion();
  return !sesion?.roles || sesion.roles.includes("Administrador");
}

/**
 * Valida un token contra la API consultando el tenant actual.
 * Devuelve la sesión lista para guardar, o lanza con mensaje legible.
 */
export async function validarCredenciales(
  baseUrl: string,
  token: string,
): Promise<Sesion> {
  const api = createFleetSpecialClient({ baseUrl, getToken: () => token });
  let respuesta;
  try {
    respuesta = await api.GET("/tenants/me");
  } catch {
    throw new Error(
      "No se pudo contactar la API. Verifique la URL y que el backend esté encendido.",
    );
  }
  if (respuesta.error || !respuesta.data) {
    throw new Error(
      respuesta.response.status === 401
        ? "Token inválido o expirado."
        : `La API respondió ${respuesta.response.status}.`,
    );
  }
  return {
    baseUrl,
    token,
    razonSocial: respuesta.data.razonSocial,
    plan: respuesta.data.plan,
  };
}

/** Error de API que conserva el Problem (RFC 7807) para la UI. */
export class ErrorApi extends Error {
  problema: schemas["Problem"] | null;
  constructor(problema?: schemas["Problem"] | null, status?: number) {
    super(
      problemaAMensaje(
        problema ?? null,
        status ? `La API respondió ${status}.` : "Ocurrió un error.",
      ),
    );
    this.name = "ErrorApi";
    this.problema = problema ?? null;
  }
}

/**
 * Desenvuelve una respuesta de openapi-fetch: data o lanza ErrorApi.
 * Uso: `const pagina = desenvolver(await api.GET("/vehiculos", …));`
 */
export function desenvolver<T>(r: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  if (r.error !== undefined || r.data === undefined) {
    throw new ErrorApi(
      (r.error ?? null) as schemas["Problem"] | null,
      r.response?.status,
    );
  }
  return r.data;
}

/** Extrae el Problem de un error lanzado por una mutación/consulta. */
export function problemaDe(err: unknown): schemas["Problem"] | string | null {
  if (err instanceof ErrorApi) return err.problema ?? err.message;
  if (err instanceof Error) return err.message;
  return err ? String(err) : null;
}

/** Proveedor raíz: sesión + caché de datos de servidor (TanStack Query). */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  return (
    <SesionProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </SesionProvider>
  );
}
