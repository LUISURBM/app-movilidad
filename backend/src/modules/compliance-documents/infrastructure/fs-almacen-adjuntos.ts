/**
 * AlmacenAdjuntos sobre SISTEMA DE ARCHIVOS — variante de producción sencilla
 * (bootstrapping): un VPS con disco persistente basta para arrancar. S3/MinIO
 * implementará el mismo puerto cuando el volumen lo pida (misma interfaz).
 *
 * Diseño (spec-005 R5/R11):
 *  - Aislamiento por tenant: `<base>/<tenant>/<documentoId>/<hash16>.bin` — el
 *    tenant es SIEMPRE el primer segmento; `obtener` resuelve bajo ese prefijo
 *    y rechaza refs con `..` o absolutas (no hay forma de salir del prefijo).
 *  - Metadatos junto al binario: `<hash16>.json` (mime, tamaño, hash completo).
 *  - Append-only por contenido: reemplazar escribe una ref nueva; el histórico
 *    de renovaciones conserva la suya.
 *
 * Config: FLEETSPECIAL_ADJUNTOS_DIR (default `./data/adjuntos`).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import { TenantId } from "../../../shared/kernel";
import { AdjuntoAlmacenado, AlmacenAdjuntos } from "../application/ports";

interface MetadatosAdjunto {
  mime: string;
  tamano: number;
  sha256: string;
}

export class FsAlmacenAdjuntos implements AlmacenAdjuntos {
  constructor(
    private readonly baseDir: string = process.env.FLEETSPECIAL_ADJUNTOS_DIR ??
      "./data/adjuntos",
  ) {}

  async guardar(
    tenant: TenantId,
    documentoId: string,
    contenido: Uint8Array,
    mime: string,
  ): Promise<{ ref: string }> {
    const sha256 = createHash("sha256").update(contenido).digest("hex");
    const ref = `${documentoId}/${sha256.slice(0, 16)}`;
    const rutaBin = this.rutaSegura(tenant, `${ref}.bin`);
    await mkdir(dirname(rutaBin), { recursive: true });
    await writeFile(rutaBin, contenido);
    const metadatos: MetadatosAdjunto = { mime, tamano: contenido.length, sha256 };
    await writeFile(this.rutaSegura(tenant, `${ref}.json`), JSON.stringify(metadatos));
    return { ref };
  }

  async obtener(tenant: TenantId, ref: string): Promise<AdjuntoAlmacenado | null> {
    try {
      const contenido = await readFile(this.rutaSegura(tenant, `${ref}.bin`));
      const crudo = await readFile(this.rutaSegura(tenant, `${ref}.json`), "utf8");
      const metadatos = JSON.parse(crudo) as MetadatosAdjunto;
      return { contenido, mime: metadatos.mime };
    } catch {
      return null;
    }
  }

  /** Une base/tenant/ref y garantiza que el resultado siga bajo el prefijo del tenant. */
  private rutaSegura(tenant: TenantId, relativo: string): string {
    const prefijo = normalize(join(this.baseDir, String(tenant))) + sep;
    const ruta = normalize(join(prefijo, relativo));
    if (!ruta.startsWith(prefijo)) {
      throw new Error("ref de adjunto inválida (fuera del prefijo del tenant)");
    }
    return ruta;
  }
}
