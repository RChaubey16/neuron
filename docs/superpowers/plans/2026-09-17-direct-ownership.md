# Direct Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the fabricated per-user "system" `ApiKey` that dashboard-native service calls authenticate through, replacing it with direct `userId` ownership on `ShortUrl`, `EmailJob`, and `UsageLog`.

**Architecture:** Add a required `userId` column (backfilled from the existing `apiKeyId` join) to the three tables, make `apiKeyId` optional metadata instead of the ownership backbone, delete `DashboardApiKeyGuard`/`getOrCreateSystemKey`/`isSystemKey`, and switch every service method that creates or scopes a resource to take/use `userId` directly.

**Tech Stack:** NestJS, Prisma 7 (`prisma-client-js` generator, `PrismaPg` driver adapter), PostgreSQL (Supabase), Jest/ts-jest, supertest for e2e.

**Spec:** `docs/2026-09-17-direct-ownership-design.md` (supersedes `docs/2026-09-16-dashboard-service-usage-design.md`)

## Global Constraints

- Every method on a `*.service.ts` file needs a JSDoc block above it (summary, `@throws`-style prose for exceptions, `@param`/`@returns`) — update JSDoc on every service method whose signature or scoping changes, don't just change the code.
- Prisma client generator stays `prisma-client-js` — do not touch `generator client` in `schema.prisma`.
- After any `schema.prisma` edit, run `pnpm exec prisma generate` before running tests — `generated/prisma` types must match the schema or `tsc`/ts-jest fails.
- Run `pnpm run lint` after removing any import — an import that becomes unused (e.g. `Prisma`, `ApiKey` in `api-keys.service.ts` once `getOrCreateSystemKey` is gone) fails lint, not just a stray warning.
- This migration runs against a real Supabase Postgres DB that already has live system-key rows and resources owned by them — the migration SQL's step order (backfill → null out → delete keys → drop column) is not optional reordering, it's what avoids an FK violation or an accidental cascade-delete of real history.

---

### Task 1: Prisma schema + migration — add `userId`, make `apiKeyId` optional, drop `isSystemKey`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_direct_ownership/migration.sql` (via `prisma migrate dev --create-only`)

**Interfaces:**
- Produces: `ShortUrl.userId`, `EmailJob.userId`, `UsageLog.userId` (all `String`, required, indexed); `ShortUrl.apiKeyId`, `EmailJob.apiKeyId`, `UsageLog.apiKeyId` become `String?`; `ApiKey.isSystemKey` and its partial unique index are gone.
- Consumes: nothing (first task).

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Replace the `ApiKey`, `UsageLog`, `ShortUrl`, `EmailJob` models and the `User` model's relation list with:

```prisma
model User {
  id        String   @id
  email     String   @unique
  createdAt DateTime @default(now())

  apiKeys   ApiKey[]
  shortUrls ShortUrl[]
  emailJobs EmailJob[]
  usageLogs UsageLog[]
}

/// Only the hash of a generated key is ever stored — the raw key is returned
/// once at creation time and never persisted or logged.
model ApiKey {
  id         String    @id @default(uuid())
  userId     String
  hashedKey  String    @unique
  keyPrefix  String
  name       String?
  createdAt  DateTime  @default(now())
  lastUsedAt DateTime?
  revokedAt  DateTime?

  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  usageLogs UsageLog[]
  shortUrls ShortUrl[]
  emailJobs EmailJob[]

  @@index([userId])
}

/// One row per authenticated service call, written by the cross-cutting
/// usage-logging interceptor. `apiKeyId` is set only when a machine's real
/// API key made the call; a dashboard-native call leaves it null and is
/// identified by `userId` alone.
model UsageLog {
  id        String   @id @default(uuid())
  apiKeyId  String?
  userId    String
  service   String
  endpoint  String
  createdAt DateTime @default(now())

  apiKey ApiKey? @relation(fields: [apiKeyId], references: [id], onDelete: SetNull)
  user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([apiKeyId])
  @@index([userId])
  @@index([service, createdAt])
}

/// A shortened URL. `code` is the public-facing identifier used in the
/// unauthenticated `GET /:code` redirect route. `apiKeyId` is set only when
/// a machine's real API key created it; a dashboard-native creation leaves
/// it null and is identified by `userId` alone.
model ShortUrl {
  id          String   @id @default(uuid())
  code        String   @unique
  originalUrl String
  apiKeyId    String?
  userId      String
  createdAt   DateTime @default(now())
  clickCount  Int      @default(0)

  apiKey ApiKey? @relation(fields: [apiKeyId], references: [id], onDelete: SetNull)
  user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([apiKeyId])
  @@index([userId])
}

enum EmailJobStatus {
  QUEUED
  PROCESSING
  SENT
  FAILED
  CANCELLED
}

/// A queued email send, tracked durably in Postgres since BullMQ's own Redis
/// job state is transient. `id` doubles as the underlying BullMQ job's
/// `jobId`. `apiKeyId` is set only when a machine's real API key queued it;
/// a dashboard-native send leaves it null and is identified by `userId` alone.
model EmailJob {
  id           String         @id @default(uuid())
  apiKeyId     String?
  userId       String
  status       EmailJobStatus @default(QUEUED)
  to           String[]
  subject      String
  body         String
  error        String?
  attemptsMade Int            @default(0)
  resendId     String?
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt

  apiKey ApiKey? @relation(fields: [apiKeyId], references: [id], onDelete: SetNull)
  user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([apiKeyId])
  @@index([userId])
}
```

- [ ] **Step 2: Create the migration draft**

Run: `pnpm exec prisma migrate dev --create-only --name direct_ownership`

This creates `prisma/migrations/<timestamp>_direct_ownership/migration.sql` with Prisma's own best-effort diff. Its content gets fully replaced in the next step — this step exists only to get the migration folder/timestamp and `migration_lock.toml` bookkeeping right, matching how this repo already hand-edits generated migration SQL (see the `20260916103856_add_api_key_system_key` migration's partial unique index).

- [ ] **Step 3: Replace the migration file's contents**

Overwrite the generated `migration.sql` with:

```sql
-- Step 1: add nullable userId columns (backfilled below before being required)
ALTER TABLE "ShortUrl" ADD COLUMN "userId" TEXT;
ALTER TABLE "EmailJob" ADD COLUMN "userId" TEXT;
ALTER TABLE "UsageLog" ADD COLUMN "userId" TEXT;

-- Step 2: backfill userId from the owning ApiKey, for every existing row
UPDATE "ShortUrl" SET "userId" = "ApiKey"."userId" FROM "ApiKey" WHERE "ApiKey"."id" = "ShortUrl"."apiKeyId";
UPDATE "EmailJob" SET "userId" = "ApiKey"."userId" FROM "ApiKey" WHERE "ApiKey"."id" = "EmailJob"."apiKeyId";
UPDATE "UsageLog" SET "userId" = "ApiKey"."userId" FROM "ApiKey" WHERE "ApiKey"."id" = "UsageLog"."apiKeyId";

-- Step 3: userId is now populated on every row -- make it required
ALTER TABLE "ShortUrl" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "EmailJob" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "UsageLog" ALTER COLUMN "userId" SET NOT NULL;

-- Step 4: apiKeyId becomes optional metadata rather than the row's ownership
-- backbone -- drop its old FK (was CASCADE) before relaxing NOT NULL, since
-- the null-out in Step 5 below requires the column to already be nullable
ALTER TABLE "ShortUrl" DROP CONSTRAINT "ShortUrl_apiKeyId_fkey";
ALTER TABLE "EmailJob" DROP CONSTRAINT "EmailJob_apiKeyId_fkey";
ALTER TABLE "UsageLog" DROP CONSTRAINT "UsageLog_apiKeyId_fkey";

ALTER TABLE "ShortUrl" ALTER COLUMN "apiKeyId" DROP NOT NULL;
ALTER TABLE "EmailJob" ALTER COLUMN "apiKeyId" DROP NOT NULL;
ALTER TABLE "UsageLog" ALTER COLUMN "apiKeyId" DROP NOT NULL;

-- Step 5: null out apiKeyId for rows that were only ever created through a
-- hidden dashboard system key -- they were honestly dashboard-originated
-- with no real key, which is what apiKeyId should say now. Must run after
-- Step 4's DROP NOT NULL (this column is not nullable before that point).
UPDATE "ShortUrl" SET "apiKeyId" = NULL FROM "ApiKey" WHERE "ApiKey"."id" = "ShortUrl"."apiKeyId" AND "ApiKey"."isSystemKey" = true;
UPDATE "EmailJob" SET "apiKeyId" = NULL FROM "ApiKey" WHERE "ApiKey"."id" = "EmailJob"."apiKeyId" AND "ApiKey"."isSystemKey" = true;
UPDATE "UsageLog" SET "apiKeyId" = NULL FROM "ApiKey" WHERE "ApiKey"."id" = "UsageLog"."apiKeyId" AND "ApiKey"."isSystemKey" = true;

-- Step 6: drop the hidden system keys now that nothing references them
-- (every row that did has had apiKeyId nulled out above)
DELETE FROM "ApiKey" WHERE "isSystemKey" = true;

-- Step 7: drop the system-key column and its partial unique index
DROP INDEX "ApiKey_userId_system_key_unique";
ALTER TABLE "ApiKey" DROP COLUMN "isSystemKey";

-- Step 8: re-add apiKeyId's FK as ON DELETE SET NULL (was CASCADE) so a
-- future hard-deleted key can't take usage history down with it, and add
-- the new userId FK (CASCADE, matching ApiKey's own FK to User) -- userId
-- is the ownership column now
ALTER TABLE "ShortUrl" ADD CONSTRAINT "ShortUrl_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailJob" ADD CONSTRAINT "EmailJob_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ShortUrl" ADD CONSTRAINT "ShortUrl_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailJob" ADD CONSTRAINT "EmailJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 9: index the new ownership column, matching every other FK on these tables
CREATE INDEX "ShortUrl_userId_idx" ON "ShortUrl"("userId");
CREATE INDEX "EmailJob_userId_idx" ON "EmailJob"("userId");
CREATE INDEX "UsageLog_userId_idx" ON "UsageLog"("userId");
```

