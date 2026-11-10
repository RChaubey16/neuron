# Neuron: Progress

Tracks where development stands against
[the development plan](backend-platform-development-plan.md).
Updated after every feature commit.

**Status values:** Not started · In progress · Done · Blocked

## Current status

-   **Current phase:** Phase 0: Project Foundation
-   **Next up:** Finish Feature 0.3 (connect to the Supabase dev project), then Phase 1, Feature 1.1
-   **Last updated:** 2026-11-10

## Waiting on

| Item | Needed by | Status |
|---|---|---|
| Docker Desktop installed | Feature 0.1 | Done (Docker 29.8, Compose 5.5) |
| Git repository URL | Before first push | Pending (not blocking) |
| Supabase development project and connection strings | Feature 0.3 | Partial: DB password received (`cred.txt`); need project ref and pooler host |
| Google Cloud OAuth app | Feature 1.1 | Pending |
| Domain names (web, API, short) | Feature 4.5 / 5.6 | Pending (not blocking) |

## Features

### Phase 0: Project Foundation

| Feature | Status | Commit | Notes |
|---|---|---|---|
| 0.1 Initialize NestJS project | Done | `957403f` | NestJS 12, Node 26, ESM; Oxlint + Vitest (plan updated); `@/*` alias; env validation, `/api/v1` prefix, CORS, validation pipe, exception filter |
| 0.2 Docker development environment | Done | `156d6ae` | Node 26.13 slim; `dev`/`prod` targets; Corepack 0.36 → pnpm 12.18; node_modules + store in volumes; hot reload works without polling (needs `procps`); prod image non-root, prod deps only |
| 0.3 Supabase database integration (Prisma) | In progress | `aa0fd72` | Prisma 7.10.1 + `@prisma/adapter-pg`; `PrismaModule`/`PrismaService`; `migrate dev`/`deploy` verified on test Postgres; `docker-compose.test.yml` with `auth.users` stub; `migrate` image target. **Pending:** connect to the Supabase dev project. For 1.3: `migrate dev`'s shadow DB lacks `auth`, so FKs to `auth.users` need a shadow DB with the stub |
| 0.4 Health check API | Done | `aa74194` | `GET /api/v1/health` (app + DB, 503 when DB down, 3 s DB timeout), `GET /api/v1/health/live` for container health checks; basic Swagger at `/api/v1/docs` + `/api/v1/openapi.json` (Phase 0 criterion; full docs in 5.5); `@Public()` decorator ready for Phase 1 guards |

### Phase 1: Authentication System

| Feature | Status | Commit | Notes |
|---|---|---|---|
| 1.1 Configure Supabase Google OAuth | Not started | | |
| 1.2 Authentication integration in NestJS | Not started | | |
| 1.3 User management | Not started | | |
| 1.4 Protected routes | Not started | | |

### Phase 2: API Key Management

| Feature | Status | Commit | Notes |
|---|---|---|---|
| 2.1 API key database design | Not started | | |
| 2.2 API key generation | Not started | | |
| 2.3 API key listing | Not started | | |
| 2.4 API key revocation | Not started | | |
| 2.5 API key authentication guard | Not started | | |
| 2.6 API key scopes and permissions | Not started | | |

### Phase 3: URL Shortener Service

| Feature | Status | Commit | Notes |
|---|---|---|---|
| 3.1 URL database design | Not started | | |
| 3.2 Short code generation | Not started | | |
| 3.3 Create short URL API | Not started | | |
| 3.4 Redirect API | Not started | | |
| 3.5 URL listing API | Not started | | |
| 3.6 URL details API | Not started | | |
| 3.7 Update and delete URL APIs | Not started | | |
| 3.8 Click tracking | Not started | | |

### Phase 4: Web Frontend

| Feature | Status | Commit | Notes |
|---|---|---|---|
| 4.1 Frontend project setup | Not started | | |
| 4.2 Google login | Not started | | |
| 4.3 Profile and API key management | Not started | | |
| 4.4 API documentation pages | Not started | | |
| 4.5 Frontend deployment (Vercel) | Not started | | |

### Phase 5: Security, Testing, and Stabilization

| Feature | Status | Commit | Notes |
|---|---|---|---|
| 5.1 Rate limiting | Not started | | |
| 5.2 Security hardening | Not started | | |
| 5.3 Unit testing | Not started | | |
| 5.4 Integration and end-to-end testing | Not started | | |
| 5.5 Swagger documentation | Not started | | |
| 5.6 API deployment (Coolify) | Not started | | |

## Log

Newest first. One entry per commit.

| Date | Commit | Summary |
|---|---|---|
| 2026-11-10 | `aa74194` | Feature 0.4: health and liveness endpoints, Docker health checks, basic Swagger. |
| 2026-11-10 | `aa0fd72` | Feature 0.3 (code): Prisma integration, migration workflow, test database. Supabase check pending. |
| 2026-11-10 | `156d6ae` | Feature 0.2: Dockerfile (dev/prod), docker-compose.yml, .env.example, README with commands. |
| 2026-11-10 | `957403f` | Feature 0.1: pnpm monorepo and NestJS API scaffold with config, validation, CORS and error handling. |
| 2026-11-10 | `8043cba` | Initial commit: plan and CLAUDE.md. |
| 2026-11-10 | (none) | Plan finalized; progress tracking started. |
