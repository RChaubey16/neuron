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

## Phase 2 — Dashboard Auth (Google OAuth + JWT) ✅

1. Started Phase 2 on Supabase Auth for Google login — got it working, `GET /me` returned the right user. Then decided to rip it out and self-host the OAuth flow instead. Sometimes the "done" version isn't the version you keep. 🔁

2. Neuron now drives Google OAuth itself: `GET /auth/google` redirects to Google via `passport-google-oauth20`, `GET /auth/google/callback` looks up/creates the `User` row and hands back a Nest-issued JWT (`@nestjs/jwt`, not Supabase's). Supabase is database-only now — just Postgres via Prisma.

3. Migrating away from a library meant losing its guardrails. `jose`/`@nestjs/config`/`@nestjs/jwt`/`@nestjs/passport` all have ESM-only "latest" majors that silently break CommonJS Jest on import — pinned every one back to a CJS-compatible line. Same lesson, four times over.

4. Manual end-to-end verification against a real Google OAuth client caught a real bug: `findOrCreateUser`'s upsert matched on `id`, so a user from before this migration (whose `id` was a Supabase UUID, not Google's `sub`) missed the lookup and crashed on a duplicate-email constraint instead of linking accounts. Fixed by upserting on `email` — the column that's actually unique.

5. Post-commit review turned up one more: an unverified Google profile email could be used to hijack an existing account. Added an explicit `email_verified` check before trusting the profile. Caught before it shipped, but a good reminder that "OAuth worked in testing" isn't the same as "OAuth is safe."

6. Phase 2 done (the long way): self-hosted Google OAuth, Nest-issued session JWTs, `GET /me` verified end-to-end against a real login and a real Postgres DB. On to API keys. 🔑

---

## Phase 3 — API Key Management ✅

