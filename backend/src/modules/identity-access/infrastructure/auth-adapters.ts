/**
 * Adaptadores de infraestructura de autenticación (spec-015), sin dependencias
 * externas (misma filosofía que platform/jwt.ts):
 *
 *  - `ScryptHasher`: scrypt de node:crypto, hash autodescriptivo
 *    `scrypt$N$r$p$salB64$hashB64`, verificación en tiempo constante.
 *  - `EmisorTokensJwt`: JWT HS256 con el secreto de plataforma
 *    (FLEETSPECIAL_JWT_SECRET). Sin secreto → `disponible() === false` (503).
 *  - `GeneradorCodigosAleatorio`: códigos de invitación URL-safe de 192 bits.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { firmarJwtHS256 } from "../../../platform/jwt";
import {
  EmisorTokens,
  GeneradorCodigos,
  HasherPassword,
  SesionEmitida,
} from "../application/auth.ports";

const scrypt = promisify(scryptCb) as (
  password: string,
  sal: Buffer,
  largo: number,
  opts: { N: number; r: number; p: number },
) => Promise<Buffer>;

const N = 16384; // 2^14 — balance costo/latencia para un VPS pequeño
const R = 8;
const P = 1;
const LARGO = 32;

export class ScryptHasher implements HasherPassword {
  async derivar(password: string): Promise<string> {
    const sal = randomBytes(16);
    const hash = await scrypt(password, sal, LARGO, { N, r: R, p: P });
    return `scrypt$${N}$${R}$${P}$${sal.toString("base64")}$${hash.toString("base64")}`;
  }

  async verificar(password: string, almacenado: string): Promise<boolean> {
    const partes = almacenado.split("$");
    if (partes.length !== 6 || partes[0] !== "scrypt") return false;
    const [, n, r, p, salB64, hashB64] = partes;
    const esperado = Buffer.from(hashB64, "base64");
    try {
      const calculado = await scrypt(password, Buffer.from(salB64, "base64"), esperado.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
      });
      return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
    } catch {
      return false;
    }
  }
}

export class EmisorTokensJwt implements EmisorTokens {
  constructor(
    private readonly secreto: () => string | undefined = () =>
      process.env.FLEETSPECIAL_JWT_SECRET,
    private readonly duracionSegundos = 8 * 3600, // spec-015 regla 5
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  disponible(): boolean {
    return Boolean(this.secreto());
  }

  emitir(claims: { sub: string; tenantId: string; roles: readonly string[] }): SesionEmitida {
    const secreto = this.secreto();
    if (!secreto) throw new Error("EmisorTokensJwt sin secreto: valide disponible() antes.");
    const emitidoEn = this.ahora();
    const token = firmarJwtHS256(
      { sub: claims.sub, tenant_id: claims.tenantId, roles: [...claims.roles] },
      secreto,
      { expiraEnSegundos: this.duracionSegundos, ahora: emitidoEn },
    );
    const expiraEn = new Date(emitidoEn.getTime() + this.duracionSegundos * 1000).toISOString();
    return { token, expiraEn };
  }
}

export class GeneradorCodigosAleatorio implements GeneradorCodigos {
  generar(): string {
    return randomBytes(24).toString("base64url");
  }
}
