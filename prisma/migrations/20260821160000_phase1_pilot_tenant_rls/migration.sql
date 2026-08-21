-- Phase 1 pilot tenant defense-in-depth.
--
-- These policies are deliberately additive and non-blocking for existing
-- background workers: when no transaction-local organization is present,
-- rows remain visible. Request-scoped database work opts into enforcement by
-- setting `sermon_clip.organization_id` with set_config(..., true). Table
-- owners continue to bypass RLS unless FORCE RLS is enabled; the pilot runtime
-- should therefore use a least-privilege, non-owner database role before this
-- layer is counted as an isolation control.

CREATE OR REPLACE FUNCTION public.sermon_clip_tenant_row_visible(row_organization_id text)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  WITH tenant_context AS (
    SELECT NULLIF(current_setting('sermon_clip.organization_id', true), '') AS organization_id
  )
  SELECT tenant_context.organization_id IS NULL
    OR (
      row_organization_id IS NOT NULL
      AND tenant_context.organization_id = row_organization_id
    )
  FROM tenant_context
$$;

CREATE OR REPLACE FUNCTION public.sermon_clip_sermon_row_visible(row_sermon_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."Sermon" AS sermon
    WHERE sermon.id = row_sermon_id
      AND public.sermon_clip_tenant_row_visible(sermon."organizationId")
  )
$$;

