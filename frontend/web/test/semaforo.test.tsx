import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SemaforoBadge } from "@/shared/ui";

describe("SemaforoBadge", () => {
  it("muestra los tres estados del semáforo con su texto es-CO", () => {
    const { rerender } = render(<SemaforoBadge estado="Vigente" />);
    expect(screen.getByTestId("semaforo").textContent).toContain("Vigente");
    expect(screen.getByTestId("semaforo").dataset.estado).toBe("Vigente");

    rerender(<SemaforoBadge estado="PorVencer" />);
    expect(screen.getByTestId("semaforo").textContent).toContain("Por vencer");

    rerender(<SemaforoBadge estado="Vencido" />);
    expect(screen.getByTestId("semaforo").textContent).toContain("Vencido");
  });

  it("sin estado muestra 'Sin datos' (no inventa verde)", () => {
    render(<SemaforoBadge estado={undefined} />);
    expect(screen.getByText("Sin datos")).toBeDefined();
    expect(screen.queryByTestId("semaforo")).toBeNull();
  });
});
