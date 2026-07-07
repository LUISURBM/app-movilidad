/**
 * UsuariosController — endpoints REST del contrato openapi.yaml para Usuarios (spec-002).
 *  POST  /usuarios              Invitar (solo Administrador/Owner — RBAC).
 *  GET   /usuarios              Listar usuarios del Tenant.
 *  PATCH /usuarios/{usuarioId}  Actualizar roles / estado (suspender/reactivar).
 *
 * El tenant y los roles del solicitante salen del contexto de auth (ADR-0008).
 */
import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Patch, Post } from "@nestjs/common";
import { TENANT_CONTEXT, TenantContext } from "../../../platform/tenant-context";
import { ActualizarUsuario, InvitarUsuario } from "../application/use-cases";
import { UsuarioRepository } from "../application/ports";
import { EstadoUsuario } from "../domain/value-objects";
import { USUARIO_REPOSITORY } from "./tokens";
import { usuarioToDto } from "./mappers";
import {
  ActualizarUsuarioRequestDto,
  InvitarUsuarioRequestDto,
  UsuarioDto,
  UsuarioInvitadoResponseDto,
  UsuariosPaginaDto,
} from "./dtos";
import { problemFromDomainError } from "./error-mapping";

@Controller("usuarios")
export class UsuariosController {
  constructor(
    @Inject(InvitarUsuario) private readonly invitar: InvitarUsuario,
    @Inject(ActualizarUsuario) private readonly actualizar: ActualizarUsuario,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepository,
    @Inject(TENANT_CONTEXT) private readonly ctx: TenantContext,
  ) {}

  @Post()
  @HttpCode(201)
  async invitarUsuario(
    @Body() body: InvitarUsuarioRequestDto,
  ): Promise<UsuarioInvitadoResponseDto> {
    const r = await this.invitar.execute({
      tenant: this.ctx.tenantId,
      solicitanteRoles: this.ctx.roles,
      nombre: body.nombre,
      correo: body.correo,
      roles: body.roles,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, "/v1/usuarios");
      throw new HttpException(problem, problem.status);
    }
    const u = await this.usuarios.findById(this.ctx.tenantId, r.value.usuarioId);
    // spec-015: el código de invitación viaja SOLO en esta respuesta (el server
    // guarda su hash). El Administrador lo entrega a la persona invitada.
    return { ...usuarioToDto(u!), ...(r.value.invitacion ? { invitacion: r.value.invitacion } : {}) };
  }

  @Get()
  async listarUsuarios(): Promise<UsuariosPaginaDto> {
    const items = (await this.usuarios.list(this.ctx.tenantId))
      // El listado operativo excluye removidos/expirados (contrato: invitado|activo|suspendido).
      .filter((u) => u.estado !== EstadoUsuario.Removido && u.estado !== EstadoUsuario.Expirado)
      .map(usuarioToDto);
    return { items, page: 1, pageSize: items.length, total: items.length };
  }

  @Patch(":usuarioId")
  async actualizarUsuario(
    @Param("usuarioId") usuarioId: string,
    @Body() body: ActualizarUsuarioRequestDto,
  ): Promise<UsuarioDto> {
    const r = await this.actualizar.execute({
      tenant: this.ctx.tenantId,
      solicitanteRoles: this.ctx.roles,
      usuarioId,
      roles: body.roles,
      estado: body.estado,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, `/v1/usuarios/${usuarioId}`);
      throw new HttpException(problem, problem.status);
    }
    const u = await this.usuarios.findById(this.ctx.tenantId, usuarioId);
    return usuarioToDto(u!);
  }
}
