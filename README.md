# Neuron

A single NestJS + Supabase (Postgres via Prisma) platform exposing shared backend
services (notifications, URL shortener, and future services) behind a unified API.

See [docs/development-plan.md](docs/development-plan.md) for the phased build plan and
[CLAUDE.md](CLAUDE.md) for architecture notes.

## Setup

```bash
pnpm install
cp .env.example .env   # fill in your Supabase project's values
pnpm exec prisma generate
```

## Run

```bash
pnpm run start:dev      # local dev with watch mode
docker compose up       # containerized app + Redis
```

## Test

```bash
pnpm run test           # unit tests
pnpm run test:e2e       # e2e tests
pnpm run lint
pnpm run build
```
