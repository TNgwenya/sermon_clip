ALTER TABLE "ClipCandidate" ADD COLUMN IF NOT EXISTS "remotePreviewObjectKey" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN IF NOT EXISTS "remotePreviewUrl" TEXT;
ALTER TABLE "ClipCandidate" ADD COLUMN IF NOT EXISTS "remotePreviewUploadedAt" TIMESTAMP(3);
