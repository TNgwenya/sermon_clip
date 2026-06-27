ALTER TABLE "ClipCandidate" ADD COLUMN "manualCropKeyframes" JSON;
ALTER TABLE "ClipCandidate" ADD COLUMN "manualCropUpdatedAt" DATETIME;
ALTER TABLE "ClipCandidate" ADD COLUMN "smartCropDebugSnapshotPath" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN "smartCropDebugGeneratedAt" DATETIME;
ALTER TABLE "ClipCandidate" ADD COLUMN "smartCropDebugError" TEXT;
