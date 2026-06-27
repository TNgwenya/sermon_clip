ALTER TABLE "ClipCandidate" ADD COLUMN "captionStatus" TEXT NOT NULL DEFAULT 'NOT_GENERATED';
ALTER TABLE "ClipCandidate" ADD COLUMN "subtitleFilePath" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN "captionGeneratedAt" DATETIME;
ALTER TABLE "ClipCandidate" ADD COLUMN "captionGenerationError" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN "captionData" JSONB;
