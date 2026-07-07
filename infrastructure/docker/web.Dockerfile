# Portal web de FleetSpecial (Next.js) — E0.
# Se construye desde la RAÍZ del repo (contexto = .) para resolver el workspace pnpm
# y el SDK generado (frontend/shared/api).
#   docker build -f infrastructure/docker/web.Dockerfile -t fleetspecial-web .
FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml ./
COPY frontend/web/package.json frontend/web/package.json
COPY frontend/shared/api/package.json frontend/shared/api/package.json

RUN pnpm install --filter @fleetspecial/web...

COPY frontend frontend
COPY backend/contracts backend/contracts

RUN pnpm --filter @fleetspecial/web build

# Runtime: `next start` con las dependencias ya instaladas.
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY --from=build /app /app

ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/frontend/web
CMD ["npx", "next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
