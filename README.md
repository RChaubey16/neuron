# Neuron

A single NestJS + Supabase (Postgres via Prisma) platform that exposes shared
backend services — URL shortener, notifications, and more to come — behind
one unified API.

[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Jest](https://img.shields.io/badge/tested%20with-Jest-C21325?logo=jest&logoColor=white)](https://jestjs.io/)
[![License: UNLICENSED](https://img.shields.io/badge/license-private-lightgrey)](#)

## How it works

- **Humans** log in via self-hosted Google OAuth and manage API keys through
  a dashboard (Nest-issued session JWTs).
- **Machines** call service endpoints with an API key in the `x-api-key`
  header.
- Every authenticated service call is recorded to a usage log for analytics.

| | Dashboard routes | Service routes |
|---|---|---|
| Caller | A logged-in human | Another app/service |
| Credential | Session JWT (`Authorization: Bearer <jwt>`) | API key (`x-api-key: <key>`) |
| Guard | `JwtAuthGuard` | `ApiKeyGuard` |

## Services

| Module | Routes | Notes |
|---|---|---|
| `auth` | `GET /auth/google`, `GET /auth/google/callback` | Google OAuth → Nest-issued JWT |
| `api-keys` | `POST/GET /api-keys`, `DELETE /api-keys/:id` | Create, list, revoke API keys |
| `usage` | `GET /usage` | Per-service/day usage aggregates |
| `short-url` | `POST /api/v1/short-url/shorten`, `GET /:code` | First production service; `GET /:code` is public by design |
| `health` | `GET /health` | Liveness check, exempt from rate limiting |

See [`docs/API.md`](docs/API.md) for full request/response details and a
step-by-step Postman walkthrough.

## Getting started

```bash
pnpm install
cp .env.example .env      # fill in your Google OAuth + Supabase Postgres values
pnpm exec prisma generate
```

### Run

```bash
pnpm run start:dev        # local dev server, watch mode
docker compose up --build # containerized app + Redis
```

### Test

```bash
pnpm run test             # unit tests
pnpm run test:e2e         # e2e tests
pnpm run lint
pnpm run build
```

## Tech stack

- **Framework:** NestJS 11 (TypeScript)
- **Database:** Supabase Postgres via Prisma 7 (`@prisma/adapter-pg`)
- **Auth:** `passport-google-oauth20` + `@nestjs/jwt` (self-issued session JWTs)
- **Validation:** `class-validator` / `class-transformer`
- **Rate limiting:** `@nestjs/throttler`
- **Queue (planned):** BullMQ + Redis
- **Testing:** Jest (unit + e2e)
- **Deployment:** Multi-stage Docker image

## Docs

- [`docs/development-plan.md`](docs/development-plan.md) — phased build plan
- [`docs/API.md`](docs/API.md) — full API reference
- [`CLAUDE.md`](CLAUDE.md) — architecture notes and repo-specific gotchas
