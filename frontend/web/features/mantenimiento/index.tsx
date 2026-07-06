"use client";

/**
 * Feature Mantenimiento (BC-7 Maintenance Management, spec-012).
 * Umbral por vehículo (cada N km y/o T meses), preventivo pendiente/vencido
 * (advierte, no bloquea — R9), ejecución que reinicia el ciclo y correctivo.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { schemas } from "@fleetspecial/api";
import { desenvolver, problemaDe, useApi } from "@/lib/api";
import {
  BotonPrimario,
  Campo,
  Entrada,
  Modal,
  ProblemAlert,
} from "@/shared/ui";

export type UmbralMantenimiento = schemas["UmbralMantenimiento"];
type Vehiculo = schemas["Vehiculo"];

export function useUmbrales() {
  const api = useApi();
  return useQuery({
    queryKey: ["mantenimiento", "umbrales"],
    queryFn: async () => desenvolver(await api.GET("/mantenimiento/umbrales")),
  });
}

function usarInvalidacion() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["mantenimiento"] });
}

/** Situación del ciclo para la UI (advierte, no bloquea — R9). */
export function situacionUmbral(u?: UmbralMantenimiento): {
  texto: string;
  tono: "rojo" | "ambar" | "verde" | "gris";
} {
  if (!u) return { texto: "Sin umbral", tono: "gris" };
  if (u.vencido) return { texto: "Vencido por fecha", tono: "rojo" };
  if (u.pendiente) return { texto: "Preventivo pendiente", tono: "ambar" };
  return { texto: "Al día", tono: "verde" };
}

/** Km que faltan para el próximo preventivo (si el umbral es por km). */
export function faltanKm(u: UmbralMantenimiento | undefined, odometro?: number): number | null {
  if (!u?.cadaKm || odometro === undefined) return null;
  return u.baseKm + u.cadaKm - odometro;
}

