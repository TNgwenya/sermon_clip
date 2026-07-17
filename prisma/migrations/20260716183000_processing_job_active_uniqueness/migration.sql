-- Prevent duplicate expensive processing when requests race between the
-- initial lookup and insert. Completed/failed history remains unrestricted.
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
    ) AS duplicate_rank
  FROM "ProcessingJob"
  WHERE "status" IN ('PENDING', 'RUNNING')
    AND "type" IN (
      'DOWNLOAD_VIDEO',
      'EXTRACT_AUDIO',
      'TRANSCRIBE_AUDIO',
      'GENERATE_CLIPS',
      'PROCESS_SERMON',
      'GENERATE_INTELLIGENCE',
      'QUALITY_REFRESH'
    )
)
UPDATE "ProcessingJob" AS job
SET
  "status" = 'FAILED',
  "completedAt" = NOW(),
  "heartbeatAt" = NULL,
  "errorMessage" = 'Superseded by another active job during concurrency hardening.',
  "updatedAt" = NOW()
FROM ranked_active_jobs
WHERE job."id" = ranked_active_jobs."id"
  AND ranked_active_jobs.duplicate_rank > 1;

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
    'QUALITY_REFRESH'
  );
