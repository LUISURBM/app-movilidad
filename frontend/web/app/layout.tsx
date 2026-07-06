import type { Metadata } from "next";
import { Providers } from "@/lib/api";
import "./globals.css";

export const metadata: Metadata = {
  title: "FleetSpecial — Portal",
  description:
    "Portal administrativo de FleetSpecial: cumplimiento, flota y agenda de servicios.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-CO">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
