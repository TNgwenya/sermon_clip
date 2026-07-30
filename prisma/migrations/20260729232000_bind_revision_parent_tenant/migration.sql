-- Tenant ownership must always be supplied by the application. The
-- compatibility organization is only for migrating historical rows, not a
-- database default that can silently misattribute new social data.
ALTER TABLE "SocialAccount"
  ALTER COLUMN "organizationId" DROP DEFAULT;

ALTER TABLE "SocialCredential"
  ALTER COLUMN "organizationId" DROP DEFAULT;

ALTER TABLE "SocialMetricSnapshot"
  ALTER COLUMN "organizationId" DROP DEFAULT;

-- Give each revision parent a tenant-qualified candidate key. The revision
-- foreign keys use this key so a revision cannot point at an object belonging
-- to another organization. campusId intentionally remains nullable and is
-- independently constrained to (Campus.id, Campus.organizationId).
CREATE UNIQUE INDEX "ContentOpportunity_id_organizationId_key"
  ON "ContentOpportunity"("id", "organizationId");

CREATE UNIQUE INDEX "ContentAsset_id_organizationId_key"
  ON "ContentAsset"("id", "organizationId");

ALTER TABLE "ContentOpportunityRevision"
  DROP CONSTRAINT "ContentOpportunityRevision_contentOpportunityId_fkey";

ALTER TABLE "ContentOpportunityRevision"
  ADD CONSTRAINT "ContentOpportunityRevision_contentOpportunityId_organizationId_fkey"
  FOREIGN KEY ("contentOpportunityId", "organizationId")
  REFERENCES "ContentOpportunity"("id", "organizationId")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ContentAssetRevision"
  DROP CONSTRAINT "ContentAssetRevision_contentAssetId_fkey";

ALTER TABLE "ContentAssetRevision"
  ADD CONSTRAINT "ContentAssetRevision_contentAssetId_organizationId_fkey"
  FOREIGN KEY ("contentAssetId", "organizationId")
  REFERENCES "ContentAsset"("id", "organizationId")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- A composite foreign key cannot compare nullable campusId values with
-- `IS NOT DISTINCT FROM` semantics. These triggers close that gap: every
-- revision must carry exactly the same optional campus as its parent, and a
-- parent tenant assignment cannot move while revisions still carry the old
-- assignment.
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

CREATE TRIGGER "ContentOpportunityRevision_parent_tenant_guard"
BEFORE INSERT OR UPDATE ON "ContentOpportunityRevision"
FOR EACH ROW
EXECUTE FUNCTION "enforce_content_revision_parent_tenant"();

CREATE TRIGGER "ContentAssetRevision_parent_tenant_guard"
BEFORE INSERT OR UPDATE ON "ContentAssetRevision"
FOR EACH ROW
EXECUTE FUNCTION "enforce_content_revision_parent_tenant"();

CREATE TRIGGER "ContentOpportunity_revision_tenant_guard"
BEFORE UPDATE OF "organizationId", "campusId" ON "ContentOpportunity"
FOR EACH ROW
EXECUTE FUNCTION "protect_content_parent_revision_tenant"();

CREATE TRIGGER "ContentAsset_revision_tenant_guard"
BEFORE UPDATE OF "organizationId", "campusId" ON "ContentAsset"
FOR EACH ROW
EXECUTE FUNCTION "protect_content_parent_revision_tenant"();
