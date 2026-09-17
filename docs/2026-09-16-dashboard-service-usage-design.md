# Dashboard-native service usage — design

**Superseded by `docs/2026-09-17-direct-ownership-design.md`** — the hidden system-key mechanism this document designs was later removed; see that doc for why and what replaced it.

## Goal

Today Neuron's services (URL shortener, Notifications) are only reachable by
machines holding an `x-api-key`. The dashboard is purely a key-management
console — a logged-in human can create/revoke keys and look at usage/results,
but can't actually *use* a service without leaving the dashboard and making a
real API call themselves.

This spec adds a way for a logged-in dashboard user to use a service directly
from the UI — e.g. shorten a URL by filling in a form, not by copying a curl
command. It's meant as full first-class usage, not a "try it" test console.

**Scope of this spec:** the auth-bridge mechanism itself, applied first to
the URL shortener (`POST` a URL to shorten, from `/dashboard/urls`).
Notifications dashboard UI is an explicit follow-on (see "Out of scope"),
sequenced second so the bridge mechanism is proven against the simpler
service first.

## Problem: bridging two auth models

Every service route today is `ApiKeyGuard`-protected and every service
method (`ShortUrlService.create`, `NotificationsService.queueEmail`, etc.)
is scoped purely by `apiKeyId` — confirmed by reading both services'
Prisma models (`ShortUrl.apiKeyId`, `EmailJob.apiKeyId`, `UsageLog.apiKeyId`
all key off `ApiKey`, never `User`, directly). The dashboard authenticates
humans with a completely different credential — a Nest-issued session JWT,
verified by `JwtAuthGuard` — which has no API key attached to the request at
all.

**Chosen approach: a hidden per-user "system" API key.** Lazily create one
internal `ApiKey` row per user representing "actions taken via the Neuron
dashboard itself." A new guard resolves-or-creates that row and attaches it
to the request exactly the way `ApiKeyGuard` attaches a real key — so every
existing service method, the `@CurrentApiKey()` decorator, and
`UsageLoggingInterceptor` all work completely unmodified. Dashboard-created
resources land in the same tables as machine-created ones, so they already
show up correctly in `GET /short-url` (userId-scoped across all of a user's
keys) and in `GET /usage` (as their own row, keyed by the system key's id —
same as any other key, no special-casing needed) with no changes to either.

The rejected alternative (nullable `apiKeyId` + new `userId` column on
`ShortUrl`/`EmailJob`/`UsageLog`) was more "correct" modeling but touches
three tables, every service method's scoping `where` clause, and the raw-SQL
usage aggregation query — for a distinction (human-via-dashboard vs.
machine-via-key) that nothing downstream currently needs to make. Rejected
per YAGNI.

## Design

### 1. Schema

Add one column to `ApiKey`:

```prisma
model ApiKey {
  // ...existing fields...
  isSystemKey Boolean @default(false)
}
```

