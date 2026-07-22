-- CreateEnum
CREATE TYPE "ContentRevisionApprovalState" AS ENUM ('DRAFT', 'APPROVED', 'REAPPROVAL_REQUIRED');

-- CreateEnum
CREATE TYPE "TranslationReviewState" AS ENUM ('NOT_REQUIRED', 'REVIEW_REQUIRED', 'APPROVED');

-- Extend the existing partial uniqueness invariant to the new expensive job
-- type so concurrent generation requests cannot create duplicate active work.
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

-- Privacy-safe product funnel events. Metadata is restricted by the
-- application to counts, enums, booleans, and identifiers; sermon and content
-- wording is never stored here.
CREATE TYPE "ContentFunnelEventType" AS ENUM (
  'GENERATION_REQUESTED',
  'GENERATION_COMPLETED',
  'GENERATION_SHORTFALL',
  'PREVIEWED',
  'EDITED',
  'APPROVED',
  'REAPPROVAL_REQUIRED',
  'DESIGN_SAVED',
  'DESIGN_RENDERED',
  'SCHEDULE_SUCCEEDED',
  'SCHEDULE_FAILED'
);

CREATE TABLE "ContentFunnelEvent" (
  "id" TEXT NOT NULL,
  "eventType" "ContentFunnelEventType" NOT NULL,
  "sermonId" TEXT,
  "opportunityId" TEXT,
  "contentAssetId" TEXT,
  "scheduledPostId" TEXT,
  "processingJobId" TEXT,
  "dedupeKey" TEXT,
  "durationMs" INTEGER,
  "metadataJson" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContentFunnelEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentFunnelEvent_duration_check" CHECK ("durationMs" IS NULL OR "durationMs" >= 0)
);

CREATE UNIQUE INDEX "ContentFunnelEvent_dedupeKey_key" ON "ContentFunnelEvent"("dedupeKey");
CREATE INDEX "ContentFunnelEvent_eventType_occurredAt_idx" ON "ContentFunnelEvent"("eventType", "occurredAt");
CREATE INDEX "ContentFunnelEvent_sermonId_occurredAt_idx" ON "ContentFunnelEvent"("sermonId", "occurredAt");
CREATE INDEX "ContentFunnelEvent_opportunityId_occurredAt_idx" ON "ContentFunnelEvent"("opportunityId", "occurredAt");
CREATE INDEX "ContentFunnelEvent_contentAssetId_occurredAt_idx" ON "ContentFunnelEvent"("contentAssetId", "occurredAt");
CREATE INDEX "ContentFunnelEvent_processingJobId_occurredAt_idx" ON "ContentFunnelEvent"("processingJobId", "occurredAt");

-- Add structured provenance and the immutable approved revision pointer.
ALTER TABLE "ContentOpportunity"
  ADD COLUMN "structuredContentJson" JSONB,
  ADD COLUMN "sourceTranscriptSegmentIds" JSONB,
  ADD COLUMN "sourceStartTimeSeconds" DOUBLE PRECISION,
  ADD COLUMN "sourceEndTimeSeconds" DOUBLE PRECISION,
  ADD COLUMN "scriptureTranslation" TEXT,
  ADD COLUMN "scriptureVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "translationReviewState" "TranslationReviewState" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "approvedRevisionId" TEXT,
  ADD CONSTRAINT "ContentOpportunity_source_span_check"
    CHECK (
      "sourceStartTimeSeconds" IS NULL
      OR "sourceEndTimeSeconds" IS NULL
      OR "sourceEndTimeSeconds" >= "sourceStartTimeSeconds"
    );

-- Add immutable current/approved revision pointers to publishable assets.
ALTER TABLE "ContentAsset"
  ADD COLUMN "structuredContentJson" JSONB,
  ADD COLUMN "currentRevisionId" TEXT,
  ADD COLUMN "approvedRevisionId" TEXT;

