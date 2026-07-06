"use client";

/**
 * Feature Documentos (BC-4 Compliance & Documents, CORE).
 * Registrar (spec-005), renovar (spec-007) y catálogo de tipos configurable.
 * Un tipo `requerido` ausente pone al sujeto en rojo (invariante I3).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { schemas } from "@fleetspecial/api";
import { desenvolver, problemaDe, useApi } from "@/lib/api";
import { useConductores } from "@/features/conductores";
import { useVehiculos } from "@/features/vehiculos";
import {
  BotonPrimario,
  Campo,
  Entrada,
  Modal,
  ProblemAlert,
  Selector,
} from "@/shared/ui";

type Documento = schemas["Documento"];
type SujetoRef = schemas["SujetoRef"];

export interface FiltrosDocumentos {
  sujetoTipo?: "vehiculo" | "conductor";
  sujetoId?: string;
}

export function useDocumentos(filtros: FiltrosDocumentos = {}, page = 1) {
  const api = useApi();
  return useQuery({
    queryKey: ["documentos", filtros, page],
    queryFn: async () =>
      desenvolver(
        await api.GET("/documentos", {
          params: { query: { ...filtros, page, pageSize: 50 } },
        }),
      ),
  });
}

export function useCatalogoTipos() {
  const api = useApi();
  return useQuery({
    queryKey: ["catalogo", "tipos"],
    staleTime: 60_000,
    queryFn: async () => desenvolver(await api.GET("/catalogo/tipos")),
  });
}

/** Invalidaciones tras cualquier mutación de documentos. */
function usarInvalidacionDocumentos() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["documentos"] });
    queryClient.invalidateQueries({ queryKey: ["cumplimiento"] });
    queryClient.invalidateQueries({ queryKey: ["vehiculos"] });
    queryClient.invalidateQueries({ queryKey: ["conductores"] });
  };
}

/**
 * Modal para registrar un documento. Si `sujetoFijo` viene, el sujeto no se
 * elige (flujo desde el detalle de vehículo/conductor).
 */
