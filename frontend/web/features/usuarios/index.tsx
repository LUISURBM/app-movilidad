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
  const [codigo, setCodigo] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const invitar = useMutation({
    mutationFn: async () =>
      desenvolver(
        await api.POST("/usuarios", {
          body: { nombre: nombre.trim(), correo: correo.trim(), roles },
        }),
      ),
    onSuccess: (usuario) => {
      queryClient.invalidateQueries({ queryKey: ["usuarios"] });
      // spec-015: el código de invitación SOLO se ve aquí; se entrega a la persona.
      if (usuario.invitacion) {
        setCodigo(usuario.invitacion);
      } else {
        cerrar();
      }
    },
  });

  function cerrar() {
    setNombre("");
    setCorreo("");
    setRoles(["Operador"]);
    setCodigo(null);
    setCopiado(false);
    invitar.reset();
    onCerrar();
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (roles.length === 0) return;
    invitar.mutate();
  }

  async function copiar() {
    if (!codigo) return;
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
    } catch {
      /* el usuario puede seleccionar y copiar a mano */
    }
  }

  return (
    <Modal
      abierto={abierto}
      titulo={codigo ? "Invitación creada" : "Invitar usuario"}
      onCerrar={cerrar}
    >
      {codigo ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Entregue este código a <span className="font-medium">{correo}</span>. Con él (y una
            contraseña nueva) activa su cuenta en la pantalla de ingreso. Vence en 7 días y{" "}
            <span className="font-medium">no se volverá a mostrar</span>.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 select-all break-all rounded-lg bg-slate-100 px-3 py-2 text-sm">
              {codigo}
            </code>
            <BotonPrimario onClick={copiar}>{copiado ? "Copiado" : "Copiar"}</BotonPrimario>
          </div>
          <div className="flex justify-end">
            <BotonPrimario onClick={cerrar}>Entendido</BotonPrimario>
          </div>
        </div>
      ) : (
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
      )}
    </Modal>
  );
}

/** Cambio de contraseña propia (spec-015) — accesible desde la cabecera. */
export function ModalCambiarPassword({
  abierto,
  onCerrar,
}: {
  abierto: boolean;
  onCerrar: () => void;
}) {
  const api = useApi();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [exito, setExito] = useState(false);

  const cambiar = useMutation({
    mutationFn: async () =>
      desenvolver(
        await api.POST("/auth/password", {
          body: { actual, nueva },
        }),
      ),
    onSuccess: () => setExito(true),
  });

  function cerrar() {
    setActual("");
    setNueva("");
    setExito(false);
    cambiar.reset();
    onCerrar();
  }

  return (
    <Modal abierto={abierto} titulo="Cambiar contraseña" onCerrar={cerrar}>
      {exito ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Contraseña actualizada. Su sesión actual sigue activa.
          </p>
          <div className="flex justify-end">
            <BotonPrimario onClick={cerrar}>Listo</BotonPrimario>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            cambiar.mutate();
          }}
          className="space-y-4"
        >
          <Campo etiqueta="Contraseña actual" requerido>
            <Entrada
              type="password"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Campo>
          <Campo etiqueta="Contraseña nueva (mínimo 10 caracteres)" requerido>
            <Entrada
              type="password"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
            />
          </Campo>
          <ProblemAlert problema={cambiar.isError ? problemaDe(cambiar.error) : null} />
          <div className="flex justify-end">
            <BotonPrimario type="submit" disabled={cambiar.isPending}>
              {cambiar.isPending ? "Guardando…" : "Cambiar"}
            </BotonPrimario>
          </div>
        </form>
      )}
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
