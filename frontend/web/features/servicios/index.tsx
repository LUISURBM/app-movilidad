"use client";

/**
 * Feature Servicios (BC-5 Service Scheduling, CORE).
 * Crear (spec-008), asignar con regla de oro (spec-009: semáforo rojo bloquea,
 * amarillo advierte) y cambio de estado con idempotencia (clientId).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { schemas } from "@fleetspecial/api";
import { newIdempotencyKey } from "@fleetspecial/api";
import { desenvolver, problemaDe, useApi } from "@/lib/api";
import { useConductores } from "@/features/conductores";
import { useVehiculos } from "@/features/vehiculos";
import {
  BotonPrimario,
  Campo,
  Entrada,
  Modal,
  ProblemAlert,
  SemaforoBadge,
  Selector,
} from "@/shared/ui";

type EstadoServicio = schemas["EstadoServicio"];
type Servicio = schemas["Servicio"];

export interface FiltrosServicios {
  desde?: string;
  hasta?: string;
  estado?: EstadoServicio;
}

export function useServicios(filtros: FiltrosServicios = {}, page = 1) {
  const api = useApi();
  return useQuery({
    queryKey: ["servicios", filtros, page],
    queryFn: async () =>
      desenvolver(
        await api.GET("/servicios", {
          params: { query: { ...filtros, page, pageSize: 50 } },
        }),
      ),
  });
}

function usarInvalidacionServicios() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["servicios"] });
}

/** Convierte "2026-07-08T14:30" (input datetime-local) a ISO con zona local. */
function aIso(local: string): string {
  return new Date(local).toISOString();
}

export function FormularioServicio({
  abierto,
  onCerrar,
}: {
  abierto: boolean;
  onCerrar: () => void;
}) {
  const api = useApi();
  const invalidar = usarInvalidacionServicios();
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [inicio, setInicio] = useState("");
  const [fin, setFin] = useState("");
  const [cliente, setCliente] = useState("");

  const crear = useMutation({
    mutationFn: async () =>
      desenvolver(
        await api.POST("/servicios", {
          body: {
            origen: origen.trim(),
            destino: destino.trim(),
            ventana: { inicio: aIso(inicio), fin: aIso(fin) },
            ...(cliente.trim() ? { cliente: cliente.trim() } : {}),
          },
        }),
      ),
    onSuccess: () => {
      invalidar();
      cerrar();
    },
  });

  function cerrar() {
    setOrigen("");
    setDestino("");
    setInicio("");
    setFin("");
    setCliente("");
    crear.reset();
    onCerrar();
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    crear.mutate();
  }

  return (
    <Modal abierto={abierto} titulo="Crear servicio" onCerrar={cerrar}>
      <form onSubmit={enviar} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Campo etiqueta="Origen" requerido>
            <Entrada value={origen} onChange={(e) => setOrigen(e.target.value)} required />
          </Campo>
          <Campo etiqueta="Destino" requerido>
            <Entrada value={destino} onChange={(e) => setDestino(e.target.value)} required />
          </Campo>
          <Campo etiqueta="Inicio" requerido>
            <Entrada
              type="datetime-local"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              required
            />
          </Campo>
          <Campo etiqueta="Fin" requerido>
            <Entrada
              type="datetime-local"
              value={fin}
              onChange={(e) => setFin(e.target.value)}
              required
            />
          </Campo>
          <Campo etiqueta="Cliente">
            <Entrada value={cliente} onChange={(e) => setCliente(e.target.value)} />
          </Campo>
        </div>
        <ProblemAlert problema={crear.isError ? problemaDe(crear.error) : null} />
        <div className="flex justify-end">
          <BotonPrimario type="submit" disabled={crear.isPending}>
            {crear.isPending ? "Creando…" : "Crear servicio"}
          </BotonPrimario>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Asignación de vehículo + conductor. Aquí vive la regla de oro:
 * un 409 con type `incumplimiento` significa semáforo en rojo;
 * `conflicto_horario`, choque de agenda. Amarillo asigna con advertencias.
 */
export function FormularioAsignacion({
  servicio,
  onCerrar,
}: {
  servicio: Servicio | null;
  onCerrar: () => void;
}) {
  const api = useApi();
  const invalidar = usarInvalidacionServicios();
  const vehiculos = useVehiculos();
  const conductores = useConductores();
  const [vehiculoId, setVehiculoId] = useState("");
  const [conductorId, setConductorId] = useState("");
  const [advertencias, setAdvertencias] = useState<string[]>([]);

  const asignar = useMutation({
    mutationFn: async () =>
      desenvolver(
        await api.PUT("/servicios/{servicioId}/asignacion", {
          params: { path: { servicioId: servicio!.id } },
          body: { vehiculoId, conductorId },
        }),
      ),
    onSuccess: (resultado) => {
      invalidar();
      if (resultado.advertencias?.length) {
        // Amarillo: asignado, pero el operador debe enterarse (spec-009).
        setAdvertencias(resultado.advertencias);
      } else {
        cerrar();
      }
    },
  });

  function cerrar() {
    setVehiculoId("");
    setConductorId("");
    setAdvertencias([]);
    asignar.reset();
    onCerrar();
  }

  return (
    <Modal
      abierto={Boolean(servicio)}
      titulo={servicio ? `Asignar: ${servicio.origen} → ${servicio.destino}` : "Asignar"}
      onCerrar={cerrar}
    >
      {advertencias.length > 0 ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
            <p className="font-medium">Asignado con advertencias:</p>
            <ul className="mt-1 list-disc pl-5">
              {advertencias.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
          <div className="flex justify-end">
            <BotonPrimario onClick={cerrar}>Entendido</BotonPrimario>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            asignar.mutate();
          }}
          className="space-y-4"
        >
          <Campo etiqueta="Vehículo" requerido>
            <Selector value={vehiculoId} onChange={(e) => setVehiculoId(e.target.value)} required>
              <option value="" disabled>
                Seleccione…
              </option>
              {(vehiculos.data?.items ?? [])
                .filter((v) => v.estado === "activo")
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.placa}
                    {v.semaforo && v.semaforo !== "Vigente" ? ` — ${v.semaforo === "Vencido" ? "EN ROJO" : "por vencer"}` : ""}
                  </option>
                ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Conductor" requerido>
            <Selector value={conductorId} onChange={(e) => setConductorId(e.target.value)} required>
              <option value="" disabled>
                Seleccione…
              </option>
              {(conductores.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                  {c.semaforo && c.semaforo !== "Vigente" ? ` — ${c.semaforo === "Vencido" ? "EN ROJO" : "por vencer"}` : ""}
                </option>
              ))}
            </Selector>
          </Campo>
          <p className="text-xs text-slate-500">
            Regla de oro: con documentos vencidos (rojo) la asignación se bloquea;
            por vencer (amarillo) asigna con advertencia.
          </p>
          <ProblemAlert problema={asignar.isError ? problemaDe(asignar.error) : null} />
          <div className="flex justify-end">
            <BotonPrimario type="submit" disabled={asignar.isPending}>
              {asignar.isPending ? "Asignando…" : "Asignar"}
            </BotonPrimario>
          </div>
        </form>
      )}
    </Modal>
  );
}

