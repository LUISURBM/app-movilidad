# SDK de API — FleetSpecial (TypeScript)

> Cliente **tipado** generado a partir del contrato OpenAPI (**API First**). El front **no inventa tipos**: los importa de aquí. Cuando cambia el contrato (`backend/contracts/openapi.yaml`), se regenera el SDK y los tipos se propagan a toda la app.

## Contenido

| Archivo | Qué es |
|---|---|
| `schema.d.ts` | **Generado** por `openapi-typescript` desde `backend/contracts/openapi.yaml`. No editar a mano. |
| `client.ts` | Cliente tipado (envuelve `openapi-fetch`): Bearer JWT, `Idempotency-Key`, base URL por entorno. |
| `index.ts` | Barrel de exportación. Importa desde aquí. |
| `package.json` | Scripts de generación, typecheck y mock. |
| `tsconfig.json` | Config para `npm run typecheck`. |

## Instalación (una vez)

```bash
cd frontend/shared/api
npm install
```

## Regenerar el SDK cuando cambie el contrato

```bash
npm run gen:api      # openapi.yaml -> schema.d.ts
npm run typecheck    # verifica que el SDK compila
```

> Regla SDD: si el comportamiento cambia, se edita **primero la spec y el contrato**, luego se regenera el SDK; nunca al revés.

## Uso en la app web

```ts
import { createFleetSpecialClient, withIdempotency, type Vehiculo } from "@/shared/api";

const api = createFleetSpecialClient({
  baseUrl: import.meta.env.VITE_API_URL,        // p. ej. https://api.fleetspecial.co/v1
  getToken: () => authStore.accessToken,        // JWT OIDC; el tenant se deriva del token
});

// GET tipado (autocompleta rutas, params y respuesta)
const { data, error } = await api.GET("/vehiculos", {
  params: { query: { page: 1, pageSize: 20 } },
});
if (error) { /* error: Problem (RFC 7807) */ }
const vehiculos: Vehiculo[] | undefined = data?.items;

// POST idempotente (offline-first): registrar un tanqueo
const clientId = crypto.randomUUID();
await api.POST("/combustible", withIdempotency({
  body: { vehiculoId, litros: 35, valor: { moneda: "COP", valor: 180000 }, odometro: 152340, clientId },
}, clientId));
```

El cliente añade `Authorization: Bearer <jwt>` automáticamente en cada request (vía `getToken`). El `tenant_id` **no** se envía: lo deriva el backend del JWT y lo refuerza Row Level Security (ADR-0008).

## Mock server (Prism) — desarrollo en paralelo

Levanta un servidor que responde según el contrato, **sin backend**, para que web y móvil avancen mientras se implementa la API:

```bash
npm run mock           # http://localhost:4010 (respuestas de ejemplo del contrato)
npm run mock:dynamic   # respuestas generadas dinámicamente a partir de los esquemas
```

Apunta el cliente al mock:

```ts
const api = createFleetSpecialClient({ baseUrl: "http://localhost:4010" });
```

Ejemplo de prueba rápida contra el mock:

```bash
curl -s http://localhost:4010/vehiculos -H "Accept: application/json"
```

## Notas

- **Independencia de framework:** el SDK es TS puro (no atado a React/Next). El portal web lo consume desde `frontend/shared/api/`.
- **Reutilizable:** el mismo paquete puede servir a otros consumidores TS. La app móvil (Flutter) **no** usa este SDK (es Dart); para Flutter se genera un cliente Dart aparte desde el mismo `openapi.yaml` cuando se aborde móvil.
- **Trazabilidad:** cada endpoint del `schema.d.ts` conserva la referencia a su `spec-NNN` en las descripciones del contrato.
