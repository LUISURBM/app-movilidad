/**
 * Recuperación de contraseña (spec-015, sección recuperación) — desbloqueada por
 * el canal de email real. Mismo patrón que la invitación: código de un solo uso,
 * solo su hash en la base, expira (1 hora).
 *
 * Anti-enumeración: solicitar SIEMPRE devuelve ok, exista o no el correo. El
 * único error visible es de plataforma (canal caído) o el límite de intentos.
 */
import { Clock, DomainError, Result, TenantId, err, ok } from "../../../shared/kernel";
import { CanalNotificacion } from "../../../platform/notificaciones";
import { UsuarioRepository } from "./ports";
import {
  CredencialRepository,
  GeneradorCodigos,
  HasherPassword,
  InvitacionRepository,
} from "./auth.ports";
import {
  hashCodigoInvitacion,
  LimitadorIntentos,
  normalizarCorreo,
  PASSWORD_MIN_LARGO,
} from "./auth.use-cases";

const RECUPERACION_MINUTOS = 60;

export interface RecuperacionDeps {
  credenciales: CredencialRepository;
  /** Mismo contrato que las invitaciones (codigoHash + consumir); tabla 0012. */
  recuperaciones: InvitacionRepository;
  usuarios: UsuarioRepository;
  hasher: HasherPassword;
  codigos: GeneradorCodigos;
  canal: CanalNotificacion;
  clock: Clock;
}

export class SolicitarRecuperacion {
  private readonly limitador: LimitadorIntentos;

  constructor(
    private readonly deps: RecuperacionDeps,
    limitador?: LimitadorIntentos,
  ) {
    // 3 solicitudes por correo cada 15 minutos (contrato: 429).
    this.limitador = limitador ?? new LimitadorIntentos(3);
  }

  async execute(input: { correo: string }): Promise<Result<void>> {
    const correo = normalizarCorreo(input.correo);
    if (this.limitador.bloqueado(correo)) {
      return err(
        new DomainError(
          "demasiados_intentos",
          "Demasiadas solicitudes para ese correo. Espere unos minutos.",
        ),
      );
    }
    this.limitador.registrarFallo(correo); // cada solicitud cuenta

    const candidatas = await this.deps.credenciales.buscarPorCorreo(correo);
    // Anti-enumeración: sin credencial (o correo en varias empresas: se envía a
    // cada una) la respuesta es idéntica.
    for (const credencial of candidatas) {
      const usuario = await this.deps.usuarios.findById(
        credencial.tenantId as TenantId,
        credencial.usuarioId,
      );
      if (!usuario) continue;

      const codigo = this.deps.codigos.generar();
      await this.deps.recuperaciones.guardar({
        codigoHash: hashCodigoInvitacion(codigo),
        tenantId: credencial.tenantId,
        usuarioId: credencial.usuarioId,
        expiraEn: new Date(
          this.deps.clock.now().getTime() + RECUPERACION_MINUTOS * 60 * 1000,
        ).toISOString(),
      });

      try {
        await this.deps.canal.enviar({
          tenantId: credencial.tenantId,
          asunto: "Recuperación de contraseña — FleetSpecial",
          cuerpo:
            `Hola ${usuario.nombre}:\n\n` +
            `Alguien (ojalá usted) pidió restablecer su contraseña. Use este código ` +
            `en la pantalla de ingreso (vence en ${RECUPERACION_MINUTOS} minutos y sirve UNA sola vez):\n\n` +
            `    ${codigo}\n\n` +
            `Si no fue usted, ignore este correo: su contraseña sigue igual.`,
          destinatarios: [{ nombre: usuario.nombre, email: correo }],
        });
      } catch {
        return err(
          new DomainError(
            "notificacion_no_disponible",
            "No se pudo enviar el correo de recuperación. Intente más tarde.",
          ),
        );
      }
    }
    return ok(undefined);
  }
}

export class RestablecerPassword {
  constructor(private readonly deps: RecuperacionDeps) {}

  async execute(input: { codigo: string; password: string }): Promise<Result<void>> {
    if (!input.password || input.password.length < PASSWORD_MIN_LARGO) {
      return err(
        new DomainError(
          "password_debil",
          `La contraseña debe tener al menos ${PASSWORD_MIN_LARGO} caracteres.`,
        ),
      );
    }
    const NO_VALIDO = new DomainError(
      "recuperacion_no_valida",
      "El código no existe, ya fue usado o está vencido.",
    );
    const codigo = (input.codigo ?? "").trim();
    if (!codigo) return err(NO_VALIDO);

    const pendiente = await this.deps.recuperaciones.consumir(
      hashCodigoInvitacion(codigo),
      this.deps.clock.now(),
    );
    if (!pendiente) return err(NO_VALIDO);

    const credencial = await this.deps.credenciales.obtener(
      pendiente.tenantId,
      pendiente.usuarioId,
    );
    if (!credencial) return err(NO_VALIDO);

    await this.deps.credenciales.guardar({
      ...credencial,
      passwordHash: await this.deps.hasher.derivar(input.password),
    });
    return ok(undefined);
  }
}
