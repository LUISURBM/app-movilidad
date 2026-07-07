# API de FleetSpecial (NestJS, monolito modular) — E0.
# Se construye desde la RAÍZ del repo (contexto = .) para resolver el workspace pnpm.
#   docker build -f infrastructure/docker/api.Dockerfile -t fleetspecial-api .
#
# Bootstrapping deliberado: corre con tsx (sin paso de build); el código TS es la
# unidad de despliegue. Cuando duela (arranque/memoria), se agrega build a dist/.
FROM node:22-alpine

WORKDIR /app
RUN corepack enable

# Manifiestos primero (caché de dependencias).
COPY package.json pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json

RUN pnpm install --filter @fleetspecial/backend

# Código + migraciones + herramientas.
COPY backend backend

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

WORKDIR /app/backend
# Sin shell-form para señales correctas (SIGTERM → shutdown hooks de Nest).
CMD ["npx", "tsx", "src/main.ts"]