- [ ] **Step 4: Apply the migration and regenerate the client**

Run: `pnpm exec prisma migrate dev` (applies the now-unapplied draft as-is; Prisma does not regenerate content for an existing migration file), then `pnpm exec prisma generate`.

- [ ] **Step 5: Verify against the real dev DB**

Run this against the dev DB (e.g. `docker compose exec app npx prisma studio`, or any `psql`/`$DATABASE_URL` client) and confirm all three return `0`:

```sql
SELECT COUNT(*) FROM "ShortUrl" WHERE "userId" IS NULL;
SELECT COUNT(*) FROM "EmailJob" WHERE "userId" IS NULL;
SELECT COUNT(*) FROM "UsageLog" WHERE "userId" IS NULL;
SELECT COUNT(*) FROM "ApiKey" WHERE "isSystemKey" IS NOT NULL; -- expect an error: column no longer exists
```

(The last query is expected to error with `column "isSystemKey" does not exist` — that error *is* the pass condition.)

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add direct userId ownership, make apiKeyId optional metadata"
```

---

### Task 2: `ApiKeyService` — remove the system-key mechanism

**Files:**
- Modify: `src/api-keys/api-keys.service.ts`
- Test: `src/api-keys/api-keys.service.spec.ts`

**Interfaces:**
- Consumes: Task 1's schema (no `isSystemKey` column).
- Produces: `ApiKeyService.findAllForUser(userId): Promise<ApiKeyResponseDto[]>` and `.revoke(userId, id): Promise<void>` unchanged in signature, simplified `where` clauses. `getOrCreateSystemKey` no longer exists — later tasks must not reference it.

- [ ] **Step 1: Update the failing/changed tests first**

In `src/api-keys/api-keys.service.spec.ts`:

Remove the entire `describe('getOrCreateSystemKey', ...)` block (lines 141–223).

Change the `findAllForUser` test's assertion (line 87):
```typescript
// before
where: { userId: 'user-1', isSystemKey: false },
// after
where: { userId: 'user-1' },
```

Change the `revoke` "sets revokedAt" test's assertion (lines 115–122):
```typescript
// before
expect(prisma.apiKey.findFirst).toHaveBeenCalledWith({
  where: {
    id: 'key-1',
    userId: 'user-1',
    isSystemKey: false,
    revokedAt: null,
  },
});
// after
expect(prisma.apiKey.findFirst).toHaveBeenCalledWith({
  where: { id: 'key-1', userId: 'user-1', revokedAt: null },
});
```

Remove the now-unused `import { Prisma } from '../../generated/prisma';` (it was only used by the removed `getOrCreateSystemKey` race test).

- [ ] **Step 2: Run the tests to confirm they fail against the current implementation**

Run: `pnpm run test -- api-keys.service.spec.ts`
Expected: FAIL — `findAllForUser`/`revoke` assertions fail because the real service still filters on `isSystemKey`.

- [ ] **Step 3: Update `src/api-keys/api-keys.service.ts`**

Remove the `SYSTEM_KEY_NAME` constant (line 11) and the entire `getOrCreateSystemKey` method (lines 88–142).

Change `findAllForUser` (line 58):
```typescript
// before
where: { userId, isSystemKey: false },
// after
where: { userId },
```

Change `revoke`'s JSDoc (lines 65–70) and `where` (line 76):
```typescript
// before
  /**
   * Revokes (soft-deletes) one of the caller's own API keys.
   * Throws a NotFoundException if the key doesn't exist, isn't owned by the
   * caller, is already revoked, or is the hidden dashboard system key (see
   * `getOrCreateSystemKey`) — that key can never be revoked through the API.
   *
   * @param userId - Id of the caller, to scope the lookup to their own keys
   * @param id - Id of the `ApiKey` to revoke
   */
  async revoke(userId: string, id: string): Promise<void> {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { id, userId, isSystemKey: false, revokedAt: null },
    });
// after
  /**
   * Revokes (soft-deletes) one of the caller's own API keys.
   * Throws a NotFoundException if the key doesn't exist, isn't owned by the
   * caller, or is already revoked.
   *
   * @param userId - Id of the caller, to scope the lookup to their own keys
   * @param id - Id of the `ApiKey` to revoke
   */
  async revoke(userId: string, id: string): Promise<void> {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { id, userId, revokedAt: null },
    });
```

Change the import line (line 7):
```typescript
// before
import { Prisma, ApiKey } from '../../generated/prisma';
// after
```
(delete the line entirely — neither `Prisma` nor `ApiKey` is referenced anywhere else in this file once `getOrCreateSystemKey` is gone)

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm run test -- api-keys.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Lint**

Run: `pnpm run lint`
Expected: no unused-import errors in this file.

- [ ] **Step 6: Commit**

```bash
git add src/api-keys/api-keys.service.ts src/api-keys/api-keys.service.spec.ts
git commit -m "refactor: remove system-key mechanism from ApiKeyService"
```

---

### Task 3: Delete `DashboardApiKeyGuard` and wire it out of `ApiKeyModule`

**Files:**
- Delete: `src/api-keys/guards/dashboard-api-key.guard.ts`
- Delete: `src/api-keys/guards/dashboard-api-key.guard.spec.ts`
- Modify: `src/api-keys/api-keys.module.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DashboardApiKeyGuard` no longer exists anywhere in the codebase — Tasks 5 and 7 remove the last two `@UseGuards(JwtAuthGuard, DashboardApiKeyGuard)` usages.

- [ ] **Step 1: Delete the guard and its spec**

```bash
git rm src/api-keys/guards/dashboard-api-key.guard.ts src/api-keys/guards/dashboard-api-key.guard.spec.ts
```

- [ ] **Step 2: Update `src/api-keys/api-keys.module.ts`**

```typescript
// before
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApiKeyController } from './api-keys.controller';
import { ApiKeyService } from './api-keys.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { DashboardApiKeyGuard } from './guards/dashboard-api-key.guard';

@Module({
  imports: [AuthModule],
  controllers: [ApiKeyController],
  providers: [ApiKeyService, ApiKeyGuard, DashboardApiKeyGuard],
  exports: [ApiKeyService, ApiKeyGuard, DashboardApiKeyGuard],
})
export class ApiKeyModule {}

// after
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApiKeyController } from './api-keys.controller';
import { ApiKeyService } from './api-keys.service';
import { ApiKeyGuard } from './guards/api-key.guard';

@Module({
  imports: [AuthModule],
  controllers: [ApiKeyController],
  providers: [ApiKeyService, ApiKeyGuard],
  exports: [ApiKeyService, ApiKeyGuard],
})
export class ApiKeyModule {}
```

Note: this leaves `src/short-url/short-url.controller.ts` and `src/notifications/notifications.controller.ts` with a dangling import of the now-deleted guard — expected at this point in the plan; Tasks 5 and 7 fix them. Do not run the full test suite until after Task 7; `pnpm run build`/`test` will fail on those two files in the meantime, which is fine mid-plan.

- [ ] **Step 3: Commit**

```bash
git add -A src/api-keys/guards src/api-keys/api-keys.module.ts
git commit -m "refactor: delete DashboardApiKeyGuard"
```

---

### Task 4: `ShortUrlService` — owner-object create, simplified `findAllForUser`

**Files:**
- Modify: `src/short-url/short-url.service.ts`
- Test: `src/short-url/short-url.service.spec.ts`

**Interfaces:**
- Consumes: Task 1's schema (`ShortUrl.userId` required, `apiKeyId` optional).
- Produces: `ShortUrlService.create(owner: { userId: string; apiKeyId?: string }, dto: CreateShortUrlDto): Promise<ShortUrlResponseDto>` — signature changed from `create(apiKeyId: string, dto)`. `findAllForUser(userId, limit, offset)` unchanged in signature. `findAllForApiKey` and `resolve` unchanged.

- [ ] **Step 1: Update the tests first**

In `src/short-url/short-url.service.spec.ts`, change the three `create` tests (lines 47–111) that call `service.create('key-1', {...})`:

```typescript
// before (first test, lines 59-72)
const result = await service.create('key-1', {
  originalUrl: 'https://example.com/very/long/path',
});

