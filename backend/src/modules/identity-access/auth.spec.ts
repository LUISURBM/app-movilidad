/**
 * Pruebas de spec-015 (autenticación con credenciales), derivadas de los Gherkin:
 * hasher scrypt real, login (ok / inválidas / no activo / multiples empresas),
 * invitación de un solo uso y cambio de contraseña.
 */
import { describe, expect, it } from "vitest";
import { SequentialIdGenerator, SystemClock, TenantId } from "../../shared/kernel";
import {
  InMemoryEventPublisher,
  InMemoryTenantRepository,
  InMemoryUsuarioRepository,
} from "./application/in-memory.adapters";
import {
  InMemoryCredencialRepository,
  InMemoryInvitacionRepository,
} from "./application/auth.in-memory";
import {
  EmisorTokensJwt,
  GeneradorCodigosAleatorio,
  ScryptHasher,
} from "./infrastructure/auth-adapters";
import { IdentityDeps, InvitarUsuario, RegistrarTenant } from "./application/use-cases";
import {
  AceptarInvitacionConCodigo,
  AuthDeps,
  CambiarPassword,
  hashCodigoInvitacion,
  IniciarSesion,
} from "./application/auth.use-cases";

const PASSWORD = "clave-segura-123";

function nuevoEntorno() {
  const tenants = new InMemoryTenantRepository();
  const usuarios = new InMemoryUsuarioRepository();
  const credenciales = new InMemoryCredencialRepository();
  const invitaciones = new InMemoryInvitacionRepository();
  const hasher = new ScryptHasher();
  const emisor = new EmisorTokensJwt(() => "secreto-de-prueba");
  const clock = new SystemClock();

  const identityDeps: IdentityDeps = {
    tenants,
    usuarios,
    publisher: new InMemoryEventPublisher(),
    clock,
    ids: new SequentialIdGenerator("usr"),
    auth: { credenciales, invitaciones, hasher, codigos: new GeneradorCodigosAleatorio() },
  };
  const authDeps: AuthDeps = { credenciales, invitaciones, usuarios, tenants, hasher, emisor, clock };

  return { identityDeps, authDeps, invitaciones, usuarios };
}

async function registrarEmpresa(
  deps: IdentityDeps,
  correo = "luis@duster.co",
  nit?: string,
): Promise<{ tenantId: string; adminUsuarioId: string }> {
  const r = await new RegistrarTenant(deps).execute({
    empresa: { razonSocial: "Transporte Duster SAS", nit },
    administrador: { nombre: "Luis", correo, password: PASSWORD },
    aceptaTratamientoDatos: true,
  });
  if (!r.ok) throw new Error(`registro falló: ${!r.ok && r.error.code}`);
  return r.value;
}

describe("spec-015 — hasher scrypt", () => {
  it("deriva y verifica; rechaza contraseña equivocada y hash corrupto", async () => {
    const hasher = new ScryptHasher();
    const hash = await hasher.derivar(PASSWORD);
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await hasher.verificar(PASSWORD, hash)).toBe(true);
    expect(await hasher.verificar("otra-clave-999", hash)).toBe(false);
    expect(await hasher.verificar(PASSWORD, "basura")).toBe(false);
  });
});

describe("spec-015 — iniciar sesión", () => {
  it("el administrador entra con la contraseña del registro y recibe token con claims", async () => {
    const env = nuevoEntorno();
    const { tenantId, adminUsuarioId } = await registrarEmpresa(env.identityDeps);

    const r = await new IniciarSesion(env.authDeps).execute({
      correo: "LUIS@duster.co", // el correo se normaliza
      password: PASSWORD,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.usuario.id).toBe(adminUsuarioId);
      expect(r.value.tenant.id).toBe(tenantId);
      expect(r.value.sesion.token.split(".")).toHaveLength(3);
      expect(r.value.sesion.expiraEn > new Date().toISOString()).toBe(true);
    }
  });

  it("credenciales inválidas: mismo error para correo inexistente y contraseña errada", async () => {
    const env = nuevoEntorno();
    await registrarEmpresa(env.identityDeps);
    const login = new IniciarSesion(env.authDeps);

    const inexistente = await login.execute({ correo: "nadie@x.co", password: PASSWORD });
    const errada = await login.execute({ correo: "luis@duster.co", password: "mala-clave-000" });
    expect(!inexistente.ok && inexistente.error.code).toBe("credenciales_invalidas");
    expect(!errada.ok && errada.error.code).toBe("credenciales_invalidas");
  });

  it("mismo correo en dos Empresas: 409 y desambiguación por NIT", async () => {
    const env = nuevoEntorno();
    // Nota: correoRegistro es único global (R7), pero la CREDENCIAL puede repetirse
    // entre tenants (usuarios invitados). Simulamos la segunda credencial directa.
    const { tenantId } = await registrarEmpresa(env.identityDeps, "conta@externa.co", "900111222");
    await env.authDeps.credenciales.guardar({
      tenantId: "tenant-b",
      usuarioId: "usr-b",
      correo: "conta@externa.co",
      passwordHash: await env.authDeps.hasher.derivar(PASSWORD),
    });

    const login = new IniciarSesion(env.authDeps);
    const ambiguo = await login.execute({ correo: "conta@externa.co", password: PASSWORD });
    expect(!ambiguo.ok && ambiguo.error.code).toBe("multiples_empresas");

    const conNit = await login.execute({
      correo: "conta@externa.co",
      password: PASSWORD,
      empresaNit: "900111222",
    });
    expect(conNit.ok && conNit.value.tenant.id === tenantId).toBe(true);
  });

  it("sin emisor configurado responde auth_no_configurada", async () => {
    const env = nuevoEntorno();
    await registrarEmpresa(env.identityDeps);
    const sinSecreto = new IniciarSesion({
      ...env.authDeps,
      emisor: new EmisorTokensJwt(() => undefined),
    });
    const r = await sinSecreto.execute({ correo: "luis@duster.co", password: PASSWORD });
    expect(!r.ok && r.error.code).toBe("auth_no_configurada");
  });
});