export function FormularioDocumento({
  abierto,
  onCerrar,
  sujetoFijo,
}: {
  abierto: boolean;
  onCerrar: () => void;
  sujetoFijo?: SujetoRef;
}) {
  const api = useApi();
  const invalidar = usarInvalidacionDocumentos();
  const catalogo = useCatalogoTipos();
  const vehiculos = useVehiculos();
  const conductores = useConductores();

  const [sujetoTipo, setSujetoTipo] = useState<"vehiculo" | "conductor">(
    sujetoFijo?.tipo ?? "vehiculo",
  );
  const [sujetoId, setSujetoId] = useState(sujetoFijo?.id ?? "");
  const [tipo, setTipo] = useState("");
  const [numero, setNumero] = useState("");
  const [expedicion, setExpedicion] = useState("");
  const [vencimiento, setVencimiento] = useState("");

  const tiposDisponibles = (catalogo.data ?? []).filter(
    (t) => t.activo && t.aplicaA === (sujetoFijo?.tipo ?? sujetoTipo),
  );

  const registrar = useMutation({
    mutationFn: async () =>
      desenvolver(
        await api.POST("/documentos", {
          body: {
            sujeto: sujetoFijo ?? { tipo: sujetoTipo, id: sujetoId },
            tipo,
            ...(numero.trim() ? { numero: numero.trim() } : {}),
            ...(expedicion ? { expedicion } : {}),
            vencimiento,
          },
        }),
      ),
    onSuccess: () => {
      invalidar();
      cerrar();
    },
  });

  function cerrar() {
    setTipo("");
    setNumero("");
    setExpedicion("");
    setVencimiento("");
    if (!sujetoFijo) setSujetoId("");
    registrar.reset();
    onCerrar();
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    registrar.mutate();
  }

  const opcionesSujeto =
    sujetoTipo === "vehiculo"
      ? (vehiculos.data?.items ?? []).map((v) => ({ id: v.id, etiqueta: v.placa }))
      : (conductores.data?.items ?? []).map((c) => ({ id: c.id, etiqueta: c.nombre }));

  return (
    <Modal abierto={abierto} titulo="Registrar documento" onCerrar={cerrar}>
      <form onSubmit={enviar} className="space-y-4">
        {!sujetoFijo ? (
          <div className="grid grid-cols-2 gap-4">
            <Campo etiqueta="Aplica a" requerido>
              <Selector
                value={sujetoTipo}
                onChange={(e) => {
                  setSujetoTipo(e.target.value as "vehiculo" | "conductor");
                  setSujetoId("");
                  setTipo("");
                }}
              >
                <option value="vehiculo">Vehículo</option>
                <option value="conductor">Conductor</option>
              </Selector>
            </Campo>
            <Campo etiqueta={sujetoTipo === "vehiculo" ? "Vehículo" : "Conductor"} requerido>
              <Selector value={sujetoId} onChange={(e) => setSujetoId(e.target.value)} required>
                <option value="" disabled>
                  Seleccione…
                </option>
                {opcionesSujeto.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.etiqueta}
                  </option>
                ))}
              </Selector>
            </Campo>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-4">
          <Campo etiqueta="Tipo de documento" requerido>
            <Selector value={tipo} onChange={(e) => setTipo(e.target.value)} required>
              <option value="" disabled>
                Seleccione…
              </option>
              {tiposDisponibles.map((t) => (
                <option key={t.codigo} value={t.codigo}>
                  {t.codigo}
                  {t.requerido ? " (obligatorio)" : ""}
                </option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Número">
            <Entrada value={numero} onChange={(e) => setNumero(e.target.value)} />
          </Campo>
          <Campo etiqueta="Expedición">
            <Entrada type="date" value={expedicion} onChange={(e) => setExpedicion(e.target.value)} />
          </Campo>
          <Campo etiqueta="Vencimiento" requerido>
            <Entrada
              type="date"
              value={vencimiento}
              onChange={(e) => setVencimiento(e.target.value)}
              required
            />
          </Campo>
        </div>
        {tiposDisponibles.length === 0 && catalogo.isSuccess ? (
          <p className="text-xs text-amber-700">
            No hay tipos activos para este sujeto. Agréguelos primero en Catálogo.
          </p>
        ) : null}
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

/** Modal de renovación (spec-007): nueva vigencia versiona el documento. */
export function FormularioRenovacion({
  documento,
  onCerrar,
}: {
  documento: Documento | null;
  onCerrar: () => void;
}) {
  const api = useApi();
  const invalidar = usarInvalidacionDocumentos();
  const [numero, setNumero] = useState("");
  const [expedicion, setExpedicion] = useState("");
  const [vencimiento, setVencimiento] = useState("");

  const renovar = useMutation({
    mutationFn: async () =>
      desenvolver(
        await api.POST("/documentos/{documentoId}/renovaciones", {
          params: { path: { documentoId: documento!.id } },
          body: {
            ...(numero.trim() ? { numero: numero.trim() } : {}),
            ...(expedicion ? { expedicion } : {}),
            vencimiento,
          },
        }),
      ),
    onSuccess: () => {
      invalidar();
      cerrar();
    },
  });

  function cerrar() {
    setNumero("");
    setExpedicion("");
    setVencimiento("");
    renovar.reset();
    onCerrar();
  }

  return (
    <Modal
      abierto={Boolean(documento)}
      titulo={documento ? `Renovar ${documento.tipo}` : "Renovar"}
      onCerrar={cerrar}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          renovar.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <Campo etiqueta="Nuevo número">
            <Entrada
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder={documento?.numero ?? ""}
            />
          </Campo>
          <Campo etiqueta="Expedición">
            <Entrada type="date" value={expedicion} onChange={(e) => setExpedicion(e.target.value)} />
          </Campo>
          <Campo etiqueta="Nuevo vencimiento" requerido>
            <Entrada
              type="date"
              value={vencimiento}
              onChange={(e) => setVencimiento(e.target.value)}
              required
            />
          </Campo>
        </div>
        <p className="text-xs text-slate-500">
          La renovación crea una nueva versión; el historial se conserva y el
          semáforo se recalcula de inmediato.
        </p>
        <ProblemAlert problema={renovar.isError ? problemaDe(renovar.error) : null} />
        <div className="flex justify-end">
          <BotonPrimario type="submit" disabled={renovar.isPending}>
            {renovar.isPending ? "Renovando…" : "Renovar"}
          </BotonPrimario>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------- Catálogo de tipos ------------------------------- */

export function useMutacionesCatalogo() {
  const api = useApi();
  const queryClient = useQueryClient();
  const invalidarCatalogo = () => {
    queryClient.invalidateQueries({ queryKey: ["catalogo"] });
    queryClient.invalidateQueries({ queryKey: ["cumplimiento"] });
  };

  const agregar = useMutation({
    mutationFn: async (cuerpo: schemas["AgregarTipoDocumentoRequest"]) =>
      desenvolver(await api.POST("/catalogo/tipos", { body: cuerpo })),
    onSuccess: invalidarCatalogo,
  });

  const actualizar = useMutation({
    mutationFn: async ({
      codigo,
      cambios,
    }: {
      codigo: string;
      cambios: { requerido?: boolean; activo?: boolean };
    }) =>
      desenvolver(
        await api.PATCH("/catalogo/tipos/{codigo}", {
          params: { path: { codigo } },
          body: cambios,
        }),
      ),
    onSuccess: invalidarCatalogo,
  });

  return { agregar, actualizar };
}
