# Neuron — Build in Public

Tweet-sized recaps of the work done in each phase of `docs/development-plan.md`.
Add a new batch under a phase as soon as that phase's exit criteria are met —
don't backfill from memory once details fade.

---

## Phase 0 — Project Setup ✅

1. Kicking off a new side project: Neuron. One NestJS + Supabase API meant to sit behind everything else I build — auth, API keys, usage logging, all shared instead of rebuilt per app. Day 0: scaffolding the repo. 🧠

2. Nest app is up with strict TypeScript, ESLint + Prettier wired in, and a `GET /health` route with an e2e test covering it before any real feature exists. Boring infra first. ✅

3. Prisma is in — but on Prisma 7, `PrismaClient` no longer reads `DATABASE_URL` automatically. Had to wire an explicit `PrismaPg` driver adapter into `PrismaService`. New major versions love removing implicit magic.

4. Learned this one the hard way: Prisma 7's newer `prisma-client` generator emits ESM-flavored output that breaks CommonJS Jest. Staying on `prisma-client-js` — classic CJS output, just works with the existing test setup.

5. `@nestjs/config` 12.x is ESM-only and instantly breaks Jest's CommonJS runner on import. Pinned back to the 4.x line. Not every "latest" is the right latest.

6. Multi-stage Dockerfile is live: deps → build → slim runtime. One image, meant to carry all the way through to Phase 8 deployment without a second build path.

7. Docker build randomly started failing in CI: pnpm 11's `minimumReleaseAge` supply-chain check rejects any dependency published in the last ~24h. Fix was pinning the pnpm version via `packageManager` in `package.json` so Corepack can't silently grab a newer pnpm mid-build.

8. `docker compose up --build` now boots the containerized app + Redis, and `/health` responds from inside the container. Phase 0 exit criteria: met. Prisma → Supabase wiring is in place, just waiting on a real Supabase project to point `DATABASE_URL` at.

9. Phase 0 done: NestJS scaffold, Prisma + driver adapter, Docker/compose, CI (lint + build + image build on push), health check, and a CLAUDE.md documenting every gotcha along the way so future-me (or Claude) doesn't relearn them the hard way. On to the data model. 🚀

---

## Phase 1 — Data Model ✅

1. Supabase project is live. `DATABASE_URL` finally points somewhere real instead of a placeholder — first real milestone unlocked. 🔓

2. Modeled `User`, `ApiKey`, and `UsageLog` in `schema.prisma`. `User.id` isn't Prisma-generated — it's meant to mirror the Supabase `auth.users` UUID once a user's first request lazily syncs their row. Data model matches the auth model before either exists.

3. `ApiKey` only ever stores a `hashedKey` + `keyPrefix`. The raw key gets generated and returned once at creation and is never written to the DB or a log line again. Designing the "can't leak what you never stored" property in from the start.

4. Ran the first `prisma migrate dev` against Supabase — tables showed up in the dashboard on the first try. Indexed `UsageLog` on `(service, createdAt)` up front since Phase 4's `/usage` aggregation is going to want it.

5. Wrote a seed script for a local test user + test API key (hashed the same way `ApiKeyGuard` will hash incoming keys later) so Phase 2/3 work doesn't need a live login flow just to get test data. Learned Prisma 7's seed command lives in `prisma.config.ts`'s `migrations.seed`, not the old `package.json` field.

6. Phase 1 done: real Supabase project, schema migrated, seed data in place. Data model shipped before a single line of auth code — exactly the order the plan called for. Dashboard auth (Google OAuth) is next. 🔐

---

## Phase 2 — Dashboard Auth (Google OAuth via Supabase) 🚧

_Tweets go here once Google login via Supabase Auth works end-to-end and `GET /me` returns the logged-in user._

---

## Phase 3 — API Key Management 🚧

_Tweets go here once keys can be created, listed, revoked, and used to authenticate a separate request._

---

## Phase 4 — Usage Logging 🚧

_Tweets go here once every authenticated call produces a `UsageLog` row automatically and `/usage` reflects it._

---

## Phase 5 — Notifications Service (Email) 🚧

_Tweets go here once a test app can POST to `/notifications/email` with an API key and an email actually arrives._

---

## Phase 6 — URL Shortener Service 🚧

_Tweets go here once a shortened URL redirects correctly and increments its click count._

---

## Phase 7 — Hardening & Cross-Cutting Concerns 🚧

_Tweets go here once rate limiting, centralized error handling, versioning, and structured logging are in place._

---

## Phase 8 — Deployment 🚧

_Tweets go here once a separate live app successfully calls the platform in production._

---

## Phase 9 — Future Services 🚧

_Tweets go here as backlog services (SMS, file storage, analytics, webhooks-out, hosted cron) get built._
