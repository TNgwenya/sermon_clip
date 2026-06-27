ALTER TABLE "ClipCandidate" ADD COLUMN "completenessScore" REAL;
ALTER TABLE "ClipCandidate" ADD COLUMN "completenessAction" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN "completenessReason" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN "completenessWarnings" JSONB;
ALTER TABLE "ClipCandidate" ADD COLUMN "completenessReviewedAt" DATETIME;
ALTER TABLE "ClipCandidate" ADD COLUMN "completenessReviewSource" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN "previousAdjustedStartTimeSeconds" REAL;
ALTER TABLE "ClipCandidate" ADD COLUMN "previousAdjustedEndTimeSeconds" REAL;

CREATE INDEX "ClipCandidate_completenessScore_idx" ON "ClipCandidate"("completenessScore");
