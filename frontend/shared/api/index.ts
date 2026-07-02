/**
 * Punto de entrada del SDK de API de FleetSpecial.
 *
 * Importa desde aquí en la app web (y, si se reutiliza, en otros consumidores TS):
 *   import { createFleetSpecialClient, type Vehiculo } from "@/shared/api";
 */
export * from "./client";
export type { paths, components, operations } from "./schema";
