# Neuron — Development Plan

**Project name:** Neuron

## Overview

A single NestJS + Supabase (Postgres via Prisma) platform exposing shared backend
services (notifications, URL shortener, and future services) behind a unified API.

- **Humans** log in via self-hosted Google OAuth (Nest-issued session JWTs) to a dashboard to manage API keys.
- **Machines** (other apps) call service endpoints using an API key (`x-api-key` header).
- Every service call is recorded in a `UsageLog` for analytics/debugging.

---

## Phase 0 — Project Setup

**Goal:** Empty but correctly wired project, dockerized from day one.

- [x] Init NestJS project (`nest new`)
- [x] Create Supabase project (Postgres + Auth, Google provider enabled)
- [x] Install & configure Prisma, point `DATABASE_URL` at Supabase Postgres
- [x] Set up `.env` structure — later reshaped by the Phase 2 migration off Supabase Auth; see `.env.example` for the current set (`DATABASE_URL` for Supabase Postgres, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_CALLBACK_URL`, `JWT_SECRET`, `FRONTEND_URL`, plus Redis/Resend vars added in later phases)
- [x] Set up base `PrismaModule` / `PrismaService` (global module)
- [x] Set up basic health check route (`GET /health`)
- [x] Set up ESLint/Prettier, basic CI (lint + build on push)
- [x] Write multi-stage `Dockerfile` (deps → build → slim runtime image)
- [x] Write `docker-compose.yml` for local dev (app + Redis; Supabase stays remote/cloud since it's hosted)
- [x] Add `.dockerignore` (`node_modules`, `.env`, `dist`, etc.)
- [x] Confirm `docker compose up` boots the app and `/health` responds from inside the container
- [x] Wire Docker build into CI (build image on push, as a build-check even before Phase 8 deployment)

**Exit criteria:** `docker compose up` starts the whole local stack (app + Redis) and `/health` returns 200 from the containerized app; Prisma connects to Supabase from inside the container.

---

## Phase 1 — Data Model

**Goal:** All core tables exist and migrations run cleanly.

- [x] Define `User`, `ApiKey`, `UsageLog` models in `schema.prisma` (as discussed)
- [x] Run first Prisma migration against Supabase
- [x] Seed script (optional) for a test user + test API key in dev

**Exit criteria:** Tables visible in Supabase dashboard; `prisma studio` works locally.

---

## Phase 2 — Dashboard Auth (Self-Hosted Google OAuth + Nest JWTs)

**Goal:** A human can log in with Google and get a valid session.

> Originally built on Supabase Auth (Supabase-issued JWTs, verified against
> Supabase's JWKS). Migrated mid-phase to self-hosted Google OAuth with
> Nest-issued session JWTs instead — Supabase is database-only now. The
> checklist below reflects what actually shipped; see CLAUDE.md's "Prisma /
> Nest gotchas" section for the migration's specific traps.

- [x] Register a Google Cloud OAuth client (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_CALLBACK_URL`) — Neuron drives the OAuth handshake itself via `passport-google-oauth20`, not Supabase Auth
- [x] `GET /auth/google` (via `GoogleStrategy`) redirects to Google's consent screen directly; `GET /auth/google/callback` completes the handshake and redirects to `${FRONTEND_URL}/auth/callback#token=<jwt>` — no separate manual-login page needed once this landed (the original throwaway `scripts/manual-google-login.html` was removed)
- [x] On first login, lazily create the local `User` row from the verified Google profile (`AuthService.findOrCreateUser`, upserted on `email` — the column with the actual unique constraint — with `id` set to Google's `sub` claim on creation)
- [x] Build `JwtAuthGuard` in NestJS — verifies a Nest-issued session JWT (`@nestjs/jwt`, signed with `JWT_SECRET`) on incoming dashboard requests; the token itself is issued by `AuthService.signToken` right after a successful Google login
- [x] Protected test route: `GET /me` returns the logged-in user's profile

**Exit criteria:** Logging in via Google and hitting `GET /me` with the session token returns the correct user.

---

## Phase 3 — API Key Management

**Goal:** Logged-in users can create, list, and revoke API keys.

- [x] `POST /api-keys` — generate key (`crypto.randomBytes`), store only the **hash**, return raw key once
- [x] `GET /api-keys` — list user's keys (show `keyPrefix`, `createdAt`, `lastUsedAt`, `revokedAt` — never the raw key)
- [x] `DELETE /api-keys/:id` — revoke (soft delete via `revokedAt`)
- [x] Build `ApiKeyGuard` — hashes incoming `x-api-key` header, looks up match, rejects if missing/revoked
- [x] Update `lastUsedAt` on successful auth (can be async/non-blocking)

**Exit criteria:** Can create a key via dashboard route, then successfully authenticate a separate request using only that key.

---

## Phase 4 — Usage Logging (cross-cutting)

**Goal:** Every service call is logged automatically, without cluttering service code.

- [x] Build a `UsageLoggingInterceptor` (or hook it into `ApiKeyGuard`) that writes a `UsageLog` row per request: `apiKeyId`, `service`, `endpoint`, timestamp
- [x] Make logging async/non-blocking (don't let logging failures break the actual request)
- [x] `GET /usage` (dashboard route) — basic aggregate view: calls per service, per day, per key

**Exit criteria:** Any authenticated service call produces a `UsageLog` row automatically, and `/usage` reflects it.

---

## Phase 5 — Notifications Service (Email)

**Goal:** First real service, working end-to-end.

- [x] Pick an email provider (Resend, Postmark, or SES — decide when you get here)
- [x] `NotificationsModule` with `POST /api/v1/notifications/email` (`to`, `subject`, `body`/`template`)
- [x] Input validation via DTOs + `class-validator`
- [x] Queue-based sending (BullMQ + Redis, or Supabase-based queue) so requests return fast and retries are handled
- [x] Error handling: provider failure shouldn't crash the request — log + retry
- [x] Protect route with `ApiKeyGuard`

**Exit criteria:** A test app can POST to `/api/v1/notifications/email` with an API key and receive an actual email.

---

## Phase 6 — URL Shortener Service

**Goal:** Second service, proving the pattern is reusable.

- [x] Add `ShortUrl` model (`code`, `originalUrl`, `apiKeyId`, `createdAt`, `clickCount`)
- [x] `POST /shorten` — create short code (protected by `ApiKeyGuard`)
- [x] `GET /:code` — public redirect endpoint (no API key needed — this one's meant to be hit by browsers)
- [x] Basic rate limiting on `POST /shorten` and `GET /:code` (per API key / per IP) to prevent abuse
- [x] Increment `clickCount` on redirect (async)

**Exit criteria:** Can shorten a URL via API, then visiting the short link redirects correctly and increments the counter.

---

## Phase 7 — Hardening & Cross-Cutting Concerns

**Goal:** Make it production-safe before you actually depend on it.

- [x] Global rate limiting (e.g. `@nestjs/throttler`) per API key — `ApiKeyThrottlerGuard` (`src/common/guards/`) overrides `ThrottlerGuard.getTracker` to key on the hashed `x-api-key` header instead of IP, falling back to the base IP tracker for unauthenticated/dashboard routes; wired globally in `AppModule` in place of the plain `ThrottlerGuard`
- [x] Centralized error handling / exception filters (consistent error JSON shape) — `GlobalExceptionFilter` (`src/common/filters/`), global via `APP_FILTER`
- [x] API versioning prefix (`/v1/...`) if not already done — already done for every `ApiKeyGuard` route (`/api/v1/...`); dashboard/auth/health routes are deliberately unversioned (see CLAUDE.md's Architecture section), enforced by `src/common/api-versioning.spec.ts`
- [x] Request validation everywhere (DTOs on all inputs)
- [x] Structured logging (e.g. Pino) — separate from `UsageLog`, this is for debugging/ops — `StructuredLogger` (`src/common/logging/`), a custom `ConsoleLogger` subclass in JSON mode rather than Pino, to avoid an ESM-only dependency; correlation IDs via `RequestIdMiddleware`
- [ ] Environment separation (dev/staging/prod Supabase projects or schemas)
- [x] Basic tests: guards, key hashing, one happy-path e2e test per service

**Exit criteria:** You'd trust this running unattended for a real side project.

---

## Phase 8 — Deployment

**Goal:** Live and reachable, running from the same Docker image built since Phase 0.

- [ ] Pick host that runs containers directly (Railway, Render, Fly.io, or a VPS with `docker compose` — since the app is already containerized, avoid re-buildpacking it)
- [ ] Push image to a registry (Docker Hub, GHCR, or host's built-in registry)
- [ ] Set production env vars (Supabase prod project, Redis if used, email provider keys)
- [ ] Set up basic uptime monitoring / alerting
- [ ] Point a real side-project app at it for a live end-to-end test

**Exit criteria:** A separate live app successfully calls the platform in production.

---

## Phase 9 — Future Services (Backlog, not scoped yet)

Ideas to slot in later using the same module pattern (`Module + Controller + Service + ApiKeyGuard`):

- SMS notifications
- File/image upload & storage (Supabase Storage)
- Simple analytics/event tracking endpoint
- Webhooks-out (notify external apps of events)
- Scheduled/cron jobs as a service (like a hosted cron trigger)

---

## Suggested Build Order Summary

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8
(setup)   (data)     (auth)    (keys)    (logging)  (email)    (shortener)  (harden)  (deploy)
```

Phases 5 and 6 can technically be swapped or built in parallel once Phase 4 is done,
since they don't depend on each other — only on the API key + logging infrastructure.
