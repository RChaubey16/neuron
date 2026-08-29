# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Phase 0 (project setup) is complete: NestJS app, Prisma wired to a `PrismaModule`/`PrismaService`, `GET /health`, Docker/docker-compose, and CI. The Supabase project exists and `.env` holds real values (`.env.example` still holds placeholders for reference). Phase 1 (data model) is complete: `User`/`ApiKey`/`UsageLog` are defined in `prisma/schema.prisma`, the first migration (`prisma/migrations/20260828122259_init`) is applied to Supabase, and `prisma/seed.ts` seeds a test user + test API key (run via `pnpm exec prisma db seed`). Phase 2 (dashboard auth) is complete and confirmed end-to-end: `AuthModule` (`src/auth/`) provides `AuthService.verifyAndSyncUser` (verifies the Supabase-issued JWT against Supabase's JWKS via `jose`, lazy-creates the local `User` row), `SupabaseJwtGuard`, a `@CurrentUser()` decorator, and a guarded `GET /me`. Google OAuth is configured in the Supabase dashboard; `scripts/manual-google-login.html` (a throwaway static page — no dashboard frontend exists yet) was used to get a real token and confirm `GET /me` against the real Supabase Postgres DB via `docker compose up`, lazy-creating the `User` row correctly. That real token's header (`alg: ES256`, `kid`) also confirmed this project uses Supabase's asymmetric JWT signing keys, not the legacy HS256 shared secret — `SUPABASE_JWT_SECRET`-based verification would have rejected it.

When implementing, follow the phase order in `docs/development-plan.md` and update its checkboxes as steps are completed.

## Commands

```bash
pnpm install                 # install deps (pnpm is pinned via package.json "packageManager")
pnpm exec prisma generate    # regenerate the Prisma client after any schema.prisma change
pnpm run start:dev           # local dev server with watch mode
pnpm run lint                # eslint --fix
pnpm run build                # nest build -> dist/
pnpm run test                 # unit tests (jest, rootDir: src, *.spec.ts)
pnpm run test:e2e             # e2e tests (jest, test/*.e2e-spec.ts) — run the whole file with `-- <file>.e2e-spec.ts`
docker compose up --build     # containerized app + Redis
```

