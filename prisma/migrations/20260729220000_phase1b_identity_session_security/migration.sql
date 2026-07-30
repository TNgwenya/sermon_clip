CREATE TYPE "MfaFactorType" AS ENUM ('TOTP');

CREATE TYPE "SecurityTokenPurpose" AS ENUM (
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'ACCOUNT_RECOVERY'
);

CREATE TABLE "PasswordCredential" (
  "userId" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PasswordCredential_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "UserIdentity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "emailAtProvider" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserSession" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campusId" TEXT,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "idleExpiresAt" TIMESTAMP(3) NOT NULL,
  "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  "ipAddressHash" TEXT,
  "userAgentHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MfaFactor" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "MfaFactorType" NOT NULL DEFAULT 'TOTP',
  "label" TEXT,
  "secretCiphertext" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MfaFactor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MfaRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "factorId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SecurityToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" "SecurityTokenPurpose" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SecurityToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserIdentity_provider_subject_key"
  ON "UserIdentity"("provider", "subject");
CREATE UNIQUE INDEX "UserIdentity_userId_provider_key"
  ON "UserIdentity"("userId", "provider");
CREATE INDEX "UserIdentity_userId_idx"
  ON "UserIdentity"("userId");

CREATE UNIQUE INDEX "UserSession_tokenHash_key"
  ON "UserSession"("tokenHash");
CREATE INDEX "UserSession_userId_revokedAt_absoluteExpiresAt_idx"
  ON "UserSession"("userId", "revokedAt", "absoluteExpiresAt");
CREATE INDEX "UserSession_organizationId_revokedAt_absoluteExpiresAt_idx"
  ON "UserSession"("organizationId", "revokedAt", "absoluteExpiresAt");
CREATE INDEX "UserSession_campusId_revokedAt_absoluteExpiresAt_idx"
  ON "UserSession"("campusId", "revokedAt", "absoluteExpiresAt");
CREATE INDEX "UserSession_idleExpiresAt_idx"
  ON "UserSession"("idleExpiresAt");

CREATE INDEX "PasswordCredential_lockedUntil_idx"
  ON "PasswordCredential"("lockedUntil");

CREATE UNIQUE INDEX "MfaFactor_id_userId_key"
  ON "MfaFactor"("id", "userId");
CREATE INDEX "MfaFactor_userId_disabledAt_idx"
  ON "MfaFactor"("userId", "disabledAt");

CREATE UNIQUE INDEX "MfaRecoveryCode_codeHash_key"
  ON "MfaRecoveryCode"("codeHash");
CREATE INDEX "MfaRecoveryCode_userId_usedAt_idx"
  ON "MfaRecoveryCode"("userId", "usedAt");
CREATE INDEX "MfaRecoveryCode_factorId_usedAt_idx"
  ON "MfaRecoveryCode"("factorId", "usedAt");

CREATE UNIQUE INDEX "SecurityToken_tokenHash_key"
  ON "SecurityToken"("tokenHash");
CREATE INDEX "SecurityToken_userId_purpose_createdAt_idx"
  ON "SecurityToken"("userId", "purpose", "createdAt");
CREATE INDEX "SecurityToken_purpose_expiresAt_idx"
  ON "SecurityToken"("purpose", "expiresAt");

ALTER TABLE "PasswordCredential"
  ADD CONSTRAINT "PasswordCredential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserIdentity"
  ADD CONSTRAINT "UserIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserSession"
  ADD CONSTRAINT "UserSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSession"
  ADD CONSTRAINT "UserSession_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSession"
  ADD CONSTRAINT "UserSession_campusId_organizationId_fkey"
  FOREIGN KEY ("campusId", "organizationId")
  REFERENCES "Campus"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MfaFactor"
  ADD CONSTRAINT "MfaFactor_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MfaRecoveryCode"
  ADD CONSTRAINT "MfaRecoveryCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MfaRecoveryCode"
  ADD CONSTRAINT "MfaRecoveryCode_factorId_userId_fkey"
  FOREIGN KEY ("factorId", "userId")
  REFERENCES "MfaFactor"("id", "userId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SecurityToken"
  ADD CONSTRAINT "SecurityToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