expect(result.code).toMatch(/^[A-Za-z0-9_-]{7}$/);
expect(result.originalUrl).toBe('https://example.com/very/long/path');
expect(result.clickCount).toBe(0);
expect(prisma.shortUrl.create).toHaveBeenCalledWith({
  data: {
    code: result.code,
    originalUrl: 'https://example.com/very/long/path',
    apiKeyId: 'key-1',
  },
});

// after
const result = await service.create(
  { userId: 'user-1', apiKeyId: 'key-1' },
  { originalUrl: 'https://example.com/very/long/path' },
);

expect(result.code).toMatch(/^[A-Za-z0-9_-]{7}$/);
expect(result.originalUrl).toBe('https://example.com/very/long/path');
expect(result.clickCount).toBe(0);
expect(prisma.shortUrl.create).toHaveBeenCalledWith({
  data: {
    code: result.code,
    originalUrl: 'https://example.com/very/long/path',
    userId: 'user-1',
    apiKeyId: 'key-1',
  },
});
```

Apply the same `service.create('key-1', {...})` → `service.create({ userId: 'user-1', apiKeyId: 'key-1' }, {...})` change to the two other `create` calls in that block (the collision-retry test at line 87 and the exhausted-retries test at line 98) and the rethrow test's call at line 107 — none of those three assert on `prisma.shortUrl.create`'s `data` shape, so only the call-site arguments change.

Add one new test to the `create` describe block, after the existing ones:

```typescript
it('persists a dashboard-originated URL with no apiKeyId', async () => {
  prisma.shortUrl.create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'short-1',
        createdAt: new Date('2026-08-30T00:00:00Z'),
        clickCount: 0,
        ...data,
      }),
  );

  await service.create(
    { userId: 'user-1' },
    { originalUrl: 'https://example.com' },
  );

  expect(prisma.shortUrl.create).toHaveBeenCalledWith({
    data: {
      code: expect.any(String),
      originalUrl: 'https://example.com',
      userId: 'user-1',
      apiKeyId: undefined,
    },
  });
});
```

Change the two `findAllForUser` tests' `where` assertions (lines 128 and 134):
```typescript
// before
where: { apiKey: { userId: 'user-1' } },
// after
where: { userId: 'user-1' },
```
(applies to both the `findMany` and `count` assertions in the first test)

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm run test -- short-url.service.spec.ts`
Expected: FAIL — the real `create` still takes a bare `apiKeyId` string, and `findAllForUser` still queries via the `apiKey` relation.

- [ ] **Step 3: Update `src/short-url/short-url.service.ts`**

```typescript
// before (lines 23-42)
  /**
   * Creates a shortened URL owned by the given API key, retrying with a
   * fresh code on the rare unique-constraint collision.
   * Throws a ConflictException if no unique code could be generated after
   * several attempts.
   *
   * @param apiKeyId - Id of the ApiKey making the request
   * @param dto - Validated payload containing the URL to shorten
   * @returns The created short URL's metadata
   */
  async create(
    apiKeyId: string,
    dto: CreateShortUrlDto,
  ): Promise<ShortUrlResponseDto> {
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
      const code = nanoid(CODE_LENGTH);
      try {
        const shortUrl = await this.prisma.shortUrl.create({
          data: { code, originalUrl: dto.originalUrl, apiKeyId },
        });

// after
  /**
   * Creates a shortened URL owned by the given user, retrying with a fresh
   * code on the rare unique-constraint collision.
   * Throws a ConflictException if no unique code could be generated after
   * several attempts.
   *
   * @param owner - Id of the owning user, plus the ApiKey id when a machine
   *   made the request (omitted for a dashboard-native call)
   * @param dto - Validated payload containing the URL to shorten
   * @returns The created short URL's metadata
   */
  async create(
    owner: { userId: string; apiKeyId?: string },
    dto: CreateShortUrlDto,
  ): Promise<ShortUrlResponseDto> {
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
      const code = nanoid(CODE_LENGTH);
      try {
        const shortUrl = await this.prisma.shortUrl.create({
          data: {
            code,
            originalUrl: dto.originalUrl,
            userId: owner.userId,
            apiKeyId: owner.apiKeyId,
          },
        });
```

Change `findAllForUser`'s JSDoc and body (lines 60–76):
```typescript
// before
  /**
   * Lists short URLs created by any of the given user's API keys, most
   * recently created first, for the dashboard's URL listing page.
   *
   * @param userId - Id of the dashboard user; `ShortUrl` only links to
   *   `ApiKey`, not `User`, directly, so results are scoped via that relation
   * @param limit - Max number of rows to return
   * @param offset - Number of rows to skip, for pagination
   * @returns A page of the user's short URLs plus the total matching count
   */
  async findAllForUser(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<ShortUrlListResponseDto> {
    return this.listByWhere({ apiKey: { userId } }, limit, offset);
  }

// after
  /**
   * Lists short URLs owned by the given user, most recently created first,
   * for the dashboard's URL listing page. Spans every URL the user owns
   * regardless of whether it was created via a real API key or directly
   * from the dashboard.
   *
   * @param userId - Id of the dashboard user
   * @param limit - Max number of rows to return
   * @param offset - Number of rows to skip, for pagination
   * @returns A page of the user's short URLs plus the total matching count
   */
  async findAllForUser(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<ShortUrlListResponseDto> {
    return this.listByWhere({ userId }, limit, offset);
  }
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm run test -- short-url.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/short-url/short-url.service.ts src/short-url/short-url.service.spec.ts
git commit -m "refactor: ShortUrlService takes an owner object instead of a bare apiKeyId"
```

---

### Task 5: `ShortUrlController` — drop `DashboardApiKeyGuard`, wire the owner object

**Files:**
- Modify: `src/short-url/short-url.controller.ts`

**Interfaces:**
- Consumes: `ShortUrlService.create(owner, dto)` from Task 4.
- Produces: no public interface change — routes/paths/guards-visible-to-clients are identical except `DashboardApiKeyGuard` no longer runs on `POST /short-url`.

- [ ] **Step 1: Update `src/short-url/short-url.controller.ts`**

```typescript
// before (imports, lines 15-17)
import { ApiKeyGuard } from '../api-keys/guards/api-key.guard';
import { DashboardApiKeyGuard } from '../api-keys/guards/dashboard-api-key.guard';
import { CurrentApiKey } from '../api-keys/decorators/current-api-key.decorator';

// after
import { ApiKeyGuard } from '../api-keys/guards/api-key.guard';
import { CurrentApiKey } from '../api-keys/decorators/current-api-key.decorator';
```

```typescript
// before (machine create route, lines 34-45)
  @Post('api/v1/short-url/shorten')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ApiKeyGuard)
  @Service('url-shortener')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @CurrentApiKey() apiKey: ApiKey,
    @Body() dto: CreateShortUrlDto,
  ): Promise<ShortUrlResponseDto> {
    return this.shortUrlService.create(apiKey.id, dto);
  }

// after
  @Post('api/v1/short-url/shorten')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ApiKeyGuard)
  @Service('url-shortener')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @CurrentApiKey() apiKey: ApiKey,
    @Body() dto: CreateShortUrlDto,
  ): Promise<ShortUrlResponseDto> {
    return this.shortUrlService.create(
      { userId: apiKey.userId, apiKeyId: apiKey.id },
      dto,
    );
  }
```

```typescript
// before (dashboard create route + its comment, lines 78-93)
  // Dashboard-native counterpart to POST /api/v1/short-url/shorten: bridges
  // a logged-in human's session JWT to the same ApiKeyId-scoped service
  // method via DashboardApiKeyGuard's hidden per-user system key, so a
  // dashboard-created link lands in the exact same tables/usage log as a
  // machine-created one (see docs/2026-09-16-dashboard-service-usage-design.md).
  @Post('short-url')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, DashboardApiKeyGuard)
  @Service('url-shortener')
  @UseInterceptors(UsageLoggingInterceptor)
  createFromDashboard(
    @CurrentApiKey() apiKey: ApiKey,
    @Body() dto: CreateShortUrlDto,
  ): Promise<ShortUrlResponseDto> {
    return this.shortUrlService.create(apiKey.id, dto);
  }

// after
  // Dashboard-native counterpart to POST /api/v1/short-url/shorten: calls
  // the same service method directly with the logged-in user's id, no
  // second guard or fabricated ApiKey involved (see
  // docs/2026-09-17-direct-ownership-design.md).
  @Post('short-url')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @Service('url-shortener')
  @UseInterceptors(UsageLoggingInterceptor)
  createFromDashboard(
    @CurrentUser() user: User,
    @Body() dto: CreateShortUrlDto,
  ): Promise<ShortUrlResponseDto> {
    return this.shortUrlService.create({ userId: user.id }, dto);
  }
```

- [ ] **Step 2: Run the full test file set touching this controller**

Run: `pnpm run build`
Expected: PASS (this confirms the dangling `DashboardApiKeyGuard` import from Task 3 is now gone and the file type-checks; e2e assertions are updated in Task 8).

- [ ] **Step 3: Commit**

```bash
git add src/short-url/short-url.controller.ts
git commit -m "refactor: ShortUrlController dashboard route drops DashboardApiKeyGuard"
```

---

### Task 6: `NotificationsService` — owner-object create, simplified scoping

**Files:**
- Modify: `src/notifications/notifications.service.ts`
- Test: `src/notifications/notifications.service.spec.ts`

