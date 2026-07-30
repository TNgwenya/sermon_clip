-- Phase 1 tenancy and identity foundation.
--
-- Compatibility strategy:
--   1. Establish a bridge organization, campus, and owner for the current
--      single-tenant installation.
--   2. Add tenant keys to existing customer-owned roots as nullable columns,
--      backfill every existing row, and retain a temporary organization
--      default so legacy create paths continue to work during the rollout.
--   3. BrandingSettings is the first fully organization-owned vertical slice:
--      its organizationId is backfilled, made NOT NULL, and made unique.
--   4. A later isolation-hardening migration must remove bridge defaults and
--      make the remaining organizationId columns NOT NULL after all writers
--      explicitly supply request-scoped tenant context.

CREATE TYPE "OrganizationStatus" AS ENUM (
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED'
);

CREATE TYPE "CampusStatus" AS ENUM (
  'ACTIVE',
  'INACTIVE',
  'ARCHIVED'
);

CREATE TYPE "UserStatus" AS ENUM (
  'INVITED',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED'
);

CREATE TYPE "MembershipRole" AS ENUM (
  'OWNER',
  'ORG_ADMIN',
  'CAMPUS_ADMIN',
  'PASTOR_APPROVER',
  'CONTENT_LEAD',
  'EDITOR',
  'PUBLISHER',
  'ANALYST',
  'VIEWER',
  'EXTERNAL_CONTRACTOR'
);

CREATE TYPE "MembershipStatus" AS ENUM (
  'INVITED',
  'ACTIVE',
  'SUSPENDED',
  'REVOKED'
);

CREATE TYPE "InvitationStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'REVOKED',
  'EXPIRED'
);

CREATE TYPE "AuditActorType" AS ENUM (
  'USER',
  'SYSTEM',
  'SUPPORT',
  'API'
);

CREATE TYPE "OwnershipTransferStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'CANCELLED',
  'EXPIRED'
);

CREATE TYPE "EntitlementSource" AS ENUM (
  'PLAN',
  'TRIAL',
  'PROMOTION',
  'MANUAL'
);

CREATE TABLE "Organization" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
  "dataRegion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Campus" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "CampusStatus" NOT NULL DEFAULT 'ACTIVE',
  "timezone" TEXT,
  "addressJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Campus_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "normalizedEmail" TEXT NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
  "authProvider" TEXT,
  "authSubject" TEXT,
  "emailVerifiedAt" TIMESTAMP(3),
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  "avatarUrl" TEXT,
  "jobTitle" TEXT,
  "phone" TEXT,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "timezone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Membership" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campusId" TEXT,
  "userId" TEXT NOT NULL,
  "role" "MembershipRole" NOT NULL,
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "joinedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invitation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campusId" TEXT,
  "email" TEXT NOT NULL,
  "normalizedEmail" TEXT NOT NULL,
  "role" "MembershipRole" NOT NULL,
  "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "tokenHash" TEXT NOT NULL,
  "invitedByUserId" TEXT,
  "acceptedByUserId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campusId" TEXT,
  "actorType" "AuditActorType" NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "requestId" TEXT,
  "ipAddressHash" TEXT,
  "userAgent" TEXT,
  "metadataJson" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OwnershipTransfer" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campusId" TEXT,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "initiatedByUserId" TEXT NOT NULL,
  "status" "OwnershipTransferStatus" NOT NULL DEFAULT 'PENDING',
  "tokenHash" TEXT NOT NULL,
  "reason" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OwnershipTransfer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationEntitlement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "limitValue" BIGINT,
  "valueJson" JSONB,
  "source" "EntitlementSource" NOT NULL DEFAULT 'PLAN',
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrganizationEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campusId" TEXT,
  "metric" TEXT NOT NULL,
  "quantity" BIGINT NOT NULL DEFAULT 1,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "idempotencyKey" TEXT,
  "metadataJson" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key"
  ON "Organization"("slug");
CREATE INDEX "Organization_status_idx"
  ON "Organization"("status");
CREATE INDEX "Organization_createdAt_idx"
  ON "Organization"("createdAt");

CREATE UNIQUE INDEX "Campus_organizationId_slug_key"
  ON "Campus"("organizationId", "slug");
CREATE INDEX "Campus_organizationId_status_idx"
  ON "Campus"("organizationId", "status");

