import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/",
}));

import PortalLayout from "@/app/(portal)/layout";
import { Providers } from "@/lib/api";

describe("guardia de sesión del portal", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    window.localStorage.clear();
  });

  it("sin sesión: no muestra contenido protegido y redirige a /login", async () => {
    const { container } = render(
      <Providers>
        <PortalLayout>
          <p>contenido protegido</p>
        </PortalLayout>
      </Providers>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/login"));
    expect(container.textContent).not.toContain("contenido protegido");
  });

  it("con sesión guardada: muestra el contenido y la razón social", async () => {
    window.localStorage.setItem(
      "fleetspecial.sesion",
      JSON.stringify({
        baseUrl: "http://localhost:3000/v1",
        token: "jwt-de-prueba",
        razonSocial: "Transportes La Duster SAS",
        plan: "Free",
      }),
    );

    const { container } = render(
      <Providers>
        <PortalLayout>
          <p>contenido protegido</p>
        </PortalLayout>
      </Providers>,
    );

    await waitFor(() => expect(container.textContent).toContain("contenido protegido"));
    expect(container.textContent).toContain("Transportes La Duster SAS");
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
