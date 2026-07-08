CREATE TYPE "ClipTranscriptSafetyStatus" AS ENUM ('TRUSTED', 'REVIEW_REQUIRED', 'REVIEWED');

ALTER TABLE "ClipCandidate"
ADD COLUMN "transcriptSafetyStatus" "ClipTranscriptSafetyStatus" NOT NULL DEFAULT 'TRUSTED',
ADD COLUMN "transcriptSafetyReasons" JSONB,
ADD COLUMN "transcriptSafetyReviewedAt" TIMESTAMP(3),
ADD COLUMN "transcriptSafetyReviewedBy" TEXT;

CREATE INDEX "ClipCandidate_sermonId_transcriptSafetyStatus_idx" ON "ClipCandidate"("sermonId", "transcriptSafetyStatus");
