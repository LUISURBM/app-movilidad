"use client";

import { useState } from "react";
import {
  EditorUsuario,
  FormularioInvitacion,
  useUsuarios,
} from "@/features/usuarios";
import { problemaDe } from "@/lib/api";
import { etiquetaRol } from "@/lib/format";
import type { schemas } from "@fleetspecial/api";
import {
  BotonPrimario,
  BotonSecundario,
  Cargando,
  Encabezado,
  ProblemAlert,
  Tabla,
  Tarjeta,
  Vacio,
} from "@/shared/ui";

type Usuario = schemas["Usuario"];

const ETIQUETA_ESTADO: Record<Usuario["estado"], string> = {
  invitado: "Invitado",
  activo: "Activo",
  suspendido: "Suspendido",
};

export default function PaginaUsuarios() {
  const usuarios = useUsuarios();
  const [invitar, setInvitar] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);

  const items = usuarios.data?.items ?? [];

  return (
    <div>
      <Encabezado
        titulo="Usuarios"
        descripcion="Personas con acceso a este tenant y sus roles. Solo Administrador puede gestionar."
        accion={<BotonPrimario onClick={() => setInvitar(true)}>Invitar usuario</BotonPrimario>}
      />
      <Tarjeta>
        {usuarios.isPending ? <Cargando /> : null}
        {usuarios.isError ? (
          <div className="p-4">
            <ProblemAlert problema={problemaDe(usuarios.error)} />
          </div>
        ) : null}
        {usuarios.isSuccess && items.length === 0 ? (
          <Vacio mensaje="No hay usuarios visibles." />
        ) : null}
        {usuarios.isSuccess && items.length > 0 ? (
          <Tabla encabezados={["Nombre", "Correo", "Roles", "Estado", ""]}>
            {items.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{u.nombre}</td>
                <td className="px-4 py-3 text-slate-600">{u.correo}</td>
                <td className="px-4 py-3 text-slate-600">
                  {u.roles.map((r) => etiquetaRol[r] ?? r).join(", ")}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      u.estado === "activo"
                        ? "bg-green-50 text-green-700"
                        : u.estado === "invitado"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {ETIQUETA_ESTADO[u.estado]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <BotonSecundario onClick={() => setEditando(u)}>Editar</BotonSecundario>
                </td>
              </tr>
            ))}
          </Tabla>
        ) : null}
      </Tarjeta>
      <FormularioInvitacion abierto={invitar} onCerrar={() => setInvitar(false)} />
      <EditorUsuario usuario={editando} onCerrar={() => setEditando(null)} />
    </div>
  );
}
