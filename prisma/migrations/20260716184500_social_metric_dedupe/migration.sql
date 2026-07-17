ALTER TABLE "SocialMetricSnapshot"
ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "SocialMetricSnapshot_dedupeKey_key"
ON "SocialMetricSnapshot"("dedupeKey");
