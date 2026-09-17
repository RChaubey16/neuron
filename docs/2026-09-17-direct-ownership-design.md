# Direct ownership — design

**Supersedes:** the "hidden per-user system API key" approach from
`docs/2026-09-16-dashboard-service-usage-design.md`.

## Goal

Remove the fabricated system `ApiKey` that dashboard-native service calls
currently authenticate through, and replace it with direct `userId`
ownership on the tables that need it. The dashboard/API dual-access vision
is unchanged — every service stays usable both from the dashboard and via
`x-api-key` — only the internal plumbing connecting the two changes.

## Why revisit this

The 2026-09-16 spec chose the system-key bridge specifically to avoid
touching `ShortUrl`, `EmailJob`, `UsageLog`, and the usage aggregation
query, on the reasoning that "human-via-dashboard vs. machine-via-key" was
a distinction nothing downstream needed to make, for a single-user project.

Two things have changed since:

1. **The distinction already turned out to matter.** `GET /api-keys` and
   `revoke` both needed `isSystemKey: false` filters to hide the fabricated
   key from a user who never created it — that's downstream code already
   caring about the distinction, just awkwardly, by filtering a lie back
   out after telling it.
2. **This is no longer scoped as a single-user project.** A real second
   user makes "we minted you a hidden credential you can never see and
   don't know exists" a worse trade than it looked like at one-user scale,
   and the retry-on-race logic around the partial unique index is exactly
   the kind of accidental complexity that compounds per user, not per
   feature.

The rejected alternative from that spec — nullable `apiKeyId` + a new
`userId` column — is what this spec implements.

## Design

### 1. Schema

```prisma
model ShortUrl {
  // ...existing fields...
  apiKeyId String?
  userId   String
  apiKey   ApiKey? @relation(fields: [apiKeyId], references: [id])
  user     User    @relation(fields: [userId], references: [id])

  @@index([userId])
}

model EmailJob {
  // ...existing fields, same shape...
  apiKeyId String?
  userId   String
  @@index([userId])
}

model UsageLog {
  // ...existing fields, same shape...
  apiKeyId String?
  userId   String
  @@index([userId])
}
```

`ApiKey.isSystemKey` and its partial unique index
(`ApiKey_userId_system_key_unique`) are dropped entirely.

### 2. Migration & backfill

This runs against a real Supabase DB that already has live system-key rows
and resources owned by them (from the 2026-09-16/dashboard-notifications
work), so order matters — a naive "add column, drop column" migration
would either leave orphaned FKs or cascade-delete real usage history:

1. Add `userId` as nullable to `ShortUrl`, `EmailJob`, `UsageLog` (+ index).
2. Backfill: `UPDATE ... SET "userId" = ApiKey."userId"` via the existing
   `apiKeyId` join, for every row on all three tables.
3. Make `userId` `NOT NULL` on all three now that every row has one.
4. For rows whose `apiKeyId` pointed at a system key (`ApiKey.isSystemKey =
   true`), set `apiKeyId` to `NULL` — these rows are now honestly
   "dashboard-originated, no key," which is what they actually were.
5. Delete every `ApiKey` row where `isSystemKey = true` — safe now, since
   step 4 removed every reference to them.
6. Drop `ApiKey.isSystemKey` + its partial unique index. Drop the old
   `NOT NULL` constraint on `apiKeyId` for the three tables.

### 3. Guards & decorators

`src/api-keys/guards/dashboard-api-key.guard.ts` (`DashboardApiKeyGuard`)
is deleted, along with `ApiKeyService.getOrCreateSystemKey`. Dashboard-native
routes drop it from `@UseGuards()` entirely — `JwtAuthGuard` alone is
sufficient, since all they need is `request.user`, which it already
provides.

`ApiKeyService.findAllForUser` and `.revoke` lose their `isSystemKey: false`
filters — nothing to filter out anymore.

### 4. Service method signatures

Every service method that currently takes a bare `apiKeyId` takes an
ownership object instead:

```typescript
// before
create(apiKeyId: string, dto: CreateShortUrlDto): Promise<ShortUrl>

// after
create(owner: { userId: string; apiKeyId?: string }, dto: CreateShortUrlDto): Promise<ShortUrl>
```

Applies to `ShortUrlService.create` and `NotificationsService.queueEmail`.
A machine call (`ApiKeyGuard`) passes `{ userId: apiKey.userId, apiKeyId:
apiKey.id }`; a dashboard-native call (`JwtAuthGuard` only) passes `{
userId: user.id }`. `findAllForUser`/`listByWhere` on both services already
scope by `userId` (via a join through `apiKey.userId` today) — they switch
to a direct `where: { userId }`, dropping the join.