1. `POST /api-keys` generates a `crypto.randomBytes(32)` key, stores only its SHA-256 hash (no salt needed — the key's already high-entropy), and returns the raw value exactly once. `GET /api-keys` / `DELETE /api-keys/:id` round out list + revoke.

2. Built `ApiKeyGuard` — the machine-auth counterpart to the dashboard's `JwtAuthGuard`. Hashes the incoming `x-api-key` header, looks up the match, rejects if missing or revoked. Two different credentials, two different guards, on purpose.

3. Verified end-to-end against the real Supabase Postgres DB: created a key with a real bearer token, authenticated a separate request using only the raw key, revoked it, confirmed the revoked key then gets rejected. Phase 3 done — machines can now authenticate independently of humans. 🤖

---

## Phase 4 — Usage Logging ✅

1. Every authenticated service call now writes a `UsageLog` row automatically via `UsageLoggingInterceptor` — `apiKeyId`, `service`, `endpoint` — without any individual service module having to remember to log anything itself. Cross-cutting by design.

2. Learned (again) that a Prisma query builder call is a lazy "PrismaPromise" — it only executes once something subscribes via `.then()`/`.catch()`. `void`-ing a fire-and-forget write looks fine and silently never runs the query. `.catch(() => {})` is the fix, and now it's a standing regression test on every fire-and-forget write in the codebase.

3. `GET /usage` aggregates by service/day/key using raw `$queryRaw` SQL, since Prisma's `groupBy` can't date-truncate `createdAt`. Verified the raw SQL against real Postgres with a standalone script, since the unit tests mock `$queryRaw` entirely and wouldn't have caught a syntax mistake.

4. Phase 4 done: every authenticated call is now automatically logged, and `/usage` reflects it. Not wired into a real production route yet — no service module existed to log from until Phase 6. 📊

---

## Phase 5 — Notifications Service (Email) ✅

1. `NotificationsModule` ships: `POST /api/v1/notifications/email`, same `ApiKeyGuard` + `@Service()` + `UsageLoggingInterceptor` pattern as the URL shortener. Sending goes through a BullMQ + Redis queue instead of synchronously — the route returns `202 { queued: true }` the moment the job's on the queue, retries (3 attempts, exponential backoff) handled by the worker.

2. First verification pass looked clean — email sent, logs quiet — but couldn't actually tell success from failure. Turns out the Resend SDK never rejects its promise: a bad API key, an unverified domain, a 4xx/5xx from their API all resolve as `{ data: null, error: {...} }` instead of throwing. My `try/catch` around `resend.emails.send()` was dead code the whole time — every job was silently marked "sent" no matter what actually happened. Confirmed by reading Resend's own SDK source.

3. Fixed: `EmailProcessor.process` now checks the discriminated `{ data, error }` result directly — throws on `error` (so BullMQ's retry policy actually engages) and logs the real Resend delivery id on success.

4. Re-verified against the real running stack, this time with actual proof instead of absence-of-error: a send to Resend's own verified address returned `202` and logged a real delivery id. A send to an address outside that account hit Resend's "can only send to your own email" restriction — and *this time* it logged the rejection and got retried by BullMQ (~5s later, matching the backoff curve). That retry firing at all is the negative-path proof the fix works.

5. Phase 5 done: second real service, same reusable pattern, plus a genuine "verification wasn't actually verifying anything" bug caught before it shipped. `GET /usage` now shows `email-notifications` right next to `url-shortener`. 📧

---

## Phase 6 — URL Shortener Service ✅

1. Built Phase 6 ahead of Phase 5 — both only depend on Phase 4, not each other, and the shortener was the faster path to proving the service pattern end-to-end.

2. `POST /shorten` (protected by `ApiKeyGuard` + `@Service('url-shortener')`) is the first real consumer of Phase 4's usage-logging pattern. `ShortUrlService.create` generates a 7-char `nanoid()` code and retries on the rare unique-constraint collision.

3. `GET /:code` is the one deliberately unauthenticated route in the whole API — meant to be clicked directly by browsers, not called with a key. Had to keep it registered dead last in `AppModule`/routing, since a single-segment catch-all like `/:code` would otherwise shadow routes like `/health` or `/usage` by registration order, not specificity.

4. Added global rate limiting via `@nestjs/throttler` — a default cap per IP, with a tighter override on `POST /shorten` and a looser one on `GET /:code` (real users click these links). Per-API-key limits are explicitly a Phase 7 problem.

5. Verified end-to-end against the real Supabase Postgres DB: shortened a URL, confirmed the redirect and `Location` header, confirmed `clickCount` incremented and a `UsageLog` row landed, confirmed a bad scheme (`javascript:`) gets rejected. Phase 6 done — second service, same pattern, proving it's reusable. 🔗

6. Ran a NestJS best-practices audit pass ahead of Phase 7 rather than duplicating it later: added startup env validation (which also fixed a real crash-on-missing-`SUPABASE_URL` bug), turned on `ValidationPipe({ transform: true })`, made `ShortUrlModule` explicitly import `ApiKeyModule` instead of relying on Nest's implicit guard resolution, and exempted `/health` from throttling so uptime monitors don't get rate-limited. Small things, all found by reading the code with fresh eyes instead of just moving to the next phase.

---

## Phase 7 — Hardening & Cross-Cutting Concerns 🚧

1. Kicked off hardening: rate limiting moved from per-IP to **per API key** — `ApiKeyThrottlerGuard` hashes the incoming `x-api-key` and keys the counter on that instead of IP, so callers behind the same NAT don't share a quota and one caller can't dodge limits by rotating IPs. Registered globally, falls back to IP tracking for dashboard/unauthenticated routes.

2. Added a `GlobalExceptionFilter` so every error response — routine `HttpException` or an unexpected server-side fault — comes back in one consistent JSON shape with a `requestId` for correlating with server logs. A raw exception or DB error never reaches the caller; only `"Internal server error"`, with the real detail logged server-side.

3. Structured logging via a custom `ConsoleLogger` subclass in JSON mode instead of Pino — dodging yet another ESM-only-dependency trap this project's hit a few times already. Paired with an `AsyncLocalStorage`-based request-id middleware so every log line (Nest's own included) carries a correlation id without threading it through every call signature.

4. API versioning turned out to already be correctly implemented (only `ApiKeyGuard` routes get `/api/v1/...`) — formalized it as a standing regression test that reflects on route/guard metadata instead of booting the whole app, then proved it actually catches a regression by temporarily de-versioning a route and watching the test fail before reverting.

5. Ran the `nestjs-best-practices` skill as an audit pass and it earned its keep: two path params (`DELETE /api-keys/:id`, `GET /:code`) had zero format validation before hitting the database, and — worse — two of the e2e suites never wired up the same `ValidationPipe` config the real app runs, so validation on DTOs that already existed had never actually been exercised in those tests. Both fixed, with new 400-path e2e coverage.

6. Same audit pass caught all three fire-and-forget writes in the codebase (`lastUsedAt`, `UsageLog`, `clickCount`) swallowing failures with an empty `.catch(() => {})` — non-blocking was always the right call, silent never was. They log now, with a regression test per site proving the failure path is reachable.

7. One item left before Phase 7's done: environment separation (dev/staging/prod Supabase projects or schemas). Everything else — rate limiting, error handling, versioning, structured logging, request validation, and baseline test coverage — is in place. 🚧

---

## Phase 8 — Deployment 🚧

_Tweets go here once a separate live app successfully calls the platform in production._

---

## Phase 9 — Future Services 🚧

_Tweets go here as backlog services (SMS, file storage, analytics, webhooks-out, hosted cron) get built._
