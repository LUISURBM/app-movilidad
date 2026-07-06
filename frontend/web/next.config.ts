import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El SDK se consume como fuente TypeScript (API First): Next lo transpila.
  transpilePackages: ["@fleetspecial/api"],
  // Portal interno CSR: los datos viven detrás del JWT; nada que pre-renderizar por SEO.
  reactStrictMode: true,
};

export default nextConfig;
