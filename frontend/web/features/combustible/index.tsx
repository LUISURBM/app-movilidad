"use client";

/**
 * Feature Combustible (BC-6 Fuel Management).
 * Los tanqueos son append-only y llegan desde la app del conductor (spec-011);
 * el portal los consulta (control de gasto y monotonía del odómetro).
 */

import { useQuery } from "@tanstack/react-query";
import { desenvolver, useApi } from "@/lib/api";

export function useTanqueos(vehiculoId?: string, page = 1) {
  const api = useApi();
  return useQuery({
    queryKey: ["combustible", vehiculoId ?? "todos", page],
    queryFn: async () =>
      desenvolver(
        await api.GET("/combustible", {
          params: {
            query: {
              ...(vehiculoId ? { vehiculoId } : {}),
              page,
              pageSize: 50,
            },
          },
        }),
      ),
  });
}
