/**
 * Value Objects del contexto Identity & Access (BC-1) — spec-001 / spec-002.
 * Inmutables, validados en construcción. Sin dependencias de framework.
 */
import { DomainError } from "../../../shared/kernel";

/** Correo electrónico validado (anti-typo básico). spec-001 R1, spec-002 R2. */
export class Correo {
  private static readonly PATRON = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  private constructor(public readonly valor: string) {}

  static de(v: string): Correo {
    const norm = (v ?? "").trim().toLowerCase();
    if (!Correo.PATRON.test(norm)) {
      throw new DomainError("correo_invalido", `Correo inválido: "${v}".`);
    }
    return new Correo(norm);
  }

  equals(other: Correo): boolean {
    return this.valor === other.valor;
  }
}

/** Plan de la Suscripción (contrato openapi.yaml). spec-001 R6 crea Free por defecto. */
export enum PlanSuscripcion {
  Free = "Free",
  Starter = "Starter",
  Pro = "Pro",
  Enterprise = "Enterprise",
}

/**
 * Ciclo de vida del Usuario. spec-002 R7:
 * Invitado → Activo → (Suspendido ↔ Activo) → Removido; Invitado → Expirado.
 * (El contrato REST solo expone invitado|activo|suspendido; removido/expirado son
 * estados de dominio que no se listan como usuarios operativos.)
 */
export enum EstadoUsuario {
  Invitado = "invitado",
  Activo = "activo",
  Suspendido = "suspendido",
  Removido = "removido",
  Expirado = "expirado",
}

/**
 * Evidencia del consentimiento Habeas Data (Ley 1581/2012). spec-001 R3/R4:
 * obligatorio y previo a crear el Tenant; se registra versión, fecha y titular.
 */
export class Consentimiento {
  private constructor(
    public readonly version: string,
    public readonly aceptadoEn: string, // ISO date-time
    public readonly titular: string, // correo del titular
  ) {}

  static aceptar(params: { version: string; aceptadoEn: string; titular: string }): Consentimiento {
    const version = (params.version ?? "").trim();
    if (!version) {
      throw new DomainError("version_politica_requerida", "Debe indicarse la versión de la política aceptada.");
    }
    return new Consentimiento(version, params.aceptadoEn, params.titular);
  }
}
