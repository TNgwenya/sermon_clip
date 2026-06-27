-- CreateTable: MinistryMoment
CREATE TABLE "MinistryMoment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sermonId" TEXT NOT NULL,
    "momentType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startTimeSeconds" REAL,
    "endTimeSeconds" REAL,
    "confidenceScore" REAL NOT NULL,
    "transcriptExcerpt" TEXT,
    "whyDetected" TEXT,
    "suggestedAudience" TEXT,
    "suggestedUsage" TEXT,
    "clipCategory" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "isManuallyAdjusted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MinistryMoment_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable: ClipCandidate
ALTER TABLE "ClipCandidate" ADD COLUMN "ministryMomentId" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN "smartClipCategory" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN "recommendationReason" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN "intendedAudience" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN "ministryValue" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN "socialValue" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN "suggestedHook" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN "suggestedCaption" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN "recommendationConfidence" REAL;
ALTER TABLE "ClipCandidate" ADD COLUMN "isAiGenerated" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ClipCandidate" ADD COLUMN "isManuallyEdited" BOOLEAN NOT NULL DEFAULT false;

-- Indexes
CREATE INDEX "MinistryMoment_sermonId_idx" ON "MinistryMoment"("sermonId");
CREATE INDEX "MinistryMoment_sermonId_momentType_idx" ON "MinistryMoment"("sermonId", "momentType");
CREATE INDEX "MinistryMoment_sermonId_reviewStatus_idx" ON "MinistryMoment"("sermonId", "reviewStatus");
CREATE INDEX "MinistryMoment_clipCategory_idx" ON "MinistryMoment"("clipCategory");
CREATE INDEX "MinistryMoment_startTimeSeconds_endTimeSeconds_idx" ON "MinistryMoment"("startTimeSeconds", "endTimeSeconds");

CREATE INDEX "ClipCandidate_sermonId_smartClipCategory_idx" ON "ClipCandidate"("sermonId", "smartClipCategory");
CREATE INDEX "ClipCandidate_ministryMomentId_idx" ON "ClipCandidate"("ministryMomentId");
