\set ON_ERROR_STOP on

-- Run only against a disposable database after Phase 1 and Phase 2 migrations:
--   psql "$ISOLATED_DATABASE_URL" -f scripts/verify-orchestration-rls.sql
-- The temporary role and all fixtures are rolled back.

BEGIN;

CREATE ROLE sermon_clip_orchestration_rls_verifier NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO sermon_clip_orchestration_rls_verifier;
GRANT SELECT ON TABLE public."OrchestrationJob", public."OrchestrationOutboxEvent"
  TO sermon_clip_orchestration_rls_verifier;

INSERT INTO public."Organization" (id, slug, name, "updatedAt") VALUES
  ('orchestration_rls_org_a', 'orchestration-rls-org-a', 'Orchestration RLS A', now()),
  ('orchestration_rls_org_b', 'orchestration-rls-org-b', 'Orchestration RLS B', now());

INSERT INTO public."Sermon" (
  id, "organizationId", "youtubeUrl", title, "speakerName", "churchName",
  language, "rightsConfirmed", "updatedAt"
) VALUES
  ('orchestration_rls_sermon_a', 'orchestration_rls_org_a', 'https://example.test/a', 'A', 'Pastor A', 'Church A', 'English', true, now()),
  ('orchestration_rls_sermon_b', 'orchestration_rls_org_b', 'https://example.test/b', 'B', 'Pastor B', 'Church B', 'English', true, now());

INSERT INTO public."OrchestrationJob" (
  id, "organizationId", "sermonId", lane, "idempotencyKey", "intentHash",
  "payloadJson", "correlationId", "updatedAt"
) VALUES
  ('orchestration_rls_job_a', 'orchestration_rls_org_a', 'orchestration_rls_sermon_a', 'TRANSCRIPTION', 'key-a', 'intent-a', '{}', 'correlation-a', now()),
  ('orchestration_rls_job_b', 'orchestration_rls_org_b', 'orchestration_rls_sermon_b', 'TRANSCRIPTION', 'key-b', 'intent-b', '{}', 'correlation-b', now());

INSERT INTO public."OrchestrationOutboxEvent" (
  id, "organizationId", "orchestrationJobId", "deliverySequence", topic,
  "messageKey", "payloadJson", "updatedAt"
) VALUES
  ('orchestration_rls_outbox_a', 'orchestration_rls_org_a', 'orchestration_rls_job_a', 1, 'test', 'message-a', '{}', now()),
  ('orchestration_rls_outbox_b', 'orchestration_rls_org_b', 'orchestration_rls_job_b', 1, 'test', 'message-b', '{}', now());

SET LOCAL ROLE sermon_clip_orchestration_rls_verifier;
SELECT set_config('sermon_clip.organization_id', 'orchestration_rls_org_a', true);

DO $$
DECLARE
  visible_jobs integer;
  visible_outbox integer;
  cross_tenant_jobs integer;
BEGIN
  SELECT count(*) INTO visible_jobs
  FROM public."OrchestrationJob"
  WHERE id IN ('orchestration_rls_job_a', 'orchestration_rls_job_b');

  SELECT count(*) INTO visible_outbox
  FROM public."OrchestrationOutboxEvent"
  WHERE id IN ('orchestration_rls_outbox_a', 'orchestration_rls_outbox_b');

  SELECT count(*) INTO cross_tenant_jobs
  FROM public."OrchestrationJob"
  WHERE id = 'orchestration_rls_job_b';

  IF visible_jobs <> 1 OR visible_outbox <> 1 OR cross_tenant_jobs <> 0 THEN
    RAISE EXCEPTION
      'Orchestration RLS verification failed: jobs=%, outbox=%, cross_tenant=%',
      visible_jobs, visible_outbox, cross_tenant_jobs;
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;

\echo 'Orchestration tenant RLS verification passed; temporary role and fixtures were rolled back.'
