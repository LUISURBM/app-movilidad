/**
 * Pruebas de los casos de uso de ADJUNTOS (spec-005 R5/R11) y del adaptador FS.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DateOnly, TenantId } from "../../shared/kernel";
import { InMemoryAlmacenAdjuntos } from "./application/adjuntos.in-memory";
import {
  ADJUNTO_MAX_BYTES,
  DescargarAdjunto,
  mimeBase,
  SubirAdjunto,
} from "./application/adjuntos.use-cases";
import { InMemoryDocumentoRepository } from "./application/in-memory.adapters";
import { FsAlmacenAdjuntos } from "./infrastructure/fs-almacen-adjuntos";
import { Documento } from "./domain/documento.aggregate";
import { SujetoRef, TipoDocumento, TipoSujeto, Vencimiento } from "./domain/value-objects";

const TENANT = TenantId("tenant-duster");
const OTRO = TenantId("tenant-otro");
const PDF = new TextEncoder().encode("%PDF-1.4 contenido");

async function documentoDePrueba(docs: InMemoryDocumentoRepository): Promise<string> {
  const tipo = new TipoDocumento("SOAT", TipoSujeto.Vehiculo, true, true);
  const r = Documento.registrar({
    id: "doc-1",
    sujeto: SujetoRef.vehiculo("veh-1"),
    tipo,
    emision: DateOnly.parse("2026-01-01"),
    vencimiento: Vencimiento.parse("2027-01-01"),
  });
  if (!r.ok) throw new Error("no se pudo crear el documento de prueba");
  await docs.save(TENANT, r.value);
  return "doc-1";
}

describe("spec-005 adjuntos — casos de uso", () => {
  it("sube, referencia y descarga el mismo contenido", async () => {
    const docs = new InMemoryDocumentoRepository();
    const almacen = new InMemoryAlmacenAdjuntos();
    const id = await documentoDePrueba(docs);

    const up = await new SubirAdjunto(docs, almacen).execute({
      tenant: TENANT,
      documentoId: id,
      contenido: PDF,
      contentType: "application/pdf",
    });
    expect(up.ok).toBe(true);
    expect((await docs.findById(TENANT, id))?.adjuntoRef).toBeTruthy();

    const down = await new DescargarAdjunto(docs, almacen).execute({
      tenant: TENANT,
      documentoId: id,
    });
    expect(down.ok && Buffer.from(down.value.contenido).equals(Buffer.from(PDF))).toBe(true);
    expect(down.ok && down.value.mime).toBe("application/pdf");
  });

  it("rechaza mime no permitido, vacío y tamaño excedido", async () => {
    const docs = new InMemoryDocumentoRepository();
    const almacen = new InMemoryAlmacenAdjuntos();
    const id = await documentoDePrueba(docs);
    const subir = new SubirAdjunto(docs, almacen);

    const exe = await subir.execute({ tenant: TENANT, documentoId: id, contenido: PDF, contentType: "application/x-msdownload" });
    expect(!exe.ok && exe.error.code).toBe("adjunto_tipo_no_permitido");

    const vacio = await subir.execute({ tenant: TENANT, documentoId: id, contenido: new Uint8Array(0), contentType: "application/pdf" });
    expect(!vacio.ok && vacio.error.code).toBe("adjunto_tipo_no_permitido");

    const enorme = await subir.execute({
      tenant: TENANT,
      documentoId: id,
      contenido: new Uint8Array(ADJUNTO_MAX_BYTES + 1),
      contentType: "application/pdf",
    });
    expect(!enorme.ok && enorme.error.code).toBe("adjunto_demasiado_grande");
  });

  it("mimeBase normaliza parámetros y mayúsculas", () => {
    expect(mimeBase("Image/PNG; charset=binary")).toBe("image/png");
    expect(mimeBase(undefined)).toBe("");
  });

  it("un tenant no resuelve refs de otro (R11, almacén in-memory)", async () => {
    const almacen = new InMemoryAlmacenAdjuntos();
    const { ref } = await almacen.guardar(TENANT, "doc-x", PDF, "application/pdf");
    expect(await almacen.obtener(OTRO, ref)).toBeNull();
    expect(await almacen.obtener(TENANT, ref)).not.toBeNull();
  });
});

describe("FsAlmacenAdjuntos (adaptador de producción sencilla)", () => {
  const dir = mkdtempSync(join(tmpdir(), "fs-adjuntos-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("guarda y recupera bytes + mime bajo el prefijo del tenant", async () => {
    const fs = new FsAlmacenAdjuntos(dir);
    const { ref } = await fs.guardar(TENANT, "doc-9", PDF, "application/pdf");
    const leido = await fs.obtener(TENANT, ref);
    expect(leido && Buffer.from(leido.contenido).equals(Buffer.from(PDF))).toBe(true);
    expect(leido?.mime).toBe("application/pdf");
    // Otro tenant, misma ref: no resuelve (R11).
    expect(await fs.obtener(OTRO, ref)).toBeNull();
  });

  it("rechaza refs que intentan salir del prefijo del tenant", async () => {
    const fs = new FsAlmacenAdjuntos(dir);
    await expect(fs.obtener(TENANT, `../${OTRO}/doc-9/x.bin`)).resolves.toBeNull();
  });
});
