"use client";

/**
 * Design system mínimo del portal (shared/ui, docs/09 §4).
 * Piezas sobrias reutilizadas por todas las features; el color fuerte
 * lo pone el Semáforo (lenguaje ubicuo de Compliance).
 */

import { useEffect, type ReactNode } from "react";
import type { schemas } from "@fleetspecial/api";
import { problemaAMensaje } from "@/lib/format";

type Semaforo = schemas["Semaforo"];
type Problem = schemas["Problem"];

/* ---------------------------------- Semáforo --------------------------------- */

const ESTILO_SEMAFORO: Record<Semaforo, { css: string; texto: string; punto: string }> = {
  Vigente: { css: "bg-green-50 text-green-700 ring-green-600/20", texto: "Vigente", punto: "bg-green-500" },
  PorVencer: { css: "bg-amber-50 text-amber-700 ring-amber-600/20", texto: "Por vencer", punto: "bg-amber-500" },
  Vencido: { css: "bg-red-50 text-red-700 ring-red-600/20", texto: "Vencido", punto: "bg-red-500" },
};

/** Insignia del Semáforo de cumplimiento (Verde/Amarillo/Rojo). */
export function SemaforoBadge({ estado }: { estado?: Semaforo | null }) {
  if (!estado) {
    return <span className="text-xs text-slate-400">Sin datos</span>;
  }
  const s = ESTILO_SEMAFORO[estado];
  return (
    <span
      data-testid="semaforo"
      data-estado={estado}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.css}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.punto}`} />
      {s.texto}
    </span>
  );
}

/* ----------------------------------- Página ---------------------------------- */

export function Encabezado({
  titulo,
  descripcion,
  accion,
}: {
  titulo: string;
  descripcion?: string;
  accion?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>
        {descripcion ? <p className="mt-1 text-sm text-slate-500">{descripcion}</p> : null}
      </div>
      {accion}
    </div>
  );
}

export function Tarjeta({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Vacio({ mensaje, hijos }: { mensaje: string; hijos?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="text-sm text-slate-500">{mensaje}</p>
      {hijos}
    </div>
  );
}

export function Cargando() {
  return (
    <div className="flex items-center gap-2 px-6 py-14 text-sm text-slate-400" role="status">
      <span className="h-2 w-2 animate-pulse rounded-full bg-slate-300" />
      Cargando…
    </div>
  );
}

/* ----------------------------------- Tabla ----------------------------------- */

export function Tabla({ encabezados, children }: { encabezados: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            {encabezados.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

/* ---------------------------------- Botones ---------------------------------- */

export function BotonPrimario(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-marca-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-marca-700 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  );
}

export function BotonSecundario(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  );
}

/* -------------------------------- Formularios -------------------------------- */

export function Campo({
  etiqueta,
  requerido,
  children,
}: {
  etiqueta: string;
  requerido?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">
        {etiqueta}
        {requerido ? <span className="text-red-500"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

export const claseInput =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-marca-600 focus:ring-2 focus:ring-marca-600/20";

export function Entrada(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input {...rest} className={`${claseInput} ${className}`} />;
}

export function Selector(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", children, ...rest } = props;
  return (
    <select {...rest} className={`${claseInput} ${className}`}>
      {children}
    </select>
  );
}

/* ------------------------------ Errores (Problem) ----------------------------- */

/** Alerta de error RFC 7807 con encabezados del dominio (regla de oro, choques…). */
export function ProblemAlert({
  problema,
  fallback = "Ocurrió un error.",
}: {
  problema?: Problem | string | null;
  fallback?: string;
}) {
  if (!problema) return null;
  const mensaje =
    typeof problema === "string" ? problema : problemaAMensaje(problema, fallback);
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
    >
      {mensaje}
    </div>
  );
}

/* ----------------------------------- Modal ----------------------------------- */

export function Modal({
  abierto,
  titulo,
  onCerrar,
  children,
}: {
  abierto: boolean;
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!abierto) return;
    const escuchar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", escuchar);
    return () => window.removeEventListener("keydown", escuchar);
  }, [abierto, onCerrar]);

  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-base font-semibold">{titulo}</h2>
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 4l8 8m0-8l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