**Interfaces:**
- Consumes: Task 1's schema (`EmailJob.userId` required, `apiKeyId` optional).
- Produces: `queueEmail(owner: { userId: string; apiKeyId?: string }, dto): Promise<EmailJobResponseDto>`, `sendTemplatedEmail(owner: { userId: string; apiKeyId?: string }, templateKey: string, dto): Promise<EmailJobResponseDto>` — both changed from a bare `apiKeyId: string` first param. `getStatus(apiKeyId, jobId)`, `retry(apiKeyId, jobId)`, `cancel(apiKeyId, jobId)` **unchanged** (EmailJob still carries a real `apiKeyId` for machine-created jobs). `findAllForUser`, `retryForUser`, `cancelForUser` unchanged in signature, simplified internal scope.

- [ ] **Step 1: Update the tests first**

In `src/notifications/notifications.service.spec.ts`:

```typescript
// before (queueEmail test, lines 74-83)
const result = await service.queueEmail('key-1', dto);

expect(prisma.emailJob.create).toHaveBeenCalledWith({
  data: {
    apiKeyId: 'key-1',
    to: dto.to,
    subject: dto.subject,
    body: dto.body,
  },
});

// after
const result = await service.queueEmail(
  { userId: 'user-1', apiKeyId: 'key-1' },
  dto,
);

expect(prisma.emailJob.create).toHaveBeenCalledWith({
  data: {
    userId: 'user-1',
    apiKeyId: 'key-1',
    to: dto.to,
    subject: dto.subject,
    body: dto.body,
  },
});
```

Add a new test to the `queueEmail` describe block:

```typescript
it('creates a dashboard-originated job with no apiKeyId', async () => {
  prisma.emailJob.create.mockResolvedValue(job);
  queue.add.mockResolvedValue({});

  await service.queueEmail(
    { userId: 'user-1' },
    { to: ['recipient@example.com'], subject: 'Hi', body: '<p>Hello</p>' },
  );

  expect(prisma.emailJob.create).toHaveBeenCalledWith({
    data: {
      userId: 'user-1',
      apiKeyId: undefined,
      to: ['recipient@example.com'],
      subject: 'Hi',
      body: '<p>Hello</p>',
    },
  });
});
```

```typescript
// before (sendTemplatedEmail test, lines 105-117)
const result = await service.sendTemplatedEmail('key-1', 'welcome', {
  to: ['recipient@example.com'],
  variables: { name: 'Ada', productName: 'Neuron' },
});

expect(prisma.emailJob.create).toHaveBeenCalledWith({
  data: {
    apiKeyId: 'key-1',
    to: ['recipient@example.com'],
    subject: 'Welcome to Neuron, Ada!',
    body: "<p>Hi Ada,</p><p>Thanks for signing up for Neuron. We're glad to have you.</p>",
  },
});

// after
const result = await service.sendTemplatedEmail(
  { userId: 'user-1', apiKeyId: 'key-1' },
  'welcome',
  { to: ['recipient@example.com'], variables: { name: 'Ada', productName: 'Neuron' } },
);

expect(prisma.emailJob.create).toHaveBeenCalledWith({
  data: {
    userId: 'user-1',
    apiKeyId: 'key-1',
    to: ['recipient@example.com'],
    subject: 'Welcome to Neuron, Ada!',
    body: "<p>Hi Ada,</p><p>Thanks for signing up for Neuron. We're glad to have you.</p>",
  },
});
```

Update the two `sendTemplatedEmail` error-case calls (lines 132 and 142) from `service.sendTemplatedEmail('key-1', 'does-not-exist', {...})` to `service.sendTemplatedEmail({ userId: 'user-1', apiKeyId: 'key-1' }, 'does-not-exist', {...})` (and similarly for the `'welcome'`/mismatched-variables case) — neither test asserts on `create`'s data shape, only the call-site arguments change.

Change the `findAllForUser` test's `where` assertions (lines 159 and 165):
```typescript
// before
where: { apiKey: { userId: 'user-1' } },
// after
where: { userId: 'user-1' },
```

Change the `retryForUser` test's assertion (line 311):
```typescript
// before
where: { id: 'job-1', apiKey: { userId: 'user-1' } },
// after
where: { id: 'job-1', userId: 'user-1' },
```

Change the `cancelForUser` test's assertion (line 380):
```typescript
// before
where: { id: 'job-1', apiKey: { userId: 'user-1' } },
// after
where: { id: 'job-1', userId: 'user-1' },
```

`getStatus`/`retry`/`cancel` tests (lines 221–369, using `service.getStatus('key-1', ...)` etc. and asserting `where: { id, apiKeyId: 'key-1' }`) need **no changes** — those methods' signature and scoping are untouched.

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm run test -- notifications.service.spec.ts`
Expected: FAIL against the current implementation.

- [ ] **Step 3: Update `src/notifications/notifications.service.ts`**

```typescript
// before (lines 26-46)
  /**
   * Creates a durable `EmailJob` record and queues it for asynchronous
   * delivery, using the record's own id as the BullMQ job id so the two
   * never need reconciling.
   * A downstream Resend failure is EmailProcessor's concern, handled via
   * BullMQ's own retry/backoff on the job, not by this method.
   * Note: if Redis is unreachable, the queue add below does NOT reliably
   * throw — ioredis's offline-queue buffering can cause it to hang instead
   * of failing fast (known gap, not yet fixed; see CLAUDE.md's gotchas).
   * The EmailJob row would be created and left QUEUED in that case.
   *
   * @param apiKeyId - Id of the ApiKey making the request, for ownership
   * @param dto - Validated recipients/subject/body payload
   * @returns The created job's current state
   */
  async queueEmail(
    apiKeyId: string,
    dto: CreateEmailDto,
  ): Promise<EmailJobResponseDto> {
    return this.createAndQueueJob(apiKeyId, dto);
  }

// after
  /**
   * Creates a durable `EmailJob` record and queues it for asynchronous
   * delivery, using the record's own id as the BullMQ job id so the two
   * never need reconciling.
   * A downstream Resend failure is EmailProcessor's concern, handled via
   * BullMQ's own retry/backoff on the job, not by this method.
   * Note: if Redis is unreachable, the queue add below does NOT reliably
   * throw — ioredis's offline-queue buffering can cause it to hang instead
   * of failing fast (known gap, not yet fixed; see CLAUDE.md's gotchas).
   * The EmailJob row would be created and left QUEUED in that case.
   *
   * @param owner - Id of the owning user, plus the ApiKey id when a machine
   *   made the request (omitted for a dashboard-native call)
   * @param dto - Validated recipients/subject/body payload
   * @returns The created job's current state
   */
  async queueEmail(
    owner: { userId: string; apiKeyId?: string },
    dto: CreateEmailDto,
  ): Promise<EmailJobResponseDto> {
    return this.createAndQueueJob(owner, dto);
  }
```

```typescript
// before (lines 48-77)
  /**
   * Renders a predefined template with the given variables and queues the
   * result exactly like queueEmail.
   * Throws a NotFoundException if templateKey doesn't match a known
   * template (see `src/notifications/templates/templates.ts`).
   * Throws a BadRequestException (via renderTemplate) if `variables`
   * doesn't exactly match the template's required variables.
   * The rendered subject/body are persisted on the EmailJob row itself,
   * not the template key + raw variables — so status/retry/EmailProcessor
   * need no template-awareness, and editing a template's source later
   * can't retroactively change an already-queued job's content.
   *
   * @param apiKeyId - Id of the ApiKey making the request, for ownership
   * @param templateKey - Key of the template to render, from EMAIL_TEMPLATES
   * @param dto - Recipients and template variable values
   * @returns The created job's current state
   */
  async sendTemplatedEmail(
    apiKeyId: string,
    templateKey: string,
    dto: SendTemplatedEmailDto,
  ): Promise<EmailJobResponseDto> {
    const template = EMAIL_TEMPLATES[templateKey];
    if (!template) {
      throw new NotFoundException(`Unknown email template '${templateKey}'`);
    }

    const { subject, body } = renderTemplate(template, dto.variables);
    return this.createAndQueueJob(apiKeyId, { to: dto.to, subject, body });
  }

// after
  /**
   * Renders a predefined template with the given variables and queues the
   * result exactly like queueEmail.
   * Throws a NotFoundException if templateKey doesn't match a known
   * template (see `src/notifications/templates/templates.ts`).
   * Throws a BadRequestException (via renderTemplate) if `variables`
   * doesn't exactly match the template's required variables.
   * The rendered subject/body are persisted on the EmailJob row itself,
   * not the template key + raw variables — so status/retry/EmailProcessor
   * need no template-awareness, and editing a template's source later
   * can't retroactively change an already-queued job's content.
   *
   * @param owner - Id of the owning user, plus the ApiKey id when a machine
   *   made the request (omitted for a dashboard-native call)
   * @param templateKey - Key of the template to render, from EMAIL_TEMPLATES
   * @param dto - Recipients and template variable values
   * @returns The created job's current state
   */
  async sendTemplatedEmail(
    owner: { userId: string; apiKeyId?: string },
    templateKey: string,
    dto: SendTemplatedEmailDto,
  ): Promise<EmailJobResponseDto> {
    const template = EMAIL_TEMPLATES[templateKey];
    if (!template) {
      throw new NotFoundException(`Unknown email template '${templateKey}'`);
    }

    const { subject, body } = renderTemplate(template, dto.variables);
    return this.createAndQueueJob(owner, { to: dto.to, subject, body });
  }
