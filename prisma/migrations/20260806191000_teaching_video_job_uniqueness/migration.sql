-- Keep teaching discovery idempotent under concurrent requests. Export jobs use
-- the media-asset successor queue and are deliberately excluded from this
-- single-active-job index.
DROP INDEX IF EXISTS "ProcessingJob_one_active_type_per_sermon_key";

CREATE UNIQUE INDEX "ProcessingJob_one_active_type_per_sermon_key"
ON "ProcessingJob" ("sermonId", "type")
WHERE "status" IN ('PENDING', 'RUNNING')
  AND "type" IN (
    'DOWNLOAD_VIDEO',
    'EXTRACT_AUDIO',
    'TRANSCRIBE_AUDIO',
    'GENERATE_CLIPS',
    'GENERATE_TEACHING_VIDEOS',
    'PROCESS_SERMON',
    'GENERATE_INTELLIGENCE',
    'QUALITY_REFRESH'
  );
