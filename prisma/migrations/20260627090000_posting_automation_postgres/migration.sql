DO $$ BEGIN
  CREATE TYPE "PostingAutomationMode" AS ENUM ('MANUAL', 'AUTOMATIC');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ScheduledPostWorkerStatus" AS ENUM ('IDLE', 'SYNCED', 'CLAIMED', 'POSTING', 'SUCCEEDED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "ScheduledPostStatus" ADD VALUE IF NOT EXISTS 'POSTING';
ALTER TYPE "ScheduledPostStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "ScheduledPostStatus" ADD VALUE IF NOT EXISTS 'PRIVATE_ONLY_UNVERIFIED';

ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "automationMode" "PostingAutomationMode" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "timezone" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "workerStatus" "ScheduledPostWorkerStatus" NOT NULL DEFAULT 'IDLE';
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "workerId" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3);
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "externalPostId" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "publishedUrl" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "publishError" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "finalPrivacyStatus" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

UPDATE "ScheduledPost"
SET "idempotencyKey" = CONCAT("id", ':', "platform", ':', COALESCE("scheduledFor"::TEXT, 'manual'))
WHERE "idempotencyKey" IS NULL OR "idempotencyKey" = '';

ALTER TABLE "ScheduledPost" ALTER COLUMN "idempotencyKey" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ScheduledPost_idempotencyKey_key" ON "ScheduledPost"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "ScheduledPost_automationMode_idx" ON "ScheduledPost"("automationMode");
CREATE INDEX IF NOT EXISTS "ScheduledPost_workerStatus_idx" ON "ScheduledPost"("workerStatus");
