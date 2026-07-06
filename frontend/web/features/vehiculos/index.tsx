"use client";

/**
 * Feature Vehículos (BC-2 Fleet Management).
 * Registro (placa única e inmutable), edición, odómetro monótono (spec-003).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { schemas } from "@fleetspecial/api";
import { desenvolver, problemaDe, useApi } from "@/lib/api";
import { etiquetaClaseVehiculo } from "@/lib/format";
import {
  BotonPrimario,
  Campo,
  Entrada,
  Modal,
  ProblemAlert,
  Selector,
} from "@/shared/ui";

type ClaseVehiculo = schemas["ClaseVehiculo"];

const CLASES = Object.keys(etiquetaClaseVehiculo) as ClaseVehiculo[];

export function useVehiculos(page = 1) {
  const api = useApi();
  return useQuery({
    queryKey: ["vehiculos", page],
    queryFn: async () =>
      desenvolver(
        await api.GET("/vehiculos", {
          params: { query: { page, pageSize: 50 } },
        }),
      ),
  });
}

export function useVehiculo(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ["vehiculos", "detalle", id],
    enabled: Boolean(id),
    queryFn: async () =>
      desenvolver(
        await api.GET("/vehiculos/{vehiculoId}", {
          params: { path: { vehiculoId: id! } },
        }),
      ),
  });
}

/** Modal de registro de vehículo. La placa no se puede cambiar después (inmutable). */
export function FormularioVehiculo({
  abierto,
  onCerrar,
}: {
  abierto: boolean;
  onCerrar: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [placa, setPlaca] = useState("");
  const [clase, setClase] = useState<ClaseVehiculo>("camioneta");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anio, setAnio] = useState("");
  const [odometro, setOdometro] = useState("");

  const registrar = useMutation({
    mutationFn: async () =>
      desenvolver(
        await api.POST("/vehiculos", {
          body: {
            placa: placa.trim().toUpperCase(),
            clase,
            ...(marca.trim() ? { marca: marca.trim() } : {}),
            ...(modelo.trim() ? { modelo: modelo.trim() } : {}),
            ...(anio ? { anio: Number(anio) } : {}),
            ...(odometro ? { odometroInicial: Number(odometro) } : {}),
          },
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehiculos"] });
      queryClient.invalidateQueries({ queryKey: ["sujetos"] });
      cerrar();
    },
  });

  function cerrar() {
    setPlaca("");
    setMarca("");
    setModelo("");
    setAnio("");
    setOdometro("");
    registrar.reset();
    onCerrar();
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    registrar.mutate();
  }

  return (
    <Modal abierto={abierto} titulo="Registrar vehículo" onCerrar={cerrar}>
      <form onSubmit={enviar} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Campo etiqueta="Placa" requerido>
            <Entrada
              value={placa}
              onChange={(e) => setPlaca(e.target.value.toUpperCase())}
              placeholder="ABC123"
              pattern="[A-Za-z]{3}[0-9]{2,3}"
              title="Placa colombiana: 3 letras y 2–3 dígitos, p. ej. ABC123"
              required
            />
          </Campo>
          <Campo etiqueta="Clase" requerido>
            <Selector value={clase} onChange={(e) => setClase(e.target.value as ClaseVehiculo)}>
              {CLASES.map((c) => (
                <option key={c} value={c}>
                  {etiquetaClaseVehiculo[c]}
                </option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Marca">
            <Entrada value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Renault" />
          </Campo>
          <Campo etiqueta="Modelo">
            <Entrada value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Duster" />
          </Campo>
          <Campo etiqueta="Año">
            <Entrada
              type="number"
              min={1950}
              max={2100}
              value={anio}
              onChange={(e) => setAnio(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Odómetro inicial (km)">
            <Entrada
              type="number"
              min={0}
              value={odometro}
              onChange={(e) => setOdometro(e.target.value)}
            />
          </Campo>
        </div>
        <p className="text-xs text-slate-500">
          La placa identifica al vehículo y no se puede modificar después.
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

/** Registro manual de odómetro (monótono: una lectura menor se rechaza). */
export function FormularioOdometro({
  vehiculoId,
  abierto,
  onCerrar,
}: {
  vehiculoId: string;
  abierto: boolean;
  onCerrar: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [lectura, setLectura] = useState("");

  const registrar = useMutation({
    mutationFn: async () =>
      desenvolver(
        await api.POST("/vehiculos/{vehiculoId}/odometro", {
          params: { path: { vehiculoId } },
          body: { lectura: Number(lectura), fuente: "manual" },
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehiculos"] });
      cerrar();
    },
  });

  function cerrar() {
    setLectura("");
    registrar.reset();
    onCerrar();
  }

  return (
    <Modal abierto={abierto} titulo="Registrar odómetro" onCerrar={cerrar}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          registrar.mutate();
        }}
        className="space-y-4"
      >
        <Campo etiqueta="Lectura (km)" requerido>
          <Entrada
            type="number"
            min={0}
            value={lectura}
            onChange={(e) => setLectura(e.target.value)}
            required
            autoFocus
          />
        </Campo>
        <p className="text-xs text-slate-500">
          El odómetro solo avanza: una lectura menor a la última conocida será rechazada.
        </p>
        <ProblemAlert problema={registrar.isError ? problemaDe(registrar.error) : null} />
        <div className="flex justify-end">
          <BotonPrimario type="submit" disabled={registrar.isPending}>
            {registrar.isPending ? "Guardando…" : "Guardar lectura"}
          </BotonPrimario>
        </div>
      </form>
    </Modal>
  );
}
