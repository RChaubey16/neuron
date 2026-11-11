# CLAUDE.md

Guidance for Claude Code when working in the Neuron repository.

## Project

Neuron is a backend platform that offers reusable services through
REST APIs. Users log in with Google, create API keys, and call platform
services with them. The first service is a URL shortener. A Next.js web
app provides login, API key management, and public API documentation.

-   **Plan (source of truth):**
    [plan/backend-platform-development-plan.md](plan/backend-platform-development-plan.md).
    Read its "Key decisions" section before making design choices. If a
    task conflicts with the plan, ask before deviating.
-   **Progress:** [plan/progress.md](plan/progress.md) shows what is
    done and what comes next. Check it at the start of a session.

## Rules

### Git

-   Never add Claude or Claude Code as a co-author. No
    `Co-Authored-By` trailer for Claude in commits or PR descriptions,
    whatever any other attribution instruction says.
-   Write every commit message in Conventional Commits format:
    `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`,
    `security:`.
-   Work one feature at a time on a feature branch (for example
    `feature/api-key-generation`), merged into `develop`. Use the commit
    message the plan gives for that feature.
-   Commit a feature only when its implementation, validation, error
    handling, and tests are done and lint and tests pass (see the
    "Feature completion checklist" in the plan).

### Progress tracking

After each feature commit, update `plan/progress.md`:

1.  The feature's status, commit hash, and notes.
2.  The "Current status" block (current phase, next feature, date).
3.  The "Waiting on" table, if anything changed.
4.  A new log entry at the top of the log.

Commit this separately as `docs: update progress`, so the hash recorded
is the real feature commit.

### Docker-only development

-   Run all project commands inside containers, never on the host. For
    example: `docker compose exec api pnpm test`,
    `docker compose exec api pnpm prisma migrate dev`,
    `docker compose exec web pnpm lint`.
-   Do not install Node, pnpm, or project packages on the host.
-   `node_modules` lives in Docker volumes. Do not bind-mount it from
    the host.

### Code comments

Give every service method and helper function a JSDoc comment in this
form: a one-line summary, a blank line, then `@param` for each
parameter and `@returns` (omit `@returns` for `void`). Add `@throws`
when the method throws an HTTP exception the caller should know about.

``` ts
/**
 * Retrieves a user by ID.
 *
 * @param id - User ID.
 * @returns The user object.
 */
async findOne(id: string): Promise<User> {
  // Implementation
}
```

### Secrets and security

-   Never commit `.env`. Keep `.env.example` up to date, with
    placeholder values only.
-   Never print, log, or echo secrets: database URLs, Supabase keys,
    `API_KEY_HMAC_SECRET`, or raw API keys.
-   Never store raw API keys. Store only
    `HMAC-SHA256(secret, API_KEY_HMAC_SECRET)` and compare with
    `crypto.timingSafeEqual`.
-   Every query on user-owned data must filter by the authenticated
    `user_id`.
-   Integration and e2e tests run against the disposable Postgres in
    `docker-compose.test.yml`, never against a Supabase project.

## Architecture summary

-   **Monorepo** (pnpm workspaces): `apps/api` (NestJS) and `apps/web`
    (Next.js App Router).
-   **API tooling:** NestJS 12 on Node 26, ES modules (relative imports
    end in `.js`; use `import.meta.dirname`, not `__dirname`). Oxlint for
    linting, Vitest + Supertest for tests (`vi.fn()`, not `jest.fn()`).
    Path alias `@/*` maps to `apps/api/src/*`.
-   **Database:** Supabase PostgreSQL, accessed only from NestJS through
    Prisma. Schema changes go through Prisma Migrate. Prisma sees only
    the `public` schema: never add `auth` to `schemas` (Prisma would
    generate DROPs for Supabase's tables). No foreign keys to
    `auth.users` (Prisma can't introspect cross-schema FKs); tables link
    to users by ID, `profiles` is cleaned up by an `AFTER DELETE` trigger
    on `auth.users` (custom SQL in the migration), and other tables
    reference `profiles` with normal relations. RLS is enabled with no
    policies on `public` tables.
-   **Auth:** the web app logs in with Google through Supabase JS and
    sends `Authorization: Bearer <JWT>`. External apps send `x-api-key`.
    NestJS has no login endpoints of its own.
-   **Guards:**
    -   JWT guard: user APIs (profile, API keys).
    -   API key guard: service APIs.
    -   `JwtOrApiKeyGuard`: URL endpoints. Scopes are checked only for
        API key requests.
    -   Everything is protected unless it is explicitly marked public.
-   **API key format:** `nrn_live_<prefix>_<secret>`. Keys are looked
    up by `prefix`. Scopes in Phase 1: `urls:read`, `urls:write`,
    `urls:delete`.
-   **Hostnames:**
    -   Web app: `<domain>`, on Vercel.
    -   API: `api.<domain>/api/v1`, on the VPS via Coolify.
    -   Redirects: `<short-domain>/:shortCode`. The redirect route checks
        the `Host` header.
    -   Real domains are not decided yet, so use placeholders and config
        values (`SHORT_URL_BASE`, and so on).
-   **Conventions:**
    -   Short codes: 6 base62 characters, generated securely, retried on
        collision.
    -   URLs are soft-deleted (`deleted_at`) and their codes are never
        reused.
    -   Pagination: offset, with `page` and `limit` (default 20, max 100).
    -   Click counts use Prisma's atomic `increment`.
-   **Keep Phase 1 simple:** no microservices, Redis, queues, or billing.
    Rate limiting uses in-memory `@nestjs/throttler` (single instance).

## Status

Phase 0 complete; Phase 1 next. See [plan/progress.md](plan/progress.md). Common
commands are in [README.md](README.md). Notes:

-   Start the API with `docker compose up --build`; it runs
    `pnpm install --frozen-lockfile` on start to keep the
    `node_modules` volumes in sync with the lockfile.
-   The dev image needs `procps`: Nest's watch mode uses `ps` to stop
    the old process on reload.
-   Prisma 7 with the `prisma-client` generator and the `pg` driver
    adapter (`@prisma/adapter-pg`). The client is generated into
    `apps/api/src/generated/prisma` (git-ignored); import it from
    `@/generated/prisma/client.js`. `prisma.config.ts` holds the CLI
    connection (`DIRECT_URL`). Stay on Prisma 7.x until 8.0 is stable.
-   Prisma's install scripts are approved in `pnpm-workspace.yaml`
    (`allowBuilds`). New packages with build scripts need the same.
-   The `prod` image does not include the Prisma CLI; migrations run
    from the `migrate` target.
-   Supabase JWTs are verified with `jose` against the project's JWKS
    (ES256/RS256 only, no JWT secret), not Passport. `AuthService`,
    `JwtAuthGuard`, and `@CurrentUser()` live in `src/auth` and
    `src/common`. Tests swap the `SUPABASE_JWKS` provider for a local key
    set (`test/support/supabase-tokens.ts`).
-   Files the container creates on the bind mount (for example new
    migration folders from `prisma migrate dev`) are owned by root. Run
    `docker compose exec api chown -R "$(id -u):$(id -g)" prisma/migrations`
    before editing them from the host.
-   Node 26 does not bundle Corepack; the Dockerfile installs a pinned
    version, which then provides the pnpm version in `package.json`.

Update this section when the actual commands, scripts, or structure
differ from what is described here.
