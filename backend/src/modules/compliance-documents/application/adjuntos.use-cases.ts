/**
 * Casos de uso de ADJUNTOS de documento (spec-005 R5/R11) — como el catálogo,
 * dependen solo de sus puertos (sin ripple en ComplianceDeps).
 *
 * Reglas del contrato:
 *  - Tipos permitidos: PDF, JPEG, PNG (otros → `adjunto_tipo_no_permitido`, 422).
 *  - Tamaño máximo 5 MB (→ `adjunto_demasiado_grande`, 413).
 *  - Subir REEMPLAZA el adjunto de la vigencia actual; las versiones históricas
 *    conservan su propia referencia (el almacén es append-only por contenido).
 */
import { DomainError, Result, TenantId, err, ok } from "../../../shared/kernel";
import { AdjuntoAlmacenado, AlmacenAdjuntos, DocumentoRepository } from "./ports";

export const ADJUNTO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB (contrato: 413 si se excede)

export const MIMES_PERMITIDOS = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

/** Normaliza un Content-Type con parámetros ("image/png; charset=…") a su mime base. */
export function mimeBase(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

export class SubirAdjunto {
  constructor(
    private readonly documentos: DocumentoRepository,
    private readonly almacen: AlmacenAdjuntos,
  ) {}

  async execute(input: {
    tenant: TenantId;
    documentoId: string;
    contenido: Uint8Array;
    contentType?: string;
  }): Promise<Result<void>> {
    const mime = mimeBase(input.contentType);
    if (!MIMES_PERMITIDOS.has(mime)) {
      return err(
        new DomainError(
          "adjunto_tipo_no_permitido",
          "El adjunto debe ser PDF, JPEG o PNG (envíe el Content-Type real del archivo).",
        ),
      );
    }
    if (input.contenido.length === 0) {
      return err(new DomainError("adjunto_tipo_no_permitido", "El adjunto está vacío."));
    }
    if (input.contenido.length > ADJUNTO_MAX_BYTES) {
      return err(
        new DomainError(
          "adjunto_demasiado_grande",
          `El adjunto supera el máximo de ${ADJUNTO_MAX_BYTES / (1024 * 1024)} MB.`,
        ),
      );
    }

    const doc = await this.documentos.findById(input.tenant, input.documentoId);
    if (!doc) {
      return err(new DomainError("documento_no_encontrado", "Documento no encontrado."));
    }

    const { ref } = await this.almacen.guardar(
      input.tenant,
      input.documentoId,
      input.contenido,
      mime,
    );
    doc.adjuntarSoporte(ref);
    await this.documentos.save(input.tenant, doc);
    return ok(undefined);
  }
}

export class DescargarAdjunto {
  constructor(
    private readonly documentos: DocumentoRepository,
    private readonly almacen: AlmacenAdjuntos,
  ) {}

  async execute(input: {
    tenant: TenantId;
    documentoId: string;
  }): Promise<Result<AdjuntoAlmacenado>> {
    const doc = await this.documentos.findById(input.tenant, input.documentoId);
    if (!doc) {
      return err(new DomainError("documento_no_encontrado", "Documento no encontrado."));
    }
    if (!doc.adjuntoRef) {
      return err(new DomainError("adjunto_no_encontrado", "El documento no tiene adjunto."));
    }
    // El almacén también aísla por tenant (R11): una ref ajena no resuelve.
    const adjunto = await this.almacen.obtener(input.tenant, doc.adjuntoRef);
    if (!adjunto) {
      return err(new DomainError("adjunto_no_encontrado", "El adjunto no está disponible."));
    }
    return ok(adjunto);
  }
}
