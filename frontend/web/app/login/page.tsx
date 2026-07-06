"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  BASE_URL_POR_DEFECTO,
  useSesion,
  validarCredenciales,
} from "@/lib/api";
import {
  BotonPrimario,
  Campo,
  Entrada,
  ProblemAlert,
  Tarjeta,
} from "@/shared/ui";

/**
 * Ingreso v0: URL de la API + token de acceso (JWT).
 * En dev el token se genera con `backend/tool/token-dev.ts` (rol Operador/Admin).
 * Cuando el contrato incorpore login con credenciales, esta pantalla lo adopta.
 */
export default function PaginaLogin() {
  const router = useRouter();
  const { iniciarSesion } = useSesion();
  const [baseUrl, setBaseUrl] = useState(BASE_URL_POR_DEFECTO);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validando, setValidando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setValidando(true);
    try {
      const sesion = await validarCredenciales(baseUrl.trim().replace(/\/$/, ""), token.trim());
      iniciarSesion(sesion);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setValidando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-marca-600 text-lg font-bold text-white">
            F
          </div>
          <h1 className="text-xl font-semibold tracking-tight">FleetSpecial</h1>
          <p className="mt-1 text-sm text-slate-500">Portal administrativo</p>
        </div>
        <Tarjeta className="p-5">
          <form onSubmit={enviar} className="space-y-4">
            <Campo etiqueta="URL de la API" requerido>
              <Entrada
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={BASE_URL_POR_DEFECTO}
                required
              />
            </Campo>
            <Campo etiqueta="Token de acceso" requerido>
              <Entrada
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Pegue aquí su token (JWT)"
                required
                autoComplete="off"
              />
            </Campo>
            <ProblemAlert problema={error} />
            <BotonPrimario type="submit" disabled={validando} className="w-full">
              {validando ? "Validando…" : "Ingresar"}
            </BotonPrimario>
          </form>
        </Tarjeta>
        <p className="mt-4 text-center text-xs text-slate-400">
          En desarrollo, genere el token con <code>backend/tool/token-dev.ts</code>.
        </p>
      </div>
    </main>
  );
}
