/**
 * AuthController — endpoints REST de spec-015.
 *  POST /auth/login               PÚBLICO: correo + contraseña → JWT de sesión.
 *  POST /auth/aceptar-invitacion  PÚBLICO: código de un solo uso + contraseña → Activo + sesión.
 *  POST /auth/password            AUTENTICADO: cambiar la contraseña propia.
 *
 * Las rutas públicas están exentas en dev-auth.middleware (security: [] del contrato).
 */
import { Body, Controller, HttpCode, HttpException, Inject, Post } from "@nestjs/common";
import { TENANT_CONTEXT, TenantContext } from "../../../platform/tenant-context";
import {
  AceptarInvitacionConCodigo,
  CambiarPassword,
  IniciarSesion,
  SesionCreada,
} from "../application/auth.use-cases";
import { tenantToDto, usuarioToDto } from "./mappers";
import { UsuarioDto } from "./dtos";
import { problemFromDomainError } from "./error-mapping";

interface LoginRequestDto {
  correo: string;
  password: string;
  empresaNit?: string;
}

interface AceptarInvitacionRequestDto {
  codigo: string;
  password: string;
}

interface CambiarPasswordRequestDto {
  actual: string;
  nueva: string;
}

/** SesionCreada del contrato (spec-015). */
interface SesionCreadaDto {
  token: string;
  expiraEn: string;
  usuario: UsuarioDto;
  tenant: { id: string; razonSocial: string };
}

function aSesionDto(s: SesionCreada): SesionCreadaDto {
  const tenant = tenantToDto(s.tenant);
  return {
    token: s.sesion.token,
    expiraEn: s.sesion.expiraEn,
    usuario: usuarioToDto(s.usuario),
    tenant: { id: tenant.id, razonSocial: tenant.razonSocial },
  };
}

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(IniciarSesion) private readonly iniciarSesion: IniciarSesion,
    @Inject(AceptarInvitacionConCodigo)
    private readonly aceptarInvitacion: AceptarInvitacionConCodigo,
    @Inject(CambiarPassword) private readonly cambiarPassword: CambiarPassword,
    @Inject(TENANT_CONTEXT) private readonly ctx: TenantContext,
  ) {}

  @Post("login")
  @HttpCode(200)
  async login(@Body() body: LoginRequestDto): Promise<SesionCreadaDto> {
    const r = await this.iniciarSesion.execute({
      correo: body.correo ?? "",
      password: body.password ?? "",
      empresaNit: body.empresaNit,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, "/v1/auth/login");
      throw new HttpException(problem, problem.status);
    }
    return aSesionDto(r.value);
  }

  @Post("aceptar-invitacion")
  @HttpCode(200)
  async aceptar(@Body() body: AceptarInvitacionRequestDto): Promise<SesionCreadaDto> {
    const r = await this.aceptarInvitacion.execute({
      codigo: body.codigo ?? "",
      password: body.password ?? "",
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, "/v1/auth/aceptar-invitacion");
      throw new HttpException(problem, problem.status);
    }
    return aSesionDto(r.value);
  }

  @Post("password")
  @HttpCode(204)
  async password(@Body() body: CambiarPasswordRequestDto): Promise<void> {
    const r = await this.cambiarPassword.execute({
      tenant: this.ctx.tenantId,
      usuarioId: this.ctx.usuarioId,
      actual: body.actual ?? "",
      nueva: body.nueva ?? "",
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, "/v1/auth/password");
      throw new HttpException(problem, problem.status);
    }
  }
}
