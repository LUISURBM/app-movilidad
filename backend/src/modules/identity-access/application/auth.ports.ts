/**
 * Puertos de AUTENTICACIÓN (spec-015) — capa de aplicación de Identity & Access.
 *
 * Credenciales e invitaciones son PRE-TENANT por naturaleza (el login ocurre
 * antes de conocer el tenant), por eso sus repos consultan por correo/código a
 * través de todos los tenants (tablas sin RLS — spec-015 regla 10) y solo los
 * casos de uso de auth los usan.
 */

export interface Credencial {
  tenantId: string;
  usuarioId: string;
  /** Correo normalizado (minúsculas) — clave de búsqueda del login. */
  correo: string;
  /** Hash scrypt autodescriptivo (`scrypt$N$r$p$sal$hash`). Nunca la contraseña. */
  passwordHash: string;
}

export interface CredencialRepository {
  guardar(credencial: Credencial): Promise<void>;
  /** Todas las credenciales del correo (puede haber una por tenant — spec-002). */
  buscarPorCorreo(correo: string): Promise<Credencial[]>;
  obtener(tenantId: string, usuarioId: string): Promise<Credencial | null>;
}

export interface InvitacionPendiente {
  /** SHA-256 hex del código; el código en claro solo viaja al Administrador. */
  codigoHash: string;
  tenantId: string;
  usuarioId: string;
  /** ISO date-time. */
  expiraEn: string;
}

export interface InvitacionRepository {
  guardar(invitacion: InvitacionPendiente): Promise<void>;
  /**
   * Consume la invitación de un solo uso: la devuelve y la elimina SOLO si
   * existe y no está vencida a `ahora`; null en cualquier otro caso.
   */
  consumir(codigoHash: string, ahora: Date): Promise<InvitacionPendiente | null>;
}

export interface HasherPassword {
  derivar(password: string): Promise<string>;
  /** Comparación en tiempo constante contra el hash almacenado. */
  verificar(password: string, hash: string): Promise<boolean>;
}

export interface SesionEmitida {
  token: string;
  /** ISO date-time de expiración del token. */
  expiraEn: string;
}

/**
 * Emisor de tokens de sesión. Hoy: JWT HS256 con el secreto de plataforma.
 * Mañana: OIDC/Keycloak implementa este mismo puerto (costura anotada).
 */
export interface EmisorTokens {
  /** false cuando el servidor no tiene secreto configurado (→ 503). */
  disponible(): boolean;
  emitir(claims: { sub: string; tenantId: string; roles: readonly string[] }): SesionEmitida;
}

/** Códigos de invitación de un solo uso (alta entropía, URL-safe). */
export interface GeneradorCodigos {
  generar(): string;
}
