/**
 * Adaptador EN MEMORIA del AlmacenAdjuntos — dev y tests (como los demás
 * adaptadores in-memory del módulo). Claves bajo prefijo del tenant (R11).
 * La ref incluye un hash del contenido: append-only, las versiones históricas
 * conservan su adjunto aunque la vigencia suba uno nuevo.
 */
import { createHash } from "node:crypto";
import { TenantId } from "../../../shared/kernel";
import { AdjuntoAlmacenado, AlmacenAdjuntos } from "./ports";

export function refDeAdjunto(documentoId: string, contenido: Uint8Array): string {
  const hash = createHash("sha256").update(contenido).digest("hex").slice(0, 16);
  return `${documentoId}/${hash}`;
}

export class InMemoryAlmacenAdjuntos implements AlmacenAdjuntos {
  private store = new Map<string, AdjuntoAlmacenado>();

  async guardar(
    tenant: TenantId,
    documentoId: string,
    contenido: Uint8Array,
    mime: string,
  ): Promise<{ ref: string }> {
    const ref = refDeAdjunto(documentoId, contenido);
    this.store.set(`${tenant}::${ref}`, { contenido, mime });
    return { ref };
  }

  async obtener(tenant: TenantId, ref: string): Promise<AdjuntoAlmacenado | null> {
    return this.store.get(`${tenant}::${ref}`) ?? null;
  }
}
