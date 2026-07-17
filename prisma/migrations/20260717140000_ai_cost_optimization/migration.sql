ALTER TABLE "AiInvocation" ADD COLUMN "cachedInputTokens" INTEGER;
ALTER TABLE "AiInvocation" ADD COLUMN "reasoningTokens" INTEGER;
ALTER TABLE "AiInvocation" ADD COLUMN "providerRequestCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiInvocation" ADD COLUMN "cacheHit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiInvocation" ADD COLUMN "audioDurationSeconds" DOUBLE PRECISION;

CREATE TABLE "AiResponseCache" (
  "id" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "promptVersion" TEXT,
  "responseText" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiResponseCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiResponseCache_requestHash_key" ON "AiResponseCache"("requestHash");
CREATE INDEX "AiResponseCache_operation_idx" ON "AiResponseCache"("operation");
CREATE INDEX "AiResponseCache_model_idx" ON "AiResponseCache"("model");
CREATE INDEX "AiResponseCache_expiresAt_idx" ON "AiResponseCache"("expiresAt");