REVOKE ALL ON FUNCTION public.sermon_clip_sermon_row_visible(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sermon_clip_sermon_row_visible(text) TO PUBLIC;

-- Directly tenant-owned pilot records.
ALTER TABLE public."Sermon" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sermon_pilot_tenant_isolation" ON public."Sermon";
CREATE POLICY "Sermon_pilot_tenant_isolation" ON public."Sermon"
  USING (public.sermon_clip_tenant_row_visible("organizationId"))
  WITH CHECK (public.sermon_clip_tenant_row_visible("organizationId"));

ALTER TABLE public."SermonSourceAsset" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SermonSourceAsset_pilot_tenant_isolation" ON public."SermonSourceAsset";
CREATE POLICY "SermonSourceAsset_pilot_tenant_isolation" ON public."SermonSourceAsset"
  USING (public.sermon_clip_tenant_row_visible("organizationId"))
  WITH CHECK (public.sermon_clip_tenant_row_visible("organizationId"));

ALTER TABLE public."ContentOpportunity" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ContentOpportunity_pilot_tenant_isolation" ON public."ContentOpportunity";
CREATE POLICY "ContentOpportunity_pilot_tenant_isolation" ON public."ContentOpportunity"
  USING (public.sermon_clip_tenant_row_visible("organizationId"))
  WITH CHECK (public.sermon_clip_tenant_row_visible("organizationId"));

ALTER TABLE public."ContentAsset" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ContentAsset_pilot_tenant_isolation" ON public."ContentAsset";
CREATE POLICY "ContentAsset_pilot_tenant_isolation" ON public."ContentAsset"
  USING (public.sermon_clip_tenant_row_visible("organizationId"))
  WITH CHECK (public.sermon_clip_tenant_row_visible("organizationId"));

ALTER TABLE public."WeekDraft" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "WeekDraft_pilot_tenant_isolation" ON public."WeekDraft";
CREATE POLICY "WeekDraft_pilot_tenant_isolation" ON public."WeekDraft"
  USING (public.sermon_clip_tenant_row_visible("organizationId"))
  WITH CHECK (public.sermon_clip_tenant_row_visible("organizationId"));

ALTER TABLE public."SocialAccount" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SocialAccount_pilot_tenant_isolation" ON public."SocialAccount";
CREATE POLICY "SocialAccount_pilot_tenant_isolation" ON public."SocialAccount"
  USING (public.sermon_clip_tenant_row_visible("organizationId"))
  WITH CHECK (public.sermon_clip_tenant_row_visible("organizationId"));

ALTER TABLE public."ScheduledPost" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ScheduledPost_pilot_tenant_isolation" ON public."ScheduledPost";
CREATE POLICY "ScheduledPost_pilot_tenant_isolation" ON public."ScheduledPost"
  USING (public.sermon_clip_tenant_row_visible("organizationId"))
  WITH CHECK (public.sermon_clip_tenant_row_visible("organizationId"));

ALTER TABLE public."BrandingSettings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "BrandingSettings_pilot_tenant_isolation" ON public."BrandingSettings";
CREATE POLICY "BrandingSettings_pilot_tenant_isolation" ON public."BrandingSettings"
  USING (public.sermon_clip_tenant_row_visible("organizationId"))
  WITH CHECK (public.sermon_clip_tenant_row_visible("organizationId"));

-- Media and processing records inherit ownership from their sermon. The
-- security-definer helper performs only the boolean ownership check and does
-- not expose sermon fields.
ALTER TABLE public."Transcript" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Transcript_pilot_tenant_isolation" ON public."Transcript";
CREATE POLICY "Transcript_pilot_tenant_isolation" ON public."Transcript"
  USING (public.sermon_clip_sermon_row_visible("sermonId"))
  WITH CHECK (public.sermon_clip_sermon_row_visible("sermonId"));

ALTER TABLE public."TranscriptSegment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "TranscriptSegment_pilot_tenant_isolation" ON public."TranscriptSegment";
CREATE POLICY "TranscriptSegment_pilot_tenant_isolation" ON public."TranscriptSegment"
  USING (public.sermon_clip_sermon_row_visible("sermonId"))
  WITH CHECK (public.sermon_clip_sermon_row_visible("sermonId"));

ALTER TABLE public."ClipCandidate" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ClipCandidate_pilot_tenant_isolation" ON public."ClipCandidate";
CREATE POLICY "ClipCandidate_pilot_tenant_isolation" ON public."ClipCandidate"
  USING (public.sermon_clip_sermon_row_visible("sermonId"))
  WITH CHECK (public.sermon_clip_sermon_row_visible("sermonId"));

ALTER TABLE public."ProcessingJob" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ProcessingJob_pilot_tenant_isolation" ON public."ProcessingJob";
CREATE POLICY "ProcessingJob_pilot_tenant_isolation" ON public."ProcessingJob"
  USING (public.sermon_clip_sermon_row_visible("sermonId"))
  WITH CHECK (public.sermon_clip_sermon_row_visible("sermonId"));

ALTER TABLE public."VideoSubjectTrack" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "VideoSubjectTrack_pilot_tenant_isolation" ON public."VideoSubjectTrack";
CREATE POLICY "VideoSubjectTrack_pilot_tenant_isolation" ON public."VideoSubjectTrack"
  USING (public.sermon_clip_sermon_row_visible("sermonId"))
  WITH CHECK (public.sermon_clip_sermon_row_visible("sermonId"));

ALTER TABLE public."ClipEditPlan" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ClipEditPlan_pilot_tenant_isolation" ON public."ClipEditPlan";
CREATE POLICY "ClipEditPlan_pilot_tenant_isolation" ON public."ClipEditPlan"
  USING (public.sermon_clip_sermon_row_visible("sermonId"))
  WITH CHECK (public.sermon_clip_sermon_row_visible("sermonId"));

ALTER TABLE public."ClipArtifact" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ClipArtifact_pilot_tenant_isolation" ON public."ClipArtifact";
CREATE POLICY "ClipArtifact_pilot_tenant_isolation" ON public."ClipArtifact"
  USING (public.sermon_clip_sermon_row_visible("sermonId"))
  WITH CHECK (public.sermon_clip_sermon_row_visible("sermonId"));

-- Prevent new source-asset rows from disagreeing with their parent sermon.
-- NOT VALID avoids a blocking historical-table validation during deployment;
-- PostgreSQL still enforces the constraint for all new and changed rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'SermonSourceAsset_sermon_tenant_fkey'
      AND conrelid = 'public."SermonSourceAsset"'::regclass
  ) THEN
    ALTER TABLE public."SermonSourceAsset"
      ADD CONSTRAINT "SermonSourceAsset_sermon_tenant_fkey"
      FOREIGN KEY ("sermonId", "organizationId")
      REFERENCES public."Sermon"(id, "organizationId")
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END
$$;
