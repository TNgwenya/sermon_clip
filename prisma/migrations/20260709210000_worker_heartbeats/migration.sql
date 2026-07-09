CREATE TABLE "WorkerHeartbeat" (
  "id" TEXT NOT NULL,
  "workerType" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ONLINE',
  "dryRun" BOOLEAN NOT NULL DEFAULT false,
  "detailsJson" JSONB,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkerHeartbeat_workerType_workerId_key"
ON "WorkerHeartbeat"("workerType", "workerId");

CREATE INDEX "WorkerHeartbeat_workerType_heartbeatAt_idx"
ON "WorkerHeartbeat"("workerType", "heartbeatAt");
