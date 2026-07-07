/**
 * Persistencia conmutable de la plataforma (E0, camino a producción).
 *
 * Un solo interruptor por entorno:
 *   FLEETSPECIAL_PERSISTENCIA = "memoria" (default) | "postgres"
 *   DATABASE_URL              = postgres://usuario:clave@host:5432/fleetspecial  (modo postgres)
 *
 * - "memoria": los módulos cablean sus adaptadores in-memory (dev, demo y suites).
 * - "postgres": se inicializa UN DataSource de TypeORM (pool pg) y cada módulo
 *   conmuta a sus adaptadores SQL/TypeORM de `infrastructure/` — sin tocar
 *   dominio ni casos de uso (Clean Architecture).
 *
 * NOTA de tenancy (deuda E1, anotada en docs/DESPLIEGUE.md): los adaptadores SQL
 * filtran por tenant_id explícito en cada query; la conexión de la API corre hoy
 * con un rol que no está sujeto a RLS. Las políticas RLS de las migraciones
 * siguen protegiendo cualquier acceso con roles normales (psql, reportes).
 * Cerrar la deuda = rol dedicado sin bypass + `runInTenant` en los adaptadores.
 */
import { Global, Inject, Module, OnApplicationShutdown, Optional } from "@nestjs/common";
import { DataSource } from "typeorm";
import { TenantId } from "../shared/kernel";
import { TenantRegistry } from "./daily-job";
import {
  DocumentoEntity,
  OutboxEntity,
  TipoDocumentoEntity,
} from "../modules/compliance-documents/infrastructure/entities";
import { ServicioEntity } from "../modules/service-scheduling/infrastructure/entities";

export const DATA_SOURCE = Symbol("DATA_SOURCE");

export type ModoPersistencia = "memoria" | "postgres";

export function modoPersistencia(): ModoPersistencia {
  const crudo = (process.env.FLEETSPECIAL_PERSISTENCIA ?? "memoria").trim().toLowerCase();
  if (crudo === "postgres") return "postgres";
  if (crudo && crudo !== "memoria") {
    throw new Error(
      `FLEETSPECIAL_PERSISTENCIA inválida: "${crudo}" (use "memoria" o "postgres").`,
    );
  }
  return "memoria";
}

/**
 * Selección de adaptador por modo. En modo postgres exige el DataSource
 * (falla CERRADO y con mensaje claro si falta configuración).
 * Tipa como UNIÓN para que cada rama conserve su clase concreta (ambas
 * implementan el mismo puerto; la DI de Nest no exige más).
 */
export function elegirAdaptador<S, M>(
  ds: DataSource | null,
  sql: (ds: DataSource) => S,
  memoria: () => M,
): S | M {
  if (modoPersistencia() === "postgres") {
    if (!ds) {
      throw new Error(
        "FLEETSPECIAL_PERSISTENCIA=postgres pero el DataSource no está inicializado (¿falta DATABASE_URL?).",
      );
    }
    return sql(ds);
  }
  return memoria();
}

async function crearDataSource(): Promise<DataSource | null> {
  if (modoPersistencia() !== "postgres") return null;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("FLEETSPECIAL_PERSISTENCIA=postgres requiere DATABASE_URL.");
  }
  const ds = new DataSource({
    type: "postgres",
    url,
    // Solo las entidades TypeORM reales (Compliance/Scheduling); el resto de
    // módulos usa SQL parametrizado directo sobre el mismo pool.
    entities: [DocumentoEntity, TipoDocumentoEntity, OutboxEntity, ServicioEntity],
    synchronize: false, // el esquema lo manda `tool/migrar.ts` (migraciones .sql verbatim)
    logging: ["error"],
  });
  await ds.initialize();
  return ds;
}

/** Cierra el pool con el ciclo de vida de la app. */
class CierrePersistencia implements OnApplicationShutdown {
  constructor(@Optional() @Inject(DATA_SOURCE) private readonly ds: DataSource | null) {}
  async onApplicationShutdown(): Promise<void> {
    if (this.ds?.isInitialized) await this.ds.destroy();
  }
}

/** Registro real de tenants activos: la tabla `tenant` (spec-001). */
export class SqlTenantRegistry implements TenantRegistry {
  constructor(private readonly dataSource: DataSource) {}
  async listarActivos(): Promise<TenantId[]> {
    const filas: Array<{ id: string }> = await this.dataSource.query(`SELECT id FROM tenant`);
    return filas.map((f) => TenantId(f.id));
  }
}

@Global()
@Module({
  providers: [
    { provide: DATA_SOURCE, useFactory: crearDataSource },
    CierrePersistencia,
  ],
  exports: [DATA_SOURCE],
})
export class PersistenciaModule {}
