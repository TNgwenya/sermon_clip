CREATE TABLE "SermonSubjectTrack" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sermonId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "evidence" TEXT,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "confidenceScore" REAL NOT NULL,
  "firstStartTimeSeconds" REAL,
  "lastEndTimeSeconds" REAL,
  "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SermonSubjectTrack_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SermonSpeakerTrack" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sermonId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "segmentCount" INTEGER NOT NULL DEFAULT 0,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "firstStartTimeSeconds" REAL,
  "lastEndTimeSeconds" REAL,
  "confidenceScore" REAL NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SermonSpeakerTrack_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SermonSubjectTrack_sermonId_label_kind_key" ON "SermonSubjectTrack"("sermonId", "label", "kind");
CREATE INDEX "SermonSubjectTrack_sermonId_idx" ON "SermonSubjectTrack"("sermonId");
CREATE INDEX "SermonSubjectTrack_kind_idx" ON "SermonSubjectTrack"("kind");
CREATE INDEX "SermonSubjectTrack_label_idx" ON "SermonSubjectTrack"("label");

CREATE UNIQUE INDEX "SermonSpeakerTrack_sermonId_label_key" ON "SermonSpeakerTrack"("sermonId", "label");
CREATE INDEX "SermonSpeakerTrack_sermonId_idx" ON "SermonSpeakerTrack"("sermonId");
CREATE INDEX "SermonSpeakerTrack_displayName_idx" ON "SermonSpeakerTrack"("displayName");
CREATE INDEX "SermonSpeakerTrack_isPrimary_idx" ON "SermonSpeakerTrack"("isPrimary");
