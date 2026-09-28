# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Phases 0–6 and 8 of `docs/development-plan.md` are complete; Phase 7 is complete except environment separation (dev/staging/prod). Per-phase history lives in git and in `docs/` (`OVERVIEW.md`, `API.md`, the dated design docs) — this file only records what's true now.

- **Backend** (`src/`): NestJS API with modules for auth (`auth/`), API keys (`api-keys/`), usage logging (`usage/`), email notifications (`notifications/`), and the URL shortener (`short-url/`), plus cross-cutting pieces in `common/` and `config/`.
- **Frontend** (`frontend/`): standalone Next.js 16 + React 19 dashboard (own `package.json`/lockfile, not a pnpm workspace member), using `@tanstack/react-query` for data fetching and Vitest + Testing Library for tests. `lib/api.ts` centralizes every fetch and clears the stored JWT + redirects to `/` on any `401`. User feedback for actions (mutation success/failure) goes through toasts — `toast` from `sonner`, rendered by the shadcn-based `components/ui/sonner.tsx` mounted once in `app/layout.tsx`, with `describeError()` from `lib/api.ts` as the description (it surfaces the backend's `message`). Page-level load failures stay as inline `QueryStateCard`s with a Retry button. shadcn is configured via `components.json`, but the generated components must be adapted to Neuron's own tokens in `globals.css` (shadcn's `--popover`/`--radius`/etc. aren't defined) and to its light-only theme (done so far: `sonner`, `button`, `alert-dialog`). Note shadcn's "accent" is a neutral hover color while Neuron's `accent` is the brand indigo — don't map one onto the other. Generated components import `cn` from the `cn` npm package (shadcn's own clsx + tailwind-merge replacement), not a local `lib/utils`; that's intended. Destructive confirmations use `AlertDialog`, not `window.confirm` (the key table's Delete does; Revoke and email Cancel still use `window.confirm`). Sidebar groups: "Services" (URLs, Notifications incl. Templates) and "API" (Keys, Usage, Routes), with Settings pinned at the bottom.
- **Deployed**: backend on a Hostinger VPS via Coolify (`docker-compose.coolify.yml`) at `neuron-api.ruturaj.xyz`; frontend on Vercel at `neuron.ruturaj.xyz`.

