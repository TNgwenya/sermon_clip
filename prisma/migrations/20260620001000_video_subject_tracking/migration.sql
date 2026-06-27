CREATE TABLE "VideoSubjectTrack" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clipCandidateId" TEXT NOT NULL,
  "sermonId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'HEURISTIC_CENTER',
  "label" TEXT NOT NULL,
  "confidenceScore" REAL NOT NULL,
  "startTimeSeconds" REAL NOT NULL,
  "endTimeSeconds" REAL NOT NULL,
  "frameWidth" INTEGER,
  "frameHeight" INTEGER,
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "boxesJson" JSONB NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "VideoSubjectTrack_clipCandidateId_fkey" FOREIGN KEY ("clipCandidateId") REFERENCES "ClipCandidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "VideoSubjectTrack_clipCandidateId_idx" ON "VideoSubjectTrack"("clipCandidateId");
CREATE INDEX "VideoSubjectTrack_sermonId_idx" ON "VideoSubjectTrack"("sermonId");
CREATE INDEX "VideoSubjectTrack_kind_idx" ON "VideoSubjectTrack"("kind");
CREATE INDEX "VideoSubjectTrack_source_idx" ON "VideoSubjectTrack"("source");
