/**
 * Utilidades de presentación es-CO. Sin dependencias (anti-sobreingeniería):
 * Intl cubre fechas y moneda.
 */

import type { schemas } from "@fleetspecial/api";

type Problem = schemas["Problem"];

const fmtFecha = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });
const fmtFechaHora = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
});
const fmtCop = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

/** "2026-07-06" o ISO datetime → "6 jul 2026". Devuelve "—" si falta. */
export function fecha(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? "—" : fmtFecha.format(d);
}

/** ISO datetime → "6 jul 2026, 2:30 p. m.". */
export function fechaHora(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : fmtFechaHora.format(d);
}

/** Monto COP entero → "$ 250.000". */
export function cop(valor?: number | null): string {
  if (valor === undefined || valor === null) return "—";
  return fmtCop.format(valor);
}

/** Días restantes → texto humano ("vence en 3 días" / "vencido hace 2 días"). */
export function diasRestantesTexto(dias?: number): string {
  if (dias === undefined) return "";
  if (dias < 0) return `vencido hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? "" : "s"}`;
  if (dias === 0) return "vence hoy";
  return `vence en ${dias} día${dias === 1 ? "" : "s"}`;
}

/**
 * Traduce un Problem (RFC 7807) del backend a un mensaje accionable.
 * Los `detail` del backend ya vienen en español; aquí solo agregamos
 * encabezados según el tipo de conflicto del dominio.
 */
export function problemaAMensaje(p?: Problem | null, fallback = "Ocurrió un error."): string {
  if (!p) return fallback;
  const encabezados: Record<string, string> = {
    incumplimiento: "Bloqueado por la regla de oro",
    conflicto_horario: "Choque de agenda",
    duplicado: "Ya existe",
    estado_invalido: "Transición de estado no permitida",
  };
  const encabezado = p.type ? encabezados[p.type] : undefined;
  const detalle = p.detail ?? p.title ?? fallback;
  const porCampo = (p.errors ?? [])
    .map((e) => (e.campo ? `${e.campo}: ${e.mensaje ?? ""}` : e.mensaje ?? ""))
    .filter(Boolean)
    .join(" · ");
  const cuerpo = porCampo ? `${detalle} (${porCampo})` : detalle;
  return encabezado ? `${encabezado}: ${cuerpo}` : cuerpo;
}

/** Etiquetas es-CO para enums del contrato. */
export const etiquetaClaseVehiculo: Record<string, string> = {
  automovil: "Automóvil",
  camioneta: "Camioneta",
  van: "Van",
  microbus: "Microbús",
  bus: "Bus",
  campero: "Campero",
  otro: "Otro",
};

export const etiquetaEstadoServicio: Record<string, string> = {
  Planificado: "Planificado",
  Iniciado: "Iniciado",
  Finalizado: "Finalizado",
  Cancelado: "Cancelado",
};

export const etiquetaRol: Record<string, string> = {
  Administrador: "Administrador",
  Operador: "Operador",
  GestorPlanilla: "Gestor de planilla",
  RepresentanteLegal: "Representante legal",
  DuenoVehiculo: "Dueño de vehículo",
  Conductor: "Conductor",
};