Plus a **partial unique index** (hand-added to the generated migration SQL,
since Prisma's schema DSL has no filtered-`@@unique` construct): at most one
system key per user.

```sql
CREATE UNIQUE INDEX "ApiKey_userId_system_key_unique"
  ON "ApiKey"("userId") WHERE "isSystemKey" = true;
```

This guards against a genuine race: two concurrent dashboard requests (e.g.
two tabs, or a double-click) both finding no system key and both trying to
create one. Without the index, a user could end up with two system keys,
silently splitting their dashboard-originated usage/resources across both.

### 2. `ApiKeyService` additions

```
getOrCreateSystemKey(userId: string): Promise<ApiKey>
```

- `findFirst({ where: { userId, isSystemKey: true } })` — return if found.
- Otherwise generate key material the same way `create()` already does
  (`crypto.randomBytes(32)` → SHA-256 hash, `keyPrefix`), persist with
  `isSystemKey: true`, `name: 'Dashboard'`. The raw value is generated only
  to satisfy the existing `hashedKey`/`keyPrefix` columns — it is never
  returned to any caller and can never be used to authenticate via
  `ApiKeyGuard`'s normal hash-lookup path, since nothing ever surfaces it.
- On a unique-constraint violation from the partial index (`P2002`,
  mirroring `ShortUrlService.create`'s existing collision-retry pattern):
  re-run the `findFirst` and return what the other concurrent request
  created, instead of throwing.

Two existing methods gain a filter:

- `findAllForUser` — adds `isSystemKey: false` to its `where`, so the hidden
  key never appears in `GET /api-keys`.
- `revoke` — adds `isSystemKey: false` to its ownership lookup, so
  `DELETE /api-keys/:id` 404s for a system key's id exactly like it does for
  an id that doesn't exist or isn't owned by the caller — it can never be
  revoked through the API, even if someone learned its id.

### 3. `DashboardApiKeyGuard`

New guard, `src/api-keys/guards/dashboard-api-key.guard.ts`. Runs after
`JwtAuthGuard` (which attaches `request.user`) on any dashboard route that
needs to call a service method:

```
canActivate(context): calls apiKeyService.getOrCreateSystemKey(request.user.id),
  sets request.apiKey = that row, returns true.
```

This is the entire bridge. Because it attaches `request.apiKey` the same way
`ApiKeyGuard` does, everything downstream — `@CurrentApiKey()`,
`UsageLoggingInterceptor`, the service methods themselves — needs zero
changes.

### 4. New route

`POST /short-url` on the existing `ShortUrlController` — pairs with the
`GET /short-url` list route already there (same path, different verb, no
route-ordering conflict with `GET :code` since that catch-all only matches
`GET` requests).

```
@Post('short-url')
@UseGuards(JwtAuthGuard, DashboardApiKeyGuard)
@Service('url-shortener')
@UseInterceptors(UsageLoggingInterceptor)
createFromDashboard(@CurrentApiKey() apiKey: ApiKey, @Body() dto: CreateShortUrlDto): Promise<ShortUrlResponseDto> {
  return this.shortUrlService.create(apiKey.id, dto);
}
```

Reuses `CreateShortUrlDto`/`ShortUrlResponseDto`/`ShortUrlService.create`
unchanged. Since it's guarded by `DashboardApiKeyGuard`, not `ApiKeyGuard`
itself, `src/common/api-versioning.spec.ts`'s reflection-based check
correctly classifies it as a dashboard route (no version prefix required) —
no change needed to that test's logic, though the full suite gets re-run to
confirm.

### 5. Frontend

- `frontend/lib/api.ts`: `createShortUrl(originalUrl: string) => apiFetch<ShortUrl>('/short-url', { method: 'POST', body: JSON.stringify({ originalUrl }) })`.
- `frontend/app/dashboard/urls/page.tsx`: a "Shorten a URL" form at the top
  of the existing page — one URL input, one submit button — visually
  matching `ApiKeysSection`'s create-form pattern. On success, invalidates
  the `['short-urls']` query (all `limit` variants, via a prefix match) so
  the new link appears at the top of the list immediately, and clears the
  input. On error, a plain inline message (matching the existing "Failed to
  generate key." pattern in `ApiKeysSection`) — no need to parse/surface the
  backend's specific validation message.

## Error handling

- Invalid URL (no `http`/`https` scheme): existing `CreateShortUrlDto`
  validation already 400s — unchanged.
- No/expired JWT: `JwtAuthGuard` 401s before `DashboardApiKeyGuard` runs —
  unchanged existing behavior.
- Concurrent first-use race on system key creation: handled by the partial
  unique index + retry-refetch in `getOrCreateSystemKey`, see above.

## Testing

- `ApiKeyService`: `getOrCreateSystemKey` (creates once; returns existing on
  second call; refetches instead of throwing on a simulated `P2002` race);
  `findAllForUser` excludes system keys; `revoke` 404s for a system key id.
- `DashboardApiKeyGuard`: unit test — calls `getOrCreateSystemKey` with
  `request.user.id`, attaches the result as `request.apiKey`, returns true.
- `ShortUrlController`/e2e: `POST /short-url` with a valid JWT creates and
  returns a `ShortUrlResponseDto`, writes a `UsageLog` row scoped to the
  hidden system key, and appears in a subsequent `GET /short-url`; with no
  JWT, 401.
- Frontend: new test for the create form — successful submit invalidates the
  list query and shows the new row; a failed submit shows the inline error
  and leaves the input intact.
- Confirm `api-versioning.spec.ts` still passes unmodified (sanity check,
  not a code change).
- Real-stack verification via `docker compose up`, per this project's
  established practice: sign in as the seeded user, shorten a URL from the
  dashboard form, confirm it appears in the list, confirm `GET /api-keys`
  never shows the system key, confirm the system key's usage shows up under
  `GET /usage`.

## Pattern for future services

This establishes a reusable shape: any `@Service()`-tagged,
`ApiKeyGuard`-protected write route gets a dashboard-native counterpart by
swapping `@UseGuards(ApiKeyGuard)` → `@UseGuards(JwtAuthGuard,
DashboardApiKeyGuard)` and reusing the exact same DTOs/service method/
`@Service()`/`UsageLoggingInterceptor`. The Notifications follow-on (next
spec) applies this directly to `POST /notifications/email`, plus needs its
own new `GET` list route (mirroring the `GET /short-url` pattern already
built) since no such listing exists yet for email jobs.

## Out of scope (this spec)

- Notifications dashboard UI (send form, job list, status/retry/cancel from
  the dashboard) — explicit follow-on, its own spec.
- Any caching of the system-key lookup — every `DashboardApiKeyGuard`-guarded
  request does one indexed `findFirst` (already indexed via
  `ApiKey.@@index([userId])`); revisit only if this measurably matters.
- Editing/deleting a shortened URL from the dashboard — out of scope for
  both the API and the dashboard today.
