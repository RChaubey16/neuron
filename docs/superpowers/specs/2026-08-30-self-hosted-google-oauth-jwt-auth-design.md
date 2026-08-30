# Self-Hosted Google OAuth + JWT Dashboard Auth

## Context

Dashboard auth currently relies on Supabase Auth: the frontend drives a
client-side Google login against Supabase, Supabase issues a JWT signed
with a rotating asymmetric key, and `SupabaseJwtGuard` verifies it against
Supabase's JWKS endpoint (`AuthService.verifyAndSyncUser`).

Supabase is being scoped down to database-only. This spec replaces
Supabase-issued session tokens with a fully self-hosted flow: Nest drives
the Google OAuth authorization-code exchange itself and signs its own JWT
for dashboard sessions. Machine auth (`ApiKeyGuard`, the `x-api-key`
header) is entirely unaffected — this is dashboard-auth-only.

## Goal

A human hits `GET /auth/google`, completes Google login, and lands back on
a frontend URL carrying a JWT that Nest itself issued and can verify on
every subsequent dashboard request — with no dependency on Supabase Auth
or Supabase's JWKS.

## Flow

```
Browser → GET /auth/google
        → passport-google-oauth20 redirects to Google's consent screen
Google  → GET /auth/google/callback?code=...
        → passport exchanges the code for an access token + Google profile
Nest    → AuthService.findOrCreateUser({ sub, email }) — upsert local User
        → AuthService.signToken(user) — Nest signs its own JWT (HS256, JWT_SECRET)
        → 302 redirect to `${FRONTEND_URL}/auth/callback#token=<jwt>`
Frontend → sends that JWT as `Authorization: Bearer <jwt>` on every dashboard request
JwtAuthGuard → verifies with JWT_SECRET, loads User by payload.sub, attaches to request
```

## Components

### New

- **`src/auth/strategies/google.strategy.ts`** — `GoogleStrategy extends
  PassportStrategy(Strategy, 'google')`, configured from
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL`. Its
  `validate(accessToken, refreshToken, profile, done)` extracts
  `{ sub: profile.id, email: profile.emails[0].value }` and hands it back
  as the request's `user` (passport convention) — no DB call inside the
  strategy itself.
- **`AuthService.findOrCreateUser({ sub, email })`** — replaces
  `verifyAndSyncUser`. Same `prisma.user.upsert` shape as today
  (`where: { id: sub }`, `create: { id: sub, email }`), just keyed by
  Google's `sub` instead of Supabase's `auth.users` UUID.
- **`AuthService.signToken(user)`** —
  `this.jwtService.signAsync({ sub: user.id, email: user.email }, { expiresIn: JWT_EXPIRES_IN })`.
