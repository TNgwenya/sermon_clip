CREATE TABLE "ContentOpportunity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sermonId" TEXT NOT NULL,
  "churchName" TEXT,
  "category" TEXT NOT NULL,
  "opportunityType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "bodyContent" TEXT NOT NULL,
  "shortDescription" TEXT,
  "sourceTranscriptExcerpt" TEXT,
  "relatedScripture" TEXT,
  "ministryMomentId" TEXT,
  "relatedClipId" TEXT,
  "suggestedPlatform" TEXT,
  "confidenceScore" REAL,
  "aiReason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
  "editedContent" TEXT,
  "approvedContent" TEXT,
  "isAiGenerated" BOOLEAN NOT NULL DEFAULT true,
  "isManuallyCreated" BOOLEAN NOT NULL DEFAULT false,
  "isManuallyEdited" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ContentOpportunity_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContentOpportunity_ministryMomentId_fkey" FOREIGN KEY ("ministryMomentId") REFERENCES "MinistryMoment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ContentOpportunity_relatedClipId_fkey" FOREIGN KEY ("relatedClipId") REFERENCES "ClipCandidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ContentOpportunity_sermonId_idx" ON "ContentOpportunity"("sermonId");
CREATE INDEX "ContentOpportunity_sermonId_category_idx" ON "ContentOpportunity"("sermonId", "category");
CREATE INDEX "ContentOpportunity_sermonId_opportunityType_idx" ON "ContentOpportunity"("sermonId", "opportunityType");
CREATE INDEX "ContentOpportunity_sermonId_status_idx" ON "ContentOpportunity"("sermonId", "status");
CREATE INDEX "ContentOpportunity_churchName_idx" ON "ContentOpportunity"("churchName");
CREATE INDEX "ContentOpportunity_ministryMomentId_idx" ON "ContentOpportunity"("ministryMomentId");
CREATE INDEX "ContentOpportunity_relatedClipId_idx" ON "ContentOpportunity"("relatedClipId");