-- CreateTable
CREATE TABLE "ContentOpportunityRevision" (
  "id" TEXT NOT NULL,
  "contentOpportunityId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "shortDescription" TEXT,
  "content" TEXT NOT NULL,
  "structuredContentJson" JSONB,
  "sourceTranscriptExcerpt" TEXT,
  "sourceTranscriptSegmentIds" JSONB,
  "sourceStartTimeSeconds" DOUBLE PRECISION,
  "sourceEndTimeSeconds" DOUBLE PRECISION,
  "relatedScripture" TEXT,
  "scriptureTranslation" TEXT,
  "scriptureVerifiedAt" TIMESTAMP(3),
  "translationReviewState" "TranslationReviewState" NOT NULL DEFAULT 'NOT_REQUIRED',
  "approvalState" "ContentRevisionApprovalState" NOT NULL DEFAULT 'DRAFT',
  "createdBy" TEXT,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContentOpportunityRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentOpportunityRevision_revision_number_check" CHECK ("revisionNumber" >= 1),
  CONSTRAINT "ContentOpportunityRevision_source_span_check"
    CHECK (
      "sourceStartTimeSeconds" IS NULL
      OR "sourceEndTimeSeconds" IS NULL
      OR "sourceEndTimeSeconds" >= "sourceStartTimeSeconds"
    )
);

-- CreateTable
CREATE TABLE "ContentAssetRevision" (
  "id" TEXT NOT NULL,
  "contentAssetId" TEXT NOT NULL,
  "sourceOpportunityRevisionId" TEXT,
  "revisionNumber" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "bodyContent" TEXT,
  "structuredContentJson" JSONB,
  "caption" TEXT,
  "hashtagsJson" JSONB,
  "callToAction" TEXT,
  "metadataJson" JSONB,
  "approvalState" "ContentRevisionApprovalState" NOT NULL DEFAULT 'DRAFT',
  "createdBy" TEXT,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "renderedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContentAssetRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentAssetRevision_revision_number_check" CHECK ("revisionNumber" >= 1)
);

ALTER TABLE "ScheduledPostContentAsset"
  ADD COLUMN "contentAssetRevisionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ContentOpportunity_approvedRevisionId_key" ON "ContentOpportunity"("approvedRevisionId");
CREATE INDEX "ContentOpportunity_approvedRevisionId_idx" ON "ContentOpportunity"("approvedRevisionId");
CREATE UNIQUE INDEX "ContentOpportunityRevision_contentOpportunityId_revisionNum_key"
  ON "ContentOpportunityRevision"("contentOpportunityId", "revisionNumber");
CREATE INDEX "ContentOpportunityRevision_contentOpportunityId_approvalSta_idx"
  ON "ContentOpportunityRevision"("contentOpportunityId", "approvalState");
CREATE INDEX "ContentOpportunityRevision_createdAt_idx" ON "ContentOpportunityRevision"("createdAt");

CREATE UNIQUE INDEX "ContentAsset_currentRevisionId_key" ON "ContentAsset"("currentRevisionId");
CREATE UNIQUE INDEX "ContentAsset_approvedRevisionId_key" ON "ContentAsset"("approvedRevisionId");
CREATE INDEX "ContentAsset_currentRevisionId_idx" ON "ContentAsset"("currentRevisionId");
CREATE INDEX "ContentAsset_approvedRevisionId_idx" ON "ContentAsset"("approvedRevisionId");
CREATE UNIQUE INDEX "ContentAssetRevision_contentAssetId_revisionNumber_key"
  ON "ContentAssetRevision"("contentAssetId", "revisionNumber");
CREATE INDEX "ContentAssetRevision_contentAssetId_approvalState_idx"
  ON "ContentAssetRevision"("contentAssetId", "approvalState");
CREATE INDEX "ContentAssetRevision_sourceOpportunityRevisionId_idx"
  ON "ContentAssetRevision"("sourceOpportunityRevisionId");
CREATE INDEX "ContentAssetRevision_createdAt_idx" ON "ContentAssetRevision"("createdAt");
CREATE INDEX "ScheduledPostContentAsset_contentAssetRevisionId_idx"
  ON "ScheduledPostContentAsset"("contentAssetRevisionId");

-- Existing Scripture graphics have no durable record that a person checked
-- the verse wording against a named translation. Put them back into review
-- instead of silently grandfathering an unverifiable approval.
UPDATE "ContentOpportunity"
SET
  "translationReviewState" = 'REVIEW_REQUIRED',
  "status" = CASE
    WHEN "status" IN ('APPROVED', 'USED') THEN 'NEEDS_REVIEW'::"ContentOpportunityStatus"
    ELSE "status"
  END
WHERE "opportunityType" = 'SCRIPTURE_GRAPHIC';

