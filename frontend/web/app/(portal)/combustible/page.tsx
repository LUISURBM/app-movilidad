"use client";

import { useState } from "react";
import { useTanqueos } from "@/features/combustible";
import { useVehiculos } from "@/features/vehiculos";
import { problemaDe } from "@/lib/api";
import { cop, fechaHora } from "@/lib/format";
import {
  Cargando,
  Encabezado,
  ProblemAlert,
  Selector,
  Tabla,
  Tarjeta,
  Vacio,
} from "@/shared/ui";

export default function PaginaCombustible() {
  const [vehiculoId, setVehiculoId] = useState("");
  const vehiculos = useVehiculos();
  const tanqueos = useTanqueos(vehiculoId || undefined);

  const items = tanqueos.data?.items ?? [];
  const placas = new Map((vehiculos.data?.items ?? []).map((v) => [v.id, v.placa]));

  return (
    <div>
      <Encabezado
        titulo="Combustible"
        descripcion="Tanqueos reportados desde la app del conductor (registro inmutable)."
      />

      <div className="mb-4 flex items-center gap-2">
        <label className="text-sm text-slate-600" htmlFor="filtro-vehiculo">
          Vehículo:
        </label>
        <Selector
          id="filtro-vehiculo"
          value={vehiculoId}
          onChange={(e) => setVehiculoId(e.target.value)}
          className="max-w-44"
        >
          <option value="">Todos</option>
          {(vehiculos.data?.items ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.placa}
            </option>
          ))}
        </Selector>
      </div>

      <Tarjeta>
        {tanqueos.isPending ? <Cargando /> : null}
        {tanqueos.isError ? (
          <div className="p-4">
            <ProblemAlert problema={problemaDe(tanqueos.error)} />
          </div>
        ) : null}
        {tanqueos.isSuccess && items.length === 0 ? (
          <Vacio mensaje="Sin tanqueos registrados todavía. Se capturan desde la app, incluso sin señal." />
        ) : null}
        {tanqueos.isSuccess && items.length > 0 ? (
          <Tabla encabezados={["Fecha", "Vehículo", "Litros", "Valor", "Odómetro"]}>
            {items.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">{fechaHora(t.tanqueadoEn)}</td>
                <td className="px-4 py-3 font-medium">{placas.get(t.vehiculoId) ?? t.vehiculoId.slice(0, 8)}</td>
                <td className="px-4 py-3">{t.litros.toLocaleString("es-CO")} L</td>
                <td className="px-4 py-3">{cop(t.valor.valor)}</td>
                <td className="px-4 py-3 text-slate-600">{t.odometro.toLocaleString("es-CO")} km</td>
              </tr>
            ))}
          </Tabla>
        ) : null}
      </Tarjeta>
    </div>
  );
}
