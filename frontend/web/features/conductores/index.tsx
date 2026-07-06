"use client";

/**
 * Feature Conductores (BC-3 Driver Management).
 * La licencia se materializa como Documento LICENCIA en Compliance (spec-004 R5),
 * por eso alimenta el Semáforo y la regla de oro.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { desenvolver, problemaDe, useApi } from "@/lib/api";
import {
  BotonPrimario,
  Campo,
  Entrada,
  Modal,
  ProblemAlert,
} from "@/shared/ui";

export function useConductores(page = 1) {
  const api = useApi();
  return useQuery({
    queryKey: ["conductores", page],
    queryFn: async () =>
      desenvolver(
        await api.GET("/conductores", {
          params: { query: { page, pageSize: 50 } },
        }),
      ),
  });
}

export function useConductor(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ["conductores", "detalle", id],
    enabled: Boolean(id),
    queryFn: async () =>
      desenvolver(
        await api.GET("/conductores/{conductorId}", {
          params: { path: { conductorId: id! } },
        }),
      ),
  });
}

export function FormularioConductor({
  abierto,
  onCerrar,
}: {
  abierto: boolean;
  onCerrar: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState("");
  const [documento, setDocumento] = useState("");
  const [licNumero, setLicNumero] = useState("");
  const [licCategoria, setLicCategoria] = useState("C1");
  const [licVencimiento, setLicVencimiento] = useState("");

  const registrar = useMutation({
    mutationFn: async () =>
      desenvolver(
        await api.POST("/conductores", {
          body: {
            nombre: nombre.trim(),
            documentoIdentidad: documento.trim(),
            licencia: {
              numero: licNumero.trim(),
              categoria: licCategoria.trim().toUpperCase(),
              vencimiento: licVencimiento,
            },
          },
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conductores"] });
      queryClient.invalidateQueries({ queryKey: ["sujetos"] });
      queryClient.invalidateQueries({ queryKey: ["cumplimiento"] });
      queryClient.invalidateQueries({ queryKey: ["documentos"] });
      cerrar();
    },
  });

  function cerrar() {
    setNombre("");
    setDocumento("");
    setLicNumero("");
    setLicVencimiento("");
    registrar.reset();
    onCerrar();
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    registrar.mutate();
  }

  return (
    <Modal abierto={abierto} titulo="Registrar conductor" onCerrar={cerrar}>
      <form onSubmit={enviar} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Campo etiqueta="Nombre completo" requerido>
            <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          </Campo>
          <Campo etiqueta="Documento de identidad" requerido>
            <Entrada
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              placeholder="CC 1234567890"
              required
            />
          </Campo>
          <Campo etiqueta="Licencia — número" requerido>
            <Entrada value={licNumero} onChange={(e) => setLicNumero(e.target.value)} required />
          </Campo>
          <Campo etiqueta="Licencia — categoría" requerido>
            <Entrada
              value={licCategoria}
              onChange={(e) => setLicCategoria(e.target.value)}
              placeholder="C1"
              required
            />
          </Campo>
          <Campo etiqueta="Licencia — vencimiento" requerido>
            <Entrada
              type="date"
              value={licVencimiento}
              onChange={(e) => setLicVencimiento(e.target.value)}
              required
            />
          </Campo>
        </div>
        <p className="text-xs text-slate-500">
          La licencia queda registrada como documento de cumplimiento: su vencimiento
          alimenta el semáforo y bloquea asignaciones si está vencida.
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
