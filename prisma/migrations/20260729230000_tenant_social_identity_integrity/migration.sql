-- Social provider identities belong to a church organization. The same
-- provider account may be connected independently by different organizations,
-- but can appear only once inside an organization.
UPDATE "SocialAccount"
SET "organizationId" = 'org_local_default'
WHERE "organizationId" IS NULL;

UPDATE "SocialCredential"
SET "organizationId" = 'org_local_default'
WHERE "organizationId" IS NULL;

UPDATE "SocialMetricSnapshot"
SET "organizationId" = 'org_local_default'
WHERE "organizationId" IS NULL;

ALTER TABLE "SocialAccount"
  ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "SocialCredential"
  ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "SocialMetricSnapshot"
  ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "SocialAccount"
  DROP CONSTRAINT IF EXISTS "SocialAccount_externalProvider_externalAccountId_key";

ALTER TABLE "SocialCredential"
  DROP CONSTRAINT IF EXISTS "SocialCredential_provider_externalAccountId_key";

ALTER TABLE "SocialMetricSnapshot"
  DROP CONSTRAINT IF EXISTS "SocialMetricSnapshot_dedupeKey_key";

CREATE UNIQUE INDEX "SocialAccount_org_provider_identity_key"
  ON "SocialAccount"("organizationId", "externalProvider", "externalAccountId");

CREATE UNIQUE INDEX "SocialAccount_id_organizationId_key"
  ON "SocialAccount"("id", "organizationId");

CREATE UNIQUE INDEX "SocialCredential_org_provider_identity_key"
  ON "SocialCredential"("organizationId", "provider", "externalAccountId");

CREATE UNIQUE INDEX "SocialMetricSnapshot_org_dedupe_key"
  ON "SocialMetricSnapshot"("organizationId", "dedupeKey");

ALTER TABLE "SocialAccount"
  DROP CONSTRAINT IF EXISTS "SocialAccount_campusId_fkey";

ALTER TABLE "SocialCredential"
  DROP CONSTRAINT IF EXISTS "SocialCredential_campusId_fkey";

ALTER TABLE "SocialMetricSnapshot"
  DROP CONSTRAINT IF EXISTS "SocialMetricSnapshot_campusId_fkey";

ALTER TABLE "SocialCredential"
  DROP CONSTRAINT IF EXISTS "SocialCredential_socialAccountId_fkey";

ALTER TABLE "SocialMetricSnapshot"
  DROP CONSTRAINT IF EXISTS "SocialMetricSnapshot_socialAccountId_fkey";

ALTER TABLE "SocialAccount"
  ADD CONSTRAINT "SocialAccount_campusId_organizationId_fkey"
  FOREIGN KEY ("campusId", "organizationId")
  REFERENCES "Campus"("id", "organizationId")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "SocialCredential"
  ADD CONSTRAINT "SocialCredential_campusId_organizationId_fkey"
  FOREIGN KEY ("campusId", "organizationId")
  REFERENCES "Campus"("id", "organizationId")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "SocialMetricSnapshot"
  ADD CONSTRAINT "SocialMetricSnapshot_campusId_organizationId_fkey"
  FOREIGN KEY ("campusId", "organizationId")
  REFERENCES "Campus"("id", "organizationId")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "SocialCredential"
  ADD CONSTRAINT "SocialCredential_socialAccountId_organizationId_fkey"
  FOREIGN KEY ("socialAccountId", "organizationId")
  REFERENCES "SocialAccount"("id", "organizationId")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "SocialMetricSnapshot"
  ADD CONSTRAINT "SocialMetricSnapshot_socialAccountId_organizationId_fkey"
  FOREIGN KEY ("socialAccountId", "organizationId")
  REFERENCES "SocialAccount"("id", "organizationId")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
