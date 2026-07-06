"use client";

/**
 * Panel de Cumplimiento: la primera pantalla del día del operador.
 * ¿Qué está vencido? ¿Qué vence pronto? (spec-006, CORE del negocio)
 */

import Link from "next/link";
import { rutaSujeto, useAlertas, useMapaSujetos } from "@/features/cumplimiento";
import { problemaDe } from "@/lib/api";
import { diasRestantesTexto, fecha } from "@/lib/format";
import {
  Cargando,
  Encabezado,
  ProblemAlert,
  Tabla,
  Tarjeta,
  Vacio,
} from "@/shared/ui";

export default function PaginaCumplimiento() {
  const alertas = useAlertas();
  const sujetos = useMapaSujetos();

  const items = alertas.data?.items ?? [];
  const vencidos = items.filter((a) => a.estado === "vencido");
  const porVencer = items.filter((a) => a.estado === "por_vencer");

  return (
    <div>
      <Encabezado
        titulo="Cumplimiento"
        descripcion="Documentos vencidos y por vencer de toda la operación."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Tarjeta className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500">Vencidos</p>
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden />
          </div>
          <p className="mt-1 text-3xl font-semibold text-red-600">
            {alertas.isSuccess ? vencidos.length : "—"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Bloquean asignaciones (regla de oro).
          </p>
        </Tarjeta>
        <Tarjeta className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500">Por vencer</p>
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden />
          </div>
          <p className="mt-1 text-3xl font-semibold text-amber-600">
            {alertas.isSuccess ? porVencer.length : "—"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Renueve a tiempo para no frenar la operación.
          </p>
        </Tarjeta>
      </div>

      <Tarjeta>
        {alertas.isPending ? <Cargando /> : null}
        {alertas.isError ? (
          <div className="p-4">
            <ProblemAlert problema={problemaDe(alertas.error)} />
          </div>
        ) : null}
        {alertas.isSuccess && items.length === 0 ? (
          <Vacio mensaje="Sin alertas: toda la documentación está vigente." />
        ) : null}
        {alertas.isSuccess && items.length > 0 ? (
          <Tabla encabezados={["Documento", "Sujeto", "Vencimiento", "Situación"]}>
            {[...vencidos, ...porVencer].map((a) => (
              <tr key={a.documentoId} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{a.tipo ?? "Documento"}</td>
                <td className="px-4 py-3">
                  <Link
                    href={rutaSujeto(a.sujeto.tipo, a.sujeto.id)}
                    className="text-marca-700 hover:underline"
                  >
                    {sujetos.data?.get(a.sujeto.id) ??
                      (a.sujeto.tipo === "vehiculo" ? "Vehículo" : "Conductor")}
                  </Link>
                </td>
                <td className="px-4 py-3">{fecha(a.vencimiento)}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      a.estado === "vencido"
                        ? "font-medium text-red-600"
                        : "font-medium text-amber-600"
                    }
                  >
                    {diasRestantesTexto(a.diasRestantes) ||
                      (a.estado === "vencido" ? "vencido" : "por vencer")}
                  </span>
                </td>
              </tr>
            ))}
          </Tabla>
        ) : null}
      </Tarjeta>
    </div>
  );
}
