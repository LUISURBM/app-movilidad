/**
 * Migrador de esquema (E0) — aplica `backend/migrations/*.sql` VERBATIM y en orden
 * de nombre contra DATABASE_URL, registrando lo aplicado en `esquema_migracion`.
 *
 *   DATABASE_URL=postgres://... npx tsx tool/migrar.ts
 *
 * Diseño (anti-sobreingeniería, sin dependencias nuevas: usa `pg` que ya está):
 *  - Cada archivo corre UNA sola vez (registro por nombre). Las migraciones son
 *    append-only: jamás se edita una aplicada; los cambios van en archivos nuevos.
 *  - Los archivos traen `BEGIN;`/`COMMIT;` propios; aquí se retiran esas líneas
 *    y se envuelve TODO (contenido + registro) en UNA transacción del migrador,
 *    para que "aplicada" y "registrada" sean atómicas.
 *  - Un candado consultivo (advisory lock) evita dos migradores en paralelo.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR_MIGRACIONES = resolve(__dirname, "../migrations");
const CANDADO = 727201; // arbitrario y fijo: "migrador FleetSpecial"

function sinTransaccionPropia(sql: string): string {
  // Retira SOLO las líneas que son exactamente BEGIN; / COMMIT; (con espacios).
  return sql
    .split("\n")
    .filter((linea) => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(linea))
    .join("\n");
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Falta DATABASE_URL (postgres://usuario:clave@host:5432/fleetspecial).");
    process.exit(1);
  }

  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query("SELECT pg_advisory_lock($1)", [CANDADO]);
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS esquema_migracion (
        nombre      text PRIMARY KEY,
        aplicado_en timestamptz NOT NULL DEFAULT now()
      )
    `);

    const aplicadas = new Set(
      (await cliente.query("SELECT nombre FROM esquema_migracion")).rows.map(
        (f: { nombre: string }) => f.nombre,
      ),
    );

    const archivos = readdirSync(DIR_MIGRACIONES)
      .filter((n) => n.endsWith(".sql"))
      .sort();

    let nuevas = 0;
    for (const nombre of archivos) {
      if (aplicadas.has(nombre)) continue;
      const contenido = sinTransaccionPropia(readFileSync(join(DIR_MIGRACIONES, nombre), "utf8"));
      console.info(`Aplicando ${nombre}…`);
      try {
        await cliente.query("BEGIN");
        await cliente.query(contenido);
        await cliente.query("INSERT INTO esquema_migracion (nombre) VALUES ($1)", [nombre]);
        await cliente.query("COMMIT");
        nuevas += 1;
      } catch (err) {
        await cliente.query("ROLLBACK");
        console.error(`FALLÓ ${nombre}:`, err instanceof Error ? err.message : err);
        process.exit(1);
      }
    }
    console.info(
      nuevas === 0
        ? `Esquema al día (${archivos.length} migraciones ya aplicadas).`
        : `Listo: ${nuevas} migración(es) nueva(s); total ${archivos.length}.`,
    );
  } finally {
    await cliente.query("SELECT pg_advisory_unlock($1)", [CANDADO]).catch(() => undefined);
    await cliente.end();
  }
}

void main();
