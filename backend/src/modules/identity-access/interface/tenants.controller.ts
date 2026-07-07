/**
 * TenantsController — endpoints REST del contrato openapi.yaml para Empresas (spec-001).
 *  POST /tenants      Onboarding PÚBLICO (sin JWT): crea Tenant + Admin + consentimiento.
 *  GET  /tenants/me   Datos de la Empresa del contexto autenticado.
 */
import { Body, Controller, Get, HttpCode, HttpException, Inject, Post } from "@nestjs/common";
import { TenantId } from "../../../shared/kernel";
import { TENANT_CONTEXT, TenantContext } from "../../../platform/tenant-context";
import { RegistrarTenant } from "../application/use-cases";
import { TenantRepository, UsuarioRepository } from "../application/ports";
import { TENANT_REPOSITORY, USUARIO_REPOSITORY } from "./tokens";
import { tenantToDto, usuarioToDto } from "./mappers";
import { RegistrarTenantRequestDto, TenantCreadoDto, TenantDto } from "./dtos";
import { problemFromDomainError } from "./error-mapping";

@Controller("tenants")
export class TenantsController {
  constructor(
    @Inject(RegistrarTenant) private readonly registrar: RegistrarTenant,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepository,
    @Inject(TENANT_CONTEXT) private readonly ctx: TenantContext,
  ) {}

  @Post()
  @HttpCode(201)
  async registrarTenant(@Body() body: RegistrarTenantRequestDto): Promise<TenantCreadoDto> {
    const r = await this.registrar.execute({
      empresa: { razonSocial: body.empresa?.razonSocial, nit: body.empresa?.nit },
      administrador: {
        nombre: body.administrador?.nombre,
        correo: body.administrador?.correo,
        // spec-015: contraseña del primer admin (requerida por el contrato).
        password: body.administrador?.password,
      },
      aceptaTratamientoDatos: body.aceptaTratamientoDatos,
    });
    if (!r.ok) {
      const problem = problemFromDomainError(r.error, "/v1/tenants");
      throw new HttpException(problem, problem.status);
    }
    const tenant = await this.tenants.findById(r.value.tenantId);
    const admin = await this.usuarios.findById(r.value.tenantId as TenantId, r.value.adminUsuarioId);
    return { tenant: tenantToDto(tenant!), administrador: usuarioToDto(admin!) };
  }

  @Get("me")
  async miEmpresa(): Promise<TenantDto> {
    const tenant = await this.tenants.findById(this.ctx.tenantId);
    if (!tenant) {
      throw new HttpException({ type: "tenant_no_encontrado", title: "Empresa no encontrada", status: 404 }, 404);
    }
    return tenantToDto(tenant);
  }
}