Known open gaps:
- No uptime monitoring/alerting in production, and no separate live app has called the deployed API yet (Phase 8's exit criterion).
- No non-interactive way through the Google OAuth flow: verifying `JwtAuthGuard` routes against a running stack means minting a JWT locally with `jsonwebtoken`, the app's `JWT_SECRET`, and a real `User.id` from Postgres.
- Browser click-through verification of dashboard forms hasn't been done; Vitest specs cover them instead.

When implementing, follow the phase order in `docs/development-plan.md` and update its checkboxes as steps are completed.

## Commands

```bash
pnpm install                 # install deps (pnpm is pinned via package.json "packageManager")
pnpm exec prisma generate    # regenerate the Prisma client after any schema.prisma change
pnpm exec prisma db seed     # seed a test user + test API key
pnpm run start:dev           # local dev server with watch mode
pnpm run lint                # eslint --fix
pnpm run build               # nest build -> dist/
pnpm run test                # unit tests (jest, rootDir: src, *.spec.ts)
pnpm run test:e2e            # e2e tests (jest, test/*.e2e-spec.ts) — run one file with `-- <file>.e2e-spec.ts`
docker compose up --build    # containerized app + Redis + frontend (next dev on :3001)
```

Frontend commands (`lint`, `build`, `test`) run from `frontend/`. CI (`.github/workflows/ci.yml`) runs backend and frontend as parallel jobs.

## Code conventions

Every method in a `*.service.ts` file must have a JSDoc block directly above it describing what it does, any exceptions it throws, and (when non-trivial) the reasoning behind non-obvious steps. Follow this shape:

```typescript
/**
 * Creates a new user record.
 * Throws a ConflictException if a user with the same email already exists.
 *
 * @param createUserDto - Validated payload from the incoming request
 * @returns The newly created user entity
 */
async create(createUserDto: CreateUserDto): Promise<User> {
  const existing = await this.userRepository.findOne({
    where: { email: createUserDto.email },
  });

  if (existing) {
    throw new ConflictException('A user with this email already exists');
  }

  // Repository.create() only builds the entity instance in memory,
  // it does not persist it — save() is what hits the DB
  const user = this.userRepository.create(createUserDto);
  return this.userRepository.save(user);
}
```

- The JSDoc block goes above the method signature: a one-to-two sentence summary, a line for each exception the method can throw, then `@param`/`@returns` tags for anything not self-evident from the type signature.
- Inline `//` comments inside the method body are still reserved for non-obvious behavior (e.g. a framework quirk like `create()` vs `save()` above) — don't restate what the code already says.
- This applies to every method on a service class, including trivial ones — keep the JSDoc proportional (a one-line summary is fine for a one-line method).
- Controllers return response DTOs (`class-transformer`'s `@Expose()`), never Prisma entities directly — see `src/auth/dto/user-response.dto.ts`. `main.ts` registers a global `ClassSerializerInterceptor` and `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`; new request-body DTOs should use `class-validator` decorators to get validation for free.
- Every fire-and-forget Prisma write gets a regression test that mocks a lazy thenable (see the PrismaPromise gotcha below).

## Project overview

**Neuron** is a single NestJS + Supabase (Postgres via Prisma) platform exposing shared backend services (email notifications, URL shortener, and future services) behind one unified API.

- **Humans** authenticate via self-hosted Google OAuth (Nest-issued session JWTs) to a dashboard for managing API keys and using services directly.
- **Machines** (other apps) call service endpoints using an API key via the `x-api-key` header.
- Every service call — machine or dashboard — is recorded in a `UsageLog` for analytics/debugging.

## Architecture

- **Auth model is dual-track**: dashboard routes use `JwtAuthGuard` (verifies the Nest-issued session JWT, `@nestjs/jwt` + `JWT_SECRET`, user via `@CurrentUser()`); service routes use `ApiKeyGuard` (SHA-256-hashes the incoming `x-api-key`, looks up `ApiKey.hashedKey`, rejects if missing/revoked, key via `@CurrentApiKey()`). Don't conflate the two credentials. Google OAuth: `GET /auth/google` → Google → `GET /auth/google/callback` → redirect to `${FRONTEND_URL}/auth/callback#token=<jwt>`. A `User` row is lazily created on first login (`AuthService.findOrCreateUser`).
- **Supabase is database-only** (`DATABASE_URL`) — it doesn't handle auth.
- **Ownership lives on the row**: `ShortUrl`, `EmailJob`, and `UsageLog` each carry a required `userId`; `apiKeyId` is optional and set only when a real machine key made the call (FK is `ON DELETE SET NULL`, so deleting a key keeps history). Dashboard-native routes call the same service methods with `{ userId, apiKeyId: undefined }`. See `docs/2026-09-17-direct-ownership-design.md`.
- **Every service is usable from both sides**: each machine route (`ApiKeyGuard`) has a dashboard-native counterpart (`JwtAuthGuard`) reusing the same DTOs and service method. Dashboard list/retry/cancel actions scope by `{ userId }` so they span jobs created by any of the user's keys.
- **API versioning tracks the auth split, not the module split**: every `ApiKeyGuard` route is versioned under `/api/{version}/{service-directory}/{route}` (e.g. `POST /api/v1/short-url/shorten`); dashboard routes, the OAuth handshake, `GET /health`, and the public `GET /:code` redirect stay unversioned. Service routes are the external contract; dashboard routes ship in lockstep with the first-party frontend. `src/common/api-versioning.spec.ts` enforces this via route/guard metadata reflection.
- **API keys are hashed at rest** — the raw `crypto.randomBytes(32)` key is returned once at creation; only the hash plus a display `keyPrefix` is stored. Never persist or log the raw key. Keys can be revoked (`POST /api-keys/:id/revoke`, stays listed) or deleted (`DELETE /api-keys/:id`, soft delete via `deletedAt`, hidden from the list). Deleting also sets `revokedAt`, since `ApiKeyGuard` only checks `revokedAt` — keep that invariant if touching either path.
- **Usage logging is cross-cutting**: routes opt in with `@Service(name)` + `UsageLoggingInterceptor`, which writes a `UsageLog` (`userId` from `request.user?.id ?? request.apiKey?.userId`, `apiKeyId`, `service`, `endpoint`) non-blockingly after the handler settles. `GET /usage` aggregates it with raw SQL (`DATE_TRUNC`), since Prisma's `groupBy` can't truncate dates.
- **Rate limiting** is global via `ApiKeyThrottlerGuard` (`APP_GUARD`, 20 req/min default), which keys on the hashed `x-api-key` header when present and falls back to IP otherwise; per-route `@Throttle()` overrides exist on the shortener routes, and `HealthController` is `@SkipThrottle()`.
- **Email notifications run through a queue** (BullMQ + Redis): routes return `202` immediately; `EmailProcessor` sends via Resend with 3 attempts + exponential backoff. The Resend SDK never throws — it resolves `{ data, error }` — so the processor throws on `error` to trigger retries. Status is tracked on `EmailJob` (`QUEUED`/`PROCESSING`/`SENT`/`FAILED`/`CANCELLED`); status transitions from worker events are guarded (`updateMany` with an expected prior status) because `active`/`completed` listener writes can land out of order. Templates are code-defined in `src/notifications/templates/templates.ts` (required/URL variables validated at send time, sample values for dashboard preview).
- **URL shortener**: 7-char `nanoid` codes with retry on `P2002` collision; `GET /:code` is intentionally unauthenticated and fire-and-forget increments `clickCount`.
- **Cross-cutting infra** (`src/common/`): `GlobalExceptionFilter` (via `APP_FILTER`) returns one JSON error shape and masks non-`HttpException` errors as generic 500s; `StructuredLogger` (Nest `ConsoleLogger` in JSON mode, set in `main.ts`) makes all logs JSON; `RequestIdMiddleware` + `AsyncLocalStorage` (`request-context.ts`) assign/propagate `x-request-id`.
- **Each service is an isolated NestJS module** (`Module + Controller + Service`, guards per route). New services should replicate this shape; declare guards/interceptors per route, not at class level, so machine and dashboard routes can share a controller.
- **One build path**: a single multi-stage `Dockerfile` (deps → build → slim runtime) is used by local `docker compose` and by Coolify in production — don't introduce a second.

## Prisma / Nest gotchas specific to this repo

- **Prisma client generator must stay `prisma-client-js`, not the newer `prisma-client`.** The new generator emits `.ts` files with no `index` entrypoint and relies on ESM-style relative imports that break under this project's CommonJS ts-jest setup. The client is generated to `generated/prisma` and imported from there.
- **Prisma 7 requires an explicit driver adapter** — `PrismaClient` no longer auto-reads `DATABASE_URL`. `PrismaService` passes `new PrismaPg({ connectionString: process.env.DATABASE_URL })` explicitly; don't remove that.
- **`@prisma/client-runtime-utils` must stay a direct dependency.** `pnpm prune --prod` (Dockerfile build stage) drops it otherwise, breaking the runtime image with `Cannot find module '@prisma/client-runtime-utils'` even though local build/tests pass.
- **ESM-only major versions break Jest's CommonJS runner on import. Keep these pinned:** `@nestjs/config` 4.x, `@nestjs/jwt` and `@nestjs/passport` 11.x, `nanoid` 3.x. A `tsc`/`nest build` pass isn't enough to prove a version works — only `pnpm run test` surfaces the ESM failure.
- **`@nestjs/bullmq` must stay on 11.x and `bullmq` on 5.x, not 6.x.** bullmq 6.x moves `ioredis` to a peer dependency, breaking the queue at runtime with a missing-module error.
- **A git worktree nested inside this repo (e.g. under `.claude/worktrees/...`) can silently resolve a removed dependency from the outer repo's `node_modules`**, masking a real "module not found" error. Use `docker build --target build` to confirm a dependency is actually gone.
- **`JwtModule` must be re-exported from `AuthModule`, not just imported.** A guard referenced by `@UseGuards()` resolves across the whole DI graph, but its *own* constructor dependencies (`JwtService`) resolve from the module scope it's registered in.
- **A guard/interceptor referenced by class resolves across the entire app's DI graph**, not just the controller's module. Feature modules still import the module providing a guard they use (e.g. `ShortUrlModule` imports `ApiKeyModule`, `NotificationsModule` imports `AuthModule`) so the dependency is documented.
- **Use `configService.getOrThrow<T>(key)` for required config.** `get<T>()` returns `T | undefined`, which produces confusing overload errors when passed to third-party types (e.g. passport-google-oauth20's `StrategyOptions`). Safe because startup validation guarantees presence.
- **`AuthService.findOrCreateUser`'s upsert must key on `email`, not `id`.** `email` carries the unique constraint; upserting on `id` crashes with `P2002` for a pre-existing user whose `id` came from an earlier auth provider.
- **A param typed with a runtime-less interface (e.g. Express's `Response`) alongside a param decorator needs `import type`** under `isolatedModules` + `emitDecoratorMetadata`, or `nest build` fails with `TS1272`.
- **`prisma7.config.ts` and the `prisma/` directory must stay excluded from `tsconfig.build.json`.** Otherwise `rootDir` widens, the entrypoint becomes `dist/src/main.js`, and `nest start --watch` hangs silently after "Watching for file changes".
- **Corepack pins pnpm from `package.json`'s `packageManager`** — the Dockerfile copies `package.json` before any `pnpm` command for this reason. Without the pin, newer pnpm's `minimumReleaseAge` check can break `pnpm install --frozen-lockfile`.
- **The seed command is wired via `prisma7.config.ts`'s `migrations.seed`**, not `package.json`'s legacy `"prisma": { "seed": ... }` field.
- **Prisma query builder calls return a lazy PrismaPromise that only executes once subscribed.** `void prisma.x.update(...)` for a fire-and-forget write silently never runs. Use `.catch(() => {})` instead (used by `ApiKeyGuard`'s `lastUsedAt`, `UsageLoggingInterceptor`, `ShortUrlService.resolve`).
- **`ShortUrlModule` must stay the last import in `AppModule`, and `GET /:code` the last route registered.** Express matches in registration order, so the catch-all would shadow later top-level routes. `test/short-url.e2e-spec.ts` guards this.
- **`process.env` is validated at startup** (`src/config/env.validation.ts`, wired via `ConfigModule.forRoot({ validate })`). Required: `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` (URL), `JWT_SECRET`, `FRONTEND_URL` (URL), `REDIS_HOST`, `REDIS_PORT`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`; optional: `JWT_EXPIRES_IN`, `PORT`. Every e2e spec compiling `AppModule` runs this against the real environment, so CI supplies well-formed dummy values and a local `.env` needs the full set. The file imports `reflect-metadata` itself since it runs `validateSync` outside a Nest bootstrap.
- **`@typescript-eslint/no-unused-vars` uses `ignoreRestSiblings: true`** for the destructure-to-omit test pattern (`const { DATABASE_URL: _omit, ...rest } = validEnv;`).
- **Queue producers and the readiness check use a separate fail-fast Redis connection** (`PRODUCER_REDIS` from `src/redis/redis.module.ts`, `enableOfflineQueue: false`), so a Redis outage makes `Queue.add()` reject immediately instead of hanging. The email queue is therefore built by `emailQueueProvider` (token `EMAIL_QUEUE`), not `BullModule.registerQueue`: `@nestjs/bullmq` hands a registered queue's connection options to its `@Processor` worker, and BullMQ advises against disabling the offline queue on workers. With no registered queue, `EmailProcessor` falls back to `BullModule.forRootAsync`'s connection. Inject `EMAIL_QUEUE` (not `@InjectQueue('email')`) and override that token in tests. When `queue.add()` throws, `NotificationsService` marks the row `FAILED` (retryable from the dashboard) and returns `503`.
- **`GET /health` is liveness only; `GET /health/ready` pings Postgres and Redis** (2s timeout each) and returns `503` with a per-check breakdown if either is down. Point uptime monitors at `/health/ready`.
- **e2e tests boot the full `AppModule`, BullMQ worker included**, but CI runs them with **no Redis or Postgres** (no `services:` in `ci.yml`): specs must stub every dependency call, e.g. `jest.spyOn(app.get(PRODUCER_REDIS), 'ping')`, since a test that passes locally against a real `.env` database/Redis will fail in CI. Locally, Redis is optional (`docker run -d --rm -p 6379:6379 redis:7-alpine` with `REDIS_HOST=localhost`, since `.env`'s `REDIS_HOST=redis` only resolves inside docker compose). Even with Redis up, the worker occasionally emits `Connection is closed` during `app.close()` and fails a random test — a pre-existing teardown race, not a real failure.
- **`GET /auth/google/callback` uses `OAuthCallbackRedirectFilter`**, so any sign-in failure (consent cancelled, unverified email, DB error) redirects to `${FRONTEND_URL}/auth/callback#error=...` instead of rendering JSON in the browser.
- **The Resend SDK never rejects its promise** — failures resolve as `{ data: null, error }`. A `try/catch` around `resend.emails.send()` catches nothing; check `error` explicitly.
- **The frontend's dev container needs its own `node_modules` volume** (`frontend-node-modules` in `docker-compose.yml`). Bind-mounting the host's install into Alpine makes `pnpm install` prompt to purge it, which hangs forever without a TTY.
- **Coolify doesn't auto-generate a domain for a Docker Compose deployment** — use "Generate Domain" or add one manually on the service.
- **A newly saved Coolify domain needs a redeploy of the `app` service before Traefik routes to it** (until then Traefik returns its plain-text `404 page not found` and Let's Encrypt can't issue a cert).
- **`docker-compose.coolify.yml` uses `environment:` `${VAR}` interpolation, not `env_file: .env`** — `.env` is gitignored and absent in Coolify's checkout; values come from Coolify's Environment Variables UI.
- **`.agents/skills/`, `.claude/skills/` (symlinks into `.agents/`), and `skills-lock.json` are intentionally tracked** — they install the `frontend-design` and `nestjs-best-practices` agent skills used when working in this repo. Don't delete them as clutter.
