"use client";

/**
 * Feature Documentos (BC-4 Compliance & Documents, CORE).
 * Registrar (spec-005), renovar (spec-007) y catálogo de tipos configurable.
 * Un tipo `requerido` ausente pone al sujeto en rojo (invariante I3).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
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

/* ------------------------------- Adjuntos ------------------------------------ */

const ADJUNTO_MAX_BYTES = 5 * 1024 * 1024;
const ADJUNTO_MIMES = ["application/pdf", "image/jpeg", "image/png"];

/**
 * Celda de adjunto (spec-005 R5): subir/reemplazar (PUT octet-stream) y ver
 * (GET → blob → nueva pestaña). El servidor re-valida tipo y tamaño.
 */
export function CeldaAdjunto({ documento }: { documento: Documento }) {
  const api = useApi();
  const invalidar = usarInvalidacionDocumentos();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const subir = useMutation({
    mutationFn: async (archivo: File) => {
      if (!ADJUNTO_MIMES.includes(archivo.type)) {
        throw new Error("Solo se aceptan PDF, JPG o PNG.");
      }
      if (archivo.size > ADJUNTO_MAX_BYTES) {
        throw new Error("El archivo supera el máximo de 5 MB.");
      }
      const r = await api.PUT("/documentos/{documentoId}/adjunto", {
        params: { path: { documentoId: documento.id } },
        body: archivo as unknown as string,
        bodySerializer: (b) => b as unknown as BodyInit,
        headers: { "Content-Type": archivo.type },
      });
      return desenvolver(r);
    },
    onSuccess: () => {
      setError(null);
      invalidar();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "No se pudo subir."),
  });

  const ver = useMutation({
    mutationFn: async () => {
      const r = await api.GET("/documentos/{documentoId}/adjunto", {
        params: { path: { documentoId: documento.id } },
        parseAs: "blob",
      });
      const blob = desenvolver(r) as Blob;
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "No se pudo abrir."),
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex justify-end gap-2">
        {documento.tieneAdjunto ? (
          <button
            onClick={() => ver.mutate()}
            disabled={ver.isPending}
            className="text-sm font-medium text-marca-700 hover:underline disabled:opacity-50"
          >
            {ver.isPending ? "Abriendo…" : "Ver"}
          </button>
        ) : null}
        <button
          onClick={() => inputRef.current?.click()}
          disabled={subir.isPending}
          className="text-sm font-medium text-marca-700 hover:underline disabled:opacity-50"
        >
          {subir.isPending ? "Subiendo…" : documento.tieneAdjunto ? "Reemplazar" : "Subir"}
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept={ADJUNTO_MIMES.join(",")}
        className="hidden"
        aria-label={`Adjunto de ${documento.tipo}`}
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          e.target.value = "";
          if (archivo) subir.mutate(archivo);
        }}
      />
    </div>
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
