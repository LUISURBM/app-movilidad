"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  BASE_URL_POR_DEFECTO,
  ErrorApi,
  iniciarSesionConCredenciales,
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
 * Ingreso (spec-015): correo y contraseña contra POST /auth/login.
 * El modo "token" queda como avanzado (soporte/dev: token de token-dev.ts).
 */
export default function PaginaLogin() {
  const router = useRouter();
  const { iniciarSesion } = useSesion();
  const [modo, setModo] = useState<"credenciales" | "token">("credenciales");
  const [baseUrl, setBaseUrl] = useState(BASE_URL_POR_DEFECTO);
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [empresaNit, setEmpresaNit] = useState("");
  const [pedirNit, setPedirNit] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validando, setValidando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setValidando(true);
    const url = baseUrl.trim().replace(/\/$/, "");
    try {
      const sesion =
        modo === "credenciales"
          ? await iniciarSesionConCredenciales(url, {
              correo: correo.trim(),
              password,
              ...(pedirNit && empresaNit.trim() ? { empresaNit: empresaNit.trim() } : {}),
            })
          : await validarCredenciales(url, token.trim());
      iniciarSesion(sesion);
      router.replace("/");
    } catch (err) {
      if (err instanceof ErrorApi && err.problema?.type === "multiples_empresas") {
        setPedirNit(true);
      }
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

            {modo === "credenciales" ? (
              <>
                <Campo etiqueta="Correo" requerido>
                  <Entrada
                    type="email"
                    value={correo}
                    onChange={(e) => setCorreo(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </Campo>
                <Campo etiqueta="Contraseña" requerido>
                  <Entrada
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </Campo>
                {pedirNit ? (
                  <Campo etiqueta="NIT de la Empresa" requerido>
                    <Entrada
                      value={empresaNit}
                      onChange={(e) => setEmpresaNit(e.target.value)}
                      placeholder="900123456"
                      required
                    />
                  </Campo>
                ) : null}
              </>
            ) : (
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
            )}

            <ProblemAlert problema={error} />
            <BotonPrimario type="submit" disabled={validando} className="w-full">
              {validando ? "Validando…" : "Ingresar"}
            </BotonPrimario>
          </form>
        </Tarjeta>
        <button
          type="button"
          onClick={() => {
            setModo(modo === "credenciales" ? "token" : "credenciales");
            setError(null);
          }}
          className="mt-4 w-full text-center text-xs text-slate-400 hover:text-slate-600"
        >
          {modo === "credenciales"
            ? "¿Soporte o desarrollo? Ingresar con token"
            : "Volver al ingreso con correo y contraseña"}
        </button>
      </div>
    </main>
  );
}
