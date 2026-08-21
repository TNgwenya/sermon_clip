\set ON_ERROR_STOP on

-- Run only against a disposable/local database after migrations:
--   psql "$ISOLATED_DATABASE_URL" -f scripts/verify-tenant-rls.sql
-- Everything is enclosed in a rollback, including the temporary verification
-- role and fixtures. The connected role must be allowed to CREATE ROLE.

BEGIN;

CREATE ROLE sermon_clip_rls_verifier NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO sermon_clip_rls_verifier;
GRANT SELECT ON TABLE public."Sermon", public."ProcessingJob"
  TO sermon_clip_rls_verifier;

INSERT INTO public."Organization" (id, slug, name, "updatedAt") VALUES
  ('rls_verify_org_a', 'rls-verify-org-a', 'RLS Verify A', now()),
  ('rls_verify_org_b', 'rls-verify-org-b', 'RLS Verify B', now());

INSERT INTO public."Sermon" (
  id, "organizationId", "youtubeUrl", title, "speakerName", "churchName",
  language, "rightsConfirmed", "updatedAt"
) VALUES
  ('rls_verify_sermon_a', 'rls_verify_org_a', 'https://example.test/a', 'A', 'Pastor A', 'Church A', 'English', true, now()),
  ('rls_verify_sermon_b', 'rls_verify_org_b', 'https://example.test/b', 'B', 'Pastor B', 'Church B', 'English', true, now());

INSERT INTO public."ProcessingJob" (id, "sermonId", type, "updatedAt") VALUES
  ('rls_verify_job_a', 'rls_verify_sermon_a', 'PROCESS_SERMON', now()),
  ('rls_verify_job_b', 'rls_verify_sermon_b', 'PROCESS_SERMON', now());

SET LOCAL ROLE sermon_clip_rls_verifier;
SELECT set_config('sermon_clip.organization_id', 'rls_verify_org_a', true);

DO $$
DECLARE
  visible_sermons integer;
  visible_jobs integer;
  cross_tenant_sermons integer;
BEGIN
  SELECT count(*) INTO visible_sermons
  FROM public."Sermon"
  WHERE id IN ('rls_verify_sermon_a', 'rls_verify_sermon_b');

  SELECT count(*) INTO visible_jobs
  FROM public."ProcessingJob"
  WHERE id IN ('rls_verify_job_a', 'rls_verify_job_b');

  SELECT count(*) INTO cross_tenant_sermons
  FROM public."Sermon"
  WHERE id = 'rls_verify_sermon_b';

  IF visible_sermons <> 1 OR visible_jobs <> 1 OR cross_tenant_sermons <> 0 THEN
    RAISE EXCEPTION
      'RLS verification failed: sermons=%, jobs=%, cross_tenant=%',
      visible_sermons, visible_jobs, cross_tenant_sermons;
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;

\echo 'Tenant RLS verification passed; temporary role and fixtures were rolled back.'
