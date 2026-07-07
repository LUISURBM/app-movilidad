/**
 * Adaptadores EN MEMORIA de los puertos de autenticación (spec-015) — dev y tests.
 */
import {
  Credencial,
  CredencialRepository,
  InvitacionPendiente,
  InvitacionRepository,
} from "./auth.ports";

export class InMemoryCredencialRepository implements CredencialRepository {
  private store = new Map<string, Credencial>();

  async guardar(credencial: Credencial): Promise<void> {
    this.store.set(`${credencial.tenantId}::${credencial.usuarioId}`, { ...credencial });
  }

  async buscarPorCorreo(correo: string): Promise<Credencial[]> {
    return [...this.store.values()].filter((c) => c.correo === correo);
  }

  async obtener(tenantId: string, usuarioId: string): Promise<Credencial | null> {
    return this.store.get(`${tenantId}::${usuarioId}`) ?? null;
  }
}

export class InMemoryInvitacionRepository implements InvitacionRepository {
  private store = new Map<string, InvitacionPendiente>();

  async guardar(invitacion: InvitacionPendiente): Promise<void> {
    this.store.set(invitacion.codigoHash, { ...invitacion });
  }

  async consumir(codigoHash: string, ahora: Date): Promise<InvitacionPendiente | null> {
    const inv = this.store.get(codigoHash);
    if (!inv) return null;
    this.store.delete(codigoHash); // un solo uso: también se elimina la vencida
    if (new Date(inv.expiraEn).getTime() <= ahora.getTime()) return null;
    return inv;
  }
}
