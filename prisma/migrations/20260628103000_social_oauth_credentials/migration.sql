DO $$ BEGIN
  CREATE TYPE "SocialConnectorProvider" AS ENUM ('YOUTUBE', 'META_FACEBOOK', 'META_INSTAGRAM', 'TIKTOK', 'THREADS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SocialConnectorStatus" AS ENUM ('CONNECTED', 'NEEDS_REAUTH', 'ERROR', 'DISABLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SocialCredential" (
  "id" TEXT NOT NULL,
  "socialAccountId" TEXT,
  "provider" "SocialConnectorProvider" NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "accountName" TEXT,
  "handle" TEXT,
  "accessTokenCiphertext" TEXT NOT NULL,
  "refreshTokenCiphertext" TEXT,
  "tokenType" TEXT,
  "scopesJson" JSONB,
  "metadataJson" JSONB,
  "expiresAt" TIMESTAMP(3),
  "status" "SocialConnectorStatus" NOT NULL DEFAULT 'CONNECTED',
  "lastSyncAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SocialCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SocialCredential_provider_externalAccountId_key" ON "SocialCredential"("provider", "externalAccountId");
CREATE INDEX IF NOT EXISTS "SocialCredential_socialAccountId_idx" ON "SocialCredential"("socialAccountId");
CREATE INDEX IF NOT EXISTS "SocialCredential_provider_idx" ON "SocialCredential"("provider");
CREATE INDEX IF NOT EXISTS "SocialCredential_status_idx" ON "SocialCredential"("status");
CREATE INDEX IF NOT EXISTS "SocialCredential_lastSyncAt_idx" ON "SocialCredential"("lastSyncAt");

DO $$ BEGIN
  ALTER TABLE "SocialCredential"
  ADD CONSTRAINT "SocialCredential_socialAccountId_fkey"
  FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
