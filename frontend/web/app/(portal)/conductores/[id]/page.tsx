"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useConductor } from "@/features/conductores";
import { useCumplimientoSujeto } from "@/features/cumplimiento";
import { FormularioDocumento, FormularioRenovacion, useDocumentos } from "@/features/documentos";
import { problemaDe } from "@/lib/api";
import { diasRestantesTexto, fecha } from "@/lib/format";
import type { schemas } from "@fleetspecial/api";
import {
  BotonPrimario,
  BotonSecundario,
  Cargando,
  Encabezado,
  ProblemAlert,
  SemaforoBadge,
  Tabla,
  Tarjeta,
  Vacio,
} from "@/shared/ui";

type Documento = schemas["Documento"];

export default function PaginaConductor() {
  const { id } = useParams<{ id: string }>();
  const conductor = useConductor(id);
  const cumplimiento = useCumplimientoSujeto("conductor", id);
  const documentos = useDocumentos({ sujetoTipo: "conductor", sujetoId: id });
  const [nuevoDoc, setNuevoDoc] = useState(false);
  const [renovando, setRenovando] = useState<Documento | null>(null);

  if (conductor.isPending) return <Cargando />;
  if (conductor.isError) return <ProblemAlert problema={problemaDe(conductor.error)} />;
  const c = conductor.data!;

  const docs = documentos.data?.items ?? [];
  const evaluados = cumplimiento.data?.documentos ?? [];
  const diasPorDoc = new Map(evaluados.map((d) => [d.documentoId, d.diasRestantes]));

  return (
    <div>
      <Encabezado
        titulo={c.nombre}
        descripcion={
          c.licencia
            ? `Licencia ${c.licencia.numero ?? ""} · categoría ${c.licencia.categoria ?? "—"} · vence ${fecha(c.licencia.vencimiento)}`
            : undefined
        }
        accion={<BotonPrimario onClick={() => setNuevoDoc(true)}>Registrar documento</BotonPrimario>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Tarjeta className="p-5">
          <p className="text-sm font-medium text-slate-500">Cumplimiento</p>
          <div className="mt-2">
            <SemaforoBadge estado={cumplimiento.data?.semaforo ?? c.semaforo} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            En rojo no se le pueden asignar servicios (regla de oro).
          </p>
        </Tarjeta>
        <Tarjeta className="p-5">
          <p className="text-sm font-medium text-slate-500">Licencia</p>
          <p className="mt-1 text-2xl font-semibold">{c.licencia?.categoria ?? "—"}</p>
          <p className="mt-1 text-xs text-slate-500">
            {c.licencia?.vencimiento ? `Vence ${fecha(c.licencia.vencimiento)}` : "Sin registro"}
          </p>
        </Tarjeta>
      </div>

      <h2 className="mb-3 text-base font-semibold">Documentos</h2>
      <Tarjeta>
        {documentos.isPending ? <Cargando /> : null}
        {documentos.isSuccess && docs.length === 0 ? (
          <Vacio mensaje="Sin documentos registrados para este conductor." />
        ) : null}
        {documentos.isSuccess && docs.length > 0 ? (
          <Tabla encabezados={["Tipo", "Número", "Vencimiento", "Situación", "Estado", ""]}>
            {docs.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{d.tipo}</td>
                <td className="px-4 py-3 text-slate-600">{d.numero ?? "—"}</td>
                <td className="px-4 py-3">{fecha(d.vencimiento)}</td>
                <td className="px-4 py-3 text-slate-600">
                  {diasRestantesTexto(diasPorDoc.get(d.id) ?? undefined)}
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

      <FormularioDocumento
        abierto={nuevoDoc}
        onCerrar={() => setNuevoDoc(false)}
        sujetoFijo={{ tipo: "conductor", id: c.id }}
      />
      <FormularioRenovacion documento={renovando} onCerrar={() => setRenovando(null)} />
    </div>
  );
}
