/**
 * Job diario de plataforma — corre el "reloj de dominio" (spec-006 R8) sin
 * intervención del usuario: a cada medianoche UTC ejecuta la tarea por tenant.
 *
 * Sin dependencias de cron externas: `setTimeout` encadenado, verificable con
 * fake timers. El registro de tenants es un puerto: hoy in-memory (el onboarding
 * de Empresas, spec-001, poblará la fuente real).
 */
import { TenantId } from "../shared/kernel";

export interface TenantRegistry {
  listarActivos(): Promise<TenantId[]>;
}

export class InMemoryTenantRegistry implements TenantRegistry {
  constructor(private readonly tenants: TenantId[] = []) {}
  async listarActivos(): Promise<TenantId[]> {
    return [...this.tenants];
  }
}

/** Milisegundos desde `ahora` hasta la próxima medianoche UTC (exclusiva). */
export function msHastaProximaMedianocheUTC(ahora: Date): number {
  const siguiente = Date.UTC(
    ahora.getUTCFullYear(),
    ahora.getUTCMonth(),
    ahora.getUTCDate() + 1,
  );
  return siguiente - ahora.getTime();
}

const DIA_MS = 24 * 60 * 60 * 1000;

export interface ResumenCorrida {
  tenants: number;
  errores: number;
}

/**
 * Programa `tarea(tenant)` para TODOS los tenants activos, cada medianoche UTC.
 * Un error en un tenant NO detiene a los demás (aislamiento operacional).
 */
export class DailyTenantJob {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private corridas: ResumenCorrida[] = [];

  constructor(
    public readonly nombre: string,
    private readonly registry: TenantRegistry,
    private readonly tarea: (tenant: TenantId) => Promise<unknown>,
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  /** Ejecuta una corrida completa (todos los tenants) UNA vez, ya mismo. */
  async correrAhora(): Promise<ResumenCorrida> {
    const tenants = await this.registry.listarActivos();
    let errores = 0;
    for (const t of tenants) {
      try {
        await this.tarea(t);
      } catch {
        errores += 1; // se registra y se sigue con el resto
      }
    }
    const resumen = { tenants: tenants.length, errores };
    this.corridas.push(resumen);
    return resumen;
  }

  /** Agenda la próxima medianoche y, desde ahí, cada 24 h. */
  start(): void {
    if (this.timer) return;
    const programar = (enMs: number) => {
      this.timer = setTimeout(async () => {
        await this.correrAhora();
        programar(DIA_MS);
      }, enMs);
      // No retener el proceso vivo solo por el job (si el runtime lo soporta).
      (this.timer as { unref?: () => void }).unref?.();
    };
    programar(msHastaProximaMedianocheUTC(this.ahora()));
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  get historial(): readonly ResumenCorrida[] {
    return this.corridas;
  }
}
