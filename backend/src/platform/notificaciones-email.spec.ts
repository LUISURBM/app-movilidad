/**
 * Pruebas del canal SMTP y del directorio SQL (spec-006 R4/R6, entrega real).
 * El transporte se inyecta (puerto `Mailer`): sin red ni SMTP en las suites.
 */
import { describe, expect, it } from "vitest";
import { Mensaje, NotificacionesSink, InMemoryDirectorioContactos } from "./notificaciones";
import { Mailer, SmtpCanal, SqlDirectorioContactos } from "./notificaciones.infra";
import { OutboxRow } from "./outbox";

class MailerFalso implements Mailer {
  public readonly enviados: Array<{ from: string; to: string[]; subject: string; text: string }> = [];
  public fallar = false;
  async sendMail(o: { from: string; to: string[]; subject: string; text: string }): Promise<void> {
    if (this.fallar) throw new Error("SMTP caído");
    this.enviados.push(o);
  }
}

const MENSAJE: Mensaje = {
  tenantId: "tenant-duster",
  asunto: "⚠️ SOAT por vencer (5 días)",
  cuerpo: "El documento SOAT del Vehículo veh-1 vence en 5 día(s).",
  destinatarios: [
    { nombre: "Luis", email: "luis@duster.co" },
    { nombre: "Sin correo" }, // se ignora
    { nombre: "Ana", email: "ana@duster.co" },
  ],
};

describe("SmtpCanal", () => {
  it("envía a los correos del tenant con remitente y asunto correctos", async () => {
    const mailer = new MailerFalso();
    await new SmtpCanal(mailer, "FleetSpecial <alertas@duster.co>").enviar(MENSAJE);

    expect(mailer.enviados).toHaveLength(1);
    const m = mailer.enviados[0];
    expect(m.from).toBe("FleetSpecial <alertas@duster.co>");
    expect(m.to).toEqual(["luis@duster.co", "ana@duster.co"]);
    expect(m.subject).toContain("SOAT por vencer");
    expect(m.text).toContain("vence en 5 día(s)");
  });

  it("sin destinatarios con email es no-op (no bloquea el outbox)", async () => {
    const mailer = new MailerFalso();
    await new SmtpCanal(mailer, "x@y.co").enviar({ ...MENSAJE, destinatarios: [{ nombre: "N" }] });
    expect(mailer.enviados).toHaveLength(0);
  });

  it("si el SMTP falla, el error se PROPAGA (el dispatcher reintenta)", async () => {
    const mailer = new MailerFalso();
    mailer.fallar = true;
    await expect(
      new SmtpCanal(mailer, "x@y.co").enviar(MENSAJE),
    ).rejects.toThrow("SMTP caído");
  });

  it("de punta a punta con el sink: DocumentoVencido llega como email", async () => {
    const mailer = new MailerFalso();
    const directorio = new InMemoryDirectorioContactos();
    directorio.agregar("tenant-duster", { email: "luis@duster.co" });
    const sink = new NotificacionesSink(directorio, new SmtpCanal(mailer, "alertas@d.co"));

    const fila: OutboxRow = {
      id: "evt-1",
      tenantId: "tenant-duster",
      tipoEvento: "DocumentoVencido",
      aggregateId: "doc-1",
      payload: { tipoDocumento: "SOAT", sujeto: { tipo: "vehiculo", id: "ABC123" } },
      intentos: 0,
    };
    await sink.entregar(fila);

    expect(mailer.enviados).toHaveLength(1);
    expect(mailer.enviados[0].subject).toContain("VENCIDO");
    expect(mailer.enviados[0].to).toEqual(["luis@duster.co"]);
  });
});

describe("SqlDirectorioContactos", () => {
  it("consulta usuarios activos Admin/Operador del tenant y mapea a contactos", async () => {
    const consultas: Array<{ sql: string; params: unknown[] }> = [];
    // El adaptador enruta por enTenant() (transacción con SET LOCAL
    // app.current_tenant para RLS), así que el DataSource falso expone
    // transaction() y provee un manager con query — mismo shape que el real
    // (cf. dsSobrePglite en rls-e1.pg.integration.spec.ts).
    const manager = {
      query: async (sql: string, params: unknown[] = []) => {
        consultas.push({ sql, params });
        if (sql.includes("set_config")) return []; // fija el tenant: sin filas
        return [
          { nombre: "Luis", correo: "luis@duster.co" },
          { nombre: "Ana", correo: "ana@duster.co" },
        ];
      },
    };
    const dsFalso = {
      query: manager.query,
      transaction: (work: (m: typeof manager) => Promise<unknown>) => work(manager),
    };
    const contactos = await new SqlDirectorioContactos(
      dsFalso as never,
    ).contactosDeTenant("tenant-duster");

    expect(contactos).toEqual([
      { nombre: "Luis", email: "luis@duster.co" },
      { nombre: "Ana", email: "ana@duster.co" },
    ]);
    // enTenant fija primero el tenant (SET LOCAL) y luego corre la consulta.
    expect(consultas.some((c) => c.sql.includes("set_config"))).toBe(true);
    const negocio = consultas.find((c) => c.sql.includes("FROM usuario"))!;
    expect(negocio.params).toEqual(["tenant-duster"]);
    expect(negocio.sql).toContain("estado = 'activo'");
    expect(negocio.sql).toContain("Administrador");
  });
});
