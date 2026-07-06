"use client";

import { useState, type FormEvent } from "react";
import {
  useCatalogoTipos,
  useMutacionesCatalogo,
} from "@/features/documentos";
import { problemaDe } from "@/lib/api";
import {
  BotonPrimario,
  Campo,
  Cargando,
  Encabezado,
  Entrada,
  Modal,
  ProblemAlert,
  Selector,
  Tabla,
  Tarjeta,
  Vacio,
} from "@/shared/ui";

export default function PaginaCatalogo() {
  const catalogo = useCatalogoTipos();
  const { agregar, actualizar } = useMutacionesCatalogo();
  const [abierto, setAbierto] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [aplicaA, setAplicaA] = useState<"vehiculo" | "conductor">("vehiculo");
  const [requerido, setRequerido] = useState(false);

  const tipos = catalogo.data ?? [];

  function cerrar() {
    setCodigo("");
    setAplicaA("vehiculo");
    setRequerido(false);
    agregar.reset();
    setAbierto(false);
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    agregar.mutate(
      {
        codigo: codigo.trim().toUpperCase().replace(/\s+/g, "_"),
        aplicaA,
        requerido,
      },
      { onSuccess: cerrar },
    );
  }

  return (
    <div>
      <Encabezado
        titulo="Catálogo de tipos de documento"
        descripcion="Qué documentos existen y cuáles son obligatorios. Un tipo obligatorio ausente pone al sujeto en rojo."
        accion={<BotonPrimario onClick={() => setAbierto(true)}>Agregar tipo</BotonPrimario>}
      />

      {actualizar.isError ? (
        <div className="mb-4">
          <ProblemAlert problema={problemaDe(actualizar.error)} />
        </div>
      ) : null}

      <Tarjeta>
        {catalogo.isPending ? <Cargando /> : null}
        {catalogo.isError ? (
          <div className="p-4">
            <ProblemAlert problema={problemaDe(catalogo.error)} />
          </div>
        ) : null}
        {catalogo.isSuccess && tipos.length === 0 ? (
          <Vacio
            mensaje="El catálogo está vacío. Agregue SOAT, RTM, TARJETA_OPERACION… para empezar a registrar documentos."
            hijos={<BotonPrimario onClick={() => setAbierto(true)}>Agregar tipo</BotonPrimario>}
          />
        ) : null}
        {catalogo.isSuccess && tipos.length > 0 ? (
          <Tabla encabezados={["Código", "Aplica a", "Obligatorio", "Activo"]}>
            {tipos.map((t) => (
              <tr key={t.codigo} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{t.codigo}</td>
                <td className="px-4 py-3 text-slate-600">
                  {t.aplicaA === "vehiculo" ? "Vehículo" : "Conductor"}
                </td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    className="accent-marca-600"
                    checked={t.requerido}
                    disabled={actualizar.isPending}
                    onChange={(e) =>
                      actualizar.mutate({
                        codigo: t.codigo,
                        cambios: { requerido: e.target.checked },
                      })
                    }
                    aria-label={`Obligatorio ${t.codigo}`}
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    className="accent-marca-600"
                    checked={t.activo}
                    disabled={actualizar.isPending}
                    onChange={(e) =>
                      actualizar.mutate({
                        codigo: t.codigo,
                        cambios: { activo: e.target.checked },
                      })
                    }
                    aria-label={`Activo ${t.codigo}`}
                  />
                </td>
              </tr>
            ))}
          </Tabla>
        ) : null}
      </Tarjeta>

      <Modal abierto={abierto} titulo="Agregar tipo de documento" onCerrar={cerrar}>
        <form onSubmit={enviar} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Campo etiqueta="Código" requerido>
              <Entrada
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                placeholder="SOAT"
                required
              />
            </Campo>
            <Campo etiqueta="Aplica a" requerido>
              <Selector
                value={aplicaA}
                onChange={(e) => setAplicaA(e.target.value as "vehiculo" | "conductor")}
              >
                <option value="vehiculo">Vehículo</option>
                <option value="conductor">Conductor</option>
              </Selector>
            </Campo>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requerido}
              onChange={(e) => setRequerido(e.target.checked)}
              className="accent-marca-600"
            />
            Obligatorio (su ausencia pone al sujeto en rojo)
          </label>
          <ProblemAlert problema={agregar.isError ? problemaDe(agregar.error) : null} />
          <div className="flex justify-end">
            <BotonPrimario type="submit" disabled={agregar.isPending}>
              {agregar.isPending ? "Agregando…" : "Agregar"}
            </BotonPrimario>
          </div>
        </form>
      </Modal>
    </div>
  );
}
