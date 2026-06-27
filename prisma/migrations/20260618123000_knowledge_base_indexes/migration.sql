CREATE INDEX "Sermon_churchName_idx" ON "Sermon"("churchName");
CREATE INDEX "Sermon_speakerName_idx" ON "Sermon"("speakerName");
CREATE INDEX "Sermon_sermonDate_idx" ON "Sermon"("sermonDate");
CREATE INDEX "Sermon_status_idx" ON "Sermon"("status");
CREATE INDEX "Sermon_createdAt_idx" ON "Sermon"("createdAt");

CREATE INDEX "ClipCandidate_smartClipCategory_idx" ON "ClipCandidate"("smartClipCategory");
CREATE INDEX "ClipCandidate_status_idx" ON "ClipCandidate"("status");
CREATE INDEX "ClipCandidate_createdAt_idx" ON "ClipCandidate"("createdAt");

CREATE INDEX "SermonScriptureRef_reference_idx" ON "SermonScriptureRef"("reference");
CREATE INDEX "SermonScriptureRef_book_idx" ON "SermonScriptureRef"("book");

CREATE INDEX "SermonTopicTag_sermonId_topic_idx" ON "SermonTopicTag"("sermonId", "topic");

CREATE INDEX "MinistryMoment_momentType_idx" ON "MinistryMoment"("momentType");
CREATE INDEX "MinistryMoment_createdAt_idx" ON "MinistryMoment"("createdAt");

CREATE INDEX "ContentOpportunity_category_idx" ON "ContentOpportunity"("category");
CREATE INDEX "ContentOpportunity_opportunityType_idx" ON "ContentOpportunity"("opportunityType");
CREATE INDEX "ContentOpportunity_status_idx" ON "ContentOpportunity"("status");
CREATE INDEX "ContentOpportunity_createdAt_idx" ON "ContentOpportunity"("createdAt");
