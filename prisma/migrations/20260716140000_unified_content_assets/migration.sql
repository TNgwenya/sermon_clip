-- CreateEnum
CREATE TYPE "ContentAssetType" AS ENUM (
  'QUOTE_GRAPHIC',
  'SCRIPTURE_GRAPHIC',
  'CAROUSEL',
  'TEXT_POST',
  'DEVOTIONAL',
  'PRAYER',
  'INVITATION',
  'DISCUSSION',
  'SERMON_RECAP',
  'STORY',
  'GUIDE',
  'EMAIL',
  'NEWSLETTER',
  'BLOG',
  'OTHER'
);

-- CreateEnum
CREATE TYPE "ContentAssetStatus" AS ENUM (
  'GENERATED',
  'APPROVED',
  'PREPARED',
  'READY',
  'SCHEDULED',
  'PUBLISHED',
  'ARCHIVED'
);

-- CreateTable
CREATE TABLE "ContentAsset" (
  "id" TEXT NOT NULL,
  "sermonId" TEXT NOT NULL,
  "contentOpportunityId" TEXT,
  "assetType" "ContentAssetType" NOT NULL,
  "status" "ContentAssetStatus" NOT NULL DEFAULT 'GENERATED',
  "platform" "PostingPlatform",
  "title" TEXT NOT NULL,
  "bodyContent" TEXT,
  "caption" TEXT,
  "hashtagsJson" JSONB,
  "callToAction" TEXT,
  "metadataJson" JSONB,
  "approvedAt" TIMESTAMP(3),
  "preparedAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "scheduledAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentAssetFile" (
  "id" TEXT NOT NULL,
  "contentAssetId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "filePath" TEXT,
  "objectKey" TEXT,
  "publicUrl" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "sizeBytes" BIGINT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContentAssetFile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentAssetFile_location_check" CHECK (num_nonnulls("filePath", "objectKey", "publicUrl") >= 1),
  CONSTRAINT "ContentAssetFile_dimensions_check" CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0)),
  CONSTRAINT "ContentAssetFile_size_check" CHECK ("sizeBytes" IS NULL OR "sizeBytes" >= 0),
  CONSTRAINT "ContentAssetFile_sort_order_check" CHECK ("sortOrder" >= 0)
);

-- CreateTable
CREATE TABLE "ScheduledPostContentAsset" (
  "scheduledPostId" TEXT NOT NULL,
  "contentAssetId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ScheduledPostContentAsset_pkey" PRIMARY KEY ("scheduledPostId", "contentAssetId"),
  CONSTRAINT "ScheduledPostContentAsset_sort_order_check" CHECK ("sortOrder" >= 0)
);

-- CreateIndex
CREATE INDEX "ContentAsset_sermonId_idx" ON "ContentAsset"("sermonId");
CREATE INDEX "ContentAsset_contentOpportunityId_idx" ON "ContentAsset"("contentOpportunityId");
CREATE INDEX "ContentAsset_assetType_idx" ON "ContentAsset"("assetType");
CREATE INDEX "ContentAsset_status_idx" ON "ContentAsset"("status");
CREATE INDEX "ContentAsset_platform_idx" ON "ContentAsset"("platform");
CREATE INDEX "ContentAsset_sermonId_status_idx" ON "ContentAsset"("sermonId", "status");
CREATE INDEX "ContentAsset_createdAt_idx" ON "ContentAsset"("createdAt");
CREATE UNIQUE INDEX "ContentAssetFile_contentAssetId_sortOrder_key" ON "ContentAssetFile"("contentAssetId", "sortOrder");
CREATE INDEX "ContentAssetFile_objectKey_idx" ON "ContentAssetFile"("objectKey");
CREATE INDEX "ScheduledPostContentAsset_scheduledPostId_sortOrder_idx" ON "ScheduledPostContentAsset"("scheduledPostId", "sortOrder");
CREATE INDEX "ScheduledPostContentAsset_contentAssetId_idx" ON "ScheduledPostContentAsset"("contentAssetId");

-- AddForeignKey
ALTER TABLE "ContentAsset"
  ADD CONSTRAINT "ContentAsset_sermonId_fkey"
  FOREIGN KEY ("sermonId") REFERENCES "Sermon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentAsset"
  ADD CONSTRAINT "ContentAsset_contentOpportunityId_fkey"
  FOREIGN KEY ("contentOpportunityId") REFERENCES "ContentOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContentAssetFile"
  ADD CONSTRAINT "ContentAssetFile_contentAssetId_fkey"
  FOREIGN KEY ("contentAssetId") REFERENCES "ContentAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduledPostContentAsset"
  ADD CONSTRAINT "ScheduledPostContentAsset_scheduledPostId_fkey"
  FOREIGN KEY ("scheduledPostId") REFERENCES "ScheduledPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduledPostContentAsset"
  ADD CONSTRAINT "ScheduledPostContentAsset_contentAssetId_fkey"
  FOREIGN KEY ("contentAssetId") REFERENCES "ContentAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
