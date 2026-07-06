"use client";

import Link from "next/link";
import { useState } from "react";
import { FormularioConductor, useConductores } from "@/features/conductores";
import { problemaDe } from "@/lib/api";
import { fecha } from "@/lib/format";
import {
  BotonPrimario,
  Cargando,
  Encabezado,
  ProblemAlert,
  SemaforoBadge,
  Tabla,
  Tarjeta,
  Vacio,
} from "@/shared/ui";

export default function PaginaConductores() {
  const conductores = useConductores();
  const [crear, setCrear] = useState(false);

  const items = conductores.data?.items ?? [];

  return (
    <div>
      <Encabezado
        titulo="Conductores"
        descripcion="La licencia vive como documento de cumplimiento: alimenta el semáforo."
        accion={<BotonPrimario onClick={() => setCrear(true)}>Registrar conductor</BotonPrimario>}
      />
      <Tarjeta>
        {conductores.isPending ? <Cargando /> : null}
        {conductores.isError ? (
          <div className="p-4">
            <ProblemAlert problema={problemaDe(conductores.error)} />
          </div>
        ) : null}
        {conductores.isSuccess && items.length === 0 ? (
          <Vacio
            mensaje="Aún no hay conductores registrados."
            hijos={<BotonPrimario onClick={() => setCrear(true)}>Registrar conductor</BotonPrimario>}
          />
        ) : null}
        {conductores.isSuccess && items.length > 0 ? (
          <Tabla encabezados={["Nombre", "Licencia", "Categoría", "Vence", "Cumplimiento"]}>
            {items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/conductores/${c.id}`} className="font-medium text-marca-700 hover:underline">
                    {c.nombre}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{c.licencia?.numero ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{c.licencia?.categoria ?? "—"}</td>
                <td className="px-4 py-3">{fecha(c.licencia?.vencimiento)}</td>
                <td className="px-4 py-3">
                  <SemaforoBadge estado={c.semaforo} />
                </td>
              </tr>
            ))}
          </Tabla>
        ) : null}
      </Tarjeta>
      <FormularioConductor abierto={crear} onCerrar={() => setCrear(false)} />
    </div>
  );
}
