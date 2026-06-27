ALTER TABLE "ClipCandidate" ADD COLUMN "captionBurnStatus" TEXT NOT NULL DEFAULT 'NOT_BURNED';
ALTER TABLE "ClipCandidate" ADD COLUMN "captionedVideoPath" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN "captionBurnedAt" DATETIME;
ALTER TABLE "ClipCandidate" ADD COLUMN "captionBurnError" TEXT;
