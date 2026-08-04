-- Prisma's schema language cannot represent these PostgreSQL-only invariants.
-- Apply them after `prisma db push` and before baselining migration history.

WITH ranked_active_jobs AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "sermonId", "type"
      ORDER BY
        CASE WHEN "status" = 'RUNNING' THEN 0 ELSE 1 END,
        CASE
          WHEN "status" = 'RUNNING' THEN GREATEST(
            COALESCE("heartbeatAt", '-infinity'::timestamp),
            COALESCE("updatedAt", '-infinity'::timestamp)
          )
        END DESC NULLS LAST,
        CASE WHEN "status" = 'PENDING' THEN "createdAt" END ASC NULLS LAST,
        "id" ASC
    ) AS active_rank
  FROM "ProcessingJob"
  WHERE "status" IN ('PENDING', 'RUNNING')
    AND "type" IN (
      'DOWNLOAD_VIDEO',
      'EXTRACT_AUDIO',
      'TRANSCRIBE_AUDIO',
      'GENERATE_CLIPS',
      'PROCESS_SERMON',
      'GENERATE_INTELLIGENCE',
      'QUALITY_REFRESH',
      'GENERATE_CONTENT_OPPORTUNITIES'
    )
)
UPDATE "ProcessingJob" AS job
SET
  "status" = 'FAILED',
  "completedAt" = COALESCE(job."completedAt", NOW()),
  "heartbeatAt" = NULL,
  "errorMessage" = COALESCE(
    job."errorMessage",
    'Superseded while enforcing one active processing job per sermon and type.'
  )
FROM ranked_active_jobs
WHERE job."id" = ranked_active_jobs."id"
  AND ranked_active_jobs.active_rank > 1;

DROP INDEX IF EXISTS "ProcessingJob_one_active_type_per_sermon_key";

CREATE UNIQUE INDEX "ProcessingJob_one_active_type_per_sermon_key"
ON "ProcessingJob" ("sermonId", "type")
WHERE "status" IN ('PENDING', 'RUNNING')
  AND "type" IN (
    'DOWNLOAD_VIDEO',
    'EXTRACT_AUDIO',
    'TRANSCRIBE_AUDIO',
    'GENERATE_CLIPS',
    'PROCESS_SERMON',
    'GENERATE_INTELLIGENCE',
    'QUALITY_REFRESH',
    'GENERATE_CONTENT_OPPORTUNITIES'
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ContentAssetFile_location_check'
      AND conrelid = '"ContentAssetFile"'::regclass
  ) THEN
    ALTER TABLE "ContentAssetFile"
      ADD CONSTRAINT "ContentAssetFile_location_check"
      CHECK (num_nonnulls("filePath", "objectKey", "publicUrl") >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ContentAssetFile_dimensions_check'
      AND conrelid = '"ContentAssetFile"'::regclass
  ) THEN
    ALTER TABLE "ContentAssetFile"
      ADD CONSTRAINT "ContentAssetFile_dimensions_check"
      CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ContentAssetFile_size_check'
      AND conrelid = '"ContentAssetFile"'::regclass
  ) THEN
    ALTER TABLE "ContentAssetFile"
      ADD CONSTRAINT "ContentAssetFile_size_check"
      CHECK ("sizeBytes" IS NULL OR "sizeBytes" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ContentAssetFile_sort_order_check'
      AND conrelid = '"ContentAssetFile"'::regclass
  ) THEN
    ALTER TABLE "ContentAssetFile"
      ADD CONSTRAINT "ContentAssetFile_sort_order_check"
      CHECK ("sortOrder" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ScheduledPostContentAsset_sort_order_check'
      AND conrelid = '"ScheduledPostContentAsset"'::regclass
  ) THEN
    ALTER TABLE "ScheduledPostContentAsset"
      ADD CONSTRAINT "ScheduledPostContentAsset_sort_order_check"
      CHECK ("sortOrder" >= 0);
  END IF;
END $$;

