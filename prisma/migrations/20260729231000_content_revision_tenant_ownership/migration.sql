-- Give immutable content revisions direct tenant ownership. Ownership is
-- derived from the parent row, never from browser-provided input.
ALTER TABLE "ContentOpportunityRevision"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "campusId" TEXT;

ALTER TABLE "ContentAssetRevision"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "campusId" TEXT;

UPDATE "ContentOpportunityRevision" AS revision
SET
  "organizationId" = COALESCE(opportunity."organizationId", 'org_local_default'),
  "campusId" = CASE
    WHEN opportunity."campusId" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "Campus" AS campus
        WHERE campus."id" = opportunity."campusId"
          AND campus."organizationId" = COALESCE(opportunity."organizationId", 'org_local_default')
      )
    THEN opportunity."campusId"
    ELSE NULL
  END
FROM "ContentOpportunity" AS opportunity
WHERE revision."contentOpportunityId" = opportunity."id";

UPDATE "ContentAssetRevision" AS revision
SET
  "organizationId" = COALESCE(asset."organizationId", 'org_local_default'),
  "campusId" = CASE
    WHEN asset."campusId" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "Campus" AS campus
        WHERE campus."id" = asset."campusId"
          AND campus."organizationId" = COALESCE(asset."organizationId", 'org_local_default')
      )
    THEN asset."campusId"
    ELSE NULL
  END
FROM "ContentAsset" AS asset
WHERE revision."contentAssetId" = asset."id";

ALTER TABLE "ContentOpportunityRevision"
  ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "ContentAssetRevision"
  ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "ContentOpportunityRevision"
  ADD CONSTRAINT "ContentOpportunityRevision_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContentOpportunityRevision_campusId_organizationId_fkey"
    FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContentAssetRevision"
  ADD CONSTRAINT "ContentAssetRevision_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContentAssetRevision_campusId_organizationId_fkey"
    FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ContentOpportunityRevision_organizationId_contentOpportunityId_createdAt_idx"
  ON "ContentOpportunityRevision"("organizationId", "contentOpportunityId", "createdAt");
CREATE INDEX "ContentOpportunityRevision_campusId_contentOpportunityId_createdAt_idx"
  ON "ContentOpportunityRevision"("campusId", "contentOpportunityId", "createdAt");
CREATE INDEX "ContentAssetRevision_organizationId_contentAssetId_createdAt_idx"
  ON "ContentAssetRevision"("organizationId", "contentAssetId", "createdAt");
CREATE INDEX "ContentAssetRevision_campusId_contentAssetId_createdAt_idx"
  ON "ContentAssetRevision"("campusId", "contentAssetId", "createdAt");
