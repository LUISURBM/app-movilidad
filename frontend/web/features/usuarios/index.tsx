"use client";

/**
 * Feature Usuarios (BC-1 Identity & Access).
 * Invitación y gestión de roles/estado (spec-002; solo Administrador — el
 * backend hace cumplir R1/R11, la UI muestra el 403 tal cual).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import type { schemas } from "@fleetspecial/api";
import { desenvolver, problemaDe, useApi } from "@/lib/api";
import { etiquetaRol } from "@/lib/format";
import {
  BotonPrimario,
  Campo,
  Entrada,
  Modal,
  ProblemAlert,
  Selector,
} from "@/shared/ui";

type RolUsuario = schemas["RolUsuario"];
type Usuario = schemas["Usuario"];

const ROLES = Object.keys(etiquetaRol) as RolUsuario[];

export function useUsuarios(page = 1) {
  const api = useApi();
  return useQuery({
    queryKey: ["usuarios", page],
    queryFn: async () =>
      desenvolver(
        await api.GET("/usuarios", {
          params: { query: { page, pageSize: 50 } },
        }),
      ),
  });
}

function SelectorRoles({
  seleccionados,
  onCambio,
}: {
  seleccionados: RolUsuario[];
  onCambio: (roles: RolUsuario[]) => void;
}) {
  function alternar(rol: RolUsuario) {
    onCambio(
      seleccionados.includes(rol)
        ? seleccionados.filter((r) => r !== rol)
        : [...seleccionados, rol],
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {ROLES.map((rol) => (
        <label
          key={rol}
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm transition hover:bg-slate-50"
        >
          <input
            type="checkbox"
            checked={seleccionados.includes(rol)}
            onChange={() => alternar(rol)}
            className="accent-marca-600"
          />
          {etiquetaRol[rol]}
        </label>
      ))}
    </div>
  );
}

export function FormularioInvitacion({
  abierto,
  onCerrar,
}: {
  abierto: boolean;
  onCerrar: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [roles, setRoles] = useState<RolUsuario[]>(["Operador"]);

  const invitar = useMutation({
    mutationFn: async () =>
      desenvolver(
        await api.POST("/usuarios", {
          body: { nombre: nombre.trim(), correo: correo.trim(), roles },
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["usuarios"] });
      cerrar();
    },
  });

  function cerrar() {
    setNombre("");
    setCorreo("");
    setRoles(["Operador"]);
    invitar.reset();
    onCerrar();
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (roles.length === 0) return;
    invitar.mutate();
  }

  return (
    <Modal abierto={abierto} titulo="Invitar usuario" onCerrar={cerrar}>
      <form onSubmit={enviar} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Campo etiqueta="Nombre" requerido>
            <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          </Campo>
          <Campo etiqueta="Correo" requerido>
            <Entrada
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              required
            />
          </Campo>
        </div>
        <Campo etiqueta="Roles" requerido>
          <SelectorRoles seleccionados={roles} onCambio={setRoles} />
        </Campo>
        {roles.length === 0 ? (
          <p className="text-xs text-red-600">Seleccione al menos un rol.</p>
        ) : null}
        <ProblemAlert problema={invitar.isError ? problemaDe(invitar.error) : null} />
        <div className="flex justify-end">
          <BotonPrimario type="submit" disabled={invitar.isPending || roles.length === 0}>
            {invitar.isPending ? "Invitando…" : "Invitar"}
          </BotonPrimario>
        </div>
      </form>
    </Modal>
  );
}

export function EditorUsuario({
  usuario,
  onCerrar,
}: {
  usuario: Usuario | null;
  onCerrar: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [roles, setRoles] = useState<RolUsuario[]>([]);
  const [estado, setEstado] = useState<"activo" | "suspendido">("activo");

  useEffect(() => {
    if (usuario) {
      setRoles(usuario.roles);
      setEstado(usuario.estado === "suspendido" ? "suspendido" : "activo");
    }
  }, [usuario]);

  const actualizar = useMutation({
    mutationFn: async () =>
      desenvolver(
        await api.PATCH("/usuarios/{usuarioId}", {
          params: { path: { usuarioId: usuario!.id } },
          body: { roles, estado },
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["usuarios"] });
      cerrar();
    },
  });

  function cerrar() {
    actualizar.reset();
    onCerrar();
  }

  return (
    <Modal
      abierto={Boolean(usuario)}
      titulo={usuario ? `Editar ${usuario.nombre}` : "Editar usuario"}
      onCerrar={cerrar}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (roles.length === 0) return;
          actualizar.mutate();
        }}
        className="space-y-4"
      >
        <Campo etiqueta="Roles" requerido>
          <SelectorRoles seleccionados={roles} onCambio={setRoles} />
        </Campo>
        <Campo etiqueta="Estado">
          <Selector
            value={estado}
            onChange={(e) => setEstado(e.target.value as "activo" | "suspendido")}
          >
            <option value="activo">Activo</option>
            <option value="suspendido">Suspendido</option>
          </Selector>
        </Campo>
        <ProblemAlert problema={actualizar.isError ? problemaDe(actualizar.error) : null} />
        <div className="flex justify-end">
          <BotonPrimario type="submit" disabled={actualizar.isPending || roles.length === 0}>
            {actualizar.isPending ? "Guardando…" : "Guardar"}
          </BotonPrimario>
        </div>
      </form>
    </Modal>
  );
}
