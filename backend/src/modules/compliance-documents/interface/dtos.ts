/**
 * DTOs de la capa interface (REST) — reflejan EXACTAMENTE los esquemas de
 * `backend/contracts/openapi.yaml` (API First). Son tipos planos de transporte;
 * no llevan lógica de dominio. Los mappers (mappers.ts) traducen dominio <-> DTO.
 */

// ---- Comunes ----
export type SemaforoDto = "Vigente" | "PorVencer" | "Vencido";

export interface SujetoRefDto {
  tipo: "vehiculo" | "conductor";
  id: string;
}

export interface ProblemDto {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Array<{ campo: string; mensaje: string }>;
}

export interface PaginaDto<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ---- spec-005: Registrar Documento ----
export interface RegistrarDocumentoRequestDto {
  sujeto: SujetoRefDto;
  tipo: string;
  numero?: string;
  expedicion?: string; // YYYY-MM-DD (emisión)
  vencimiento: string; // YYYY-MM-DD
}

export interface DocumentoDto {
  id: string;
  sujeto: SujetoRefDto;
  tipo: string;
  numero?: string;
  expedicion?: string;
  vencimiento: string;
  estado: SemaforoDto;
  tieneAdjunto: boolean;
  version: number;
  historico?: Array<{
    version: number;
    vencimiento: string;
    reemplazadoEn: string;
  }>;
}

// ---- spec-007: Renovar Documento ----
export interface RenovarDocumentoRequestDto {
  numero?: string;
  expedicion?: string; // nueva emisión
  vencimiento: string; // nuevo vencimiento
}

// ---- spec-006: Cumplimiento / Semáforo ----
export interface EstadoCumplimientoDto {
  sujeto: SujetoRefDto;
  semaforo: SemaforoDto;
  documentos?: Array<{
    documentoId?: string;
    tipo: string;
    vencimiento?: string;
    estado: SemaforoDto;
    diasRestantes?: number;
  }>;
}

export interface AlertaDto {
  documentoId: string;
  sujeto: SujetoRefDto;
  tipo: string;
  estado: "por_vencer" | "vencido";
  vencimiento: string;
  diasRestantes?: number;
}
