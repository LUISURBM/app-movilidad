/**
 * Punto de entrada del backend FleetSpecial.
 *   npm run start:dev   (tsx src/main.ts)
 *
 * Variables de entorno:
 *   PORT                 puerto HTTP (default 3000)
 *   FLEETSPECIAL_TENANTS CSV de tenants activos para el job diario (dev)
 *   OUTBOX_POLL_MS       intervalo del dispatcher del outbox (default 5000)
 */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configurarApp } from "./bootstrap";

async function bootstrap(): Promise<void> {
  const app = configurarApp(await NestFactory.create(AppModule));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.info(`FleetSpecial backend escuchando en http://localhost:${port}/v1 (health: /v1/health)`);
}

void bootstrap();
