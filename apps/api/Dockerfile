# syntax=docker/dockerfile:1
# Neuron API. Build from the repo root:
#   docker build -f apps/api/Dockerfile -t neuron-api .

FROM node:24-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 TURBO_TELEMETRY_DISABLED=1
# pnpm comes from the root package.json's packageManager field.
RUN corepack enable
WORKDIR /repo

# 1. Cut the monorepo down to the API and the workspace packages it uses.
FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.13 prune @neuron/api --docker

# 2. Install dependencies (cached until a package.json or the lockfile changes), then build.
FROM base AS build
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY --from=prune /repo/out/full/ ./
COPY tsconfig.base.json ./
RUN pnpm turbo run build --filter=@neuron/api
# The API with production dependencies only, and packages/db with the Prisma
# CLI for running migrations when the container starts.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @neuron/api deploy --prod --store-dir /pnpm/store /out/api && \
    pnpm --filter @neuron/db deploy --store-dir /pnpm/store /out/db

# 3. The runtime image: no build tools, no sources, and a non-root user.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production API_PORT=4000
WORKDIR /app
COPY --from=build /out/api ./api
COPY --from=build /out/db ./db
COPY --chmod=755 docker/api-entrypoint.sh /usr/local/bin/neuron-api-entrypoint
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${API_PORT}/health" || exit 1
ENTRYPOINT ["neuron-api-entrypoint"]
