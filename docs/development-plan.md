# Neuron — Development Plan

**Project name:** Neuron

## Overview

A single NestJS + Supabase (Postgres via Prisma) platform exposing shared backend
services (notifications, URL shortener, and future services) behind a unified API.

- **Humans** log in via Google OAuth (Supabase Auth) to a dashboard to manage API keys.
- **Machines** (other apps) call service endpoints using an API key (`x-api-key` header).
- Every service call is recorded in a `UsageLog` for analytics/debugging.

---

## Phase 0 — Project Setup

**Goal:** Empty but correctly wired project, dockerized from day one.

- [x] Init NestJS project (`nest new`)
- [x] Create Supabase project (Postgres + Auth, Google provider enabled)
- [x] Install & configure Prisma, point `DATABASE_URL` at Supabase Postgres
- [x] Set up `.env` structure (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`)
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

## Phase 2 — Dashboard Auth (Google OAuth via Supabase)

**Goal:** A human can log in with Google and get a valid session.

- [x] Configure Google OAuth provider in Supabase Auth settings
- [x] Frontend (even a minimal one, or Postman/manual flow first) triggers Supabase Google login (`scripts/manual-google-login.html`, a throwaway dev-only page)
- [x] On first login, sync Supabase `auth.users` record into your own `User` table (lazy-create-on-first-request, via `AuthService.verifyAndSyncUser`)
- [x] Build `SupabaseJwtGuard` in NestJS — verifies the Supabase JWT on incoming dashboard requests (against Supabase's JWKS, since this project signs tokens with an asymmetric key, not the legacy shared secret)
- [x] Protected test route: `GET /me` returns the logged-in user's profile

**Exit criteria:** Logging in via Google and hitting `GET /me` with the session token returns the correct user.

---

## Phase 3 — API Key Management

**Goal:** Logged-in users can create, list, and revoke API keys.

- [ ] `POST /api-keys` — generate key (`crypto.randomBytes`), store only the **hash**, return raw key once
- [ ] `GET /api-keys` — list user's keys (show `keyPrefix`, `createdAt`, `lastUsedAt`, `revokedAt` — never the raw key)
- [ ] `DELETE /api-keys/:id` — revoke (soft delete via `revokedAt`)
- [ ] Build `ApiKeyGuard` — hashes incoming `x-api-key` header, looks up match, rejects if missing/revoked
- [ ] Update `lastUsedAt` on successful auth (can be async/non-blocking)

**Exit criteria:** Can create a key via dashboard route, then successfully authenticate a separate request using only that key.

---

## Phase 4 — Usage Logging (cross-cutting)

**Goal:** Every service call is logged automatically, without cluttering service code.

- [ ] Build a `UsageLoggingInterceptor` (or hook it into `ApiKeyGuard`) that writes a `UsageLog` row per request: `apiKeyId`, `service`, `endpoint`, timestamp
- [ ] Make logging async/non-blocking (don't let logging failures break the actual request)
- [ ] `GET /usage` (dashboard route) — basic aggregate view: calls per service, per day, per key

**Exit criteria:** Any authenticated service call produces a `UsageLog` row automatically, and `/usage` reflects it.

---

## Phase 5 — Notifications Service (Email)

**Goal:** First real service, working end-to-end.

- [ ] Pick an email provider (Resend, Postmark, or SES — decide when you get here)
- [ ] `NotificationsModule` with `POST /notifications/email` (`to`, `subject`, `body`/`template`)
- [ ] Input validation via DTOs + `class-validator`
- [ ] Queue-based sending (BullMQ + Redis, or Supabase-based queue) so requests return fast and retries are handled
- [ ] Error handling: provider failure shouldn't crash the request — log + retry
- [ ] Protect route with `ApiKeyGuard`

**Exit criteria:** A test app can POST to `/notifications/email` with an API key and receive an actual email.

---

## Phase 6 — URL Shortener Service

**Goal:** Second service, proving the pattern is reusable.

- [ ] Add `ShortUrl` model (`code`, `originalUrl`, `apiKeyId`, `createdAt`, `clickCount`)
- [ ] `POST /shorten` — create short code (protected by `ApiKeyGuard`)
- [ ] `GET /:code` — public redirect endpoint (no API key needed — this one's meant to be hit by browsers)
- [ ] Basic rate limiting on `POST /shorten` and `GET /:code` (per API key / per IP) to prevent abuse
- [ ] Increment `clickCount` on redirect (async)

**Exit criteria:** Can shorten a URL via API, then visiting the short link redirects correctly and increments the counter.

---

## Phase 7 — Hardening & Cross-Cutting Concerns

**Goal:** Make it production-safe before you actually depend on it.

- [ ] Global rate limiting (e.g. `@nestjs/throttler`) per API key
- [ ] Centralized error handling / exception filters (consistent error JSON shape)
- [ ] API versioning prefix (`/v1/...`) if not already done
- [ ] Request validation everywhere (DTOs on all inputs)
- [ ] Structured logging (e.g. Pino) — separate from `UsageLog`, this is for debugging/ops
- [ ] Environment separation (dev/staging/prod Supabase projects or schemas)
- [ ] Basic tests: guards, key hashing, one happy-path e2e test per service

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
