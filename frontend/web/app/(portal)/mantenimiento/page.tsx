"use client";

import { useState } from "react";
import {
  faltanKm,
  FormularioRegistroMantenimiento,
  FormularioUmbral,
  situacionUmbral,
  useUmbrales,
  type UmbralMantenimiento,
} from "@/features/mantenimiento";
import { useVehiculos } from "@/features/vehiculos";
import { problemaDe } from "@/lib/api";
import { fecha } from "@/lib/format";
import type { schemas } from "@fleetspecial/api";
import {
  BotonSecundario,
  Cargando,
  Encabezado,
  ProblemAlert,
  Tabla,
  Tarjeta,
  Vacio,
} from "@/shared/ui";

type Vehiculo = schemas["Vehiculo"];

const TONO_CSS: Record<string, string> = {
  rojo: "bg-red-50 text-red-700",
  ambar: "bg-amber-50 text-amber-700",
  verde: "bg-green-50 text-green-700",
  gris: "bg-slate-100 text-slate-500",
};

export default function PaginaMantenimiento() {
  const vehiculos = useVehiculos();
  const umbrales = useUmbrales();
  const [editandoUmbral, setEditandoUmbral] = useState<Vehiculo | null>(null);
  const [registrando, setRegistrando] = useState<{
    vehiculo: Vehiculo;
    tipo: "ejecucion" | "correctivo";
  } | null>(null);

  const items = vehiculos.data?.items ?? [];
  const porVehiculo = new Map<string, UmbralMantenimiento>(
    (umbrales.data ?? []).map((u) => [u.vehiculoId, u]),
  );

  const cargando = vehiculos.isPending || umbrales.isPending;
  const error = vehiculos.isError
    ? problemaDe(vehiculos.error)
    : umbrales.isError
      ? problemaDe(umbrales.error)
      : null;

  return (
    <div>
      <Encabezado
        titulo="Mantenimiento"
        descripcion="Preventivo por umbral de kilometraje o tiempo. Un preventivo pendiente advierte; no bloquea la operación."
      />

      <Tarjeta>
        {cargando ? <Cargando /> : null}
        {error ? (
          <div className="p-4">
            <ProblemAlert problema={error} />
          </div>
        ) : null}
        {!cargando && !error && items.length === 0 ? (
          <Vacio mensaje="Registre vehículos primero; aquí les define el ciclo de mantenimiento." />
        ) : null}
        {!cargando && !error && items.length > 0 ? (
          <Tabla encabezados={["Vehículo", "Odómetro", "Umbral", "Próximo preventivo", "Situación", ""]}>
            {items.map((v) => {
              const u = porVehiculo.get(v.id);
              const s = situacionUmbral(u);
              const faltan = faltanKm(u, v.odometro);
              return (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{v.placa}</td>
                  <td className="px-4 py-3">
                    {v.odometro !== undefined ? `${v.odometro.toLocaleString("es-CO")} km` : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {u
                      ? [
                          u.cadaKm ? `cada ${u.cadaKm.toLocaleString("es-CO")} km` : null,
                          u.cadaMeses ? `cada ${u.cadaMeses} meses` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {u?.pendiente || u?.vencido
                      ? "ahora"
                      : faltan !== null
                        ? `en ${faltan.toLocaleString("es-CO")} km`
                        : u?.cadaMeses && u.baseFecha
                          ? `base ${fecha(u.baseFecha)}`
                          : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TONO_CSS[s.tono]}`}
                    >
                      {s.texto}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <BotonSecundario onClick={() => setEditandoUmbral(v)}>
                        {u ? "Editar umbral" : "Definir umbral"}
                      </BotonSecundario>
                      {u ? (
                        <BotonSecundario
                          onClick={() => setRegistrando({ vehiculo: v, tipo: "ejecucion" })}
                        >
                          Registrar mantenimiento
                        </BotonSecundario>
                      ) : null}
                      <BotonSecundario
                        onClick={() => setRegistrando({ vehiculo: v, tipo: "correctivo" })}
                      >
                        Correctivo
                      </BotonSecundario>
                    </div>
                  </td>
                </tr>
              );
            })}
          </Tabla>
        ) : null}
      </Tarjeta>

      <FormularioUmbral
        vehiculo={editandoUmbral}
        umbral={editandoUmbral ? porVehiculo.get(editandoUmbral.id) : undefined}
        onCerrar={() => setEditandoUmbral(null)}
      />
      <FormularioRegistroMantenimiento
        vehiculo={registrando?.vehiculo ?? null}
        tipo={registrando?.tipo ?? "ejecucion"}
        onCerrar={() => setRegistrando(null)}
      />
    </div>
  );
}
