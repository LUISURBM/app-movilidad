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
  const [modo, setModo] = useState<
    "credenciales" | "token" | "recuperar" | "restablecer"
  >("credenciales");
  const [codigoRecuperacion, setCodigoRecuperacion] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
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
    setAviso(null);
    setValidando(true);
    const url = baseUrl.trim().replace(/\/$/, "");
    try {
      if (modo === "recuperar") {
        // spec-015 recuperación: 204 siempre (anti-enumeración).
        const res = await fetch(`${url}/auth/recuperar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ correo: correo.trim() }),
        });
        if (!res.ok) throw new Error("No se pudo solicitar la recuperación. Intente más tarde.");
        setModo("restablecer");
        setAviso("Si el correo existe, llegará un código (vence en 1 hora). Péguelo abajo.");
        return;
      }
      if (modo === "restablecer") {
        const res = await fetch(`${url}/auth/restablecer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codigo: codigoRecuperacion.trim(), password }),
        });
        if (res.status === 410) throw new Error("El código no existe, ya fue usado o venció.");
        if (!res.ok) throw new Error("No se pudo restablecer (revise la contraseña: mínimo 10 caracteres).");
        setModo("credenciales");
        setCodigoRecuperacion("");
        setPassword("");
        setAviso("Contraseña restablecida: ingrese con la nueva.");
        return;
      }
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

            {modo === "recuperar" ? (
              <Campo etiqueta="Correo de su cuenta" requerido>
                <Entrada
                  type="email"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  required
                />
              </Campo>
            ) : null}
            {modo === "restablecer" ? (
              <>
                <Campo etiqueta="Código recibido por correo" requerido>
                  <Entrada
                    value={codigoRecuperacion}
                    onChange={(e) => setCodigoRecuperacion(e.target.value)}
                    required
                  />
                </Campo>
                <Campo etiqueta="Contraseña nueva (mínimo 10 caracteres)" requerido>
                  <Entrada
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={10}
                    required
                  />
                </Campo>
              </>
            ) : null}
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

            {aviso ? (
              <p className="rounded-lg border border-green-200 bg-green-50 px-3.5 py-2.5 text-sm text-green-800">
                {aviso}
              </p>
            ) : null}
            <ProblemAlert problema={error} />
            <BotonPrimario type="submit" disabled={validando} className="w-full">
              {validando
                ? "Procesando…"
                : modo === "recuperar"
                  ? "Enviar código"
                  : modo === "restablecer"
                    ? "Restablecer"
                    : "Ingresar"}
            </BotonPrimario>
          </form>
        </Tarjeta>
        {modo === "credenciales" ? (
          <button
            type="button"
            onClick={() => {
              setModo("recuperar");
              setError(null);
              setAviso(null);
            }}
            className="mt-3 w-full text-center text-xs text-slate-500 hover:text-slate-700"
          >
            ¿Olvidó su contraseña?
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setModo(modo === "credenciales" ? "token" : "credenciales");
            setError(null);
            setAviso(null);
          }}
          className="mt-3 w-full text-center text-xs text-slate-400 hover:text-slate-600"
        >
          {modo === "credenciales"
            ? "¿Soporte o desarrollo? Ingresar con token"
            : "Volver al ingreso con correo y contraseña"}
        </button>
      </div>
    </main>
  );
}
