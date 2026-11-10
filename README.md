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

The API is served under `http://localhost:3000/api/v1`:

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/health` | App and database status (503 if the database is down) |
| `GET /api/v1/health/live` | Liveness only, used by container health checks |
| `/api/v1/docs` | Swagger UI |
| `/api/v1/openapi.json` | OpenAPI document |

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

## Database (Prisma + Supabase)

The API talks to Supabase PostgreSQL through Prisma. Set both
connection strings in `.env` (Supabase dashboard → **Connect**):

-   `DATABASE_URL`: Transaction pooler (port 6543), used by the app.
-   `DIRECT_URL`: Session pooler (port 5432), used by Prisma Migrate.

``` bash
docker compose exec api pnpm db:migrate     # create + apply a migration (prisma migrate dev)
docker compose exec api pnpm db:status      # show migration status
docker compose exec api pnpm db:generate    # regenerate the Prisma client
```

Change `apps/api/prisma/schema.prisma`, then run `pnpm db:migrate`.
Foreign keys to Supabase's `auth.users` are not managed by Prisma: create
the migration with `pnpm db:migrate --create-only`, add the SQL, then
apply it. The generated client in `apps/api/src/generated/` is
git-ignored and rebuilt on start.

Production applies migrations with the `migrate` image target
(`prisma migrate deploy`) before the new release starts.

## Tests

Unit tests need nothing else. e2e tests run against a disposable Postgres
(never Supabase) that includes a stub of Supabase's `auth.users`:

``` bash
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --wait postgres-test
docker compose exec api pnpm test:e2e
docker compose -f docker-compose.yml -f docker-compose.test.yml rm -sf postgres-test
```

The e2e setup runs `prisma migrate deploy` against it first.

`node_modules` lives in Docker volumes, so packages built for macOS
never reach the Linux container. If dependencies get into a bad state,
reset the volumes with `docker compose down -v` and start again.

## Production images

The same Dockerfile has a `prod` target, which Coolify deploys, and a
`migrate` target that applies database migrations:

``` bash
docker build -f apps/api/Dockerfile --target prod -t neuron-api .
docker build -f apps/api/Dockerfile --target migrate -t neuron-api-migrate .
docker run --rm --env-file .env neuron-api-migrate    # needs DIRECT_URL
docker run --rm -p 3000:3000 --env-file .env neuron-api
```

`prod` contains only production dependencies and runs as the non-root
`node` user. The Prisma CLI lives only in the `migrate` image.
