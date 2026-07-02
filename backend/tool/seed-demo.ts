/**
 * Siembra los datos del DEMO contra la API real (todo por HTTP, como en el E2E):
 *   catálogo SOAT → documento vigente del vehículo → 2 servicios de hoy
 *   → asignación al conductor (pasa la regla de oro en verde).
 *
 * Uso (con el backend corriendo):
 *   npx tsx tool/seed-demo.ts --url http://localhost:3000/v1 --token <JWT-de-Operador>
 *   (o sin token en modo dev de headers: --tenant tenant-demo)
 */
function arg(nombre: string, porDefecto?: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

const BASE = arg("url", "http://localhost:3000/v1")!;
const TOKEN = arg("token");
const TENANT = arg("tenant", "tenant-demo")!;
const VEH = arg("vehiculo", "veh-duster")!;
const COND = arg("conductor", "cond-luis")!;

const headers: Record<string, string> = {
  "Content-Type": "application/json",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : { "x-tenant-id": TENANT, "x-roles": "Operador" }),
};

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  console.log(`  ${method} ${path} → ${res.status}${json?.type ? ` (${json.type})` : ""}`);
  return { status: res.status, json };
}

function hoyA(hora: number): string {
  const d = new Date();
  d.setHours(hora, 0, 0, 0);
  return d.toISOString();
}

async function main(): Promise<void> {
  console.log(`Sembrando demo en ${BASE} (tenant ${TENANT})...\n`);

  // 1) Catálogo: SOAT para vehículos (idempotente: 409 si ya existe = OK).
  await api("POST", "/catalogo/tipos", { codigo: "SOAT", aplicaA: "vehiculo" });

  // 2) SOAT VIGENTE del vehículo demo (regla de oro en verde).
  const venc = new Date();
  venc.setFullYear(venc.getFullYear() + 1);
  await api("POST", "/documentos", {
    sujeto: { tipo: "vehiculo", id: VEH },
    tipo: "SOAT",
    expedicion: new Date().toISOString().slice(0, 10),
    vencimiento: venc.toISOString().slice(0, 10),
  });

  // 3) Dos servicios de HOY + asignación al conductor demo.
  const rutas = [
    { origen: "Bogotá", destino: "Colegio San José", desde: 7, hasta: 9 },
    { origen: "Colegio San José", destino: "Bogotá", desde: 16, hasta: 18 },
  ];
  for (const r of rutas) {
    const s = await api("POST", "/servicios", {
      origen: r.origen,
      destino: r.destino,
      ventana: { inicio: hoyA(r.desde), fin: hoyA(r.hasta) },
      cliente: "Colegio San José",
    });
    if (s.status !== 201) continue;
    await api("PUT", `/servicios/${s.json.id}/asignacion`, {
      vehiculoId: VEH,
      conductorId: COND,
    });
  }

  console.log("\nListo. En la app: pull-to-refresh y verás los servicios del día.");
}

void main();
