CREATE TYPE "SermonSourceAssetStatus" AS ENUM (
  'INITIATED',
  'UPLOADING',
  'READY',
  'FAILED'
);

CREATE TABLE "SermonSourceAsset" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campusId" TEXT,
  "sermonId" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "uploadId" TEXT,
  "originalFileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "partSizeBytes" INTEGER NOT NULL,
  "etag" TEXT,
  "versionId" TEXT,
  "status" "SermonSourceAssetStatus" NOT NULL DEFAULT 'INITIATED',
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SermonSourceAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SermonSourceAsset_sermonId_key"
ON "SermonSourceAsset"("sermonId");

CREATE UNIQUE INDEX "SermonSourceAsset_bucket_objectKey_key"
ON "SermonSourceAsset"("bucket", "objectKey");

CREATE INDEX "SermonSourceAsset_organizationId_status_createdAt_idx"
ON "SermonSourceAsset"("organizationId", "status", "createdAt");

CREATE INDEX "SermonSourceAsset_campusId_status_createdAt_idx"
ON "SermonSourceAsset"("campusId", "status", "createdAt");

ALTER TABLE "SermonSourceAsset"
ADD CONSTRAINT "SermonSourceAsset_sermonId_fkey"
FOREIGN KEY ("sermonId") REFERENCES "Sermon"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SermonSourceAsset"
ADD CONSTRAINT "SermonSourceAsset_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SermonSourceAsset"
ADD CONSTRAINT "SermonSourceAsset_campusId_fkey"
FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
