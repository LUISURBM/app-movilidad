"use client";

import { useState } from "react";
import { useMapaSujetos } from "@/features/cumplimiento";
import {
  CeldaAsignacion,
  FormularioAsignacion,
  FormularioServicio,
  useCambiarEstadoServicio,
  useServicios,
} from "@/features/servicios";
import { problemaDe } from "@/lib/api";
import { etiquetaEstadoServicio, fechaHora } from "@/lib/format";
import type { schemas } from "@fleetspecial/api";
import {
  BotonPrimario,
  BotonSecundario,
  Cargando,
  Encabezado,
  ProblemAlert,
  Selector,
  Tabla,
  Tarjeta,
  Vacio,
} from "@/shared/ui";

type EstadoServicio = schemas["EstadoServicio"];
type Servicio = schemas["Servicio"];

const COLOR_ESTADO: Record<EstadoServicio, string> = {
  Planificado: "bg-slate-100 text-slate-700",
  Iniciado: "bg-blue-50 text-blue-700",
  Finalizado: "bg-green-50 text-green-700",
  Cancelado: "bg-slate-100 text-slate-400 line-through",
};

export default function PaginaServicios() {
  const [estado, setEstado] = useState<"" | EstadoServicio>("");
  const servicios = useServicios(estado ? { estado } : {});
  const sujetos = useMapaSujetos();
  const cambiarEstado = useCambiarEstadoServicio();
  const [crear, setCrear] = useState(false);
  const [asignando, setAsignando] = useState<Servicio | null>(null);

  const items = servicios.data?.items ?? [];

  function cancelar(s: Servicio) {
    if (window.confirm(`¿Cancelar el servicio ${s.origen} → ${s.destino}?`)) {
      cambiarEstado.mutate({ servicioId: s.id, accion: "cancelar" });
    }
  }

  return (
    <div>
      <Encabezado
        titulo="Servicios"
        descripcion="Agenda de la operación. La ejecución (iniciar/finalizar) la reporta el conductor desde la app."
        accion={<BotonPrimario onClick={() => setCrear(true)}>Crear servicio</BotonPrimario>}
      />

      <div className="mb-4 flex items-center gap-2">
        <label className="text-sm text-slate-600" htmlFor="filtro-estado">
          Estado:
        </label>
        <Selector
          id="filtro-estado"
          value={estado}
          onChange={(e) => setEstado(e.target.value as "" | EstadoServicio)}
          className="max-w-44"
        >
          <option value="">Todos</option>
          {(Object.keys(etiquetaEstadoServicio) as EstadoServicio[]).map((e) => (
            <option key={e} value={e}>
              {etiquetaEstadoServicio[e]}
            </option>
          ))}
        </Selector>
      </div>

      {cambiarEstado.isError ? (
        <div className="mb-4">
          <ProblemAlert problema={problemaDe(cambiarEstado.error)} />
        </div>
      ) : null}

      <Tarjeta>
        {servicios.isPending ? <Cargando /> : null}
        {servicios.isError ? (
          <div className="p-4">
            <ProblemAlert problema={problemaDe(servicios.error)} />
          </div>
        ) : null}
        {servicios.isSuccess && items.length === 0 ? (
          <Vacio
            mensaje="No hay servicios con este filtro."
            hijos={<BotonPrimario onClick={() => setCrear(true)}>Crear servicio</BotonPrimario>}
          />
        ) : null}
        {servicios.isSuccess && items.length > 0 ? (
          <Tabla encabezados={["Ruta", "Ventana", "Cliente", "Asignación", "Estado", ""]}>
            {items.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">
                  {s.origen} → {s.destino}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {fechaHora(s.ventana.inicio)}
                  <span className="text-slate-400"> — </span>
                  {fechaHora(s.ventana.fin)}
                </td>
                <td className="px-4 py-3 text-slate-600">{s.cliente ?? "—"}</td>
                <td className="px-4 py-3">
                  <CeldaAsignacion servicio={s} nombres={sujetos.data} />
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${COLOR_ESTADO[s.estado]}`}
                  >
                    {etiquetaEstadoServicio[s.estado]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {s.estado === "Planificado" ? (
                      <>
                        <BotonSecundario onClick={() => setAsignando(s)}>
                          {s.asignacion ? "Reasignar" : "Asignar"}
                        </BotonSecundario>
                        <BotonSecundario onClick={() => cancelar(s)}>Cancelar</BotonSecundario>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </Tabla>
        ) : null}
      </Tarjeta>

      <FormularioServicio abierto={crear} onCerrar={() => setCrear(false)} />
      <FormularioAsignacion servicio={asignando} onCerrar={() => setAsignando(null)} />
    </div>
  );
}
