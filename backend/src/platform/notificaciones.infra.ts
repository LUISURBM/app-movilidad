/**
 * Adaptadores REALES de notificaciones (cierra el gap de entrega de spec-006 R4/R6):
 *
 *  - `SmtpCanal`: email por SMTP (nodemailer detrás de un puerto `Mailer` mínimo,
 *    inyectable en pruebas). Si el envío falla, LANZA → el OutboxDispatcher
 *    reintenta con backoff (al menos una vez, ADR-0004).
 *  - `SqlDirectorioContactos`: los destinatarios reales del tenant — usuarios
 *    ACTIVOS con rol Administrador u Operador (tabla `usuario`, spec-002).
 *
 * Config (ver infrastructure/docker/.env.example):
 *   FLEETSPECIAL_SMTP_URL  = smtp://usuario:clave@host:587  (smtps:// para 465)
 *   FLEETSPECIAL_SMTP_FROM = "FleetSpecial <alertas@sudominio.co>"
 * Sin FLEETSPECIAL_SMTP_URL el canal sigue siendo consola (dev).
 */
import nodemailer from "nodemailer";
import { DataSource } from "typeorm";
import { CanalNotificacion, Contacto, DirectorioContactos, Mensaje } from "./notificaciones";

/** Superficie mínima que usamos de nodemailer (inyectable en pruebas). */
export interface Mailer {
  sendMail(opciones: {
    from: string;
    to: string[];
    subject: string;
    text: string;
  }): Promise<unknown>;
}

export class SmtpCanal implements CanalNotificacion {
  constructor(
    private readonly mailer: Mailer,
    private readonly remitente: string,
  ) {}

  async enviar(m: Mensaje): Promise<void> {
    const correos = m.destinatarios
      .map((c) => c.email?.trim())
      .filter((e): e is string => Boolean(e));
    if (correos.length === 0) return; // sin emails: no-op (no bloquear el outbox)

    // Cualquier error del transporte se propaga: el dispatcher reintenta.
    await this.mailer.sendMail({
      from: this.remitente,
      to: correos,
      subject: m.asunto,
      text: `${m.cuerpo}\n\n— FleetSpecial`,
    });
  }
}

/** Construye el canal SMTP desde la URL de entorno (nodemailer real). */
export function smtpCanalDesdeEnv(): SmtpCanal | null {
  const url = process.env.FLEETSPECIAL_SMTP_URL?.trim();
  if (!url) return null;
  const remitente =
    process.env.FLEETSPECIAL_SMTP_FROM?.trim() || "FleetSpecial <no-responder@fleetspecial>";
  const transporte = nodemailer.createTransport(url);
  return new SmtpCanal(transporte as unknown as Mailer, remitente);
}

/**
 * Destinatarios operativos del tenant: usuarios ACTIVOS con rol Administrador u
 * Operador. (`roles` es text[] en la migración 0007; `&&` = solapamiento.)
 */
export class SqlDirectorioContactos implements DirectorioContactos {
  constructor(private readonly dataSource: DataSource) {}

  async contactosDeTenant(tenantId: string): Promise<Contacto[]> {
    const filas: Array<{ nombre: string; correo: string }> = await this.dataSource.query(
      `SELECT nombre, correo
         FROM usuario
        WHERE tenant_id = $1
          AND estado = 'activo'
          AND roles && ARRAY['Administrador','Operador']::text[]`,
      [tenantId],
    );
    return filas.map((f) => ({ nombre: f.nombre, email: f.correo }));
  }
}