-- Legacy quote graphics also predate durable TranscriptSegment links. A cached
-- excerpt alone is not sufficient evidence for a pastor-attributed quote, so
-- previously approved quote graphics must be matched and approved again.
UPDATE "ContentOpportunity"
SET "status" = CASE
  WHEN "status" IN ('APPROVED', 'USED') THEN 'NEEDS_REVIEW'::"ContentOpportunityStatus"
  ELSE "status"
END
WHERE "opportunityType" = 'QUOTE_GRAPHIC';

-- Establish revision 1 for every legacy opportunity. Only records whose
-- approval can still be trusted receive an approved pointer.
INSERT INTO "ContentOpportunityRevision" (
  "id",
  "contentOpportunityId",
  "revisionNumber",
  "title",
  "shortDescription",
  "content",
  "structuredContentJson",
  "sourceTranscriptExcerpt",
  "sourceTranscriptSegmentIds",
  "sourceStartTimeSeconds",
  "sourceEndTimeSeconds",
  "relatedScripture",
  "scriptureTranslation",
  "scriptureVerifiedAt",
  "translationReviewState",
  "approvalState",
  "createdBy",
  "approvedBy",
  "approvedAt",
  "createdAt"
)
SELECT
  'legacy-opportunity-revision:' || opportunity."id",
  opportunity."id",
  1,
  opportunity."title",
  opportunity."shortDescription",
  COALESCE(NULLIF(BTRIM(opportunity."approvedContent"), ''), NULLIF(BTRIM(opportunity."editedContent"), ''), opportunity."bodyContent"),
  opportunity."structuredContentJson",
  opportunity."sourceTranscriptExcerpt",
  opportunity."sourceTranscriptSegmentIds",
  opportunity."sourceStartTimeSeconds",
  opportunity."sourceEndTimeSeconds",
  opportunity."relatedScripture",
  opportunity."scriptureTranslation",
  opportunity."scriptureVerifiedAt",
  opportunity."translationReviewState",
  CASE
    WHEN opportunity."status" IN ('APPROVED', 'USED') THEN 'APPROVED'::"ContentRevisionApprovalState"
    WHEN opportunity."opportunityType" IN ('QUOTE_GRAPHIC', 'SCRIPTURE_GRAPHIC') THEN 'REAPPROVAL_REQUIRED'::"ContentRevisionApprovalState"
    ELSE 'DRAFT'::"ContentRevisionApprovalState"
  END,
  'legacy-migration',
  CASE WHEN opportunity."status" IN ('APPROVED', 'USED') THEN 'legacy-migration' ELSE NULL END,
  CASE WHEN opportunity."status" IN ('APPROVED', 'USED') THEN opportunity."updatedAt" ELSE NULL END,
  opportunity."createdAt"
FROM "ContentOpportunity" opportunity;

UPDATE "ContentOpportunity" opportunity
SET "approvedRevisionId" = 'legacy-opportunity-revision:' || opportunity."id"
WHERE opportunity."status" IN ('APPROVED', 'USED');

-- Snapshot every legacy asset and link every historical scheduled-post row to
-- that immutable snapshot. Assets sourced from content that now needs review
-- are deliberately not grandfathered as approved.
INSERT INTO "ContentAssetRevision" (
  "id",
  "contentAssetId",
  "sourceOpportunityRevisionId",
  "revisionNumber",
  "title",
  "bodyContent",
  "structuredContentJson",
  "caption",
  "hashtagsJson",
  "callToAction",
  "metadataJson",
  "approvalState",
  "createdBy",
  "approvedBy",
  "approvedAt",
  "renderedAt",
  "createdAt"
)
SELECT
  'legacy-asset-revision:' || asset."id",
  asset."id",
  opportunity."approvedRevisionId",
  1,
  asset."title",
  asset."bodyContent",
  asset."structuredContentJson",
  asset."caption",
  asset."hashtagsJson",
  asset."callToAction",
  asset."metadataJson",
  CASE
    WHEN asset."status" IN ('READY', 'SCHEDULED', 'PUBLISHED')
      AND (asset."contentOpportunityId" IS NULL OR opportunity."approvedRevisionId" IS NOT NULL)
      THEN 'APPROVED'::"ContentRevisionApprovalState"
    WHEN asset."status" IN ('APPROVED', 'PREPARED', 'READY', 'SCHEDULED', 'PUBLISHED')
      THEN 'REAPPROVAL_REQUIRED'::"ContentRevisionApprovalState"
    ELSE 'DRAFT'::"ContentRevisionApprovalState"
  END,
  'legacy-migration',
  CASE
    WHEN asset."status" IN ('READY', 'SCHEDULED', 'PUBLISHED')
      AND (asset."contentOpportunityId" IS NULL OR opportunity."approvedRevisionId" IS NOT NULL)
      THEN 'legacy-migration'
    ELSE NULL
  END,
  CASE
    WHEN asset."status" IN ('READY', 'SCHEDULED', 'PUBLISHED')
      AND (asset."contentOpportunityId" IS NULL OR opportunity."approvedRevisionId" IS NOT NULL)
      THEN COALESCE(asset."approvedAt", asset."preparedAt", asset."updatedAt")
    ELSE NULL
  END,
  CASE
    WHEN asset."status" IN ('READY', 'SCHEDULED', 'PUBLISHED') THEN COALESCE(asset."readyAt", asset."updatedAt")
    ELSE NULL
  END,
  asset."createdAt"
