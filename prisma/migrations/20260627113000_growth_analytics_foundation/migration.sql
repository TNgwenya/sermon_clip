DO $$ BEGIN
  CREATE TYPE "GrowthMetricSource" AS ENUM ('API', 'MANUAL', 'DERIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GrowthRecommendationStatus" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'SCHEDULED', 'LEARNED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GrowthCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GrowthCampaignPhaseStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GrowthTrendDecision" AS ENUM ('USE', 'ADAPT_CAREFULLY', 'AVOID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GrowthGuardrailResult" AS ENUM ('PASS', 'NEEDS_REVIEW', 'FAIL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MinistryOutcomeType" AS ENUM (
    'EVENT_SIGNUP',
    'PRAYER_REQUEST',
    'DISCIPLESHIP_STEP',
    'WEBSITE_CLICK',
    'MESSAGE',
    'TESTIMONY',
    'SERVICE_ATTENDANCE',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SocialMetricSnapshot" (
  "id" TEXT NOT NULL,
  "socialAccountId" TEXT,
  "platform" TEXT NOT NULL,
  "platformPostId" TEXT,
  "postUrl" TEXT,
  "followers" INTEGER,
  "views" INTEGER,
  "reach" INTEGER,
  "impressions" INTEGER,
  "engagementRate" DOUBLE PRECISION,
  "likes" INTEGER,
  "comments" INTEGER,
  "shares" INTEGER,
  "saves" INTEGER,
  "clickThroughs" INTEGER,
  "eventSignups" INTEGER,
  "watchTimeSeconds" INTEGER,
  "averageViewDurationSeconds" DOUBLE PRECISION,
  "retentionRate" DOUBLE PRECISION,
  "followerGrowth" INTEGER,
  "rawMetrics" JSONB,
  "source" "GrowthMetricSource" NOT NULL DEFAULT 'API',
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SocialMetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PostPerformancePrediction" (
  "id" TEXT NOT NULL,
  "scheduledPostId" TEXT,
  "clipIdsJson" JSONB NOT NULL,
  "platform" TEXT NOT NULL,
  "predictedReachLow" INTEGER NOT NULL,
  "predictedReachHigh" INTEGER NOT NULL,
  "predictedEngagementRate" DOUBLE PRECISION NOT NULL,
  "predictedFollowerGrowthLow" INTEGER NOT NULL,
  "predictedFollowerGrowthHigh" INTEGER NOT NULL,
  "predictedWatchTimeSeconds" INTEGER NOT NULL,
  "confidence" TEXT NOT NULL,
  "reasoning" JSONB NOT NULL,
  "modelVersion" TEXT NOT NULL DEFAULT 'growth-system-v1',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PostPerformancePrediction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PostPredictionResult" (
  "id" TEXT NOT NULL,
  "predictionId" TEXT NOT NULL,
  "metricSnapshotId" TEXT,
  "actualReach" INTEGER,
  "actualEngagementRate" DOUBLE PRECISION,
  "actualFollowerGrowth" INTEGER,
  "actualWatchTimeSeconds" INTEGER,
  "reachErrorPercent" DOUBLE PRECISION,
  "engagementErrorPercent" DOUBLE PRECISION,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PostPredictionResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GrowthRecommendation" (
  "id" TEXT NOT NULL,
  "sourceClipId" TEXT,
  "sourceSermonId" TEXT,
  "recommendationType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "priority" INTEGER NOT NULL,
  "platformsJson" JSONB NOT NULL,
  "recommendationJson" JSONB NOT NULL,
  "rationale" JSONB NOT NULL,
  "guardrails" JSONB NOT NULL,
  "status" "GrowthRecommendationStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GrowthRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GrowthCampaign" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "eventName" TEXT NOT NULL,
  "eventType" TEXT,
  "objective" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "signupUrl" TEXT,
  "status" "GrowthCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GrowthCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GrowthCampaignPhase" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "timing" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "cta" TEXT NOT NULL,
  "orderIndex" INTEGER NOT NULL,
  "status" "GrowthCampaignPhaseStatus" NOT NULL DEFAULT 'PLANNED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GrowthCampaignPhase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GrowthTrend" (
  "id" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "trendType" TEXT NOT NULL,
  "decision" "GrowthTrendDecision" NOT NULL,
  "ministryFit" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "adaptation" TEXT NOT NULL,
  "evidenceJson" JSONB,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GrowthTrend_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GrowthGuardrailReview" (
  "id" TEXT NOT NULL,
  "scheduledPostId" TEXT,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "result" "GrowthGuardrailResult" NOT NULL,
  "issuesJson" JSONB NOT NULL,
  "suggestedRevision" TEXT,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GrowthGuardrailReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MinistryOutcome" (
  "id" TEXT NOT NULL,
  "scheduledPostId" TEXT,
  "campaignId" TEXT,
  "outcomeType" "MinistryOutcomeType" NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 1,
  "notes" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MinistryOutcome_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SocialMetricSnapshot_socialAccountId_idx" ON "SocialMetricSnapshot"("socialAccountId");
CREATE INDEX IF NOT EXISTS "SocialMetricSnapshot_platform_idx" ON "SocialMetricSnapshot"("platform");
CREATE INDEX IF NOT EXISTS "SocialMetricSnapshot_platformPostId_idx" ON "SocialMetricSnapshot"("platformPostId");
CREATE INDEX IF NOT EXISTS "SocialMetricSnapshot_capturedAt_idx" ON "SocialMetricSnapshot"("capturedAt");

CREATE INDEX IF NOT EXISTS "PostPerformancePrediction_scheduledPostId_idx" ON "PostPerformancePrediction"("scheduledPostId");
CREATE INDEX IF NOT EXISTS "PostPerformancePrediction_platform_idx" ON "PostPerformancePrediction"("platform");
CREATE INDEX IF NOT EXISTS "PostPerformancePrediction_createdAt_idx" ON "PostPerformancePrediction"("createdAt");

CREATE INDEX IF NOT EXISTS "PostPredictionResult_predictionId_idx" ON "PostPredictionResult"("predictionId");
CREATE INDEX IF NOT EXISTS "PostPredictionResult_metricSnapshotId_idx" ON "PostPredictionResult"("metricSnapshotId");
CREATE INDEX IF NOT EXISTS "PostPredictionResult_evaluatedAt_idx" ON "PostPredictionResult"("evaluatedAt");

CREATE INDEX IF NOT EXISTS "GrowthRecommendation_sourceClipId_idx" ON "GrowthRecommendation"("sourceClipId");
CREATE INDEX IF NOT EXISTS "GrowthRecommendation_sourceSermonId_idx" ON "GrowthRecommendation"("sourceSermonId");
CREATE INDEX IF NOT EXISTS "GrowthRecommendation_status_idx" ON "GrowthRecommendation"("status");
CREATE INDEX IF NOT EXISTS "GrowthRecommendation_priority_idx" ON "GrowthRecommendation"("priority");
CREATE INDEX IF NOT EXISTS "GrowthRecommendation_createdAt_idx" ON "GrowthRecommendation"("createdAt");

CREATE INDEX IF NOT EXISTS "GrowthCampaign_status_idx" ON "GrowthCampaign"("status");
CREATE INDEX IF NOT EXISTS "GrowthCampaign_startsAt_idx" ON "GrowthCampaign"("startsAt");
CREATE INDEX IF NOT EXISTS "GrowthCampaign_createdAt_idx" ON "GrowthCampaign"("createdAt");

CREATE INDEX IF NOT EXISTS "GrowthCampaignPhase_campaignId_idx" ON "GrowthCampaignPhase"("campaignId");
CREATE INDEX IF NOT EXISTS "GrowthCampaignPhase_status_idx" ON "GrowthCampaignPhase"("status");
CREATE INDEX IF NOT EXISTS "GrowthCampaignPhase_orderIndex_idx" ON "GrowthCampaignPhase"("orderIndex");

CREATE INDEX IF NOT EXISTS "GrowthTrend_platform_idx" ON "GrowthTrend"("platform");
CREATE INDEX IF NOT EXISTS "GrowthTrend_decision_idx" ON "GrowthTrend"("decision");
CREATE INDEX IF NOT EXISTS "GrowthTrend_detectedAt_idx" ON "GrowthTrend"("detectedAt");

CREATE INDEX IF NOT EXISTS "GrowthGuardrailReview_scheduledPostId_idx" ON "GrowthGuardrailReview"("scheduledPostId");
CREATE INDEX IF NOT EXISTS "GrowthGuardrailReview_targetType_targetId_idx" ON "GrowthGuardrailReview"("targetType", "targetId");
CREATE INDEX IF NOT EXISTS "GrowthGuardrailReview_result_idx" ON "GrowthGuardrailReview"("result");
CREATE INDEX IF NOT EXISTS "GrowthGuardrailReview_reviewedAt_idx" ON "GrowthGuardrailReview"("reviewedAt");

CREATE INDEX IF NOT EXISTS "MinistryOutcome_scheduledPostId_idx" ON "MinistryOutcome"("scheduledPostId");
CREATE INDEX IF NOT EXISTS "MinistryOutcome_campaignId_idx" ON "MinistryOutcome"("campaignId");
CREATE INDEX IF NOT EXISTS "MinistryOutcome_outcomeType_idx" ON "MinistryOutcome"("outcomeType");
CREATE INDEX IF NOT EXISTS "MinistryOutcome_occurredAt_idx" ON "MinistryOutcome"("occurredAt");

ALTER TABLE "SocialMetricSnapshot"
  ADD CONSTRAINT "SocialMetricSnapshot_socialAccountId_fkey"
  FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PostPerformancePrediction"
  ADD CONSTRAINT "PostPerformancePrediction_scheduledPostId_fkey"
  FOREIGN KEY ("scheduledPostId") REFERENCES "ScheduledPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PostPredictionResult"
  ADD CONSTRAINT "PostPredictionResult_predictionId_fkey"
  FOREIGN KEY ("predictionId") REFERENCES "PostPerformancePrediction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PostPredictionResult"
  ADD CONSTRAINT "PostPredictionResult_metricSnapshotId_fkey"
  FOREIGN KEY ("metricSnapshotId") REFERENCES "SocialMetricSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GrowthCampaignPhase"
  ADD CONSTRAINT "GrowthCampaignPhase_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "GrowthCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GrowthGuardrailReview"
  ADD CONSTRAINT "GrowthGuardrailReview_scheduledPostId_fkey"
  FOREIGN KEY ("scheduledPostId") REFERENCES "ScheduledPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MinistryOutcome"
  ADD CONSTRAINT "MinistryOutcome_scheduledPostId_fkey"
  FOREIGN KEY ("scheduledPostId") REFERENCES "ScheduledPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MinistryOutcome"
  ADD CONSTRAINT "MinistryOutcome_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "GrowthCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
