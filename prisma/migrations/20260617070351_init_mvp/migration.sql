-- CreateTable
CREATE TABLE "Sermon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "youtubeUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "speakerName" TEXT NOT NULL,
    "churchName" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "sermonDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "rightsConfirmed" BOOLEAN NOT NULL,
    "sourceVideoPath" TEXT,
    "audioPath" TEXT,
    "transcriptJsonPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sermonId" TEXT NOT NULL,
    "fullText" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "rawJsonPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transcript_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sermonId" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "startTimeSeconds" REAL NOT NULL,
    "endTimeSeconds" REAL NOT NULL,
    "text" TEXT NOT NULL,
    "speakerLabel" TEXT,
    "confidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TranscriptSegment_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TranscriptSegment_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClipCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sermonId" TEXT NOT NULL,
    "startTimeSeconds" REAL NOT NULL,
    "endTimeSeconds" REAL NOT NULL,
    "durationSeconds" REAL NOT NULL,
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

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sermonId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "errorMessage" TEXT,
    "logs" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProcessingJob_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_sermonId_key" ON "Transcript"("sermonId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_sermonId_idx" ON "TranscriptSegment"("sermonId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_transcriptId_idx" ON "TranscriptSegment"("transcriptId");

-- CreateIndex
CREATE INDEX "ClipCandidate_sermonId_idx" ON "ClipCandidate"("sermonId");

-- CreateIndex
CREATE INDEX "ProcessingJob_sermonId_idx" ON "ProcessingJob"("sermonId");
