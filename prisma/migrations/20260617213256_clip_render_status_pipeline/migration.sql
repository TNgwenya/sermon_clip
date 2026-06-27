-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ClipCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sermonId" TEXT NOT NULL,
    "startTimeSeconds" REAL NOT NULL,
    "endTimeSeconds" REAL NOT NULL,
    "durationSeconds" REAL NOT NULL,
    "originalStartTimeSeconds" REAL,
    "originalEndTimeSeconds" REAL,
    "adjustedStartTimeSeconds" REAL,
    "adjustedEndTimeSeconds" REAL,
    "boundaryAdjustmentReason" TEXT,
    "boundaryQuality" TEXT NOT NULL DEFAULT 'GOOD',
    "renderStatus" TEXT NOT NULL DEFAULT 'NOT_RENDERED',
    "renderedAt" DATETIME,
    "renderError" TEXT,
    "renderedFilePath" TEXT,
    "renderedDurationSeconds" REAL,
    "renderedSizeBytes" INTEGER,
    "transcriptText" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "hashtags" JSONB NOT NULL,
    "score" REAL NOT NULL,
    "reasonSelected" TEXT NOT NULL,
    "clipType" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "riskReasons" JSONB NOT NULL,
    "contextWarning" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "exportPath" TEXT,
    "srtPath" TEXT,
    "subtitlesGenerated" BOOLEAN NOT NULL DEFAULT false,
    "subtitlesBurned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClipCandidate_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ClipCandidate" ("adjustedEndTimeSeconds", "adjustedStartTimeSeconds", "boundaryAdjustmentReason", "boundaryQuality", "caption", "clipType", "contextWarning", "createdAt", "durationSeconds", "endTimeSeconds", "exportPath", "hashtags", "hook", "id", "originalEndTimeSeconds", "originalStartTimeSeconds", "reasonSelected", "riskLevel", "riskReasons", "score", "sermonId", "srtPath", "startTimeSeconds", "status", "subtitlesBurned", "subtitlesGenerated", "title", "transcriptText", "updatedAt") SELECT "adjustedEndTimeSeconds", "adjustedStartTimeSeconds", "boundaryAdjustmentReason", "boundaryQuality", "caption", "clipType", "contextWarning", "createdAt", "durationSeconds", "endTimeSeconds", "exportPath", "hashtags", "hook", "id", "originalEndTimeSeconds", "originalStartTimeSeconds", "reasonSelected", "riskLevel", "riskReasons", "score", "sermonId", "srtPath", "startTimeSeconds", "status", "subtitlesBurned", "subtitlesGenerated", "title", "transcriptText", "updatedAt" FROM "ClipCandidate";
DROP TABLE "ClipCandidate";
ALTER TABLE "new_ClipCandidate" RENAME TO "ClipCandidate";
CREATE INDEX "ClipCandidate_sermonId_idx" ON "ClipCandidate"("sermonId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