There is no `test:e2e -t` single-test filter wired up beyond Jest's own `-t <pattern>`; to run one e2e file use `pnpm run test:e2e -- <name>.e2e-spec.ts`.

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
- Controllers return response DTOs (`class-transformer`'s `@Expose()`), never Prisma entities directly — see `src/auth/dto/user-response.dto.ts`. `main.ts` registers a global `ClassSerializerInterceptor` and `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`; new request-body DTOs should use `class-validator` decorators to get validation for free.

## Prisma / Nest gotchas specific to this repo

- **Prisma client generator must stay `prisma-client-js`, not the newer `prisma-client`.** The new generator emits `.ts` files with no `index` entrypoint and relies on ESM-style relative imports (`./enums.js` etc.) that break under this project's CommonJS ts-jest setup. `prisma-client-js` outputs a classic CJS `index.js` and just works.
- **Prisma 7 requires an explicit driver adapter** — `PrismaClient` no longer auto-reads `DATABASE_URL`. `PrismaService` passes `new PrismaPg({ connectionString: process.env.DATABASE_URL })` explicitly; don't remove that when touching `src/prisma/prisma.service.ts`.
- **`@prisma/client-runtime-utils` must stay a direct dependency**, not just a transitive one pulled in by `@prisma/client`. `pnpm prune --prod` (used in the Dockerfile's build stage) drops it otherwise, likely because `@prisma/client` lists `prisma` as an optional peer dependency and that confuses pnpm's prune graph — this breaks the runtime image with `Cannot find module '@prisma/client-runtime-utils'` even though local `pnpm run build`/tests pass fine.
- **`@nestjs/config` must stay pinned to the 4.x line, not 12.x.** The 12.x release is ESM-only and fails Jest's CommonJS runner immediately on import.
- **Supabase JWTs on this project are signed with an asymmetric key (`alg: ES256`, rotating `kid`), not the legacy static `SUPABASE_JWT_SECRET`.** `AuthService` verifies tokens against Supabase's JWKS endpoint (`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`) via `jose`'s `createRemoteJWKSet`/`jwtVerify` instead of a shared-secret HS256 check — confirmed by decoding a real token obtained via `scripts/manual-google-login.html`. `SUPABASE_JWT_SECRET` is unused by the app; don't reintroduce HS256 verification against it.
- **`jose` must stay pinned to the 4.x line, not 6.x/latest.** 6.x ships ESM-only (`"type": "module"`, no CJS build) and breaks Jest's CommonJS runner the same way `@nestjs/config`/`@nestjs/jwt` 12.x do; 4.x still ships a `dist/node/cjs` build.
- **`prisma7.config.ts` (repo root) and the `prisma/` directory must both stay excluded from `tsconfig.build.json`.** If TypeScript includes either (e.g. `prisma/seed.ts`) in `nest build`, the inferred `rootDir` widens to the repo root and the compiled entrypoint becomes `dist/src/main.js` instead of `dist/main.js` — breaking not just `start:prod`/Docker's `CMD ["node", "dist/main"]`, but also `nest start --watch`: it compiles cleanly and logs "Watching for file changes" but then hangs forever with zero further output, because it tries to launch the app from the entry path it expects and that path doesn't exist. No error is printed — it just looks stuck. This exact regression happened when `prisma/seed.ts` was added in Phase 1 without adding `prisma` to the exclude list.
- **Corepack pins the package manager version from `package.json`'s `packageManager` field** — the Docker build copies `package.json` before running any `pnpm` command specifically so Corepack fetches the same pnpm version as local dev. Without that pin, Corepack grabs the latest pnpm, which (as of pnpm 11) enables a `minimumReleaseAge` supply-chain check by default that rejects any dependency published within roughly the last day — this silently breaks `pnpm install --frozen-lockfile` in CI/Docker whenever a transitive dependency had a same-day release.
- **The seed command is wired via `prisma7.config.ts`'s `migrations.seed`** (`"ts-node prisma/seed.ts"`), not the legacy `package.json` `"prisma": { "seed": ... }` field — Prisma 7's config-based setup doesn't read that field. Run it with `pnpm exec prisma db seed`.
- **`prisma init` scaffolds AI-agent "skill" reference docs** (`.claude/`, `.windsurf/`, `.agents/`, `skills-lock.json`) at the repo root as a side effect. These aren't project files — delete them if `prisma init` is ever re-run.

## Project overview

**Neuron** is a single NestJS + Supabase (Postgres via Prisma) platform exposing shared backend services (notifications, URL shortener, and future services) behind one unified API.

- **Humans** authenticate via Google OAuth (Supabase Auth) to a dashboard for managing API keys.
- **Machines** (other apps) call service endpoints using an API key via the `x-api-key` header.
- Every authenticated service call is recorded in a `UsageLog` for analytics/debugging.

## Architecture (planned)

- **Auth model is dual-track**: dashboard routes are protected by a `SupabaseJwtGuard` (verifies the Supabase-issued JWT for logged-in humans); service routes are protected by an `ApiKeyGuard` (hashes the incoming `x-api-key`, looks up a match, rejects if missing/revoked). Don't conflate the two — a dashboard session token and a service API key are different credentials with different guards.
- **API keys are hashed at rest** — only `crypto.randomBytes`-generated raw keys are returned once at creation; the stored record keeps only the hash plus a `keyPrefix` for display. Never persist or log the raw key.
- **Usage logging is cross-cutting, not per-service**: a `UsageLoggingInterceptor` (or logic inside `ApiKeyGuard`) writes a `UsageLog` row (`apiKeyId`, `service`, `endpoint`, timestamp) automatically for every authenticated request, async/non-blocking, so individual service modules don't implement logging themselves.
- **Each service is an isolated NestJS module** following the same `Module + Controller + Service + ApiKeyGuard` pattern (see Notifications and URL Shortener as the first two, Phase 9 lists future services). New services should replicate this shape rather than introducing a new pattern.
- **Supabase is the system of record for both auth and data**: Postgres via Prisma for `User`/`ApiKey`/`UsageLog`/service tables, and Supabase Auth (Google OAuth) for human login. A `User` row is synced from `auth.users` on first login (webhook or lazy-create-on-first-request), so app-level user records don't exist until a user's first authenticated call.
- **Async work runs through a queue** (BullMQ + Redis, or a Supabase-based queue) — e.g. notification sending — so request handlers return fast and failures are retried rather than surfaced synchronously.
- **The public-facing exception is the redirect route**: `GET /:code` for the URL shortener is intentionally unauthenticated (meant to be hit directly by browsers), unlike every other service route.
- Target deployment is a single multi-stage Docker image (deps → build → slim runtime) built starting in Phase 0 and reused unmodified through Phase 8 deployment — avoid introducing a second build path later.

## Build order dependencies

Phases 0–4 (setup → data model → dashboard auth → API keys → usage logging) are strictly sequential and form the shared infrastructure every service depends on. Phases 5 (Notifications) and 6 (URL Shortener) only depend on Phase 4 being done — they don't depend on each other and can be built in parallel or in either order. Phase 7 (hardening) and Phase 8 (deployment) come last.