CREATE UNIQUE INDEX "User_email_key"
  ON "User"("email");
CREATE UNIQUE INDEX "User_normalizedEmail_key"
  ON "User"("normalizedEmail");
CREATE UNIQUE INDEX "User_authProvider_authSubject_key"
  ON "User"("authProvider", "authSubject");
CREATE INDEX "User_status_idx"
  ON "User"("status");
CREATE INDEX "User_createdAt_idx"
  ON "User"("createdAt");

CREATE UNIQUE INDEX "UserProfile_userId_key"
  ON "UserProfile"("userId");

CREATE UNIQUE INDEX "Membership_organizationId_userId_campusId_key"
  ON "Membership"("organizationId", "userId", "campusId");
-- PostgreSQL treats NULL values as distinct in ordinary unique indexes. This
-- partial index closes that gap for organization-wide memberships.
CREATE UNIQUE INDEX "Membership_organizationId_userId_org_scope_key"
  ON "Membership"("organizationId", "userId")
  WHERE "campusId" IS NULL;
CREATE INDEX "Membership_organizationId_role_status_idx"
  ON "Membership"("organizationId", "role", "status");
CREATE INDEX "Membership_campusId_role_status_idx"
  ON "Membership"("campusId", "role", "status");
CREATE INDEX "Membership_userId_status_idx"
  ON "Membership"("userId", "status");
CREATE INDEX "Membership_expiresAt_idx"
  ON "Membership"("expiresAt");

CREATE UNIQUE INDEX "Invitation_tokenHash_key"
  ON "Invitation"("tokenHash");
CREATE INDEX "Invitation_organizationId_normalizedEmail_status_idx"
  ON "Invitation"("organizationId", "normalizedEmail", "status");
CREATE INDEX "Invitation_campusId_status_idx"
  ON "Invitation"("campusId", "status");
CREATE INDEX "Invitation_expiresAt_status_idx"
  ON "Invitation"("expiresAt", "status");
CREATE UNIQUE INDEX "Invitation_pending_org_scope_email_key"
  ON "Invitation"("organizationId", "normalizedEmail")
  WHERE "campusId" IS NULL AND "status" = 'PENDING';
CREATE UNIQUE INDEX "Invitation_pending_campus_scope_email_key"
  ON "Invitation"("organizationId", "campusId", "normalizedEmail")
  WHERE "campusId" IS NOT NULL AND "status" = 'PENDING';

CREATE INDEX "AuditEvent_organizationId_occurredAt_idx"
  ON "AuditEvent"("organizationId", "occurredAt");
CREATE INDEX "AuditEvent_organizationId_targetType_targetId_idx"
  ON "AuditEvent"("organizationId", "targetType", "targetId");
CREATE INDEX "AuditEvent_actorUserId_occurredAt_idx"
  ON "AuditEvent"("actorUserId", "occurredAt");
CREATE INDEX "AuditEvent_requestId_idx"
  ON "AuditEvent"("requestId");

CREATE UNIQUE INDEX "OwnershipTransfer_tokenHash_key"
  ON "OwnershipTransfer"("tokenHash");
CREATE INDEX "OwnershipTransfer_organizationId_status_idx"
  ON "OwnershipTransfer"("organizationId", "status");
CREATE INDEX "OwnershipTransfer_fromUserId_status_idx"
  ON "OwnershipTransfer"("fromUserId", "status");
CREATE INDEX "OwnershipTransfer_toUserId_status_idx"
  ON "OwnershipTransfer"("toUserId", "status");
CREATE INDEX "OwnershipTransfer_expiresAt_status_idx"
  ON "OwnershipTransfer"("expiresAt", "status");
CREATE UNIQUE INDEX "OwnershipTransfer_one_pending_per_organization_key"
  ON "OwnershipTransfer"("organizationId")
  WHERE "status" = 'PENDING';

CREATE UNIQUE INDEX "OrganizationEntitlement_organizationId_key_key"
  ON "OrganizationEntitlement"("organizationId", "key");
CREATE INDEX "OrganizationEntitlement_organizationId_enabled_idx"
  ON "OrganizationEntitlement"("organizationId", "enabled");
CREATE INDEX "OrganizationEntitlement_expiresAt_idx"
  ON "OrganizationEntitlement"("expiresAt");

CREATE UNIQUE INDEX "UsageEvent_idempotencyKey_key"
  ON "UsageEvent"("idempotencyKey");
