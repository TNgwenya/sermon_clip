-- Live-stream intake is additive and remains disabled until a provider token is configured.
CREATE TYPE "LiveIntakeStatus" AS ENUM ('PROVISIONING', 'READY', 'DISABLED', 'ERROR');
CREATE TYPE "LiveRecordingStatus" AS ENUM ('RECEIVED', 'MATERIALIZING', 'QUEUED', 'FAILED', 'IGNORED');

CREATE TABLE "LiveIntake" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campusId" TEXT,
  "provider" TEXT NOT NULL,
  "providerInputId" TEXT NOT NULL,
  "status" "LiveIntakeStatus" NOT NULL DEFAULT 'PROVISIONING',
  "label" TEXT NOT NULL,
  "recordingRetentionDays" INTEGER NOT NULL DEFAULT 30,
  "lastStreamStartedAt" TIMESTAMP(3), "lastStreamEndedAt" TIMESTAMP(3),
  "lastError" TEXT, "rotatedAt" TIMESTAMP(3), "disabledAt" TIMESTAMP(3),
  "createdByUserId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiveIntake_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LiveIntake_retention_check" CHECK ("recordingRetentionDays" BETWEEN 1 AND 90)
);
CREATE UNIQUE INDEX "LiveIntake_providerInputId_key" ON "LiveIntake"("providerInputId");
CREATE UNIQUE INDEX "LiveIntake_organizationId_campusId_key" ON "LiveIntake"("organizationId", "campusId");
CREATE UNIQUE INDEX "LiveIntake_id_organizationId_key" ON "LiveIntake"("id", "organizationId");
CREATE INDEX "LiveIntake_organizationId_status_idx" ON "LiveIntake"("organizationId", "status");

CREATE TABLE "LiveRecording" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "liveIntakeId" TEXT NOT NULL,
  "providerRecordingId" TEXT NOT NULL, "status" "LiveRecordingStatus" NOT NULL DEFAULT 'RECEIVED',
  "title" TEXT, "durationSeconds" INTEGER, "sourceUrl" TEXT, "sermonId" TEXT UNIQUE,
  "failureReason" TEXT, "materializationAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastMaterializationAttemptAt" TIMESTAMP(3), "nextMaterializationAttemptAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "queuedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiveRecording_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LiveRecording_duration_check" CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0)
);
CREATE UNIQUE INDEX "LiveRecording_liveIntakeId_providerRecordingId_key" ON "LiveRecording"("liveIntakeId", "providerRecordingId");
CREATE INDEX "LiveRecording_organizationId_status_createdAt_idx" ON "LiveRecording"("organizationId", "status", "createdAt");
CREATE INDEX "LiveRecording_status_nextMaterializationAttemptAt_idx" ON "LiveRecording"("status", "nextMaterializationAttemptAt");

ALTER TABLE "LiveIntake" ADD CONSTRAINT "LiveIntake_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT;
ALTER TABLE "LiveIntake" ADD CONSTRAINT "LiveIntake_campusId_organizationId_fkey" FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId") ON DELETE SET NULL;
ALTER TABLE "LiveRecording" ADD CONSTRAINT "LiveRecording_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT;
ALTER TABLE "LiveRecording" ADD CONSTRAINT "LiveRecording_intake_tenant_fkey" FOREIGN KEY ("liveIntakeId", "organizationId") REFERENCES "LiveIntake"("id", "organizationId") ON DELETE CASCADE;
ALTER TABLE "LiveRecording" ADD CONSTRAINT "LiveRecording_sermon_fkey" FOREIGN KEY ("sermonId") REFERENCES "Sermon"("id") ON DELETE SET NULL;

ALTER TABLE public."LiveIntake" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "LiveIntake_pilot_tenant_isolation" ON public."LiveIntake" USING (public.sermon_clip_tenant_row_visible("organizationId")) WITH CHECK (public.sermon_clip_tenant_row_visible("organizationId"));
ALTER TABLE public."LiveRecording" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "LiveRecording_pilot_tenant_isolation" ON public."LiveRecording" USING (public.sermon_clip_tenant_row_visible("organizationId")) WITH CHECK (public.sermon_clip_tenant_row_visible("organizationId"));