```

```typescript
// before (retryForUser, lines 122-140)
  /**
   * Re-queues a permanently failed email job owned by any of the given
   * user's API keys, for the dashboard table's retry action — unlike
   * `retry`, which only matches the single calling API key, this spans every
   * key a human owns (including one used to create the job from another
   * application), matching `findAllForUser`'s scoping.
   * Throws a NotFoundException per the same ownership rule as getStatus.
   * Throws a ConflictException if the job isn't in a FAILED state.
   *
   * @param userId - Id of the dashboard user, for ownership
   * @param jobId - Id of the job to retry
   * @returns The job's state after being re-queued
   */
  async retryForUser(
    userId: string,
    jobId: string,
  ): Promise<EmailJobResponseDto> {
    return this.retryJob({ apiKey: { userId } }, jobId);
  }

// after
  /**
   * Re-queues a permanently failed email job owned by the given user, for
   * the dashboard table's retry action — unlike `retry`, which only matches
   * a single calling API key, this spans every job the user owns regardless
   * of which key (or none) created it, matching `findAllForUser`'s scoping.
   * Throws a NotFoundException per the same ownership rule as getStatus.
   * Throws a ConflictException if the job isn't in a FAILED state.
   *
   * @param userId - Id of the dashboard user, for ownership
   * @param jobId - Id of the job to retry
   * @returns The job's state after being re-queued
   */
  async retryForUser(
    userId: string,
    jobId: string,
  ): Promise<EmailJobResponseDto> {
    return this.retryJob({ userId }, jobId);
  }
```

```typescript
// before (cancelForUser, lines 155-167)
  /**
   * Cancels an email job owned by any of the given user's API keys, for the
   * dashboard table's cancel action — see `retryForUser` for why this scopes
   * differently than `cancel`.
   * Throws a NotFoundException per the same ownership rule as getStatus.
   * Throws a ConflictException if the job is no longer QUEUED.
   *
   * @param userId - Id of the dashboard user, for ownership
   * @param jobId - Id of the job to cancel
   */
  async cancelForUser(userId: string, jobId: string): Promise<void> {
    return this.cancelJob({ apiKey: { userId } }, jobId);
  }

// after
  /**
   * Cancels an email job owned by the given user, for the dashboard table's
   * cancel action — see `retryForUser` for why this scopes differently than
   * `cancel`.
   * Throws a NotFoundException per the same ownership rule as getStatus.
   * Throws a ConflictException if the job is no longer QUEUED.
   *
   * @param userId - Id of the dashboard user, for ownership
   * @param jobId - Id of the job to cancel
   */
  async cancelForUser(userId: string, jobId: string): Promise<void> {
    return this.cancelJob({ userId }, jobId);
  }
```

```typescript
// before (findAllForUser, lines 230-246)
  /**
   * Lists email jobs queued by any of the given user's API keys, most
   * recently created first, for the dashboard's notifications listing page.
   *
   * @param userId - Id of the dashboard user; `EmailJob` only links to
   *   `ApiKey`, not `User`, directly, so results are scoped via that relation
   * @param limit - Max number of rows to return
   * @param offset - Number of rows to skip, for pagination
   * @returns A page of the user's email jobs plus the total matching count
   */
  async findAllForUser(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<EmailJobListResponseDto> {
    return this.listByWhere({ apiKey: { userId } }, limit, offset);
  }

// after
  /**
   * Lists email jobs owned by the given user, most recently created first,
   * for the dashboard's notifications listing page. Spans every job the
   * user owns regardless of which key (or none) created it.
   *
   * @param userId - Id of the dashboard user
   * @param limit - Max number of rows to return
   * @param offset - Number of rows to skip, for pagination
   * @returns A page of the user's email jobs plus the total matching count
   */
  async findAllForUser(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<EmailJobListResponseDto> {
    return this.listByWhere({ userId }, limit, offset);
  }
```

```typescript
// before (createAndQueueJob, lines 279-300)
  /**
   * Creates the durable EmailJob record and queues it for delivery, shared
   * by both a direct send (queueEmail) and a templated send
   * (sendTemplatedEmail) so the two entry points can never drift apart.
   */
  private async createAndQueueJob(
    apiKeyId: string,
    email: { to: string[]; subject: string; body: string },
  ): Promise<EmailJobResponseDto> {
    const job = await this.prisma.emailJob.create({
      data: {
        apiKeyId,
        to: email.to,
        subject: email.subject,
        body: email.body,
      },
    });

    await this.emailQueue.add('send', email, this.jobOptions(job.id));

    return this.toResponseDto(job);
  }

// after
  /**
   * Creates the durable EmailJob record and queues it for delivery, shared
   * by both a direct send (queueEmail) and a templated send
   * (sendTemplatedEmail) so the two entry points can never drift apart.
   */
  private async createAndQueueJob(
    owner: { userId: string; apiKeyId?: string },
    email: { to: string[]; subject: string; body: string },
  ): Promise<EmailJobResponseDto> {
    const job = await this.prisma.emailJob.create({
      data: {
        userId: owner.userId,
        apiKeyId: owner.apiKeyId,
        to: email.to,
        subject: email.subject,
        body: email.body,
      },
    });

    await this.emailQueue.add('send', email, this.jobOptions(job.id));

    return this.toResponseDto(job);
  }
```

```typescript
// before (findOwnedJob's doc comment, lines 302-309)
  /**
   * Finds an EmailJob matching the given ownership scope (either a single
   * `apiKeyId`, for a machine caller, or `{ apiKey: { userId } }`, for a
   * dashboard caller acting across every key they own).
   * Throws a NotFoundException if no matching job exists — deliberately not
   * distinguishing "doesn't exist" from "exists but isn't owned by this
   * scope", to avoid leaking whether a job id exists under another key.
   */

// after
  /**
   * Finds an EmailJob matching the given ownership scope (either a single
   * `apiKeyId`, for a machine caller, or `{ userId }`, for a dashboard
   * caller acting across every job they own regardless of key).
   * Throws a NotFoundException if no matching job exists — deliberately not
   * distinguishing "doesn't exist" from "exists but isn't owned by this
   * scope", to avoid leaking whether a job id exists under another key.
   */
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm run test -- notifications.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/notifications/notifications.service.ts src/notifications/notifications.service.spec.ts
git commit -m "refactor: NotificationsService takes an owner object for creates, direct userId scoping"
```

---

### Task 7: `NotificationsController` — drop `DashboardApiKeyGuard`, wire the owner object

**Files:**
- Modify: `src/notifications/notifications.controller.ts`

**Interfaces:**
- Consumes: `NotificationsService.queueEmail(owner, dto)`, `.sendTemplatedEmail(owner, templateKey, dto)` from Task 6.
- Produces: no public interface change; `DashboardApiKeyGuard` no longer runs on `POST /notifications/email`.

- [ ] **Step 1: Update `src/notifications/notifications.controller.ts`**

```typescript
// before (imports, lines 15-17)
import { ApiKeyGuard } from '../api-keys/guards/api-key.guard';
import { DashboardApiKeyGuard } from '../api-keys/guards/dashboard-api-key.guard';
import { CurrentApiKey } from '../api-keys/decorators/current-api-key.decorator';

// after
import { ApiKeyGuard } from '../api-keys/guards/api-key.guard';
import { CurrentApiKey } from '../api-keys/decorators/current-api-key.decorator';
```

```typescript
// before (send, lines 42-53)
  @Post('api/v1/notifications/email')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ApiKeyGuard)
  @Service('email-notifications')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  send(
    @CurrentApiKey() apiKey: ApiKey,
    @Body() dto: CreateEmailDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.queueEmail(apiKey.id, dto);
  }

// after
  @Post('api/v1/notifications/email')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ApiKeyGuard)
  @Service('email-notifications')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  send(
    @CurrentApiKey() apiKey: ApiKey,
    @Body() dto: CreateEmailDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.queueEmail(
      { userId: apiKey.userId, apiKeyId: apiKey.id },
      dto,
    );
  }
```

```typescript
// before (sendTemplated, lines 68-84)
  sendTemplated(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: TemplateKeyParamsDto,
    @Body() dto: SendTemplatedEmailDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.sendTemplatedEmail(
      apiKey.id,
      params.templateKey,
      dto,
    );
  }

// after
  sendTemplated(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: TemplateKeyParamsDto,
    @Body() dto: SendTemplatedEmailDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.sendTemplatedEmail(
      { userId: apiKey.userId, apiKeyId: apiKey.id },
      params.templateKey,
      dto,
    );
  }
```

```typescript
// before (dashboard send, lines 140-154)
  // Dashboard-native counterpart to POST /api/v1/notifications/email:
  // bridges a logged-in human's session JWT to the same apiKeyId-scoped
  // service method via DashboardApiKeyGuard's hidden per-user system key
  // (see docs/2026-09-16-dashboard-service-usage-design.md).
  @Post('notifications/email')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, DashboardApiKeyGuard)
  @Service('email-notifications')
  @UseInterceptors(UsageLoggingInterceptor)
  sendFromDashboard(
    @CurrentApiKey() apiKey: ApiKey,
    @Body() dto: CreateEmailDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.queueEmail(apiKey.id, dto);
  }

