CREATE TYPE "ClipEditPlanStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

CREATE TYPE "ClipArtifactKind" AS ENUM ('RENDERED_SOURCE', 'CAPTIONED', 'OVERLAY', 'EXPORT', 'THUMBNAIL', 'REMOTE_PREVIEW');

CREATE TYPE "ClipArtifactStatus" AS ENUM ('READY', 'FAILED', 'DELETED');

CREATE TYPE "AiInvocationStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'VALIDATION_FAILED');

CREATE TABLE "ClipEditPlan" (
  "id" TEXT NOT NULL,
  "clipCandidateId" TEXT NOT NULL,
  "sermonId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "ClipEditPlanStatus" NOT NULL DEFAULT 'ACTIVE',
  "planHash" TEXT NOT NULL,
  "sourceStartTimeSeconds" DOUBLE PRECISION NOT NULL,
  "sourceEndTimeSeconds" DOUBLE PRECISION NOT NULL,
  "cleanedDurationSeconds" DOUBLE PRECISION,
  "planJson" JSONB NOT NULL,
  "cleanupPlanJson" JSONB,
  "captionCueHash" TEXT,
  "cropPlanHash" TEXT,
  "exportSettingsHash" TEXT,
  "createdBy" TEXT NOT NULL DEFAULT 'system',
  "createdReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClipEditPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClipArtifact" (
  "id" TEXT NOT NULL,
  "clipCandidateId" TEXT NOT NULL,
  "sermonId" TEXT NOT NULL,
  "editPlanId" TEXT,
  "kind" "ClipArtifactKind" NOT NULL,
  "status" "ClipArtifactStatus" NOT NULL DEFAULT 'READY',
  "freshness" "AssetFreshness" NOT NULL DEFAULT 'UP_TO_DATE',
  "format" "ClipExportFormat",
  "planHash" TEXT,
  "filePath" TEXT,
  "objectKey" TEXT,
  "publicUrl" TEXT,
  "sizeBytes" INTEGER,
  "durationSeconds" DOUBLE PRECISION,
  "errorMessage" TEXT,
  "metadataJson" JSONB,
  "generatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClipArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiInvocation" (
  "id" TEXT NOT NULL,
  "sermonId" TEXT,
  "clipCandidateId" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'openai',
  "operation" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "promptVersion" TEXT,
  "requestHash" TEXT,
  "status" "AiInvocationStatus" NOT NULL,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "totalTokens" INTEGER,
  "estimatedCostMicros" BIGINT,
  "latencyMs" INTEGER,
  "errorMessage" TEXT,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiInvocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClipEditPlan_clipCandidateId_version_key" ON "ClipEditPlan"("clipCandidateId", "version");
CREATE INDEX "ClipEditPlan_clipCandidateId_status_idx" ON "ClipEditPlan"("clipCandidateId", "status");
CREATE INDEX "ClipEditPlan_sermonId_idx" ON "ClipEditPlan"("sermonId");
CREATE INDEX "ClipEditPlan_planHash_idx" ON "ClipEditPlan"("planHash");
CREATE INDEX "ClipEditPlan_createdAt_idx" ON "ClipEditPlan"("createdAt");

CREATE INDEX "ClipArtifact_clipCandidateId_idx" ON "ClipArtifact"("clipCandidateId");
CREATE INDEX "ClipArtifact_sermonId_idx" ON "ClipArtifact"("sermonId");
CREATE INDEX "ClipArtifact_editPlanId_idx" ON "ClipArtifact"("editPlanId");
CREATE INDEX "ClipArtifact_kind_idx" ON "ClipArtifact"("kind");
CREATE INDEX "ClipArtifact_status_idx" ON "ClipArtifact"("status");
CREATE INDEX "ClipArtifact_planHash_idx" ON "ClipArtifact"("planHash");

CREATE INDEX "AiInvocation_sermonId_idx" ON "AiInvocation"("sermonId");
CREATE INDEX "AiInvocation_clipCandidateId_idx" ON "AiInvocation"("clipCandidateId");
CREATE INDEX "AiInvocation_operation_idx" ON "AiInvocation"("operation");
CREATE INDEX "AiInvocation_model_idx" ON "AiInvocation"("model");
CREATE INDEX "AiInvocation_status_idx" ON "AiInvocation"("status");
CREATE INDEX "AiInvocation_createdAt_idx" ON "AiInvocation"("createdAt");

ALTER TABLE "ClipEditPlan" ADD CONSTRAINT "ClipEditPlan_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClipEditPlan" ADD CONSTRAINT "ClipEditPlan_clipCandidateId_fkey" FOREIGN KEY ("clipCandidateId") REFERENCES "ClipCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClipArtifact" ADD CONSTRAINT "ClipArtifact_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClipArtifact" ADD CONSTRAINT "ClipArtifact_clipCandidateId_fkey" FOREIGN KEY ("clipCandidateId") REFERENCES "ClipCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClipArtifact" ADD CONSTRAINT "ClipArtifact_editPlanId_fkey" FOREIGN KEY ("editPlanId") REFERENCES "ClipEditPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiInvocation" ADD CONSTRAINT "AiInvocation_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiInvocation" ADD CONSTRAINT "AiInvocation_clipCandidateId_fkey" FOREIGN KEY ("clipCandidateId") REFERENCES "ClipCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