-- `prisma db push` creates schema objects but cannot reproduce migration-only
-- bootstrap data or PostgreSQL partial indexes. Keep the recovery/baseline path
-- idempotent so a current-schema database is never marked migrated without the
-- identity required by the legacy authentication bridge.
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
)
ON CONFLICT ("id") DO NOTHING;

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
)
ON CONFLICT ("id") DO NOTHING;

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
)
ON CONFLICT ("id") DO NOTHING;

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
)
ON CONFLICT ("id") DO NOTHING;

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
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "OrganizationEntitlement" (
  "id",
  "organizationId",
  "key",
  "enabled",
  "limitValue",
  "source",
  "effectiveAt",
  "createdAt",
  "updatedAt"
) VALUES
  (
    'entitlement_local_ai_tokens',
    'org_local_default',
    'ai.tokens.monthly',
    TRUE,
    50000000,
    'MANUAL',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'entitlement_local_ai_audio',
    'org_local_default',
    'ai.audio_seconds.monthly',
    TRUE,
    1000000,
    'MANUAL',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'entitlement_local_media',
    'org_local_default',
    'media.seconds.monthly',
    TRUE,
    1000000,
    'MANUAL',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'entitlement_local_storage',
    'org_local_default',
    'storage.bytes',
    TRUE,
    1000000000000,
    'MANUAL',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'entitlement_local_seats',
    'org_local_default',
    'seats',
    TRUE,
    100,
    'MANUAL',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'entitlement_local_campuses',
    'org_local_default',
    'campuses',
    TRUE,
    20,
    'MANUAL',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'entitlement_local_social',
    'org_local_default',
    'social.connections',
    TRUE,
    50,
    'MANUAL',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("organizationId", "key") DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS "Membership_organizationId_userId_org_scope_key"
  ON "Membership"("organizationId", "userId")
  WHERE "campusId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Invitation_pending_org_scope_email_key"
  ON "Invitation"("organizationId", "normalizedEmail")
  WHERE "campusId" IS NULL AND "status" = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS "Invitation_pending_campus_scope_email_key"
  ON "Invitation"("organizationId", "campusId", "normalizedEmail")
  WHERE "campusId" IS NOT NULL AND "status" = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS "OwnershipTransfer_one_pending_per_organization_key"
  ON "OwnershipTransfer"("organizationId")
  WHERE "status" = 'PENDING';

-- Only rows without any tenant ownership are legacy rows. Preserve a NULL
-- campus on already-owned rows because it intentionally represents
-- organization-wide scope.
UPDATE "Sermon"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "BrandingSettings"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "ContentOpportunity"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "ContentFunnelEvent"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "ContentAsset"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "SocialAccount"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "SocialCredential"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "PostingDraft"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "ScheduledPost"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "AiInvocation"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "AiResponseCache"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "SocialMetricSnapshot"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "PostPerformancePrediction"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "GrowthRecommendation"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "GrowthCampaign"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "GrowthTrend"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "GrowthGuardrailReview"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;
UPDATE "MinistryOutcome"
SET "organizationId" = 'org_local_default',
    "campusId" = COALESCE("campusId", 'campus_local_default')
WHERE "organizationId" IS NULL;

-- Week Draft and collaboration domain rules are represented in the forward
-- migration, but `prisma db push` cannot recreate them on historyless or fresh
-- databases. Reapply them idempotently before migration history is baselined.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'WeekDraft_version_check'
      AND conrelid = '"WeekDraft"'::regclass
  ) THEN
    ALTER TABLE "WeekDraft"
      ADD CONSTRAINT "WeekDraft_version_check"
      CHECK ("version" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'WeekDraftItem_provenance_check'
      AND conrelid = '"WeekDraftItem"'::regclass
  ) THEN
    ALTER TABLE "WeekDraftItem"
      ADD CONSTRAINT "WeekDraftItem_provenance_check"
      CHECK (
        ("sourceType" = 'MANUAL' AND "sourceId" IS NULL)
        OR
        ("sourceType" <> 'MANUAL' AND NULLIF(BTRIM("sourceId"), '') IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'WeekDraftItemRevision_number_check'
      AND conrelid = '"WeekDraftItemRevision"'::regclass
  ) THEN
    ALTER TABLE "WeekDraftItemRevision"
      ADD CONSTRAINT "WeekDraftItemRevision_number_check"
      CHECK ("revisionNumber" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'WeekDraftItemRevision_hash_check'
      AND conrelid = '"WeekDraftItemRevision"'::regclass
  ) THEN
    ALTER TABLE "WeekDraftItemRevision"
      ADD CONSTRAINT "WeekDraftItemRevision_hash_check"
      CHECK ("contentHash" ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'WeekDraftItemRevision_provenance_check'
      AND conrelid = '"WeekDraftItemRevision"'::regclass
  ) THEN
    ALTER TABLE "WeekDraftItemRevision"
      ADD CONSTRAINT "WeekDraftItemRevision_provenance_check"
      CHECK (
        ("sourceType" = 'MANUAL' AND "sourceId" IS NULL)
        OR
        ("sourceType" <> 'MANUAL' AND NULLIF(BTRIM("sourceId"), '') IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CollaborationAssignment_completion_check'
      AND conrelid = '"CollaborationAssignment"'::regclass
  ) THEN
    ALTER TABLE "CollaborationAssignment"
      ADD CONSTRAINT "CollaborationAssignment_completion_check"
      CHECK (
        ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL)
        OR
        ("status" <> 'COMPLETED' AND "completedAt" IS NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CollaborationComment_body_check'
      AND conrelid = '"CollaborationComment"'::regclass
  ) THEN
    ALTER TABLE "CollaborationComment"
      ADD CONSTRAINT "CollaborationComment_body_check"
      CHECK (NULLIF(BTRIM("body"), '') IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ApprovalPolicy_minimum_check'
      AND conrelid = '"ApprovalPolicy"'::regclass
  ) THEN
    ALTER TABLE "ApprovalPolicy"
      ADD CONSTRAINT "ApprovalPolicy_minimum_check"
      CHECK ("minimumApprovals" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ApprovalPolicyRule_minimum_check'
      AND conrelid = '"ApprovalPolicyRule"'::regclass
  ) THEN
    ALTER TABLE "ApprovalPolicyRule"
      ADD CONSTRAINT "ApprovalPolicyRule_minimum_check"
      CHECK ("minimumApprovals" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ApprovalRequest_resolution_check'
      AND conrelid = '"ApprovalRequest"'::regclass
  ) THEN
    ALTER TABLE "ApprovalRequest"
      ADD CONSTRAINT "ApprovalRequest_resolution_check"
      CHECK (
        ("status" = 'PENDING' AND "resolvedAt" IS NULL AND "cancelledAt" IS NULL)
        OR
        ("status" = 'CANCELLED' AND "resolvedAt" IS NOT NULL AND "cancelledAt" IS NOT NULL)
        OR
        ("status" IN ('APPROVED', 'CHANGES_REQUESTED', 'SUPERSEDED')
          AND "resolvedAt" IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ApprovalDecision_reason_check'
      AND conrelid = '"ApprovalDecision"'::regclass
  ) THEN
    ALTER TABLE "ApprovalDecision"
      ADD CONSTRAINT "ApprovalDecision_reason_check"
      CHECK (
        "decision" = 'APPROVE'
        OR NULLIF(BTRIM("reason"), '') IS NOT NULL
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "WeekDraft_org_sermon_week_key"
  ON "WeekDraft"("organizationId", "sermonId", "weekStartsOn")
  WHERE "campusId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalPolicy_org_name_key"
  ON "ApprovalPolicy"("organizationId", "name")
  WHERE "campusId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalPolicy_active_org_default_key"
  ON "ApprovalPolicy"("organizationId")
  WHERE "campusId" IS NULL
    AND "isDefault" = true
    AND "status" = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalPolicy_active_campus_default_key"
  ON "ApprovalPolicy"("organizationId", "campusId")
  WHERE "campusId" IS NOT NULL
    AND "isDefault" = true
    AND "status" = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS "CollaborationAssignment_active_draft_assignee_key"
  ON "CollaborationAssignment"("weekDraftId", "assigneeUserId")
  WHERE "weekDraftItemId" IS NULL
    AND "status" = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS "CollaborationAssignment_active_item_assignee_key"
  ON "CollaborationAssignment"("weekDraftItemId", "assigneeUserId")
  WHERE "weekDraftItemId" IS NOT NULL
    AND "status" = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalRequest_pending_item_key"
  ON "ApprovalRequest"("weekDraftItemId")
  WHERE "status" = 'PENDING';

-- Prisma cannot express an exact nullable-campus match between immutable
-- revisions and their parents. organizationId is protected by a composite
-- foreign key; these triggers additionally compare campusId with PostgreSQL's
-- null-safe `IS NOT DISTINCT FROM` semantics in both mutation directions.
CREATE OR REPLACE FUNCTION "enforce_content_revision_parent_tenant"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_organization_id TEXT;
  parent_campus_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'ContentOpportunityRevision' THEN
    SELECT
      opportunity."organizationId",
      opportunity."campusId"
    INTO
      parent_organization_id,
      parent_campus_id
    FROM "ContentOpportunity" AS opportunity
    WHERE opportunity."id" = NEW."contentOpportunityId"
    FOR SHARE;
  ELSIF TG_TABLE_NAME = 'ContentAssetRevision' THEN
    SELECT
      asset."organizationId",
      asset."campusId"
    INTO
      parent_organization_id,
      parent_campus_id
    FROM "ContentAsset" AS asset
    WHERE asset."id" = NEW."contentAssetId"
    FOR SHARE;
  ELSE
    RAISE EXCEPTION 'Unsupported revision table %', TG_TABLE_NAME;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Revision parent does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF NEW."organizationId" IS DISTINCT FROM parent_organization_id
    OR NEW."campusId" IS DISTINCT FROM parent_campus_id
  THEN
    RAISE EXCEPTION 'Revision tenant must exactly match its parent tenant'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "protect_content_parent_revision_tenant"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."organizationId" IS NOT DISTINCT FROM OLD."organizationId"
    AND NEW."campusId" IS NOT DISTINCT FROM OLD."campusId"
  THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'ContentOpportunity' THEN
    PERFORM 1
    FROM "ContentOpportunityRevision" AS revision
    WHERE revision."contentOpportunityId" = OLD."id"
      AND (
        revision."organizationId" IS DISTINCT FROM NEW."organizationId"
        OR revision."campusId" IS DISTINCT FROM NEW."campusId"
      )
    LIMIT 1
    FOR UPDATE;
  ELSIF TG_TABLE_NAME = 'ContentAsset' THEN
    PERFORM 1
    FROM "ContentAssetRevision" AS revision
    WHERE revision."contentAssetId" = OLD."id"
      AND (
        revision."organizationId" IS DISTINCT FROM NEW."organizationId"
        OR revision."campusId" IS DISTINCT FROM NEW."campusId"
      )
    LIMIT 1
    FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Unsupported revision parent table %', TG_TABLE_NAME;
  END IF;

  IF FOUND THEN
    RAISE EXCEPTION 'Content parent tenant cannot diverge from existing revisions'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ContentOpportunityRevision_parent_tenant_guard"
  ON "ContentOpportunityRevision";
CREATE TRIGGER "ContentOpportunityRevision_parent_tenant_guard"
BEFORE INSERT OR UPDATE ON "ContentOpportunityRevision"
FOR EACH ROW
EXECUTE FUNCTION "enforce_content_revision_parent_tenant"();

DROP TRIGGER IF EXISTS "ContentAssetRevision_parent_tenant_guard"
  ON "ContentAssetRevision";
CREATE TRIGGER "ContentAssetRevision_parent_tenant_guard"
BEFORE INSERT OR UPDATE ON "ContentAssetRevision"
FOR EACH ROW
EXECUTE FUNCTION "enforce_content_revision_parent_tenant"();

DROP TRIGGER IF EXISTS "ContentOpportunity_revision_tenant_guard"
  ON "ContentOpportunity";
CREATE TRIGGER "ContentOpportunity_revision_tenant_guard"
BEFORE UPDATE OF "organizationId", "campusId" ON "ContentOpportunity"
FOR EACH ROW
EXECUTE FUNCTION "protect_content_parent_revision_tenant"();

DROP TRIGGER IF EXISTS "ContentAsset_revision_tenant_guard"
  ON "ContentAsset";
CREATE TRIGGER "ContentAsset_revision_tenant_guard"
BEFORE UPDATE OF "organizationId", "campusId" ON "ContentAsset"
FOR EACH ROW
EXECUTE FUNCTION "protect_content_parent_revision_tenant"();

-- Event programme constraints are also expressed in the migration, but empty
-- databases are created with `prisma db push` before this invariant file runs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'MinistryEvent_date_range_check'
      AND conrelid = '"MinistryEvent"'::regclass
  ) THEN
    ALTER TABLE "MinistryEvent"
      ADD CONSTRAINT "MinistryEvent_date_range_check"
      CHECK ("endDate" >= "startDate");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'EventSession_day_number_check'
      AND conrelid = '"EventSession"'::regclass
  ) THEN
    ALTER TABLE "EventSession"
      ADD CONSTRAINT "EventSession_day_number_check"
      CHECK ("dayNumber" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'EventSession_sort_order_check'
      AND conrelid = '"EventSession"'::regclass
  ) THEN
    ALTER TABLE "EventSession"
      ADD CONSTRAINT "EventSession_sort_order_check"
      CHECK ("sortOrder" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'EventSession_priority_check'
      AND conrelid = '"EventSession"'::regclass
  ) THEN
    ALTER TABLE "EventSession"
      ADD CONSTRAINT "EventSession_priority_check"
      CHECK ("priority" BETWEEN 0 AND 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'EventSession_time_range_check'
      AND conrelid = '"EventSession"'::regclass
  ) THEN
    ALTER TABLE "EventSession"
      ADD CONSTRAINT "EventSession_time_range_check"
      CHECK ("scheduledEndAt" IS NULL OR "scheduledEndAt" > "scheduledStartAt");
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_event_session_sermon_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  sermon_organization_id TEXT;
  sermon_campus_id TEXT;
BEGIN
  IF NEW."sermonId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "organizationId", "campusId"
  INTO sermon_organization_id, sermon_campus_id
  FROM "Sermon"
  WHERE "id" = NEW."sermonId";

  IF sermon_organization_id IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'Event session and sermon must belong to the same organization';
  END IF;

  IF NEW."campusId" IS NOT NULL
    AND sermon_campus_id IS DISTINCT FROM NEW."campusId" THEN
    RAISE EXCEPTION 'Event session and sermon must belong to the same campus';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "EventSession_sermon_tenant_guard"
  ON "EventSession";
CREATE TRIGGER "EventSession_sermon_tenant_guard"
BEFORE INSERT OR UPDATE OF "sermonId", "organizationId", "campusId"
ON "EventSession"
FOR EACH ROW
EXECUTE FUNCTION enforce_event_session_sermon_tenant();
