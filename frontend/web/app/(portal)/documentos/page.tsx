"use client";

import Link from "next/link";
import { useState } from "react";
import { rutaSujeto, useMapaSujetos } from "@/features/cumplimiento";
import {
  FormularioDocumento,
  FormularioRenovacion,
  useDocumentos,
} from "@/features/documentos";
import { problemaDe } from "@/lib/api";
import { fecha } from "@/lib/format";
import type { schemas } from "@fleetspecial/api";
import {
  BotonPrimario,
  BotonSecundario,
  Cargando,
  Encabezado,
  ProblemAlert,
  SemaforoBadge,
  Selector,
  Tabla,
  Tarjeta,
  Vacio,
} from "@/shared/ui";

type Documento = schemas["Documento"];

export default function PaginaDocumentos() {
  const [sujetoTipo, setSujetoTipo] = useState<"" | "vehiculo" | "conductor">("");
  const documentos = useDocumentos(sujetoTipo ? { sujetoTipo } : {});
  const sujetos = useMapaSujetos();
  const [crear, setCrear] = useState(false);
  const [renovando, setRenovando] = useState<Documento | null>(null);

  const items = documentos.data?.items ?? [];

  return (
    <div>
      <Encabezado
        titulo="Documentos"
        descripcion="SOAT, RTM, tarjeta de operación, licencias… con su vigencia y semáforo."
        accion={<BotonPrimario onClick={() => setCrear(true)}>Registrar documento</BotonPrimario>}
      />

      <div className="mb-4 flex items-center gap-2">
        <label className="text-sm text-slate-600" htmlFor="filtro-sujeto">
          Filtrar:
        </label>
        <Selector
          id="filtro-sujeto"
          value={sujetoTipo}
          onChange={(e) => setSujetoTipo(e.target.value as "" | "vehiculo" | "conductor")}
          className="max-w-44"
        >
          <option value="">Todos</option>
          <option value="vehiculo">Vehículos</option>
          <option value="conductor">Conductores</option>
        </Selector>
      </div>

      <Tarjeta>
        {documentos.isPending ? <Cargando /> : null}
        {documentos.isError ? (
          <div className="p-4">
            <ProblemAlert problema={problemaDe(documentos.error)} />
          </div>
        ) : null}
        {documentos.isSuccess && items.length === 0 ? (
          <Vacio
            mensaje="No hay documentos con este filtro."
            hijos={<BotonPrimario onClick={() => setCrear(true)}>Registrar documento</BotonPrimario>}
          />
        ) : null}
        {documentos.isSuccess && items.length > 0 ? (
          <Tabla encabezados={["Tipo", "Sujeto", "Número", "Vencimiento", "Versión", "Estado", ""]}>
            {items.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{d.tipo}</td>
                <td className="px-4 py-3">
                  <Link
                    href={rutaSujeto(d.sujeto.tipo, d.sujeto.id)}
                    className="text-marca-700 hover:underline"
                  >
                    {sujetos.data?.get(d.sujeto.id) ??
                      (d.sujeto.tipo === "vehiculo" ? "Vehículo" : "Conductor")}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{d.numero ?? "—"}</td>
                <td className="px-4 py-3">{fecha(d.vencimiento)}</td>
                <td className="px-4 py-3 text-slate-600">
                  v{d.version ?? 1}
                  {d.historico?.length ? ` (${d.historico.length} renovaciones)` : ""}
                </td>
                <td className="px-4 py-3">
                  <SemaforoBadge estado={d.estado} />
                </td>
                <td className="px-4 py-3 text-right">
                  <BotonSecundario onClick={() => setRenovando(d)}>Renovar</BotonSecundario>
                </td>
              </tr>
            ))}
          </Tabla>
        ) : null}
      </Tarjeta>

      <FormularioDocumento abierto={crear} onCerrar={() => setCrear(false)} />
      <FormularioRenovacion documento={renovando} onCerrar={() => setRenovando(null)} />
    </div>
  );
}