describe("spec-015 — invitación de un solo uso", () => {
  it("invitar genera código; aceptarlo activa al usuario, da sesión y el código muere", async () => {
    const env = nuevoEntorno();
    const { tenantId } = await registrarEmpresa(env.identityDeps);

    const inv = await new InvitarUsuario(env.identityDeps).execute({
      tenant: tenantId as TenantId,
      solicitanteRoles: ["Administrador"],
      nombre: "Ana",
      correo: "ana@duster.co",
      roles: ["Operador"],
    });
    expect(inv.ok && Boolean(inv.value.invitacion)).toBe(true);
    const codigo = inv.ok ? inv.value.invitacion! : "";

    const aceptar = new AceptarInvitacionConCodigo(env.authDeps);
    const ok1 = await aceptar.execute({ codigo, password: "clave-de-ana-77" });
    expect(ok1.ok && ok1.value.usuario.estado).toBe("activo");

    // Un solo uso.
    const ok2 = await aceptar.execute({ codigo, password: "clave-de-ana-77" });
    expect(!ok2.ok && ok2.error.code).toBe("invitacion_no_valida");

    // Y Ana ya puede iniciar sesión.
    const login = await new IniciarSesion(env.authDeps).execute({
      correo: "ana@duster.co",
      password: "clave-de-ana-77",
    });
    expect(login.ok).toBe(true);
  });

  it("una invitación vencida no vale (y también se consume)", async () => {
    const env = nuevoEntorno();
    const { tenantId } = await registrarEmpresa(env.identityDeps);
    await env.invitaciones.guardar({
      codigoHash: hashCodigoInvitacion("codigo-viejo"),
      tenantId,
      usuarioId: "usr-x",
      expiraEn: new Date(Date.now() - 1000).toISOString(),
    });
    const r = await new AceptarInvitacionConCodigo(env.authDeps).execute({
      codigo: "codigo-viejo",
      password: "clave-cualquiera-9",
    });
    expect(!r.ok && r.error.code).toBe("invitacion_no_valida");
  });

  it("password débil se rechaza SIN consumir el código", async () => {
    const env = nuevoEntorno();
    const { tenantId } = await registrarEmpresa(env.identityDeps);
    const inv = await new InvitarUsuario(env.identityDeps).execute({
      tenant: tenantId as TenantId,
      solicitanteRoles: ["Administrador"],
      nombre: "Beto",
      correo: "beto@duster.co",
      roles: ["Conductor"],
    });
    const codigo = inv.ok ? inv.value.invitacion! : "";
    const aceptar = new AceptarInvitacionConCodigo(env.authDeps);

    const corta = await aceptar.execute({ codigo, password: "corta" });
    expect(!corta.ok && corta.error.code).toBe("password_debil");

    // El código sigue vivo: ahora sí funciona.
    const buena = await aceptar.execute({ codigo, password: "clave-de-beto-88" });
    expect(buena.ok).toBe(true);
  });
});

describe("spec-015 — cambiar contraseña", () => {
  it("exige la actual; la nueva entra y la vieja deja de servir", async () => {
    const env = nuevoEntorno();
    const { tenantId, adminUsuarioId } = await registrarEmpresa(env.identityDeps);
    const cambiar = new CambiarPassword(env.authDeps);

    const malActual = await cambiar.execute({
      tenant: tenantId as TenantId,
      usuarioId: adminUsuarioId,
      actual: "no-es-la-actual",
      nueva: "clave-nueva-2026",
    });
    expect(!malActual.ok && malActual.error.code).toBe("credenciales_invalidas");

    const ok = await cambiar.execute({
      tenant: tenantId as TenantId,
      usuarioId: adminUsuarioId,
      actual: PASSWORD,
      nueva: "clave-nueva-2026",
    });
    expect(ok.ok).toBe(true);

    const login = new IniciarSesion(env.authDeps);
    const vieja = await login.execute({ correo: "luis@duster.co", password: PASSWORD });
    const nueva = await login.execute({ correo: "luis@duster.co", password: "clave-nueva-2026" });
    expect(!vieja.ok && vieja.error.code).toBe("credenciales_invalidas");
    expect(nueva.ok).toBe(true);
  });
});
