-- Preserve provider-derived word timing evidence for exact caption alignment.
-- The value is nullable so transcripts from providers without word timestamps
-- remain valid and existing transcript rows require no backfill.
ALTER TABLE "Transcript"
ADD COLUMN "wordTimings" JSONB;
