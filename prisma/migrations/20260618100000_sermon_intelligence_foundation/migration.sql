-- CreateTable: SermonIntelligence
CREATE TABLE "SermonIntelligence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sermonId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "generatedTitle" TEXT,
    "summary" TEXT,
    "centralTheme" TEXT,
    "shortOverview" TEXT,
    "keyTakeaways" BLOB,
    "confidenceScore" REAL,
    "isManuallyReviewed" BOOLEAN NOT NULL DEFAULT false,
    "manualTitle" TEXT,
    "manualSummary" TEXT,
    "manualCentralTheme" TEXT,
    "failureReason" TEXT,
    "generatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SermonIntelligence_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: SermonScriptureRef
CREATE TABLE "SermonScriptureRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sermonId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "book" TEXT,
    "chapter" INTEGER,
    "verseStart" INTEGER,
    "verseEnd" INTEGER,
    "usageType" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "frequencyCount" INTEGER NOT NULL DEFAULT 1,
    "confidenceScore" REAL NOT NULL,
    "transcriptEvidence" TEXT,
    "isManuallyAdded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SermonScriptureRef_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: SermonStructureSection
CREATE TABLE "SermonStructureSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sermonId" TEXT NOT NULL,
    "sectionType" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "startTimeSeconds" REAL,
    "endTimeSeconds" REAL,
    "confidenceScore" REAL NOT NULL,
    "transcriptExcerpt" TEXT,
    "isManuallyLabeled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SermonStructureSection_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: SermonTopicTag
CREATE TABLE "SermonTopicTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sermonId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "confidenceScore" REAL NOT NULL,
    "evidence" TEXT,
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "isManuallyAdded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SermonTopicTag_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SermonIntelligence_sermonId_key" ON "SermonIntelligence"("sermonId");
CREATE INDEX "SermonIntelligence_sermonId_idx" ON "SermonIntelligence"("sermonId");
CREATE INDEX "SermonScriptureRef_sermonId_idx" ON "SermonScriptureRef"("sermonId");
CREATE INDEX "SermonScriptureRef_sermonId_usageType_idx" ON "SermonScriptureRef"("sermonId", "usageType");
CREATE INDEX "SermonStructureSection_sermonId_idx" ON "SermonStructureSection"("sermonId");
CREATE INDEX "SermonTopicTag_sermonId_idx" ON "SermonTopicTag"("sermonId");
CREATE INDEX "SermonTopicTag_topic_idx" ON "SermonTopicTag"("topic");
