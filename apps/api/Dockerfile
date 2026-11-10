# syntax=docker/dockerfile:1
#
# Neuron API image. Build context is the repository root so the shared
# pnpm-lock.yaml is available:
#
#   docker build -f apps/api/Dockerfile --target dev  .   # local development
#   docker build -f apps/api/Dockerfile --target prod .   # Coolify / production
#   docker build -f apps/api/Dockerfile --target migrate .  # prisma migrate deploy
#
# Debian slim (not Alpine): Prisma's engines need glibc and OpenSSL.

ARG NODE_VERSION=26.13.0

# ---- runtime: OS packages shared by every stage --------------------------
FROM node:${NODE_VERSION}-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ---- base: pnpm via Corepack ----------------------------------------------
# Node 25+ no longer bundles Corepack, so install a pinned version first.
# Corepack then provides the exact pnpm version from package.json.
FROM runtime AS base
ARG COREPACK_VERSION=0.36.0
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    pnpm_config_store_dir=/pnpm/store
RUN npm install -g corepack@${COREPACK_VERSION} \
 && corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN corepack install

# ---- deps: all dependencies (dev included) --------------------------------
FROM base AS deps
RUN --mount=type=cache,id=neuron-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @neuron/api...

# ---- dev: watch mode; compose bind-mounts the source over this ----------
FROM deps AS dev
ENV NODE_ENV=development
# Nest's watch mode stops the old process with tree-kill, which needs `ps`.
# Without procps the old process keeps port 3000 and restarts fail.
RUN apt-get update \
 && apt-get install -y --no-install-recommends procps \
 && rm -rf /var/lib/apt/lists/*
COPY apps/api apps/api
WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["pnpm", "start:dev"]

# ---- build: compile TypeScript --------------------------------------------
FROM deps AS build
COPY apps/api apps/api
RUN pnpm --filter @neuron/api build

# ---- migrate: one-off job that applies migrations (prisma migrate deploy) -
# Kept out of the prod image: the Prisma CLI more than doubles its size.
# Needs DIRECT_URL. Run it before starting a new prod release.
FROM deps AS migrate
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
WORKDIR /repo/apps/api
CMD ["pnpm", "db:deploy"]

# ---- prod-deps: production dependencies only ------------------------------
FROM base AS prod-deps
RUN --mount=type=cache,id=neuron-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @neuron/api...

# ---- prod: minimal runtime image, runs as the non-root node user ----------
FROM runtime AS prod
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prod-deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --chown=node:node apps/api/package.json ./apps/api/
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
# Liveness only: a database outage should not restart the container.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
