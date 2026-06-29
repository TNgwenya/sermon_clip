ALTER TABLE "SocialAccount" ADD COLUMN IF NOT EXISTS "externalProvider" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN IF NOT EXISTS "externalAccountId" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN IF NOT EXISTS "externalPlatform" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN IF NOT EXISTS "profileUrl" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN IF NOT EXISTS "metadataJson" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "SocialAccount_externalProvider_externalAccountId_key"
  ON "SocialAccount"("externalProvider", "externalAccountId");
CREATE INDEX IF NOT EXISTS "SocialAccount_externalProvider_idx" ON "SocialAccount"("externalProvider");
CREATE INDEX IF NOT EXISTS "SocialAccount_externalAccountId_idx" ON "SocialAccount"("externalAccountId");

ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "mediaObjectKey" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "mediaPublicUrl" TEXT;
ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "mediaUploadedAt" TIMESTAMP(3);
