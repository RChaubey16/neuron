-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "isSystemKey" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
-- Partial unique index (Prisma's schema DSL has no filtered-@@unique
-- construct): guards against a concurrent-request race creating two system
-- keys for the same user, which would silently split their
-- dashboard-originated usage/resources across both.
CREATE UNIQUE INDEX "ApiKey_userId_system_key_unique"
  ON "ApiKey"("userId") WHERE "isSystemKey" = true;