`retryForUser`/`cancelForUser` and their `{ apiKey: { userId } }` ownership
scope become `{ userId }` directly — same simplification.

### 5. `UsageLoggingInterceptor`

Currently assumes `request.apiKey` exists. It becomes:

```typescript
const userId = request.user?.id ?? request.apiKey?.userId;
const apiKeyId = request.apiKey?.id ?? null;
```

This is what lets it keep running, unchanged in how it's wired
(`@UseInterceptors(UsageLoggingInterceptor)`), on dashboard-native creates
that no longer have a guard fabricating `request.apiKey`.

### 6. `UsageService.getSummaryForUser`

The raw `$queryRaw` currently scopes to the caller via a subquery on
`ApiKey.userId`. With `userId` directly on `UsageLog`, that subquery is
deleted in favor of a plain `WHERE "userId" = $1` — simpler than what's
there today, not just equivalent.

### 7. Controllers

`ShortUrlController`'s `POST /short-url` and `NotificationsController`'s
`POST /notifications/email` (dashboard-native routes) change:

```typescript
// before
@UseGuards(JwtAuthGuard, DashboardApiKeyGuard)
createFromDashboard(@CurrentApiKey() apiKey: ApiKey, @Body() dto: CreateShortUrlDto) {
  return this.shortUrlService.create(apiKey.id, dto);
}

// after
@UseGuards(JwtAuthGuard)
createFromDashboard(@CurrentUser() user: User, @Body() dto: CreateShortUrlDto) {
  return this.shortUrlService.create({ userId: user.id }, dto);
}
```

`@Service()` and `@UseInterceptors(UsageLoggingInterceptor)` stay exactly
as they are on both routes.

### 8. Removed

- `DashboardApiKeyGuard`
- `ApiKeyService.getOrCreateSystemKey`
- `ApiKey.isSystemKey` + its partial unique index
- `isSystemKey` filters in `ApiKeyService.findAllForUser` / `.revoke`

## Error handling

No new error paths. The concurrent-first-use race the old design's partial
unique index guarded against doesn't exist anymore — there's no
lazily-created row to race over. `JwtAuthGuard` alone still 401s a
dashboard-native route with no/expired JWT, unchanged.

## Testing

- Migration: run against a copy of real data (or the dev Supabase DB) and
  confirm every existing `ShortUrl`/`EmailJob`/`UsageLog` row has a correct
  `userId` post-backfill, and that no system-key `ApiKey` rows survive.
- `ShortUrlService`/`NotificationsService` unit tests: update calls from
  `create(apiKeyId, dto)` to `create({ userId, apiKeyId }, dto)`; add a
  case for the dashboard shape (`apiKeyId` omitted).
- `UsageLoggingInterceptor` unit test: add a case where `request.apiKey` is
  absent and `request.user` carries the id instead — the historical
  fire-and-forget-write regression test pattern (`.catch(() => {})`
  subscription) stays as-is, only the identity resolution changes.
- `UsageService.getSummaryForUser` unit test: update the mocked
  `$queryRaw` assertion for the simplified `WHERE` clause.
- e2e: `POST /short-url` and `POST /notifications/email` with a valid JWT
  and no `x-api-key` still create/queue correctly and appear in `GET
  /usage` with `apiKeyId: null`; `GET /api-keys` never shows a `Dashboard`
  key (there is none to show anymore).
- Confirm `src/common/api-versioning.spec.ts` passes unmodified — no guard
  metadata changed, only what's inside the guarded methods.
- Real-stack verification via `docker compose up`, this project's
  established practice: run the migration against the real Supabase DB,
  confirm pre-existing dashboard-created URLs/emails still show up in
  their respective lists post-migration with the correct owner, confirm a
  fresh dashboard-native create works end-to-end, confirm `GET /api-keys`
  and `GET /usage` look correct.

## Pattern for future services

Any new `@Service()`-tagged, `ApiKeyGuard`-protected write route gets a
dashboard-native counterpart by adding a `userId` column to its table (if
it doesn't already have a natural owner column) and a
`@UseGuards(JwtAuthGuard)`-only route that calls the same service method
with `{ userId: user.id }`. No second guard, no hidden entity.

## Out of scope

- Any UI changes — the frontend already calls the same routes with the
  same payloads; only what happens server-side to attribute the request
  changes.
- Revisiting `retry`/`cancel`'s cross-key ownership scope beyond the
  `{ apiKey: { userId } }` → `{ userId }` simplification already covered
  above.
