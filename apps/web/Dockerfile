# syntax=docker/dockerfile:1
# Neuron dashboard. Build from the repo root:
#   docker build -f apps/web/Dockerfile -t neuron-web .

FROM node:24-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1
# pnpm comes from the root package.json's packageManager field.
RUN corepack enable
WORKDIR /repo

# 1. Cut the monorepo down to the dashboard and the workspace packages it uses.
FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.13 prune @neuron/web --docker

# 2. Install dependencies (cached until a package.json or the lockfile changes), then build.
FROM base AS build
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY --from=prune /repo/out/full/ ./
COPY tsconfig.base.json ./
RUN pnpm turbo run build --filter=@neuron/web

# 3. The runtime image: Next.js's standalone server, and a non-root user.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/" || exit 1
CMD ["node", "apps/web/server.js"]
