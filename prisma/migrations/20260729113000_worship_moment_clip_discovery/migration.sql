CREATE TYPE "ClipContentKind" AS ENUM ('SERMON', 'WORSHIP');

ALTER TABLE "Sermon"
ADD COLUMN "includeWorshipMoments" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ClipCandidate"
ADD COLUMN "contentKind" "ClipContentKind" NOT NULL DEFAULT 'SERMON';

CREATE INDEX "ClipCandidate_sermonId_contentKind_idx"
ON "ClipCandidate"("sermonId", "contentKind");