/**
 * Cambio de estado desde el portal (uso del operador: típicamente cancelar,
 * o corregir un inicio/cierre cuando el teléfono del conductor falló).
 * La verdad de campo la tiene la app (spec-010); el servidor audita intentos
 * contra estados terminales.
 */
export function useCambiarEstadoServicio() {
  const api = useApi();
  const invalidar = usarInvalidacionServicios();
  return useMutation({
    mutationFn: async ({
      servicioId,
      accion,
      odometro,
    }: {
      servicioId: string;
      accion: "iniciar" | "finalizar" | "cancelar";
      odometro?: number;
    }) =>
      desenvolver(
        await api.POST("/servicios/{servicioId}/estado", {
          params: { path: { servicioId } },
          body: {
            accion,
            ocurridoEn: new Date().toISOString(),
            clientId: newIdempotencyKey(),
            ...(odometro !== undefined ? { odometro } : {}),
          },
        }),
      ),
    onSuccess: invalidar,
  });
}

/** Insignia compacta del sujeto asignado (placa + semáforo del momento de lista). */
export function CeldaAsignacion({
  servicio,
  nombres,
}: {
  servicio: Servicio;
  nombres?: Map<string, string>;
}) {
  if (!servicio.asignacion) {
    return <span className="text-xs text-slate-400">Sin asignar</span>;
  }
  const { vehiculoId, conductorId } = servicio.asignacion;
  return (
    <span className="text-sm">
      {nombres?.get(vehiculoId) ?? vehiculoId.slice(0, 8)}
      <span className="text-slate-400"> · </span>
      {nombres?.get(conductorId) ?? conductorId.slice(0, 8)}
    </span>
  );
}

export { SemaforoBadge };
