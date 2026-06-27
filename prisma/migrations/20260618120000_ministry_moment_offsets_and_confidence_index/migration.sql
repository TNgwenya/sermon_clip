-- AlterTable: MinistryMoment
ALTER TABLE "MinistryMoment" ADD COLUMN "transcriptStartOffset" INTEGER;
ALTER TABLE "MinistryMoment" ADD COLUMN "transcriptEndOffset" INTEGER;

-- Indexes
CREATE INDEX "MinistryMoment_sermonId_confidenceScore_idx" ON "MinistryMoment"("sermonId", "confidenceScore");