/** Definir/redefinir el Umbral del vehículo (upsert por vehículo). */
export function FormularioUmbral({
  vehiculo,
  umbral,
  onCerrar,
}: {
  vehiculo: Vehiculo | null;
  umbral?: UmbralMantenimiento;
  onCerrar: () => void;
}) {
  const api = useApi();
  const invalidar = usarInvalidacion();
  const [cadaKm, setCadaKm] = useState(umbral?.cadaKm?.toString() ?? "");
  const [baseKm, setBaseKm] = useState("");
  const [cadaMeses, setCadaMeses] = useState(umbral?.cadaMeses?.toString() ?? "");
  const [inicializado, setInicializado] = useState(false);

  // Base por defecto: el odómetro actual (no dispara el preventivo de inmediato).
  if (vehiculo && !inicializado) {
    setBaseKm((umbral?.baseKm ?? vehiculo.odometro ?? 0).toString());
    setCadaKm(umbral?.cadaKm?.toString() ?? "");
    setCadaMeses(umbral?.cadaMeses?.toString() ?? "");
    setInicializado(true);
  }

  const sinCriterio = !cadaKm && !cadaMeses;

  const definir = useMutation({
    mutationFn: async () =>
      desenvolver(
        await api.PUT("/mantenimiento/umbrales/{vehiculoId}", {
          params: { path: { vehiculoId: vehiculo!.id } },
          body: {
            ...(cadaKm ? { cadaKm: Number(cadaKm) } : {}),
            ...(baseKm ? { baseKm: Number(baseKm) } : {}),
            ...(cadaMeses ? { cadaMeses: Number(cadaMeses) } : {}),
          },
        }),
      ),
    onSuccess: () => {
      invalidar();
      cerrar();
    },
  });

  function cerrar() {
    setInicializado(false);
    definir.reset();
    onCerrar();
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (sinCriterio) return;
    definir.mutate();
  }

  return (
    <Modal
      abierto={Boolean(vehiculo)}
      titulo={vehiculo ? `Umbral de mantenimiento — ${vehiculo.placa}` : "Umbral"}
      onCerrar={cerrar}
    >
      <form onSubmit={enviar} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Campo etiqueta="Cada (km)">
            <Entrada
              type="number"
              min={1}
              value={cadaKm}
              onChange={(e) => setCadaKm(e.target.value)}
              placeholder="10000"
            />
          </Campo>
          <Campo etiqueta="Base (km)">
            <Entrada
              type="number"
              min={0}
              value={baseKm}
              onChange={(e) => setBaseKm(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Cada (meses)">
            <Entrada
              type="number"
              min={1}
              value={cadaMeses}
              onChange={(e) => setCadaMeses(e.target.value)}
              placeholder="6"
            />
          </Campo>
        </div>
        <p className="text-xs text-slate-500">
          Defina el ciclo por kilometraje, por meses, o ambos. Redefinir reemplaza el
          ciclo actual. La base por defecto es el odómetro actual.
        </p>
        {sinCriterio ? (
          <p className="text-xs text-red-600">Indique al menos km o meses.</p>
        ) : null}
        <ProblemAlert problema={definir.isError ? problemaDe(definir.error) : null} />
        <div className="flex justify-end">
          <BotonPrimario type="submit" disabled={definir.isPending || sinCriterio}>
            {definir.isPending ? "Guardando…" : "Guardar umbral"}
          </BotonPrimario>
        </div>
      </form>
    </Modal>
  );
}

/** Registrar ejecución del preventivo (reinicia ciclo) o correctivo reactivo. */
export function FormularioRegistroMantenimiento({
  vehiculo,
  tipo,
  onCerrar,
}: {
  vehiculo: Vehiculo | null;
  tipo: "ejecucion" | "correctivo";
  onCerrar: () => void;
}) {
  const api = useApi();
  const invalidar = usarInvalidacion();
  const [odometro, setOdometro] = useState("");
  const [costo, setCosto] = useState("");
  const [inicializado, setInicializado] = useState(false);

  if (vehiculo && !inicializado) {
    setOdometro((vehiculo.odometro ?? 0).toString());
    setCosto("");
    setInicializado(true);
  }

  const registrar = useMutation({
    mutationFn: async () => {
      const body = {
        vehiculoId: vehiculo!.id,
        odometro: Number(odometro),
        costo: { moneda: "COP" as const, valor: Number(costo) },
      };
      // Ramas separadas: las respuestas tienen tipos distintos (Umbral vs {mantenimientoId}).
      if (tipo === "ejecucion") {
        return desenvolver(await api.POST("/mantenimiento/ejecuciones", { body }));
      }
      return desenvolver(await api.POST("/mantenimiento/correctivos", { body }));
    },
    onSuccess: () => {
      invalidar();
      cerrar();
    },
  });

  function cerrar() {
    setInicializado(false);
    registrar.reset();
    onCerrar();
  }

  return (
    <Modal
      abierto={Boolean(vehiculo)}
      titulo={
        vehiculo
          ? tipo === "ejecucion"
            ? `Registrar mantenimiento — ${vehiculo.placa}`
            : `Registrar correctivo — ${vehiculo.placa}`
          : "Registrar"
      }
      onCerrar={cerrar}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          registrar.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <Campo etiqueta="Odómetro (km)" requerido>
            <Entrada
              type="number"
              min={0}
              value={odometro}
              onChange={(e) => setOdometro(e.target.value)}
              required
            />
          </Campo>
          <Campo etiqueta="Costo (COP)" requerido>
            <Entrada
              type="number"
              min={1}
              value={costo}
              onChange={(e) => setCosto(e.target.value)}
              placeholder="350000"
              required
            />
          </Campo>
        </div>
        <p className="text-xs text-slate-500">
          {tipo === "ejecucion"
            ? "La ejecución reinicia el ciclo del umbral desde esta base de km y la fecha de hoy."
            : "El correctivo es reactivo (falla): queda registrado con su costo y no depende del umbral."}
        </p>
        <ProblemAlert problema={registrar.isError ? problemaDe(registrar.error) : null} />
        <div className="flex justify-end">
          <BotonPrimario type="submit" disabled={registrar.isPending}>
            {registrar.isPending ? "Registrando…" : "Registrar"}
          </BotonPrimario>
        </div>
      </form>
    </Modal>
  );
}
