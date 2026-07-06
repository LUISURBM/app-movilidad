"use client";

/**
 * Feature Cumplimiento (BC-4 Compliance & Documents, CORE).
 * Alertas de vencimiento + estado de cumplimiento por sujeto (Semáforo).
 */

import { useQuery } from "@tanstack/react-query";
import { desenvolver, useApi } from "@/lib/api";

/** Alertas de documentos por vencer / vencidos (spec-006). */
export function useAlertas(estado?: "por_vencer" | "vencido") {
  const api = useApi();
  return useQuery({
    queryKey: ["cumplimiento", "alertas", estado ?? "todas"],
    queryFn: async () =>
      desenvolver(
        await api.GET("/cumplimiento/alertas", {
          params: { query: { ...(estado ? { estado } : {}), pageSize: 100 } },
        }),
      ),
  });
}

/** Estado de cumplimiento (semáforo + documentos) de un vehículo o conductor. */
export function useCumplimientoSujeto(
  tipo: "vehiculo" | "conductor",
  id: string | undefined,
) {
  const api = useApi();
  return useQuery({
    queryKey: ["cumplimiento", tipo, id],
    enabled: Boolean(id),
    queryFn: async () =>
      desenvolver(
        tipo === "vehiculo"
          ? await api.GET("/cumplimiento/vehiculos/{vehiculoId}", {
              params: { path: { vehiculoId: id! } },
            })
          : await api.GET("/cumplimiento/conductores/{conductorId}", {
              params: { path: { conductorId: id! } },
            }),
      ),
  });
}

/**
 * Mapa id → etiqueta legible (placa / nombre) para mostrar sujetos en alertas
 * y documentos. Flota pequeña (bootstrapping): dos listas cacheadas bastan.
 */
export function useMapaSujetos() {
  const api = useApi();
  return useQuery({
    queryKey: ["sujetos", "mapa"],
    staleTime: 60_000,
    queryFn: async () => {
      const [vehiculos, conductores] = await Promise.all([
        api.GET("/vehiculos", { params: { query: { pageSize: 200 } } }),
        api.GET("/conductores", { params: { query: { pageSize: 200 } } }),
      ]);
      const mapa = new Map<string, string>();
      for (const v of desenvolver(vehiculos).items ?? []) mapa.set(v.id, v.placa);
      for (const c of desenvolver(conductores).items ?? []) mapa.set(c.id, c.nombre);
      return mapa;
    },
  });
}

/** Ruta del detalle de un sujeto. */
export function rutaSujeto(tipo: "vehiculo" | "conductor", id: string): string {
  return tipo === "vehiculo" ? `/vehiculos/${id}` : `/conductores/${id}`;
}
