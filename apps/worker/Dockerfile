# syntax=docker/dockerfile:1
# Neuron worker. Build from the repo root:
#   docker build -f apps/worker/Dockerfile -t neuron-worker .

FROM node:24-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 TURBO_TELEMETRY_DISABLED=1
# pnpm comes from the root package.json's packageManager field.
RUN corepack enable
WORKDIR /repo

# 1. Cut the monorepo down to the worker and the workspace packages it uses.
FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.13 prune @neuron/worker --docker

# 2. Install dependencies (cached until a package.json or the lockfile changes), then build.
FROM base AS build
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY --from=prune /repo/out/full/ ./
COPY tsconfig.base.json ./
RUN pnpm turbo run build --filter=@neuron/worker
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @neuron/worker deploy --prod --store-dir /pnpm/store /out/worker

# 3. The runtime image: no build tools, no sources, and a non-root user.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production WORKER_HEALTH_PORT=4001
WORKDIR /app/worker
COPY --from=build /out/worker ./
USER node
# Internal only: the health check below. Not published.
EXPOSE 4001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${WORKER_HEALTH_PORT}/health" || exit 1
# Node runs as PID 1 and receives SIGTERM directly: the worker stops taking
# jobs and finishes the ones in progress before exiting.
CMD ["node", "dist/main.js"]
