-- Phase 2 portable media-orchestration control plane.
--
-- This migration is additive. Existing ProcessingJob rows and worker behavior
-- are intentionally unchanged so rollout can be dark-launched and rolled back
-- by stopping new orchestration producers/consumers.

CREATE TYPE "OrchestrationLane" AS ENUM (
  'INTAKE_MATERIALIZATION',
  'TRANSCRIPTION',
  'INTELLIGENCE',
  'PREVIEW',
  'FINAL_RENDER_EXPORT',
  'CONTENT_WEEK',
  'PUBLISHING'
);

CREATE TYPE "OrchestrationJobStatus" AS ENUM (
  'PENDING',
  'LEASED',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'DEAD_LETTER'
);

CREATE TYPE "OrchestrationOutboxStatus" AS ENUM (
  'PENDING',
  'PUBLISHING',
  'PUBLISHED',
  'DEAD_LETTER'
);

CREATE TABLE "OrchestrationJob" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sermonId" TEXT,
  "lane" "OrchestrationLane" NOT NULL,
  "status" "OrchestrationJobStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "intentHash" TEXT NOT NULL,
  "payloadVersion" INTEGER NOT NULL DEFAULT 1,
  "payloadJson" JSONB NOT NULL,
  "correlationId" TEXT NOT NULL,
  "parentJobId" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "leaseOwner" TEXT,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "cancelRequestedAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "lastFailureCode" TEXT,
  "lastFailureMessage" TEXT,
  "lastFailureRetryable" BOOLEAN,
  "deadLetteredAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrchestrationJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrchestrationJob_payloadVersion_check" CHECK ("payloadVersion" >= 1),
  CONSTRAINT "OrchestrationJob_attemptCount_check" CHECK ("attemptCount" >= 0),
  CONSTRAINT "OrchestrationJob_maxAttempts_check" CHECK ("maxAttempts" >= 1),
  CONSTRAINT "OrchestrationJob_lease_shape_check" CHECK (
    "status" <> 'LEASED'
    OR ("leaseOwner" IS NOT NULL AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
  )
);

CREATE TABLE "OrchestrationOutboxEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "orchestrationJobId" TEXT NOT NULL,
  "deliverySequence" INTEGER NOT NULL,
  "topic" TEXT NOT NULL,
  "messageKey" TEXT NOT NULL,
  "payloadVersion" INTEGER NOT NULL DEFAULT 1,
  "payloadJson" JSONB NOT NULL,
  "status" "OrchestrationOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "publishAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxPublishAttempts" INTEGER NOT NULL DEFAULT 8,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimOwner" TEXT,
  "claimToken" TEXT,
  "claimExpiresAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrchestrationOutboxEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrchestrationOutboxEvent_deliverySequence_check" CHECK ("deliverySequence" >= 1),
  CONSTRAINT "OrchestrationOutboxEvent_payloadVersion_check" CHECK ("payloadVersion" >= 1),
  CONSTRAINT "OrchestrationOutboxEvent_publishAttemptCount_check" CHECK ("publishAttemptCount" >= 0),
  CONSTRAINT "OrchestrationOutboxEvent_maxPublishAttempts_check" CHECK ("maxPublishAttempts" >= 1),
  CONSTRAINT "OrchestrationOutboxEvent_claim_shape_check" CHECK (
    "status" <> 'PUBLISHING'
    OR ("claimOwner" IS NOT NULL AND "claimToken" IS NOT NULL AND "claimExpiresAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "OrchestrationJob_organizationId_idempotencyKey_key"
  ON "OrchestrationJob"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "OrchestrationJob_id_organizationId_key"
  ON "OrchestrationJob"("id", "organizationId");
CREATE INDEX "OrchestrationJob_status_availableAt_priority_idx"
  ON "OrchestrationJob"("status", "availableAt", "priority");
CREATE INDEX "OrchestrationJob_organizationId_status_availableAt_idx"
  ON "OrchestrationJob"("organizationId", "status", "availableAt");
CREATE INDEX "OrchestrationJob_sermonId_lane_createdAt_idx"
  ON "OrchestrationJob"("sermonId", "lane", "createdAt");
CREATE INDEX "OrchestrationJob_leaseExpiresAt_idx"
  ON "OrchestrationJob"("leaseExpiresAt");
CREATE INDEX "OrchestrationJob_parentJobId_idx"
  ON "OrchestrationJob"("parentJobId");
CREATE INDEX "OrchestrationJob_correlationId_idx"
  ON "OrchestrationJob"("correlationId");

CREATE UNIQUE INDEX "OrchestrationOutboxEvent_messageKey_key"
  ON "OrchestrationOutboxEvent"("messageKey");
CREATE UNIQUE INDEX "OrchestrationOutboxEvent_orchestrationJobId_deliverySequence_key"
  ON "OrchestrationOutboxEvent"("orchestrationJobId", "deliverySequence");
CREATE INDEX "OrchestrationOutboxEvent_status_availableAt_createdAt_idx"
  ON "OrchestrationOutboxEvent"("status", "availableAt", "createdAt");
CREATE INDEX "OrchestrationOutboxEvent_organizationId_status_availableAt_idx"
  ON "OrchestrationOutboxEvent"("organizationId", "status", "availableAt");
CREATE INDEX "OrchestrationOutboxEvent_claimExpiresAt_idx"
  ON "OrchestrationOutboxEvent"("claimExpiresAt");

ALTER TABLE "OrchestrationJob"
  ADD CONSTRAINT "OrchestrationJob_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrchestrationJob"
  ADD CONSTRAINT "OrchestrationJob_sermonId_organizationId_fkey"
  FOREIGN KEY ("sermonId", "organizationId") REFERENCES "Sermon"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrchestrationJob"
  ADD CONSTRAINT "OrchestrationJob_parentJobId_organizationId_fkey"
  FOREIGN KEY ("parentJobId", "organizationId") REFERENCES "OrchestrationJob"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrchestrationOutboxEvent"
  ADD CONSTRAINT "OrchestrationOutboxEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrchestrationOutboxEvent"
  ADD CONSTRAINT "OrchestrationOutboxEvent_orchestrationJobId_organizationId_fkey"
  FOREIGN KEY ("orchestrationJobId", "organizationId") REFERENCES "OrchestrationJob"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Follow the Phase 1 availability-preserving tenant-context convention. This
-- is defense in depth only after the runtime uses a least-privilege non-owner
-- role; table owners bypass RLS unless FORCE RLS is enabled deliberately.
ALTER TABLE public."OrchestrationJob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "OrchestrationJob_pilot_tenant_isolation" ON public."OrchestrationJob"
  USING (public.sermon_clip_tenant_row_visible("organizationId"))
  WITH CHECK (public.sermon_clip_tenant_row_visible("organizationId"));

ALTER TABLE public."OrchestrationOutboxEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "OrchestrationOutboxEvent_pilot_tenant_isolation" ON public."OrchestrationOutboxEvent"
  USING (public.sermon_clip_tenant_row_visible("organizationId"))
  WITH CHECK (public.sermon_clip_tenant_row_visible("organizationId"));
