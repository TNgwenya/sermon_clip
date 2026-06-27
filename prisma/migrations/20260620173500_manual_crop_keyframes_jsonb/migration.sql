ALTER TABLE "ClipCandidate" RENAME COLUMN "manualCropKeyframes" TO "manualCropKeyframes_old";
ALTER TABLE "ClipCandidate" ADD COLUMN "manualCropKeyframes" JSONB;
UPDATE "ClipCandidate"
SET "manualCropKeyframes" = "manualCropKeyframes_old"
WHERE "manualCropKeyframes_old" IS NOT NULL;
