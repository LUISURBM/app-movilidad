"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useEsAdministrador, useSesion } from "@/lib/api";
import { ModalCambiarPassword } from "@/features/usuarios";

/**
 * Área autenticada del portal: guardia de sesión + navegación.
 * Las secciones reflejan los bounded contexts (lenguaje ubicuo).
 */

const SECCIONES: { href: string; titulo: string; soloAdmin?: boolean }[] = [
  { href: "/", titulo: "Cumplimiento" },
  { href: "/servicios", titulo: "Servicios" },
  { href: "/vehiculos", titulo: "Vehículos" },
  { href: "/conductores", titulo: "Conductores" },
  { href: "/documentos", titulo: "Documentos" },
  { href: "/combustible", titulo: "Combustible" },
  { href: "/mantenimiento", titulo: "Mantenimiento" },
  // RBAC visual (spec-002 R1/R11): gestionar usuarios y catálogo es de Administrador.
  { href: "/usuarios", titulo: "Usuarios", soloAdmin: true },
  { href: "/configuracion/catalogo", titulo: "Catálogo", soloAdmin: true },
];

export default function PortalLayout({ children }: { children: ReactNode }) {
  const { sesion, cerrarSesion } = useSesion();
  const router = useRouter();
  const pathname = usePathname();
  const [cambiandoPassword, setCambiandoPassword] = useState(false);
  const esAdmin = useEsAdministrador();
  const secciones = SECCIONES.filter((s) => !s.soloAdmin || esAdmin);

  useEffect(() => {
    if (sesion === null) router.replace("/login");
  }, [sesion, router]);

  // Hidratando localStorage o redirigiendo: no parpadear contenido protegido.
  if (!sesion) return null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 py-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-marca-600 text-sm font-bold text-white">
              F
            </span>
            <span className="hidden text-sm font-semibold sm:block">FleetSpecial</span>
          </Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto text-sm" aria-label="Principal">
            {secciones.map((s) => {
              const activo =
                s.href === "/" ? pathname === "/" : pathname.startsWith(s.href);
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  className={`whitespace-nowrap rounded-md px-3 py-1.5 transition ${
                    activo
                      ? "bg-marca-50 font-medium text-marca-700"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {s.titulo}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3 py-3">
            <span className="hidden max-w-40 truncate text-xs text-slate-500 md:block" title={sesion.razonSocial}>
              {sesion.razonSocial}
            </span>
            <button
              onClick={() => setCambiandoPassword(true)}
              className="text-xs font-medium text-slate-500 transition hover:text-slate-800"
            >
              Contraseña
            </button>
            <button
              onClick={() => {
                cerrarSesion();
                router.replace("/login");
              }}
              className="text-xs font-medium text-slate-500 transition hover:text-slate-800"
            >
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <ModalCambiarPassword
        abierto={cambiandoPassword}
        onCerrar={() => setCambiandoPassword(false)}
      />
    </div>
  );
}