// after
  // Dashboard-native counterpart to POST /api/v1/notifications/email: calls
  // the same service method directly with the logged-in user's id, no
  // second guard or fabricated ApiKey involved (see
  // docs/2026-09-17-direct-ownership-design.md).
  @Post('notifications/email')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  @Service('email-notifications')
  @UseInterceptors(UsageLoggingInterceptor)
  sendFromDashboard(
    @CurrentUser() user: User,
    @Body() dto: CreateEmailDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.queueEmail({ userId: user.id }, dto);
  }
```

`getStatus`, `retry`, `cancel`, `findAllForUser`, `retryFromDashboard`, `cancelFromDashboard` need **no changes** — they already pass `apiKey.id`/`user.id` as bare strings into service methods whose signatures didn't change.

- [ ] **Step 2: Confirm the project builds**

Run: `pnpm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/notifications/notifications.controller.ts
git commit -m "refactor: NotificationsController dashboard route drops DashboardApiKeyGuard"
```

---

### Task 8: `UsageLoggingInterceptor` — resolve identity from `request.user` or `request.apiKey`

**Files:**
- Modify: `src/usage/interceptors/usage-logging.interceptor.ts`
- Test: `src/usage/interceptors/usage-logging.interceptor.spec.ts`

**Interfaces:**
- Consumes: Task 1's schema (`UsageLog.userId` required, `apiKeyId` optional). Runs on both `ApiKeyGuard`-protected routes (`request.apiKey` present) and now also `JwtAuthGuard`-only dashboard-native create routes (`request.user` present, no `request.apiKey`).
- Produces: writes `{ userId, apiKeyId, service, endpoint }` instead of `{ apiKeyId, service, endpoint }`. Still a no-op (no write) when neither identity is present.

- [ ] **Step 1: Update the tests first**

In `src/usage/interceptors/usage-logging.interceptor.spec.ts`, change the `contextFor` helper (lines 14-23) to also accept an optional user:

```typescript
// before
  const contextFor = (apiKey: { id: string } | undefined, path: string) => {
    const request: { apiKey?: { id: string }; route: { path: string } } = {
      apiKey,
      route: { path },
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => contextFor,
    } as unknown as ExecutionContext;
  };

// after
  const contextFor = (
    apiKey: { id: string; userId: string } | undefined,
    path: string,
    user?: { id: string },
  ) => {
    const request: {
      apiKey?: { id: string; userId: string };
      user?: { id: string };
      route: { path: string };
    } = { apiKey, user, route: { path } };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => contextFor,
    } as unknown as ExecutionContext;
  };
```

Update every existing `contextFor({ id: 'key-1' }, ...)` call in this file to `contextFor({ id: 'key-1', userId: 'user-1' }, ...)` (the "writes a UsageLog row" test at line 51, the "does not write...no @Service()" test at line 73, the "still writes...throws" test at line 92, the "subscribes to lazy PrismaPromise" test at line 110, and the "logs an error" test at line 136).

Update the expected `usageLog.create` data in the "writes a UsageLog row" test (lines 62-68) and the "still writes when the handler throws" test (lines 99-105):
```typescript
// before
expect(prisma.usageLog.create).toHaveBeenCalledWith({
  data: {
    apiKeyId: 'key-1',
    service: 'notifications',
    endpoint: '/notifications/email',
  },
});
// after
expect(prisma.usageLog.create).toHaveBeenCalledWith({
  data: {
    userId: 'user-1',
    apiKeyId: 'key-1',
    service: 'notifications',
    endpoint: '/notifications/email',
  },
});
```

Rename and adjust the "does not write a log when no ApiKey was resolved on the request" test (lines 80-87) — this is now the "neither identity" case:
```typescript
// before
it('does not write a log when no ApiKey was resolved on the request', async () => {
  reflector.get.mockReturnValue('notifications');
  const context = contextFor(undefined, '/notifications/email');

  await lastValueFrom(interceptor.intercept(context, handlerReturning({})));

  expect(prisma.usageLog.create).not.toHaveBeenCalled();
});

