CREATE TYPE "PublicSermonPageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "SermonPublicPage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campusId" TEXT,
    "sermonId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "PublicSermonPageStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "primaryCtaLabel" TEXT,
    "primaryCtaUrl" TEXT,
    "createdByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "ctaClickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SermonPublicPage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MinistryOutcome"
ADD COLUMN "publicSermonPageId" TEXT;

CREATE UNIQUE INDEX "SermonPublicPage_sermonId_key"
ON "SermonPublicPage"("sermonId");

CREATE UNIQUE INDEX "SermonPublicPage_slug_key"
ON "SermonPublicPage"("slug");

CREATE UNIQUE INDEX "SermonPublicPage_sermonId_organizationId_key"
ON "SermonPublicPage"("sermonId", "organizationId");

CREATE INDEX "SermonPublicPage_organizationId_status_publishedAt_idx"
ON "SermonPublicPage"("organizationId", "status", "publishedAt");

CREATE INDEX "SermonPublicPage_campusId_status_publishedAt_idx"
ON "SermonPublicPage"("campusId", "status", "publishedAt");

CREATE INDEX "SermonPublicPage_createdByUserId_idx"
ON "SermonPublicPage"("createdByUserId");

CREATE INDEX "MinistryOutcome_publicSermonPageId_idx"
ON "MinistryOutcome"("publicSermonPageId");

ALTER TABLE "SermonPublicPage"
ADD CONSTRAINT "SermonPublicPage_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SermonPublicPage"
ADD CONSTRAINT "SermonPublicPage_campusId_organizationId_fkey"
FOREIGN KEY ("campusId", "organizationId")
REFERENCES "Campus"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SermonPublicPage"
ADD CONSTRAINT "SermonPublicPage_sermonId_organizationId_fkey"
FOREIGN KEY ("sermonId", "organizationId")
REFERENCES "Sermon"("id", "organizationId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SermonPublicPage"
ADD CONSTRAINT "SermonPublicPage_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MinistryOutcome"
ADD CONSTRAINT "MinistryOutcome_publicSermonPageId_fkey"
FOREIGN KEY ("publicSermonPageId") REFERENCES "SermonPublicPage"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
