/**
 * Genera un JWT HS256 de DESARROLLO/DEMO para la app del Conductor.
 * (La identidad real llega con el epic E0; esto usa el mismo verificador
 * que el middleware — platform/jwt.ts.)
 *
 * Uso:
 *   set FLEETSPECIAL_JWT_SECRET=un-secreto-largo   (PowerShell: $env:FLEETSPECIAL_JWT_SECRET="...")
 *   npx tsx tool/token-dev.ts --tenant tenant-demo --sub cond-luis --roles Conductor --horas 24
 */
import { firmarJwtHS256 } from "../src/platform/jwt";

function arg(nombre: string, porDefecto: string): string {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

const secreto = process.env.FLEETSPECIAL_JWT_SECRET;
if (!secreto) {
  console.error("Falta FLEETSPECIAL_JWT_SECRET en el entorno.");
  process.exit(1);
}

const tenant = arg("tenant", "tenant-demo");
const sub = arg("sub", "cond-luis");
const roles = arg("roles", "Conductor").split(",");
const horas = Number(arg("horas", "24"));

const token = firmarJwtHS256(
  { sub, tenant_id: tenant, roles },
  secreto,
  { expiraEnSegundos: horas * 3600 },
);

console.log(`\nToken para sub=${sub} tenant=${tenant} roles=${roles.join(",")} (expira en ${horas}h):\n`);
console.log(token);
console.log("");