FROM "ContentAsset" asset
LEFT JOIN "ContentOpportunity" opportunity ON opportunity."id" = asset."contentOpportunityId";

UPDATE "ContentAsset" asset
SET
  "currentRevisionId" = 'legacy-asset-revision:' || asset."id",
  "approvedRevisionId" = CASE
    WHEN revision."approvalState" = 'APPROVED' THEN revision."id"
    ELSE NULL
  END
FROM "ContentAssetRevision" revision
WHERE revision."contentAssetId" = asset."id" AND revision."revisionNumber" = 1;

-- A legacy READY/SCHEDULED label must not outrank the new approval pointer.
-- Keep the draft available for review, but remove it from publishing-ready
-- queues until a person approves a current immutable asset revision.
UPDATE "ContentAsset" asset
SET "status" = 'PREPARED'::"ContentAssetStatus"
FROM "ContentAssetRevision" revision
WHERE revision."id" = asset."currentRevisionId"
  AND revision."approvalState" <> 'APPROVED'
  AND asset."status" IN ('APPROVED', 'READY', 'SCHEDULED');

UPDATE "ScheduledPostContentAsset" link
SET "contentAssetRevisionId" = asset."currentRevisionId"
FROM "ContentAsset" asset
WHERE asset."id" = link."contentAssetId";

UPDATE "ScheduledPost" post
SET
  "status" = 'FAILED',
  "workerStatus" = 'FAILED',
  "publishError" = 'This content was scheduled before revision-safe approvals were enabled and now requires review and reapproval.'
WHERE post."status" IN ('PLANNED', 'READY_FOR_MEDIA_TEAM')
  AND EXISTS (
    SELECT 1
    FROM "ScheduledPostContentAsset" link
    JOIN "ContentAssetRevision" revision ON revision."id" = link."contentAssetRevisionId"
    WHERE link."scheduledPostId" = post."id"
      AND revision."approvalState" <> 'APPROVED'
  );

-- AddForeignKey
ALTER TABLE "ContentOpportunityRevision"
  ADD CONSTRAINT "ContentOpportunityRevision_contentOpportunityId_fkey"
  FOREIGN KEY ("contentOpportunityId") REFERENCES "ContentOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentOpportunity"
  ADD CONSTRAINT "ContentOpportunity_approvedRevisionId_fkey"
  FOREIGN KEY ("approvedRevisionId") REFERENCES "ContentOpportunityRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContentAssetRevision"
  ADD CONSTRAINT "ContentAssetRevision_contentAssetId_fkey"
  FOREIGN KEY ("contentAssetId") REFERENCES "ContentAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentAssetRevision"
  ADD CONSTRAINT "ContentAssetRevision_sourceOpportunityRevisionId_fkey"
  FOREIGN KEY ("sourceOpportunityRevisionId") REFERENCES "ContentOpportunityRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContentAsset"
  ADD CONSTRAINT "ContentAsset_currentRevisionId_fkey"
  FOREIGN KEY ("currentRevisionId") REFERENCES "ContentAssetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContentAsset"
  ADD CONSTRAINT "ContentAsset_approvedRevisionId_fkey"
  FOREIGN KEY ("approvedRevisionId") REFERENCES "ContentAssetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ScheduledPostContentAsset"
  ADD CONSTRAINT "ScheduledPostContentAsset_contentAssetRevisionId_fkey"
  FOREIGN KEY ("contentAssetRevisionId") REFERENCES "ContentAssetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
