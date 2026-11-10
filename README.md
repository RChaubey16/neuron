# Neuron

Neuron is a backend platform that offers reusable services through REST
APIs. Users log in with Google, create API keys, and call platform
services with them. The first service is a URL shortener.

-   `apps/api`: NestJS API (Node 26, ES modules, Oxlint, Vitest)
-   `apps/web`: Next.js web app (coming in Phase 4)

See [plan/backend-platform-development-plan.md](plan/backend-platform-development-plan.md)
for the full plan and [plan/progress.md](plan/progress.md) for current
status.

## Requirements

Only **Docker** (with Compose) and **Git**. Node, pnpm, and all packages
run inside containers. Do not install them on the host.

## Getting started

``` bash
cp .env.example .env        # then fill in real values
docker compose up --build   # API in watch mode on http://localhost:3000
```

The API is served under `http://localhost:3000/api/v1`.

## Common commands

Run every project command inside the `api` container:

``` bash
docker compose exec api pnpm lint          # Oxlint (type-aware)
docker compose exec api pnpm typecheck     # tsc --noEmit
docker compose exec api pnpm test          # unit tests (Vitest)
docker compose exec api pnpm test:e2e      # e2e tests (Vitest + Supertest)
docker compose exec api pnpm format        # Prettier
docker compose exec api pnpm add <pkg>     # add a dependency (updates pnpm-lock.yaml)
docker compose logs -f api                 # follow logs
docker compose down                        # stop containers
```

`node_modules` lives in Docker volumes, so packages built for macOS
never reach the Linux container. If dependencies get into a bad state,
reset the volumes with `docker compose down -v` and start again.

## Production image

The same Dockerfile has a `prod` target, which Coolify deploys:

``` bash
docker build -f apps/api/Dockerfile --target prod -t neuron-api .
docker run --rm -p 3000:3000 --env-file .env neuron-api
```

It contains only production dependencies and runs as the non-root
`node` user.
