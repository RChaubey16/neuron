# Neuron — Technical Architecture

A guide to Neuron's codebase for engineers: how the system is put together,
how a request moves through it, where each concern lives, and how to extend
it safely.

Related docs:

- [`OVERVIEW.md`](OVERVIEW.md): what Neuron does, for any reader.
- [`HOW-IT-WORKS.md`](HOW-IT-WORKS.md): the same system in plain language.
- [`API.md`](API.md): every endpoint, with request/response examples.
- [`development-plan.md`](development-plan.md): the phase checklist.
- [`CLAUDE.md`](../CLAUDE.md): conventions and the full list of repo-specific
  gotchas. Read its gotchas section before changing dependencies, Prisma, or
  the queue.

---

## 1. What Neuron is

Neuron is a single backend that provides shared services (email
notifications, URL shortening, more later) to two kinds of caller:

- **Humans**, through a first-party web dashboard, authenticated with Google
  OAuth and a Neuron-issued session JWT.
- **Machines** (the owner's other apps), authenticated with an API key in
  the `x-api-key` header.

Every service is usable from both sides through the same service code, and
every service call is recorded in a usage log.

## 2. System context

```
   Browser ──────────►  Dashboard (Next.js, Vercel)
                              │  fetch + Bearer JWT
                              ▼
   Other apps ───────►  Neuron API (NestJS, Coolify on a VPS) ──► Resend (email)
   (x-api-key)                │                    │
                              ▼                    ▼
                     Postgres (Supabase)      Redis (BullMQ)
                                                   │
                                                   ▼
                                        Email worker (same process)
```

| Component | Technology | Where it runs |
|---|---|---|
| API | NestJS 11, TypeScript, Express | Docker container on a Hostinger VPS, deployed by Coolify, `neuron-api.ruturaj.xyz` |
| Background worker | BullMQ `@Processor`, same process as the API | Same container |
| Database | PostgreSQL via Prisma 7 (`@prisma/adapter-pg`) | Supabase (used only as a database) |
| Queue | Redis 7 + BullMQ 5 | Container next to the API |
| Email delivery | Resend SDK | Resend |
| Dashboard | Next.js 16, React 19, TanStack Query, Tailwind 4, shadcn/Radix | Vercel, `neuron.ruturaj.xyz` |
| Identity | Google OAuth 2.0 (passport-google-oauth20), `@nestjs/jwt` | — |

## 3. Repository layout

```
.
├── src/                    NestJS backend
│   ├── main.ts             Bootstrap: logger, CORS, global pipe + serializer
│   ├── app.module.ts       Root module: config, throttler, Prisma, BullMQ, feature modules
│   ├── auth/               Google OAuth, session JWTs, JwtAuthGuard, /me
│   ├── api-keys/           API key CRUD, ApiKeyGuard, @CurrentApiKey()
│   ├── usage/              @Service() decorator, UsageLoggingInterceptor, GET /usage
│   ├── notifications/      Email jobs: controller, service, BullMQ processor, templates
│   ├── short-url/          URL shortener and the public GET /:code redirect
│   ├── health/             Liveness (/health) and readiness (/health/ready)
│   ├── redis/              Fail-fast Redis connection for request-path work
│   ├── prisma/             PrismaService (global)
│   ├── common/             Exception filter, throttler guard, logger, request id, shared DTOs
│   └── config/             Startup validation of process.env
├── test/                   e2e specs (boot the full AppModule)
├── prisma/                 schema.prisma, migrations/, seed script
├── generated/prisma/       Generated Prisma client (not committed; `prisma generate`)
├── frontend/               Dashboard, a standalone Next.js app with its own lockfile
├── docs/                   Documentation
├── Dockerfile              The single build path for every environment
├── docker-compose.yml      Local stack: API + Redis + frontend dev server
└── docker-compose.coolify.yml  Production stack used by Coolify
```

Every feature module follows the same shape: `*.module.ts`,
`*.controller.ts`, `*.service.ts`, plus `dto/` and, where needed, `guards/`,
`decorators/`, `providers/`. Unit specs (`*.spec.ts`) sit next to the file
they test.

## 4. Request lifecycle

For a typical service route, a request passes through these layers in
order:

| # | Layer | Where | What it does |
|---|---|---|---|
| 1 | `RequestIdMiddleware` | `common/request-id.middleware.ts` | Reuses a well-formed incoming `x-request-id` or generates a UUID, and stores it in `AsyncLocalStorage` (`common/request-context.ts`) so every log line carries it |
| 2 | `ApiKeyThrottlerGuard` (global, `APP_GUARD`) | `common/guards/api-key-throttler.guard.ts` | Rate limit. Keyed on the SHA-256 of `x-api-key` if present, else on IP. Default 20 req/min; routes override with `@Throttle()` |
| 3 | Route guard | `ApiKeyGuard` or `JwtAuthGuard` | Authenticates and attaches `request.apiKey` or `request.user` |
| 4 | `UsageLoggingInterceptor` (per route) | `usage/interceptors/` | Only on routes marked `@Service(name)`; writes a `UsageLog` after the handler finishes, whether it succeeded or failed |
| 5 | `ValidationPipe` (global) | `main.ts` | `whitelist`, `forbidNonWhitelisted`, `transform`: unknown fields are rejected and DTOs are instantiated |
| 6 | Controller → service | feature module | Business logic |
| 7 | `ClassSerializerInterceptor` (global) | `main.ts` | Serializes response DTOs by their `@Expose()` fields |
| 8 | `GlobalExceptionFilter` (`APP_FILTER`) | `common/filters/` | One JSON error shape with `requestId`; any non-`HttpException` becomes a generic 500 and the detail is only logged |

Logging goes through `StructuredLogger` (Nest's `ConsoleLogger` in JSON
mode), so every log line, Nest's own included, is JSON.

## 5. Authentication and authorization

There are two credentials. They're never interchangeable, and each route
uses exactly one of them (or neither).

### 5.1 Dashboard: Google OAuth → session JWT

```
Browser → GET /auth/google                       (passport redirects to Google)
Google  → GET /auth/google/callback?code=...     (passport exchanges the code)
          AuthService.findOrCreateUser(profile)  (upsert keyed on email)
          AuthService.signToken(user)            ({ sub: user.id, email })
API     → 302 ${FRONTEND_URL}/auth/callback#token=<jwt>
Browser → frontend stores the token in localStorage and strips the hash
```

- The JWT is signed with `JWT_SECRET` and expires after `JWT_EXPIRES_IN`
  (default `7d`). There is no refresh token; an expired token means signing
  in again.
- `JwtAuthGuard` verifies the signature, then loads the `User` by `sub`. It
  returns `401` if the token is missing, invalid, or expired, or the user no
  longer exists. The handler reads the user with `@CurrentUser()`.
- Any failure in the callback (consent cancelled, unverified email, DB
  error) is caught by `OAuthCallbackRedirectFilter` and redirected to
  `/auth/callback#error=...`, so the browser never lands on raw JSON.
- The token goes in the URL fragment (`#`), not the query string, so it is
  never sent to a server or written to access logs.

### 5.2 Machines: API keys

- **Creation** (`POST /api-keys`): `crypto.randomBytes(32)` produces the raw
  key. Only its SHA-256 hash (`hashedKey`) and a display `keyPrefix` are
  stored. The raw key is returned once and never persisted or logged.
- **Authentication** (`ApiKeyGuard`): hashes the incoming `x-api-key` and
  looks up a key with that hash and `revokedAt: null`. On success it
  attaches `request.apiKey` and updates `lastUsedAt` fire-and-forget.
- **Revoke** (`POST /api-keys/:id/revoke`) sets `revokedAt`; the key stays
  in the list.
- **Delete** (`DELETE /api-keys/:id`) is a soft delete: it sets `deletedAt`
  and hides the key from the list. It also sets `revokedAt`, because the
  guard only checks `revokedAt`. Keep that invariant.

### 5.3 Route matrix

| Route group | Guard | Versioned | Usage-logged |
|---|---|---|---|
| `/api/v1/notifications/...`, `/api/v1/short-url/...` | `ApiKeyGuard` | Yes | Yes |
| `/notifications/...`, `/short-url` (dashboard counterparts) | `JwtAuthGuard` | No | Yes, except read-only listings |
| `/api-keys`, `/usage`, `/me` | `JwtAuthGuard` | No | No |
| `/auth/google`, `/auth/google/callback` | Google passport strategy | No | No |
| `/health`, `/health/ready` | None, `@SkipThrottle()` | No | No |
| `GET /:code` | None (public redirect) | No | No |

**Versioning rule:** only `ApiKeyGuard` routes are versioned, as
`/api/{version}/{service-directory}/{route}`. They are the external contract
other apps depend on. Dashboard routes ship together with the first-party
frontend, so they don't need versions. `src/common/api-versioning.spec.ts`
enforces this rule by reflecting on route and guard metadata.

## 6. Data model

Defined in `prisma/schema.prisma`; migrations live in `prisma/migrations/`.

```
User 1───* ApiKey
 │  1        │ 0..1
 ├──────*  ShortUrl  *──┤
 ├──────*  EmailJob  *──┤
 └──────*  UsageLog  *──┘
```

| Model | Key fields | Notes |
|---|---|---|
| `User` | `id` (Google `sub`), `email` (unique) | Created on first login. Upserted on `email`, which holds the unique constraint |
| `ApiKey` | `hashedKey` (unique), `keyPrefix`, `name`, `lastUsedAt`, `revokedAt`, `deletedAt` | Soft-deleted |
| `ShortUrl` | `code` (unique, 7 chars), `originalUrl`, `clickCount` | |
| `EmailJob` | `status`, `to[]`, `subject`, `body`, `error`, `attemptsMade`, `resendId` | `id` is also the BullMQ job id |
| `UsageLog` | `service`, `endpoint`, `createdAt` | Indexed on `(service, createdAt)` |

**Ownership lives on the row.** `ShortUrl`, `EmailJob`, and `UsageLog` each
have a required `userId` (`ON DELETE CASCADE`) and an optional `apiKeyId`
(`ON DELETE SET NULL`). `apiKeyId` is set only when a real machine key made
the call. Dashboard routes pass `{ userId, apiKeyId: undefined }` to the
same service methods. Queries are scoped by ownership:

- Machine routes scope by the calling `apiKeyId`. A key only sees what it
  created.
- Dashboard routes scope by `userId`, so they cover rows created by any of
  the user's keys.
- A row owned by someone else returns `404`, not `403`, so callers can't
  tell whether an id exists.

The reasoning behind this model is in
[`2026-09-17-direct-ownership-design.md`](2026-09-17-direct-ownership-design.md).

## 7. Modules

### 7.1 `auth`

`GoogleStrategy` (passport), `AuthService` (`findOrCreateUser`,
`signToken`), `JwtAuthGuard`, `@CurrentUser()`, `GET /me`. `AuthModule`
re-exports `JwtModule`, so `JwtAuthGuard` can resolve `JwtService` from any
feature module that imports `AuthModule`.

### 7.2 `api-keys`

`ApiKeysService` (create, list, revoke, soft delete), `ApiKeyGuard`,
`@CurrentApiKey()`. Response DTOs never include `hashedKey`.

### 7.3 `usage`

- `@Service('url-shortener' | 'email-notifications')` marks a handler for
  logging.
- `UsageLoggingInterceptor` writes a `UsageLog` in `finalize()`, so it runs
  after success or failure without delaying the response. `userId` comes
  from `request.user?.id ?? request.apiKey?.userId`.
- `GET /usage` aggregates with raw SQL, because Prisma's `groupBy` can't
  truncate dates:
  `SELECT service, DATE_TRUNC('day', "createdAt"), "apiKeyId", COUNT(*) ... WHERE "userId" = $1 GROUP BY ... ORDER BY date DESC`.

### 7.4 `short-url`

- `POST .../shorten` generates a 7-character `nanoid` code and inserts it.
  On a unique-constraint collision (`P2002`), it retries with a new code.
- `GET /:code` looks up the code, increments `clickCount` fire-and-forget,
  and responds with a `302` redirect. An unknown code returns `404`.
- **Ordering constraint:** `GET /:code` matches any single path segment, and
  Express matches routes in registration order. `ShortUrlModule` must stay
  the last import in `AppModule`. `test/short-url.e2e-spec.ts` checks this.

### 7.5 `notifications`

The largest module. See section 8.

### 7.6 `health`

- `GET /health`: liveness; always `{ "status": "ok" }` while the process is
  up. Used by the Docker `healthcheck`.
- `GET /health/ready`: readiness. `HealthService` runs `SELECT 1` against
  Postgres and `PING` against the producer Redis connection in parallel,
  each with a 2s timeout. It returns `200` if both are up, otherwise `503`
  with a per-check breakdown. The controller sets the status directly
  instead of throwing, so the breakdown isn't replaced by the exception
  filter's error shape.

### 7.7 `redis`

Provides `PRODUCER_REDIS`, an ioredis client with `enableOfflineQueue: false`
and `maxRetriesPerRequest: 1`, so commands fail immediately during an outage
instead of hanging. The factory waits for the first connection attempt to
settle before the app finishes booting; otherwise the first requests would
be rejected as "not ready". It doesn't block startup if Redis is down,
because ioredis keeps retrying in the background. The client is closed on
shutdown.

### 7.8 `prisma`

A global `PrismaService` that builds the client with an explicit
`PrismaPg` driver adapter; Prisma 7 no longer reads `DATABASE_URL` by
itself. The client is generated to `generated/prisma` with the
`prisma-client-js` generator. Don't switch to the newer `prisma-client`
generator: its output breaks the CommonJS Jest setup.

## 8. Email notification pipeline

### 8.1 Components

| Piece | File | Role |
|---|---|---|
| `NotificationsController` | `notifications.controller.ts` | Machine and dashboard routes, sharing DTOs and service methods |
| `NotificationsService` | `notifications.service.ts` | Creates `EmailJob` rows, enqueues, retries, cancels, lists |
| `EMAIL_QUEUE` provider | `providers/email-queue.provider.ts` | BullMQ `Queue('email')` on the fail-fast `PRODUCER_REDIS` connection |
| `EmailProcessor` | `processors/email.processor.ts` | BullMQ worker; sends through Resend and syncs status from worker events |
| `RESEND_CLIENT` provider | `providers/resend-client.provider.ts` | Resend SDK instance |
| Templates | `templates/templates.ts`, `render-template.ts` | Code-defined templates (`welcome`, `password-reset`), with variable validation and HTML escaping |

### 8.2 Two Redis connections

The producer (`Queue.add`) and the worker deliberately use different
connections:

- **Producer**: `PRODUCER_REDIS`, which fails fast. A request made during a
  Redis outage gets a `503` right away.
- **Worker**: the default connection from `BullModule.forRootAsync`. BullMQ
  advises against disabling the offline queue on workers.

That's why the queue isn't registered with `BullModule.registerQueue`:
`@nestjs/bullmq` would hand the registered queue's connection to the worker.
With no registered queue, the worker uses the `forRootAsync` connection
instead. Inject the queue with `@Inject(EMAIL_QUEUE)`, not
`@InjectQueue('email')`.

### 8.3 Job lifecycle

```
                  add() fails (Redis down) → FAILED (+503 to caller)
                 ╱
create row ── QUEUED ──(worker 'active')──► PROCESSING ──('completed')──► SENT
   ▲            │  ▲                             │
   │            │  └────('failed', attempts left)┘
   │            │                                │
   │   cancel   ▼                                ▼ ('failed', attempts exhausted)
   │       CANCELLED                           FAILED
   │                                             │
   └──────────────── manual retry ───────────────┘
```

- **Postgres is the source of truth**, not BullMQ. BullMQ prunes its own
  job records (`removeOnComplete`: 1000 jobs or 24h, `removeOnFail`: 5000
  jobs); the `EmailJob` row stays.
- **Retry policy**: 3 attempts with exponential backoff starting at 5s,
  shared by the initial enqueue and manual retries (`jobOptions()`).
- **Resend never throws**; it resolves `{ data, error }`. `process()` throws
  on `error` itself, so BullMQ's retries kick in.
- **Out-of-order events**: `active` and `completed` listener writes can land
  out of order, so `QUEUED → PROCESSING` is an `updateMany` guarded on the
  expected prior status. The same applies to `QUEUED → CANCELLED`.
- **Cancel** calls `queue.remove(jobId)`. It returns `0` if a worker has
  already locked the job, which is surfaced as `409 Conflict`.
- **Manual retry** (only from `FAILED`) resets the row, removes any leftover
  BullMQ job with the same id, and re-adds it.
- **Enqueue failure**: if `queue.add()` throws, the row is marked `FAILED`
  with `"Could not be queued for delivery"`, and the caller gets `503`. The
  job can be retried from the dashboard later.

### 8.4 Templates

Templates are TypeScript objects, not database rows, so they're versioned
with the code. Each declares `requiredVariables`, optional `urlVariables`
(which must be valid `http(s)` URLs, to block `javascript:` links), and
`sampleVariables` for the dashboard preview. Rendering validates that the
provided variables exactly match `requiredVariables`, HTML-escapes the
values, and stores the rendered subject and body on the `EmailJob`. Editing
a template later never changes a job that's already queued.

## 9. Cross-cutting concerns

| Concern | Implementation |
|---|---|
| Config | `ConfigModule.forRoot({ isGlobal, validate })`. `config/env.validation.ts` validates `process.env` with class-validator at startup, so the app refuses to boot on missing or malformed values. Use `configService.getOrThrow<T>()` for required keys |
| Errors | `GlobalExceptionFilter`: `{ statusCode, message, error, requestId, ... }`; non-HTTP errors are masked as 500 |
| Logging | `StructuredLogger` (JSON), with a request id from `AsyncLocalStorage` |
| Rate limiting | `@nestjs/throttler` with `ApiKeyThrottlerGuard` as `APP_GUARD` |
| Validation | Global `ValidationPipe`; request DTOs use class-validator decorators, path params have their own param DTOs (UUID, code format) |
| Serialization | Global `ClassSerializerInterceptor`. Controllers return response DTOs with `@Expose()`, never Prisma entities |
| CORS | Only `FRONTEND_URL` |
| Shutdown | `enableShutdownHooks()`; the Redis module closes its client on shutdown |
| Fire-and-forget writes | Prisma queries are lazy and only run once awaited or chained. Write `prisma.x.update(...).catch(log)`, never `void prisma.x.update(...)`, which silently never runs. Each such write has a regression test |

## 10. Frontend

`frontend/` is a standalone Next.js app (App Router) that is not part of a
pnpm workspace; it has its own `package.json` and lockfile. It talks to the
API only over HTTP.

| Path | Purpose |
|---|---|
| `app/page.tsx` | Landing / sign-in |
| `app/auth/callback/page.tsx` | Reads `#token=` (or `#error=`), stores the token, redirects to `/dashboard` |
| `app/dashboard/layout.tsx`, `dashboard-nav.tsx` | Shell and sidebar ("Services": URLs, Notifications; "API": Keys, Usage, Routes; Settings pinned at the bottom) |
| `app/dashboard/page.tsx` | API keys: create, revoke, delete |
| `app/dashboard/urls`, `notifications`, `notifications/templates` | Using the services directly |
| `app/dashboard/usage` | Usage chart and tables |
| `app/dashboard/services` | "Routes": endpoint reference with curl examples |
| `lib/api.ts` | The only place that calls `fetch`. Adds the Bearer token; on `401` clears the token and redirects to `/`. `describeError()` extracts the backend's `message` |
| `lib/queries.ts` | TanStack Query `queryOptions` (`meQuery`, `emailTemplatesQuery`, ...) |
| `lib/auth-token.ts`, `use-auth-guard.ts` | Token in `localStorage`; client-side redirect when it's missing |
| `lib/use-paginated-list.ts` | Shared pagination for list pages |
| `components/ui/` | shadcn components adapted to Neuron's tokens in `globals.css` |

UI conventions: mutation results are shown as `sonner` toasts; page-level
load failures are shown as an inline `QueryStateCard` with Retry;
destructive confirmations use `AlertDialog`. The API base URL comes from
`NEXT_PUBLIC_API_URL`.

## 11. Testing

| Suite | Command | Scope |
|---|---|---|
| Backend unit | `pnpm run test` | `src/**/*.spec.ts`, Jest + ts-jest (CommonJS). Services tested against mocked Prisma, queue, and Resend |
| Backend e2e | `pnpm run test:e2e` | `test/*.e2e-spec.ts`. Boots the full `AppModule` (worker included) through Supertest, overriding `PrismaService`, `EMAIL_QUEUE`, `JwtService`, and the Google strategy as needed |
| Frontend | `pnpm run test` in `frontend/` | Vitest + Testing Library + jsdom |

Things to know:

- **CI has no Postgres or Redis.** e2e specs must stub every dependency
  call. A test that passes locally against a real `.env` database will fail
  in CI.
- Env validation runs in every e2e spec, so CI supplies well-formed
  placeholder values.
- Jest runs CommonJS. Several dependencies are pinned to their last
  CommonJS-compatible major version (`@nestjs/config` 4.x, `@nestjs/jwt` /
  `@nestjs/passport` 11.x, `nanoid` 3.x, `bullmq` 5.x). A passing `tsc`
  doesn't prove a version bump is safe; only `pnpm run test` does.
- `src/common/api-versioning.spec.ts` enforces the versioning rule.
- A worker occasionally logs `Connection is closed` during `app.close()` in
  e2e runs. It's a known teardown race, not a real failure.

## 12. Build, CI, and deployment

- **Dockerfile** (the only build path): `deps` (frozen install) → `build`
  (`prisma generate`, `nest build`, `pnpm prune --prod`) → `runtime`
  (`node:22-alpine`, `node dist/main`). Corepack pins pnpm from
  `package.json`'s `packageManager`.
- **Local**: `docker compose up --build` runs the API on :3000, Redis, and
  the frontend dev server on :3001. The database is still remote Supabase.
  Seed a test user and API key with `pnpm exec prisma db seed`.
- **CI** (`.github/workflows/ci.yml`), on pushes and PRs to `main`, runs
  three parallel jobs: backend (install, generate, lint, build, unit, e2e),
  frontend (lint, build, test), and a Docker image build.
- **Production backend**: Coolify builds from git using
  `docker-compose.coolify.yml` (API + Redis with a persistent volume). Env
  vars come from Coolify's UI through `${VAR}` interpolation, since `.env`
  isn't in the checkout. Traefik terminates TLS. A Docker `healthcheck`
  polls `/health`.
- **Production frontend**: Vercel, with `NEXT_PUBLIC_API_URL` pointing at
  the API.
- **Migrations**: committed under `prisma/migrations/`. There's only one
  database, so `prisma migrate dev` run locally applies a migration to it
  directly. The Docker image doesn't run migrations on startup.

## 13. Configuration reference

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Supabase Postgres connection string |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Yes | OAuth client |
| `GOOGLE_CALLBACK_URL` | Yes (URL) | Must exactly match the redirect URI registered with Google |
| `JWT_SECRET` | Yes | Signs session JWTs |
| `JWT_EXPIRES_IN` | No (default `7d`) | Session lifetime |
| `FRONTEND_URL` | Yes (URL) | CORS origin and OAuth redirect target |
| `REDIS_HOST`, `REDIS_PORT` | Yes | `redis` inside docker compose; `localhost` when running on the host |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Yes | Email delivery |
| `PORT` | No (default `3000`) | HTTP port |
| `NEXT_PUBLIC_API_URL` | Frontend | API base URL |

See `.env.example` and `frontend/.env.local.example`.

## 14. Adding a new service

1. Create `src/<service>/` with a module, controller, service, and `dto/`.
2. Machine routes: `@UseGuards(ApiKeyGuard)` + `@Service('<name>')` +
   `@UseInterceptors(UsageLoggingInterceptor)`, under
   `/api/v1/<service-directory>/...`.
3. Dashboard routes: the same service methods behind `JwtAuthGuard`,
   unversioned, passing `{ userId, apiKeyId: undefined }`.
4. Declare guards and interceptors per route, not on the class, so machine
   and dashboard routes can share a controller.
5. Import `ApiKeyModule`, `AuthModule`, and `UsageModule` in the feature
   module, to document the dependency.
6. Give owned tables a required `userId` and an optional `apiKeyId`
   (`onDelete: SetNull`), and scope every query by owner.
7. Request DTOs with class-validator; response DTOs with `@Expose()`.
8. JSDoc on every service method (see CLAUDE.md's code conventions).
9. Register the module in `AppModule` **before** `ShortUrlModule`.
10. Add `@Throttle()` overrides if the default limit doesn't fit, and a row
    in `API.md`.

## 15. Known limitations

- No uptime monitoring or alerting in production yet (`/health/ready` is
  ready to be monitored).
- One environment: no separate dev, staging, or prod databases.
- No other live app has called the production API yet.
- No non-interactive way through Google OAuth. Testing JWT routes against a
  running stack means minting a token locally with `JWT_SECRET` and a real
  `User.id`.
- Sessions can't be revoked on the server; a JWT stays valid until it
  expires.