CREATE INDEX "UsageEvent_organizationId_metric_occurredAt_idx"
  ON "UsageEvent"("organizationId", "metric", "occurredAt");
CREATE INDEX "UsageEvent_campusId_metric_occurredAt_idx"
  ON "UsageEvent"("campusId", "metric", "occurredAt");
CREATE INDEX "UsageEvent_sourceType_sourceId_idx"
  ON "UsageEvent"("sourceType", "sourceId");

ALTER TABLE "Campus"
  ADD CONSTRAINT "Campus_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserProfile"
  ADD CONSTRAINT "UserProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OwnershipTransfer"
  ADD CONSTRAINT "OwnershipTransfer_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnershipTransfer"
  ADD CONSTRAINT "OwnershipTransfer_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OwnershipTransfer"
  ADD CONSTRAINT "OwnershipTransfer_fromUserId_fkey"
  FOREIGN KEY ("fromUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnershipTransfer"
  ADD CONSTRAINT "OwnershipTransfer_toUserId_fkey"
  FOREIGN KEY ("toUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnershipTransfer"
  ADD CONSTRAINT "OwnershipTransfer_initiatedByUserId_fkey"
  FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrganizationEntitlement"
  ADD CONSTRAINT "OrganizationEntitlement_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UsageEvent"
  ADD CONSTRAINT "UsageEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UsageEvent"
  ADD CONSTRAINT "UsageEvent_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Organization" (
  "id",
  "slug",
  "name",
  "status",
  "timezone",
  "defaultLanguage",
  "createdAt",
  "updatedAt"
) VALUES (
  'org_local_default',
  'local',
  'SermonClip Local',
  'ACTIVE',
  'Africa/Johannesburg',
  'en',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT INTO "Campus" (
  "id",
  "organizationId",
  "slug",
  "name",
  "status",
  "timezone",
  "createdAt",
  "updatedAt"
) VALUES (
  'campus_local_default',
  'org_local_default',
  'main',
  'Main Campus',
  'ACTIVE',
  'Africa/Johannesburg',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT INTO "User" (
  "id",
  "email",
  "normalizedEmail",
  "status",
  "emailVerifiedAt",
  "createdAt",
  "updatedAt"
) VALUES (
  'user_local_bootstrap',
  'owner@local.sermonclip.invalid',
  'owner@local.sermonclip.invalid',
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT INTO "UserProfile" (
  "id",
  "userId",
  "displayName",
  "jobTitle",
  "timezone",
  "createdAt",
  "updatedAt"
) VALUES (
  'profile_local_bootstrap',
  'user_local_bootstrap',
  'SermonClip Owner',
  'Owner',
  'Africa/Johannesburg',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT INTO "Membership" (
  "id",
  "organizationId",
  "userId",
  "role",
  "status",
  "joinedAt",
  "createdAt",
  "updatedAt"
) VALUES (
  'membership_local_bootstrap',
  'org_local_default',
  'user_local_bootstrap',
  'OWNER',
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Add transitional tenant keys to all current customer-owned roots.
ALTER TABLE "Sermon"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "BrandingSettings"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "ContentOpportunity"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "ContentFunnelEvent"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "ContentAsset"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "SocialAccount"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "SocialCredential"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "PostingDraft"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "ScheduledPost"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "AiInvocation"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "AiResponseCache"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "SocialMetricSnapshot"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "PostPerformancePrediction"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "GrowthRecommendation"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "GrowthCampaign"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "GrowthTrend"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "GrowthGuardrailReview"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;
ALTER TABLE "MinistryOutcome"
  ADD COLUMN "organizationId" TEXT DEFAULT 'org_local_default',
  ADD COLUMN "campusId" TEXT;

-- Explicit data updates keep the migration intent visible and make the
-- backfill safe if a database engine/version does not rewrite rows on ADD.
UPDATE "Sermon"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "BrandingSettings"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "ContentOpportunity"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "ContentFunnelEvent"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "ContentAsset"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "SocialAccount"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "SocialCredential"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "PostingDraft"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "ScheduledPost"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "AiInvocation"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "AiResponseCache"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "SocialMetricSnapshot"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "PostPerformancePrediction"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "GrowthRecommendation"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "GrowthCampaign"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "GrowthTrend"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "GrowthGuardrailReview"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;
UPDATE "MinistryOutcome"
SET "organizationId" = 'org_local_default',
    "campusId" = 'campus_local_default'
WHERE "organizationId" IS NULL OR "campusId" IS NULL;

-- BrandingSettings no longer uses a globally fixed ID. The existing "local"
-- ID remains valid; new IDs are generated by Prisma with cuid().
ALTER TABLE "BrandingSettings"
  ALTER COLUMN "id" DROP DEFAULT,
  ALTER COLUMN "organizationId" SET NOT NULL;

CREATE UNIQUE INDEX "BrandingSettings_organizationId_key"
  ON "BrandingSettings"("organizationId");
CREATE INDEX "BrandingSettings_campusId_idx"
  ON "BrandingSettings"("campusId");

CREATE INDEX "Sermon_organizationId_createdAt_idx"
  ON "Sermon"("organizationId", "createdAt");
CREATE INDEX "Sermon_campusId_createdAt_idx"
  ON "Sermon"("campusId", "createdAt");
CREATE INDEX "ContentOpportunity_organizationId_status_createdAt_idx"
  ON "ContentOpportunity"("organizationId", "status", "createdAt");
CREATE INDEX "ContentOpportunity_campusId_status_createdAt_idx"
  ON "ContentOpportunity"("campusId", "status", "createdAt");
CREATE INDEX "ContentFunnelEvent_organizationId_occurredAt_idx"
  ON "ContentFunnelEvent"("organizationId", "occurredAt");
CREATE INDEX "ContentFunnelEvent_campusId_occurredAt_idx"
  ON "ContentFunnelEvent"("campusId", "occurredAt");
CREATE INDEX "ContentAsset_organizationId_status_createdAt_idx"
  ON "ContentAsset"("organizationId", "status", "createdAt");
CREATE INDEX "ContentAsset_campusId_status_createdAt_idx"
  ON "ContentAsset"("campusId", "status", "createdAt");
CREATE INDEX "SocialAccount_organizationId_platform_status_idx"
  ON "SocialAccount"("organizationId", "platform", "status");
CREATE INDEX "SocialAccount_campusId_platform_status_idx"
  ON "SocialAccount"("campusId", "platform", "status");
CREATE INDEX "SocialCredential_organizationId_provider_status_idx"
  ON "SocialCredential"("organizationId", "provider", "status");
CREATE INDEX "SocialCredential_campusId_provider_status_idx"
  ON "SocialCredential"("campusId", "provider", "status");
CREATE INDEX "PostingDraft_organizationId_status_createdAt_idx"
  ON "PostingDraft"("organizationId", "status", "createdAt");
CREATE INDEX "PostingDraft_campusId_status_createdAt_idx"
  ON "PostingDraft"("campusId", "status", "createdAt");
CREATE INDEX "ScheduledPost_organizationId_status_scheduledFor_idx"
  ON "ScheduledPost"("organizationId", "status", "scheduledFor");
CREATE INDEX "ScheduledPost_campusId_status_scheduledFor_idx"
  ON "ScheduledPost"("campusId", "status", "scheduledFor");
CREATE INDEX "AiInvocation_organizationId_createdAt_idx"
  ON "AiInvocation"("organizationId", "createdAt");
CREATE INDEX "AiInvocation_campusId_createdAt_idx"
  ON "AiInvocation"("campusId", "createdAt");
CREATE INDEX "AiResponseCache_organizationId_operation_idx"
  ON "AiResponseCache"("organizationId", "operation");
CREATE INDEX "AiResponseCache_campusId_operation_idx"
  ON "AiResponseCache"("campusId", "operation");
CREATE INDEX "SocialMetricSnapshot_organizationId_capturedAt_idx"
  ON "SocialMetricSnapshot"("organizationId", "capturedAt");
CREATE INDEX "SocialMetricSnapshot_campusId_capturedAt_idx"
  ON "SocialMetricSnapshot"("campusId", "capturedAt");
CREATE INDEX "PostPerformancePrediction_organizationId_createdAt_idx"
  ON "PostPerformancePrediction"("organizationId", "createdAt");
CREATE INDEX "PostPerformancePrediction_campusId_createdAt_idx"
  ON "PostPerformancePrediction"("campusId", "createdAt");
CREATE INDEX "GrowthRecommendation_organizationId_status_createdAt_idx"
  ON "GrowthRecommendation"("organizationId", "status", "createdAt");
CREATE INDEX "GrowthRecommendation_campusId_status_createdAt_idx"
  ON "GrowthRecommendation"("campusId", "status", "createdAt");
CREATE INDEX "GrowthCampaign_organizationId_status_createdAt_idx"
  ON "GrowthCampaign"("organizationId", "status", "createdAt");
CREATE INDEX "GrowthCampaign_campusId_status_createdAt_idx"
  ON "GrowthCampaign"("campusId", "status", "createdAt");
CREATE INDEX "GrowthTrend_organizationId_detectedAt_idx"
  ON "GrowthTrend"("organizationId", "detectedAt");
CREATE INDEX "GrowthTrend_campusId_detectedAt_idx"
  ON "GrowthTrend"("campusId", "detectedAt");
CREATE INDEX "GrowthGuardrailReview_organizationId_reviewedAt_idx"
  ON "GrowthGuardrailReview"("organizationId", "reviewedAt");
CREATE INDEX "GrowthGuardrailReview_campusId_reviewedAt_idx"
  ON "GrowthGuardrailReview"("campusId", "reviewedAt");
CREATE INDEX "MinistryOutcome_organizationId_occurredAt_idx"
  ON "MinistryOutcome"("organizationId", "occurredAt");
CREATE INDEX "MinistryOutcome_campusId_occurredAt_idx"
  ON "MinistryOutcome"("campusId", "occurredAt");

ALTER TABLE "BrandingSettings"
  ADD CONSTRAINT "BrandingSettings_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrandingSettings"
  ADD CONSTRAINT "BrandingSettings_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Sermon"
  ADD CONSTRAINT "Sermon_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sermon"
  ADD CONSTRAINT "Sermon_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContentOpportunity"
  ADD CONSTRAINT "ContentOpportunity_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentOpportunity"
  ADD CONSTRAINT "ContentOpportunity_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContentFunnelEvent"
  ADD CONSTRAINT "ContentFunnelEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentFunnelEvent"
  ADD CONSTRAINT "ContentFunnelEvent_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContentAsset"
  ADD CONSTRAINT "ContentAsset_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentAsset"
  ADD CONSTRAINT "ContentAsset_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SocialAccount"
  ADD CONSTRAINT "SocialAccount_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SocialAccount"
  ADD CONSTRAINT "SocialAccount_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SocialCredential"
  ADD CONSTRAINT "SocialCredential_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SocialCredential"
  ADD CONSTRAINT "SocialCredential_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PostingDraft"
  ADD CONSTRAINT "PostingDraft_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostingDraft"
  ADD CONSTRAINT "PostingDraft_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ScheduledPost"
  ADD CONSTRAINT "ScheduledPost_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScheduledPost"
  ADD CONSTRAINT "ScheduledPost_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiInvocation"
  ADD CONSTRAINT "AiInvocation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiInvocation"
  ADD CONSTRAINT "AiInvocation_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiResponseCache"
  ADD CONSTRAINT "AiResponseCache_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiResponseCache"
  ADD CONSTRAINT "AiResponseCache_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SocialMetricSnapshot"
  ADD CONSTRAINT "SocialMetricSnapshot_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SocialMetricSnapshot"
  ADD CONSTRAINT "SocialMetricSnapshot_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PostPerformancePrediction"
  ADD CONSTRAINT "PostPerformancePrediction_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostPerformancePrediction"
  ADD CONSTRAINT "PostPerformancePrediction_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GrowthRecommendation"
  ADD CONSTRAINT "GrowthRecommendation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrowthRecommendation"
  ADD CONSTRAINT "GrowthRecommendation_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GrowthCampaign"
  ADD CONSTRAINT "GrowthCampaign_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrowthCampaign"
  ADD CONSTRAINT "GrowthCampaign_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GrowthTrend"
  ADD CONSTRAINT "GrowthTrend_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrowthTrend"
  ADD CONSTRAINT "GrowthTrend_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GrowthGuardrailReview"
  ADD CONSTRAINT "GrowthGuardrailReview_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrowthGuardrailReview"
  ADD CONSTRAINT "GrowthGuardrailReview_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MinistryOutcome"
  ADD CONSTRAINT "MinistryOutcome_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MinistryOutcome"
  ADD CONSTRAINT "MinistryOutcome_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
