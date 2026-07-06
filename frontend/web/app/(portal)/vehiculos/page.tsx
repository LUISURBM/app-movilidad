"use client";

import Link from "next/link";
import { useState } from "react";
import { FormularioVehiculo, useVehiculos } from "@/features/vehiculos";
import { problemaDe } from "@/lib/api";
import { etiquetaClaseVehiculo } from "@/lib/format";
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

export default function PaginaVehiculos() {
  const vehiculos = useVehiculos();
  const [crear, setCrear] = useState(false);

  const items = vehiculos.data?.items ?? [];

  return (
    <div>
      <Encabezado
        titulo="Vehículos"
        descripcion="Flota registrada y su estado documental."
        accion={<BotonPrimario onClick={() => setCrear(true)}>Registrar vehículo</BotonPrimario>}
      />
      <Tarjeta>
        {vehiculos.isPending ? <Cargando /> : null}
        {vehiculos.isError ? (
          <div className="p-4">
            <ProblemAlert problema={problemaDe(vehiculos.error)} />
          </div>
        ) : null}
        {vehiculos.isSuccess && items.length === 0 ? (
          <Vacio
            mensaje="Aún no hay vehículos. Registre el primero para arrancar la operación."
            hijos={<BotonPrimario onClick={() => setCrear(true)}>Registrar vehículo</BotonPrimario>}
          />
        ) : null}
        {vehiculos.isSuccess && items.length > 0 ? (
          <Tabla encabezados={["Placa", "Clase", "Marca / modelo", "Odómetro", "Cumplimiento", "Estado"]}>
            {items.map((v) => (
              <tr key={v.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/vehiculos/${v.id}`} className="font-medium text-marca-700 hover:underline">
                    {v.placa}
                  </Link>
                </td>
                <td className="px-4 py-3">{etiquetaClaseVehiculo[v.clase] ?? v.clase}</td>
                <td className="px-4 py-3 text-slate-600">
                  {[v.marca, v.modelo, v.anio].filter(Boolean).join(" ") || "—"}
                </td>
                <td className="px-4 py-3">{v.odometro !== undefined ? `${v.odometro.toLocaleString("es-CO")} km` : "—"}</td>
                <td className="px-4 py-3">
                  <SemaforoBadge estado={v.semaforo} />
                </td>
                <td className="px-4 py-3 text-slate-600">{v.estado === "activo" ? "Activo" : "Inactivo"}</td>
              </tr>
            ))}
          </Tabla>
        ) : null}
      </Tarjeta>
      <FormularioVehiculo abierto={crear} onCerrar={() => setCrear(false)} />
    </div>
  );
}
