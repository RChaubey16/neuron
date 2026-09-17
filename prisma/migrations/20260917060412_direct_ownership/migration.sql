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
