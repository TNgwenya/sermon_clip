-- Add bounded worker lease tracking so abandoned RUNNING jobs can be reclaimed.
ALTER TABLE "ProcessingJob"
ADD COLUMN "workerId" TEXT,
ADD COLUMN "heartbeatAt" TIMESTAMP(3),
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "ProcessingJob_status_createdAt_idx" ON "ProcessingJob"("status", "createdAt");
CREATE INDEX "ProcessingJob_workerId_idx" ON "ProcessingJob"("workerId");
CREATE INDEX "ProcessingJob_heartbeatAt_idx" ON "ProcessingJob"("heartbeatAt");
