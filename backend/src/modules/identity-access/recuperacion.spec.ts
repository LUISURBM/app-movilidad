/**
 * Pruebas de la recuperación de contraseña (spec-015, sección recuperación):
 * código por email de un solo uso, anti-enumeración, límite y expiración.
 */
import { describe, expect, it } from "vitest";
import { SystemClock } from "../../shared/kernel";
import { Mensaje } from "../../platform/notificaciones";
import { InMemoryUsuarioRepository } from "./application/in-memory.adapters";
import {
  InMemoryCredencialRepository,
  InMemoryInvitacionRepository,
} from "./application/auth.in-memory";
import { GeneradorCodigosAleatorio, ScryptHasher } from "./infrastructure/auth-adapters";
import { Usuario } from "./domain/usuario.aggregate";
import { Correo } from "./domain/value-objects";
import { hashCodigoInvitacion, LimitadorIntentos } from "./application/auth.use-cases";
import {
  RecuperacionDeps,
  RestablecerPassword,
  SolicitarRecuperacion,
} from "./application/recuperacion.use-cases";

const TENANT = "tenant-duster";
const USUARIO = "usr-luis";
const CORREO = "luis@duster.co";

class CanalFalso {
  public readonly enviados: Mensaje[] = [];
  public fallar = false;
  async enviar(m: Mensaje): Promise<void> {
    if (this.fallar) throw new Error("SMTP caído");
    this.enviados.push(m);
  }
}

async function nuevoEntorno() {
  const credenciales = new InMemoryCredencialRepository();
  const recuperaciones = new InMemoryInvitacionRepository();
  const usuarios = new InMemoryUsuarioRepository();
  const hasher = new ScryptHasher();
  const canal = new CanalFalso();

  await usuarios.save(
    TENANT as never,
    Usuario.crearAdministrador({ id: USUARIO, tenantId: TENANT, nombre: "Luis", correo: Correo.de(CORREO) }),
  );
  await credenciales.guardar({
    tenantId: TENANT,
    usuarioId: USUARIO,
    correo: CORREO,
    passwordHash: await hasher.derivar("clave-original-1"),
  });

  const deps: RecuperacionDeps = {
    credenciales,
    recuperaciones,
    usuarios,
    hasher,
    codigos: new GeneradorCodigosAleatorio(),
    canal,
    clock: new SystemClock(),
  };
  return { deps, canal, credenciales, recuperaciones, hasher };
}

function codigoDelCorreo(m: Mensaje): string {
  const match = m.cuerpo.match(/\n\s{4}(\S+)\n/);
  if (!match) throw new Error("el correo no trae código");
  return match[1];
}

describe("spec-015 — recuperación de contraseña", () => {
  it("flujo completo: solicitar envía código al correo y restablecer cambia la clave", async () => {
    const { deps, canal, credenciales, hasher } = await nuevoEntorno();

    const sol = await new SolicitarRecuperacion(deps).execute({ correo: "LUIS@duster.co" });
    expect(sol.ok).toBe(true);
    expect(canal.enviados).toHaveLength(1);
    expect(canal.enviados[0].destinatarios[0].email).toBe(CORREO);

    const codigo = codigoDelCorreo(canal.enviados[0]);
    const res = await new RestablecerPassword(deps).execute({
      codigo,
      password: "clave-nueva-2026",
    });
    expect(res.ok).toBe(true);

    const credencial = await credenciales.obtener(TENANT, USUARIO);
    expect(await hasher.verificar("clave-nueva-2026", credencial!.passwordHash)).toBe(true);
    expect(await hasher.verificar("clave-original-1", credencial!.passwordHash)).toBe(false);

    // Un solo uso.
    const repetido = await new RestablecerPassword(deps).execute({
      codigo,
      password: "otra-clave-2026",
    });
    expect(!repetido.ok && repetido.error.code).toBe("recuperacion_no_valida");
  });

  it("anti-enumeración: correo inexistente responde ok y no envía nada", async () => {
    const { deps, canal } = await nuevoEntorno();
    const r = await new SolicitarRecuperacion(deps).execute({ correo: "nadie@x.co" });
    expect(r.ok).toBe(true);
    expect(canal.enviados).toHaveLength(0);
  });

  it("código vencido no vale (410)", async () => {
    const { deps, recuperaciones } = await nuevoEntorno();
    await recuperaciones.guardar({
      codigoHash: hashCodigoInvitacion("codigo-viejo"),
      tenantId: TENANT,
      usuarioId: USUARIO,
      expiraEn: new Date(Date.now() - 1000).toISOString(),
    });
    const r = await new RestablecerPassword(deps).execute({
      codigo: "codigo-viejo",
      password: "clave-nueva-2026",
    });
    expect(!r.ok && r.error.code).toBe("recuperacion_no_valida");
  });

  it("password débil se rechaza SIN consumir el código", async () => {
    const { deps, canal } = await nuevoEntorno();
    await new SolicitarRecuperacion(deps).execute({ correo: CORREO });
    const codigo = codigoDelCorreo(canal.enviados[0]);

    const corta = await new RestablecerPassword(deps).execute({ codigo, password: "corta" });
    expect(!corta.ok && corta.error.code).toBe("password_debil");

    const buena = await new RestablecerPassword(deps).execute({ codigo, password: "clave-nueva-2026" });
    expect(buena.ok).toBe(true);
  });

  it("SMTP caído responde notificacion_no_disponible (503)", async () => {
    const { deps, canal } = await nuevoEntorno();
    canal.fallar = true;
    const r = await new SolicitarRecuperacion(deps).execute({ correo: CORREO });
    expect(!r.ok && r.error.code).toBe("notificacion_no_disponible");
  });

  it("límite por correo: la 4.ª solicitud en la ventana es 429", async () => {
    const { deps } = await nuevoEntorno();
    const solicitar = new SolicitarRecuperacion(deps, new LimitadorIntentos(3, 15 * 60 * 1000, () => 0));
    await solicitar.execute({ correo: CORREO });
    await solicitar.execute({ correo: CORREO });
    await solicitar.execute({ correo: CORREO });
    const cuarta = await solicitar.execute({ correo: CORREO });
    expect(!cuarta.ok && cuarta.error.code).toBe("demasiados_intentos");
  });
});
