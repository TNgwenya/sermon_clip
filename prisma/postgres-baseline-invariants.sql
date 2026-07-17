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
      'QUALITY_REFRESH'
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
    'QUALITY_REFRESH'
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