- **`src/auth/guards/jwt-auth.guard.ts`** (`JwtAuthGuard`) — hand-rolled
  `CanActivate` (same shape as the deleted `SupabaseJwtGuard`, not a
  passport strategy, to match this codebase's existing guard style):
  extracts the `Bearer` token, calls `jwtService.verifyAsync(token)`, then
  `prisma.user.findUniqueOrThrow({ where: { id: payload.sub } })`, and
  attaches the result to `request.user`. Throws `UnauthorizedException` on
  any failure (bad signature, expired token, or the user was deleted after
  the token was issued).
- **`AuthController` additions**:
  - `GET /auth/google` — `@UseGuards(AuthGuard('google'))`, empty handler
    body (passport intercepts and issues the redirect before the handler
    runs).
  - `GET /auth/google/callback` — `@UseGuards(AuthGuard('google'))`,
    handler receives `@Req() req` with `req.user` set by the strategy,
    calls `findOrCreateUser` → `signToken` → `res.redirect(...)`.

### Removed

- `SupabaseJwtGuard` and its spec.
- `AuthService.verifyAndSyncUser` and the `jose`/JWKS setup in
  `AuthService`'s constructor.
- The `jose` dependency (nothing else in the codebase uses it once this
  lands).

### Unchanged

- `@CurrentUser()` decorator, `UserResponseDto`.
- `ApiKeyGuard` and everything under machine auth.
- Every controller currently using `@UseGuards(SupabaseJwtGuard)`
  (`auth.controller.ts`, `api-keys.controller.ts`, `usage.controller.ts`)
  switches to `@UseGuards(JwtAuthGuard)` — no other change to those
  controllers.

## Config

**New env vars** (added to `src/config/env.validation.ts` and
`.env.example`):

- `GOOGLE_CLIENT_ID` (string)
- `GOOGLE_CLIENT_SECRET` (string)
- `GOOGLE_CALLBACK_URL` (`@IsUrl`) — must exactly match the redirect URI
  registered on the Google Cloud OAuth client; a mismatch is a common,
  confusing failure mode and is worth a one-line callout in
  `.env.example`.
- `JWT_SECRET` (string)
- `JWT_EXPIRES_IN` (optional, default `'7d'`)
- `FRONTEND_URL` (`@IsUrl`)

**Removed:**

- `SUPABASE_URL` requirement from `env.validation.ts` (Supabase is
  DB-only now — `DATABASE_URL` already covers that).
- `SUPABASE_JWT_SECRET` / `SUPABASE_ANON_KEY` entries from
  `.env.example` (already effectively unused; now fully dead).
- `.github/workflows/ci.yml`'s hardcoded `SUPABASE_URL` env var on the
  `lint-and-build` job, replaced with well-formed dummy values for the
  new required vars.

## Dependencies

**Added:** `@nestjs/jwt`, `@nestjs/passport`, `passport`,
`passport-google-oauth20` (+ `@types/passport-google-oauth20` as a dev
dependency).

**Removed:** `jose`.

`passport-google-oauth20` needs to be verified for clean CJS resolution
under this project's ts-jest setup during implementation — this repo has
repeatedly hit ESM-only-only-in-a-later-version footguns (`jose` 6.x,
`nanoid` 4.x, `@nestjs/config` 12.x), so this is a real risk to check, not
an assumption to skip.

## Error handling

- Google denies/cancels consent, or the strategy throws → passport's
  `AuthGuard('google')` on the callback route rejects before our handler
  runs; Nest's default exception filter returns it as a 401/500 JSON
  error. No dashboard exists yet to redirect to a pretty error page, so a
  raw JSON error response is acceptable for now.
- Expired/invalid/tampered JWT, or the user was deleted after token
  issuance → `JwtAuthGuard` throws `UnauthorizedException`, same contract
  the app already has today via `SupabaseJwtGuard`.

## Testing

- **Unit:** `auth.service.spec.ts` gets cases for `findOrCreateUser`
  (upsert) and `signToken`. New `jwt-auth.guard.spec.ts` mirrors the
  deleted `supabase-jwt.guard.spec.ts`'s cases (missing header, invalid
  token, expired token, valid token → user attached) but mocks
  `JwtService`/`PrismaService` instead of a JWKS fetch. New
  `google.strategy.spec.ts` covers the `validate()` profile mapping.
- **E2E:** `test/auth.e2e-spec.ts` swaps its Supabase-JWT-mocking setup
  for `@nestjs/jwt`-signed test tokens. `test/api-keys.e2e-spec.ts` and
  `test/usage.e2e-spec.ts` get the same guard-mocking swap, since they
  currently stub `SupabaseJwtGuard`/`AuthService`. `env.validation.spec.ts`
  updates its required/forbidden var list to match the new env var set.
- **Manual verification:** `scripts/manual-google-login.html` currently
  drives Supabase's client-side Google login and needs to be replaced (or
  simply superseded by hitting `GET /auth/google` directly in a browser)
  to exercise the new server-driven redirect flow end-to-end against real
  Google OAuth, run via `docker compose up` per this project's standing
  preference for testing through Docker rather than bare `pnpm run
  start:dev`.

## Migration impact

No DB migration needed. `User.id` stays `String @id` (no default), just
now sourced from Google's `sub` claim instead of Supabase's `auth.users`
UUID — only the schema's doc comment on `User` changes. The existing
seeded test user/API key are unaffected, since `ApiKey` has no dependency
on the identity provider.
