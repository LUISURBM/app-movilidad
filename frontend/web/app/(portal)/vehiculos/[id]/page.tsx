"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useCumplimientoSujeto } from "@/features/cumplimiento";
import { CeldaAdjunto, FormularioDocumento, FormularioRenovacion, useDocumentos } from "@/features/documentos";
import { FormularioOdometro, useVehiculo } from "@/features/vehiculos";
import { problemaDe } from "@/lib/api";
import { diasRestantesTexto, etiquetaClaseVehiculo, fecha } from "@/lib/format";
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

export default function PaginaVehiculo() {
  const { id } = useParams<{ id: string }>();
  const vehiculo = useVehiculo(id);
  const cumplimiento = useCumplimientoSujeto("vehiculo", id);
  const documentos = useDocumentos({ sujetoTipo: "vehiculo", sujetoId: id });
  const [odometro, setOdometro] = useState(false);
  const [nuevoDoc, setNuevoDoc] = useState(false);
  const [renovando, setRenovando] = useState<Documento | null>(null);

  if (vehiculo.isPending) return <Cargando />;
  if (vehiculo.isError) return <ProblemAlert problema={problemaDe(vehiculo.error)} />;
  const v = vehiculo.data!;

  const docs = documentos.data?.items ?? [];
  const evaluados = cumplimiento.data?.documentos ?? [];
  const diasPorDoc = new Map(evaluados.map((d) => [d.documentoId, d.diasRestantes]));

  return (
    <div>
      <Encabezado
        titulo={v.placa}
        descripcion={[etiquetaClaseVehiculo[v.clase] ?? v.clase, v.marca, v.modelo, v.anio]
          .filter(Boolean)
          .join(" · ")}
        accion={
          <div className="flex gap-2">
            <BotonSecundario onClick={() => setOdometro(true)}>Registrar odómetro</BotonSecundario>
            <BotonPrimario onClick={() => setNuevoDoc(true)}>Registrar documento</BotonPrimario>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Tarjeta className="p-5">
          <p className="text-sm font-medium text-slate-500">Cumplimiento</p>
          <div className="mt-2">
            <SemaforoBadge estado={cumplimiento.data?.semaforo ?? v.semaforo} />
          </div>
        </Tarjeta>
        <Tarjeta className="p-5">
          <p className="text-sm font-medium text-slate-500">Odómetro</p>
          <p className="mt-1 text-2xl font-semibold">
            {v.odometro !== undefined ? `${v.odometro.toLocaleString("es-CO")} km` : "—"}
          </p>
        </Tarjeta>
        <Tarjeta className="p-5">
          <p className="text-sm font-medium text-slate-500">Estado</p>
          <p className="mt-1 text-2xl font-semibold">{v.estado === "activo" ? "Activo" : "Inactivo"}</p>
        </Tarjeta>
      </div>

      <h2 className="mb-3 text-base font-semibold">Documentos</h2>
      <Tarjeta>
        {documentos.isPending ? <Cargando /> : null}
        {documentos.isSuccess && docs.length === 0 ? (
          <Vacio
            mensaje="Este vehículo no tiene documentos. Sin SOAT/RTM vigentes queda en rojo y no se puede asignar."
            hijos={<BotonPrimario onClick={() => setNuevoDoc(true)}>Registrar documento</BotonPrimario>}
          />
        ) : null}
        {documentos.isSuccess && docs.length > 0 ? (
          <Tabla encabezados={["Tipo", "Número", "Vencimiento", "Situación", "Estado", "Adjunto", ""]}>
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
                <td className="px-4 py-3">
                  <CeldaAdjunto documento={d} />
                </td>
                <td className="px-4 py-3 text-right">
                  <BotonSecundario onClick={() => setRenovando(d)}>Renovar</BotonSecundario>
                </td>
              </tr>
            ))}
          </Tabla>
        ) : null}
      </Tarjeta>

      <FormularioOdometro vehiculoId={v.id} abierto={odometro} onCerrar={() => setOdometro(false)} />
      <FormularioDocumento
        abierto={nuevoDoc}
        onCerrar={() => setNuevoDoc(false)}
        sujetoFijo={{ tipo: "vehiculo", id: v.id }}
      />
      <FormularioRenovacion documento={renovando} onCerrar={() => setRenovando(null)} />
    </div>
  );
}
