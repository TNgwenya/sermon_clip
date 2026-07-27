CREATE TYPE "ResolvedFramingPlanStatus" AS ENUM ('READY', 'FALLBACK', 'PASSTHROUGH');

ALTER TABLE "ClipEditPlan"
ADD COLUMN "resolvedFramingPlan" JSONB,
ADD COLUMN "resolvedFramingPlanHash" TEXT,
ADD COLUMN "framingPlanStatus" "ResolvedFramingPlanStatus",
ADD COLUMN "framingPlanResolvedAt" TIMESTAMP(3);
