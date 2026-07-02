/**
 * Configuración común de la app HTTP — compartida por main.ts y el test E2E,
 * para que lo probado sea EXACTAMENTE lo que corre.
 */
import { INestApplication } from "@nestjs/common";

export function configurarApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix("v1"); // el contrato openapi.yaml versiona bajo /v1
  app.enableShutdownHooks();
  return app;
}