// after
it('does not write a log when neither an ApiKey nor a User was resolved on the request', async () => {
  reflector.get.mockReturnValue('notifications');
  const context = contextFor(undefined, '/notifications/email');

  await lastValueFrom(interceptor.intercept(context, handlerReturning({})));

  expect(prisma.usageLog.create).not.toHaveBeenCalled();
});
```

Add a new test after it:
```typescript
it('writes a UsageLog row keyed by userId with a null apiKeyId for a dashboard-native call (no ApiKey on the request)', async () => {
  reflector.get.mockReturnValue('url-shortener');
  prisma.usageLog.create.mockResolvedValue({});
  const context = contextFor(undefined, '/short-url', { id: 'user-1' });

  await lastValueFrom(interceptor.intercept(context, handlerReturning({})));

  expect(prisma.usageLog.create).toHaveBeenCalledWith({
    data: {
      userId: 'user-1',
      apiKeyId: null,
      service: 'url-shortener',
      endpoint: '/short-url',
    },
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm run test -- usage-logging.interceptor.spec.ts`
Expected: FAIL — the real interceptor still keys everything off `request.apiKey` alone and doesn't write `userId`.

- [ ] **Step 3: Update `src/usage/interceptors/usage-logging.interceptor.ts`**

```typescript
// before (lines 1-14)
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { SERVICE_KEY } from '../decorators/service.decorator';
import { ApiKey } from '../../../generated/prisma';

// after
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { SERVICE_KEY } from '../decorators/service.decorator';
import { ApiKey, User } from '../../../generated/prisma';
```

```typescript
// before (lines 25-68)
  /**
   * Writes a UsageLog row for every request handled by a route tagged with
   * @Service(), once ApiKeyGuard has resolved the caller's ApiKey. Runs
   * whether the handler succeeds or throws, and never blocks or fails the
   * request itself.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const service = this.reflector.get<string | undefined>(
      SERVICE_KEY,
      context.getHandler(),
    );
    const request = context.switchToHttp().getRequest<
      Omit<Request, 'route'> & {
        apiKey?: ApiKey;
        route: { path: string };
      }
    >();

    return next.handle().pipe(
      finalize(() => {
        if (!service || !request.apiKey) {
          return;
        }

        // Same lazy-PrismaPromise gotcha as ApiKeyGuard's lastUsedAt update:
        // `.catch()` subscribes (triggering execution) without blocking the
        // response; a bare `void` would silently drop the query.
        this.prisma.usageLog
          .create({
            data: {
              apiKeyId: request.apiKey.id,
              service,
              endpoint: request.route.path,
            },
          })
          .catch((error: unknown) => {
            this.logger.error(
              `Failed to write UsageLog for ${service}/${request.route.path}`,
              error instanceof Error ? error.stack : error,
            );
          });
      }),
    );
  }

// after
  /**
   * Writes a UsageLog row for every request handled by a route tagged with
   * @Service(), once either ApiKeyGuard (a machine call) or JwtAuthGuard (a
   * dashboard-native call) has resolved an identity for the request. Runs
   * whether the handler succeeds or throws, and never blocks or fails the
   * request itself.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const service = this.reflector.get<string | undefined>(
      SERVICE_KEY,
      context.getHandler(),
    );
    const request = context.switchToHttp().getRequest<
      Omit<Request, 'route'> & {
        apiKey?: ApiKey;
        user?: User;
        route: { path: string };
      }
    >();

    return next.handle().pipe(
      finalize(() => {
        const userId = request.user?.id ?? request.apiKey?.userId;
        if (!service || !userId) {
          return;
        }

        // Same lazy-PrismaPromise gotcha as ApiKeyGuard's lastUsedAt update:
        // `.catch()` subscribes (triggering execution) without blocking the
        // response; a bare `void` would silently drop the query.
        this.prisma.usageLog
          .create({
            data: {
              userId,
              apiKeyId: request.apiKey?.id ?? null,
              service,
              endpoint: request.route.path,
            },
          })
          .catch((error: unknown) => {
            this.logger.error(
              `Failed to write UsageLog for ${service}/${request.route.path}`,
              error instanceof Error ? error.stack : error,
            );
          });
      }),
    );
  }
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm run test -- usage-logging.interceptor.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/usage/interceptors/usage-logging.interceptor.ts src/usage/interceptors/usage-logging.interceptor.spec.ts
git commit -m "feat: UsageLoggingInterceptor logs userId directly, apiKeyId only when present"
```

---

### Task 9: `UsageService` — simplify the aggregate query, nullable `apiKeyId` in the DTO

**Files:**
- Modify: `src/usage/usage.service.ts`
- Modify: `src/usage/dto/usage-summary.dto.ts`

**Interfaces:**
- Consumes: Task 1's schema (`UsageLog.userId` required).
- Produces: `UsageSummaryDto.apiKeyId: string | null` (was `string`). `getSummaryForUser` signature unchanged.

- [ ] **Step 1: Update `src/usage/usage.service.ts`**

```typescript
// before (lines 1-33)
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { UsageSummaryDto } from './dto/usage-summary.dto';

interface UsageSummaryRow {
  service: string;
  date: Date;
  apiKeyId: string;
  count: bigint;
}

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns call counts grouped by service, day, and key, scoped to API
   * keys owned by the given user.
   *
   * @param userId - Id of the caller, to scope the aggregate to their own keys
   * @returns Usage rows ordered most-recent day first
   */
  async getSummaryForUser(userId: string): Promise<UsageSummaryDto[]> {
    // Raw SQL because Prisma's groupBy can't date-truncate createdAt down
    // to a calendar day across a related table's foreign key filter.
    const rows = await this.prisma.$queryRaw<UsageSummaryRow[]>(Prisma.sql`
      SELECT "service", DATE_TRUNC('day', "createdAt") AS "date", "apiKeyId", COUNT(*) AS "count"
      FROM "UsageLog"
      WHERE "apiKeyId" IN (SELECT "id" FROM "ApiKey" WHERE "userId" = ${userId})
      GROUP BY "service", "date", "apiKeyId"
      ORDER BY "date" DESC
    `);

// after
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { UsageSummaryDto } from './dto/usage-summary.dto';

interface UsageSummaryRow {
  service: string;
  date: Date;
  apiKeyId: string | null;
  count: bigint;
}

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns call counts grouped by service, day, and key, scoped to the
   * given user's own usage. A null `apiKeyId` group is a dashboard-native
   * call made with no API key.
   *
   * @param userId - Id of the caller, to scope the aggregate to their own usage
   * @returns Usage rows ordered most-recent day first
   */
  async getSummaryForUser(userId: string): Promise<UsageSummaryDto[]> {
    // Raw SQL because Prisma's groupBy can't date-truncate createdAt down
    // to a calendar day.
    const rows = await this.prisma.$queryRaw<UsageSummaryRow[]>(Prisma.sql`
      SELECT "service", DATE_TRUNC('day', "createdAt") AS "date", "apiKeyId", COUNT(*) AS "count"
      FROM "UsageLog"
      WHERE "userId" = ${userId}
      GROUP BY "service", "date", "apiKeyId"
      ORDER BY "date" DESC
    `);
```

The `.map(...)` below this is unchanged in shape (it already passes `row.apiKeyId` straight through).

- [ ] **Step 2: Update `src/usage/dto/usage-summary.dto.ts`**

```typescript
// before
import { Expose } from 'class-transformer';

/** One row of the caller's usage aggregate: call count for a service/day/key combination. */
export class UsageSummaryDto {
  @Expose()
  service: string;

  @Expose()
  date: string;

  @Expose()
  apiKeyId: string;

  @Expose()
  count: number;

  constructor(
    partial: Pick<UsageSummaryDto, 'service' | 'date' | 'apiKeyId' | 'count'>,
  ) {
    this.service = partial.service;
    this.date = partial.date;
    this.apiKeyId = partial.apiKeyId;
    this.count = partial.count;
  }
}

// after
import { Expose } from 'class-transformer';

/**
 * One row of the caller's usage aggregate: call count for a
 * service/day/key combination. `apiKeyId` is null for a group of
 * dashboard-native calls made with no API key.
 */
export class UsageSummaryDto {
  @Expose()
  service: string;

  @Expose()
  date: string;

  @Expose()
  apiKeyId: string | null;

  @Expose()
  count: number;

  constructor(
    partial: Pick<UsageSummaryDto, 'service' | 'date' | 'apiKeyId' | 'count'>,
  ) {
    this.service = partial.service;
    this.date = partial.date;
    this.apiKeyId = partial.apiKeyId;
    this.count = partial.count;
  }
}
```

- [ ] **Step 3: Run the existing test to confirm it still passes unmodified**

Run: `pnpm run test -- usage.service.spec.ts`
Expected: PASS — this test only mocks `$queryRaw`'s return value and checks the mapped shape/call count, so it's unaffected by the SQL text or type widening.

- [ ] **Step 4: Commit**

```bash
git add src/usage/usage.service.ts src/usage/dto/usage-summary.dto.ts
git commit -m "refactor: simplify usage aggregate query now that UsageLog.userId is direct"
```

---

### Task 10: Update e2e tests for the dashboard-native routes and simplified `where` clauses

**Files:**
- Modify: `test/short-url.e2e-spec.ts`
- Modify: `test/notifications.e2e-spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–9. This task only updates test expectations to match; no production code changes here.

- [ ] **Step 1: `test/short-url.e2e-spec.ts` — machine-route usage log assertions**

```typescript
// before (line 86-92, "shortens a URL for an authenticated caller")
expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
  data: {
    apiKeyId: 'key-1',
    service: 'url-shortener',
    endpoint: '/api/v1/short-url/shorten',
  },
});

// after
expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
  data: {
    userId: 'user-1',
    apiKeyId: 'key-1',
    service: 'url-shortener',
    endpoint: '/api/v1/short-url/shorten',
  },
});
```

```typescript
// before (line 129-135, "lists only the calling API key's own short URLs")
expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
  data: {
    apiKeyId: 'key-1',
    service: 'url-shortener',
    endpoint: '/api/v1/short-url',
  },
});

// after
expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
  data: {
    userId: 'user-1',
    apiKeyId: 'key-1',
    service: 'url-shortener',
    endpoint: '/api/v1/short-url',
  },
});
```

- [ ] **Step 2: `test/short-url.e2e-spec.ts` — dashboard listing `where` clause**

```typescript
// before (line 171-176)
expect(prismaMock.shortUrl.findMany).toHaveBeenCalledWith({
  where: { apiKey: { userId: dashboardUser.id } },
  orderBy: { createdAt: 'desc' },
  take: 20,
  skip: 0,
});

// after
expect(prismaMock.shortUrl.findMany).toHaveBeenCalledWith({
  where: { userId: dashboardUser.id },
  orderBy: { createdAt: 'desc' },
  take: 20,
  skip: 0,
});
```

- [ ] **Step 3: `test/short-url.e2e-spec.ts` — replace the system-key dashboard-create test**

```typescript
// before (lines 213-249)
  it('shortens a URL from the dashboard via the hidden system key, and reuses it on a second call', async () => {
    const systemKey = {
      id: 'system-key-1',
      userId: dashboardUser.id,
      isSystemKey: true,
    };
    prismaMock.apiKey.findFirst.mockResolvedValue(systemKey);
    prismaMock.shortUrl.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'short-1',
          createdAt: new Date('2026-09-16T00:00:00Z'),
          clickCount: 0,
          ...data,
        }),
    );

    const response = await request(app.getHttpServer())
      .post('/short-url')
      .set('Authorization', 'Bearer valid-token')
      .send({ originalUrl: 'https://example.com/from-dashboard' })
      .expect(201);

    const body = response.body as { code: string; originalUrl: string };
    expect(body.originalUrl).toBe('https://example.com/from-dashboard');
    expect(prismaMock.apiKey.findFirst).toHaveBeenCalledWith({
      where: { userId: dashboardUser.id, isSystemKey: true },
    });
    expect(prismaMock.apiKey.create).not.toHaveBeenCalled();
    expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
      data: {
        apiKeyId: 'system-key-1',
        service: 'url-shortener',
        endpoint: '/short-url',
      },
    });
  });

// after
  it('shortens a URL from the dashboard using the caller\'s userId directly, with no ApiKey lookup at all', async () => {
    prismaMock.shortUrl.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'short-1',
          createdAt: new Date('2026-09-16T00:00:00Z'),
          clickCount: 0,
          ...data,
        }),
    );

    const response = await request(app.getHttpServer())
      .post('/short-url')
      .set('Authorization', 'Bearer valid-token')
      .send({ originalUrl: 'https://example.com/from-dashboard' })
      .expect(201);

    const body = response.body as { code: string; originalUrl: string };
    expect(body.originalUrl).toBe('https://example.com/from-dashboard');
    expect(prismaMock.apiKey.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.apiKey.create).not.toHaveBeenCalled();
    expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
      data: {
        userId: dashboardUser.id,
        apiKeyId: null,
        service: 'url-shortener',
        endpoint: '/short-url',
      },
    });
  });
```

- [ ] **Step 4: `test/notifications.e2e-spec.ts` — machine-route `emailJob.create`/`usageLog.create` assertions**

```typescript
// before (lines 110-133, POST /api/v1/notifications/email)
expect(prismaMock.emailJob.create).toHaveBeenCalledWith({
  data: {
    apiKeyId: 'key-1',
    to: ['recipient@example.com'],
    subject: 'Test',
    body: '<p>Hello</p>',
  },
});
...
expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
  data: {
    apiKeyId: 'key-1',
    service: 'email-notifications',
    endpoint: '/api/v1/notifications/email',
  },
});

// after
expect(prismaMock.emailJob.create).toHaveBeenCalledWith({
  data: {
    userId: 'user-1',
    apiKeyId: 'key-1',
    to: ['recipient@example.com'],
    subject: 'Test',
    body: '<p>Hello</p>',
  },
});
...
expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
  data: {
    userId: 'user-1',
    apiKeyId: 'key-1',
    service: 'email-notifications',
    endpoint: '/api/v1/notifications/email',
  },
});
```

```typescript
// before (lines 199-206, POST .../templates/welcome/send)
expect(prismaMock.emailJob.create).toHaveBeenCalledWith({
  data: {
    apiKeyId: 'key-1',
    to: ['recipient@example.com'],
    subject: 'Welcome to Neuron, Ada!',
    body: "<p>Hi Ada,</p><p>Thanks for signing up for Neuron. We're glad to have you.</p>",
  },
});

// after
expect(prismaMock.emailJob.create).toHaveBeenCalledWith({
  data: {
    userId: 'user-1',
    apiKeyId: 'key-1',
    to: ['recipient@example.com'],
    subject: 'Welcome to Neuron, Ada!',
    body: "<p>Hi Ada,</p><p>Thanks for signing up for Neuron. We're glad to have you.</p>",
  },
});
```

- [ ] **Step 5: `test/notifications.e2e-spec.ts` — dashboard listing/retry/cancel `where` clauses**

```typescript
// before (line 372-377, GET /notifications/email dashboard)
expect(prismaMock.emailJob.findMany).toHaveBeenCalledWith({
  where: { apiKey: { userId: dashboardUser.id } },
  orderBy: { createdAt: 'desc' },
  take: 20,
  skip: 0,
});

// after
expect(prismaMock.emailJob.findMany).toHaveBeenCalledWith({
  where: { userId: dashboardUser.id },
  orderBy: { createdAt: 'desc' },
  take: 20,
  skip: 0,
});
```

```typescript
// before (line 468-470, POST .../retry dashboard)
expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith({
  where: { id: jobId, apiKey: { userId: dashboardUser.id } },
});

// after
expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith({
  where: { id: jobId, userId: dashboardUser.id },
});
```

```typescript
// before (line 500-502, DELETE .../:jobId dashboard)
expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith({
  where: { id: jobId, apiKey: { userId: dashboardUser.id } },
});

// after
expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith({
  where: { id: jobId, userId: dashboardUser.id },
});
```

- [ ] **Step 6: `test/notifications.e2e-spec.ts` — replace the system-key dashboard-create test**

```typescript
// before (lines 394-429)
    it('queues an email from the dashboard via the hidden system key, and reuses it on a second call', async () => {
      const systemKey = {
        id: 'system-key-1',
        userId: dashboardUser.id,
        isSystemKey: true,
      };
      prismaMock.apiKey.findFirst.mockResolvedValue(systemKey);
      prismaMock.emailJob.create.mockResolvedValue({
        ...baseJob,
        apiKeyId: systemKey.id,
        status: 'QUEUED',
      });

      const response = await request(app.getHttpServer())
        .post('/notifications/email')
        .set('Authorization', 'Bearer valid-token')
        .send({
          to: ['recipient@example.com'],
          subject: 'Test',
          body: '<p>Hello</p>',
        })
        .expect(202);

      expect(response.body).toMatchObject({ id: baseJob.id, status: 'QUEUED' });
      expect(prismaMock.apiKey.findFirst).toHaveBeenCalledWith({
        where: { userId: dashboardUser.id, isSystemKey: true },
      });
      expect(prismaMock.apiKey.create).not.toHaveBeenCalled();
      expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
        data: {
          apiKeyId: systemKey.id,
          service: 'email-notifications',
          endpoint: '/notifications/email',
        },
      });
    });

// after
    it('queues an email from the dashboard using the caller\'s userId directly, with no ApiKey lookup at all', async () => {
      prismaMock.emailJob.create.mockResolvedValue({
        ...baseJob,
        status: 'QUEUED',
      });

      const response = await request(app.getHttpServer())
        .post('/notifications/email')
        .set('Authorization', 'Bearer valid-token')
        .send({
          to: ['recipient@example.com'],
          subject: 'Test',
          body: '<p>Hello</p>',
        })
        .expect(202);

      expect(response.body).toMatchObject({ id: baseJob.id, status: 'QUEUED' });
      expect(prismaMock.apiKey.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.apiKey.create).not.toHaveBeenCalled();
      expect(prismaMock.usageLog.create).toHaveBeenCalledWith({
        data: {
          userId: dashboardUser.id,
          apiKeyId: null,
          service: 'email-notifications',
          endpoint: '/notifications/email',
        },
      });
    });
```

Note: `beforeEach` (line 44-48) still sets a default `prismaMock.apiKey.findFirst` return value for the machine-route tests earlier in the file — that's fine and untouched; this dashboard test just asserts it was never *called*.

- [ ] **Step 7: Run both full e2e files**

Run: `pnpm run test:e2e -- short-url.e2e-spec.ts`
Run: `pnpm run test:e2e -- notifications.e2e-spec.ts`
Expected: PASS for both.

- [ ] **Step 8: Commit**

```bash
git add test/short-url.e2e-spec.ts test/notifications.e2e-spec.ts
git commit -m "test: update e2e suites for direct userId ownership, no more system key"
```

---

### Task 11: Full-suite verification, real-stack check, and CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything from Tasks 1–10.
- Produces: nothing new — this is verification plus the project's established practice of documenting each completed unit of work in `CLAUDE.md`'s "Current state" section.

- [ ] **Step 1: Run the full unit test suite**

Run: `pnpm run test`
Expected: PASS, zero failures.

- [ ] **Step 2: Run the full e2e suite**

Run: `pnpm run test:e2e`
Expected: PASS, zero failures.

- [ ] **Step 3: Lint and build**

Run: `pnpm run lint`
Run: `pnpm run build`
Expected: both PASS with zero errors/warnings.

- [ ] **Step 4: Confirm `api-versioning.spec.ts` still passes unmodified**

Run: `pnpm run test -- api-versioning.spec.ts`
Expected: PASS — no guard metadata changed on any route (only what's inside the guarded handlers changed), so this reflection-based test needs no edits.

- [ ] **Step 5: Real-stack verification via `docker compose up`**

Per this project's established practice (see CLAUDE.md's many "Verified against the real Supabase Postgres DB via `docker compose up`" precedents):

1. `docker compose up --build -d`
2. Confirm the migration from Task 1 applied cleanly against the real dev DB (rerun the Step 5 verification queries from Task 1 if not already done there).
3. Mint a dashboard JWT locally the same way prior phases did (no non-interactive path through real Google OAuth exists in this environment — see CLAUDE.md's Phase 5 verification notes for the exact `jsonwebtoken` + seeded user id approach).
4. Confirm a pre-existing (pre-migration) dashboard-created URL/email — if any exist in the dev DB — still lists correctly with the right owner post-migration.
5. `POST /short-url` and `POST /notifications/email` with that dashboard JWT and no `x-api-key`: confirm both succeed, and confirm `GET /usage` shows the resulting rows with `apiKeyId: null`.
6. Create a real API key, call `POST /api/v1/short-url/shorten` and `POST /api/v1/notifications/email` with it: confirm both succeed and `GET /usage` shows those rows with a real `apiKeyId`.
7. Confirm `GET /api-keys` never shows a `Dashboard`-named key (there is none to show anymore, since Task 1 deleted every `isSystemKey` row).
8. `docker compose down`.

- [ ] **Step 6: Update `CLAUDE.md`**

Append a new paragraph to the end of the "Current state" section (after the "A real bug surfaced..." paragraph about the `onActive`/`onCompleted` race), documenting:
- What changed: the system-key bridge (`DashboardApiKeyGuard`, `getOrCreateSystemKey`, `ApiKey.isSystemKey`) was removed in favor of a required `userId` column (backfilled from the prior `apiKeyId` join) on `ShortUrl`/`EmailJob`/`UsageLog`, with `apiKeyId` becoming optional metadata (`ON DELETE SET NULL` instead of `CASCADE`).
- Why: reference `docs/2026-09-17-direct-ownership-design.md` and the reasoning that the distinction already needed filtering-back-out (`isSystemKey: false` in `findAllForUser`/`revoke`) and that the project is no longer scoped as single-user only.
- What was verified: the real facts from Step 5 above — which queries/routes were exercised, what the migration confirmed on the real Supabase DB, and any real bug or surprise hit along the way (if any occurred during Steps 1-5, name it; if verification went cleanly with no surprises, say so plainly rather than inventing one).

Also update the "Architecture (planned)" section's bullet on API keys/usage logging if it still describes ownership as flowing only through `ApiKeyId` — check the "Usage logging is cross-cutting" and "API keys are hashed at rest" bullets against the new reality and correct any that now describe the old model.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document direct-ownership refactor in CLAUDE.md"
```

## Self-Review Notes

- **Spec coverage:** every section of `docs/2026-09-17-direct-ownership-design.md` maps to a task — schema/migration (Task 1), guards/decorators (Tasks 3, 5, 7), service signatures (Tasks 4, 6), interceptor (Task 8), usage query (Task 9), removed code (Tasks 2, 3), testing (Tasks 1–10), rollout (Task 11).
- **Type consistency checked:** `{ userId: string; apiKeyId?: string }` is the exact owner-object shape used consistently across `ShortUrlService.create`, `NotificationsService.queueEmail`/`sendTemplatedEmail`/`createAndQueueJob`, and both controllers' call sites.
- **Scoped correctly:** `getStatus`/`retry`/`cancel` (machine, keyed by a single `apiKeyId`) are explicitly called out as unchanged in Task 6 — only the *creating* methods and the *cross-key* dashboard scopes (`findAllForUser`, `retryForUser`, `cancelForUser`) change, since those are the only places either inserting a new row (needs `userId` now) or joining through `apiKey.userId` (now redundant with the direct column).
