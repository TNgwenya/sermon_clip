ALTER TYPE "ProcessingJobType" ADD VALUE IF NOT EXISTS 'GENERATE_TEACHING_VIDEOS';
ALTER TYPE "ProcessingJobType" ADD VALUE IF NOT EXISTS 'EXPORT_TEACHING_VIDEOS';

CREATE TYPE "TeachingVideoAnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "TeachingVideoStatus" AS ENUM ('SUGGESTED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "TeachingBoundaryQuality" AS ENUM ('GOOD', 'NEEDS_REVIEW', 'BLOCKED');
CREATE TYPE "TeachingVideoType" AS ENUM (
  'SCRIPTURE_EXPOSITION',
  'DOCTRINAL_EXPLANATION',
  'PRACTICAL_APPLICATION',
  'PASTORAL_COUNSEL',
  'LEADERSHIP_TEACHING',
  'OTHER'
);
CREATE TYPE "TeachingVideoExportStatus" AS ENUM ('QUEUED', 'EXPORTING', 'COMPLETED', 'FAILED', 'STALE');

CREATE TABLE "TeachingVideoAnalysisRun" (
  "id" TEXT NOT NULL,
  "sermonId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campusId" TEXT,
  "status" "TeachingVideoAnalysisStatus" NOT NULL DEFAULT 'PENDING',
  "transcriptFingerprint" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "configJson" JSONB,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeachingVideoAnalysisRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeachingVideo" (
  "id" TEXT NOT NULL,
  "analysisRunId" TEXT NOT NULL,
  "sermonId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campusId" TEXT,
  "status" "TeachingVideoStatus" NOT NULL DEFAULT 'SUGGESTED',
  "teachingType" "TeachingVideoType" NOT NULL DEFAULT 'OTHER',
  "aiTitle" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "suggestedStartSeconds" DOUBLE PRECISION NOT NULL,
  "suggestedEndSeconds" DOUBLE PRECISION NOT NULL,
  "startTimeSeconds" DOUBLE PRECISION NOT NULL,
  "endTimeSeconds" DOUBLE PRECISION NOT NULL,
  "durationSeconds" DOUBLE PRECISION NOT NULL,
  "startAnchorId" TEXT NOT NULL,
  "endAnchorId" TEXT NOT NULL,
  "boundaryQuality" "TeachingBoundaryQuality" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "standaloneScore" DOUBLE PRECISION NOT NULL,
  "boundaryConfidence" DOUBLE PRECISION NOT NULL,
  "titleEvidence" TEXT,
  "startReason" TEXT NOT NULL,
  "endReason" TEXT NOT NULL,
  "durationExceptionReason" TEXT,
  "contextDependenciesJson" JSONB,
  "riskFlagsJson" JSONB,
  "completenessJson" JSONB NOT NULL,
  "boundaryValidationJson" JSONB,
  "transcriptExcerpt" TEXT NOT NULL,
  "transcriptFingerprint" TEXT NOT NULL,
  "revisionVersion" INTEGER NOT NULL DEFAULT 1,
  "approvedRevisionVersion" INTEGER,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeachingVideo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeachingVideoRevision" (
  "id" TEXT NOT NULL,
  "teachingVideoId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "startTimeSeconds" DOUBLE PRECISION NOT NULL,
  "endTimeSeconds" DOUBLE PRECISION NOT NULL,
  "durationSeconds" DOUBLE PRECISION NOT NULL,
  "startAnchorId" TEXT NOT NULL,
  "endAnchorId" TEXT NOT NULL,
  "boundaryQuality" "TeachingBoundaryQuality" NOT NULL,
  "boundaryValidationJson" JSONB,
  "transcriptFingerprint" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeachingVideoRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeachingVideoExport" (
  "id" TEXT NOT NULL,
  "teachingVideoId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "sermonId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campusId" TEXT,
  "status" "TeachingVideoExportStatus" NOT NULL DEFAULT 'QUEUED',
  "format" TEXT NOT NULL DEFAULT 'SOURCE_ASPECT',
  "filePath" TEXT,
  "objectKey" TEXT,
  "sizeBytes" BIGINT,
  "checksumSha256" TEXT,
  "durationSeconds" DOUBLE PRECISION,
  "metadataJson" JSONB,
  "errorMessage" TEXT,
  "generatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeachingVideoExport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeachingVideoAnalysisRun_sermonId_createdAt_idx" ON "TeachingVideoAnalysisRun"("sermonId", "createdAt");
CREATE INDEX "TeachingVideoAnalysisRun_organizationId_status_createdAt_idx" ON "TeachingVideoAnalysisRun"("organizationId", "status", "createdAt");
CREATE INDEX "TeachingVideoAnalysisRun_campusId_createdAt_idx" ON "TeachingVideoAnalysisRun"("campusId", "createdAt");
CREATE INDEX "TeachingVideoAnalysisRun_transcriptFingerprint_idx" ON "TeachingVideoAnalysisRun"("transcriptFingerprint");
CREATE INDEX "TeachingVideo_sermonId_status_startTimeSeconds_idx" ON "TeachingVideo"("sermonId", "status", "startTimeSeconds");
CREATE INDEX "TeachingVideo_analysisRunId_idx" ON "TeachingVideo"("analysisRunId");
CREATE INDEX "TeachingVideo_organizationId_status_createdAt_idx" ON "TeachingVideo"("organizationId", "status", "createdAt");
CREATE INDEX "TeachingVideo_campusId_createdAt_idx" ON "TeachingVideo"("campusId", "createdAt");
CREATE UNIQUE INDEX "TeachingVideoRevision_teachingVideoId_version_key" ON "TeachingVideoRevision"("teachingVideoId", "version");
CREATE INDEX "TeachingVideoRevision_teachingVideoId_createdAt_idx" ON "TeachingVideoRevision"("teachingVideoId", "createdAt");
CREATE UNIQUE INDEX "TeachingVideoExport_revisionId_key" ON "TeachingVideoExport"("revisionId");
CREATE INDEX "TeachingVideoExport_teachingVideoId_status_idx" ON "TeachingVideoExport"("teachingVideoId", "status");
CREATE INDEX "TeachingVideoExport_sermonId_status_createdAt_idx" ON "TeachingVideoExport"("sermonId", "status", "createdAt");
CREATE INDEX "TeachingVideoExport_organizationId_status_createdAt_idx" ON "TeachingVideoExport"("organizationId", "status", "createdAt");
CREATE INDEX "TeachingVideoExport_campusId_createdAt_idx" ON "TeachingVideoExport"("campusId", "createdAt");

ALTER TABLE "TeachingVideoAnalysisRun"
ADD CONSTRAINT "TeachingVideoAnalysisRun_sermonId_fkey"
FOREIGN KEY ("sermonId") REFERENCES "Sermon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeachingVideo"
ADD CONSTRAINT "TeachingVideo_analysisRunId_fkey"
FOREIGN KEY ("analysisRunId") REFERENCES "TeachingVideoAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeachingVideo"
ADD CONSTRAINT "TeachingVideo_sermonId_fkey"
FOREIGN KEY ("sermonId") REFERENCES "Sermon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeachingVideoRevision"
ADD CONSTRAINT "TeachingVideoRevision_teachingVideoId_fkey"
FOREIGN KEY ("teachingVideoId") REFERENCES "TeachingVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeachingVideoExport"
ADD CONSTRAINT "TeachingVideoExport_teachingVideoId_fkey"
FOREIGN KEY ("teachingVideoId") REFERENCES "TeachingVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeachingVideoExport"
ADD CONSTRAINT "TeachingVideoExport_revisionId_fkey"
FOREIGN KEY ("revisionId") REFERENCES "TeachingVideoRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeachingVideoExport"
ADD CONSTRAINT "TeachingVideoExport_sermonId_fkey"
FOREIGN KEY ("sermonId") REFERENCES "Sermon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
