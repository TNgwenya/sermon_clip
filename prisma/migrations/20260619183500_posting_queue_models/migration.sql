CREATE TABLE "SocialAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "platform" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "handle" TEXT,
  "status" TEXT NOT NULL DEFAULT 'CONNECTED',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "PostingDraft" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clipIdsJson" JSONB NOT NULL,
  "platformsJson" JSONB NOT NULL,
  "postingSlot" TEXT NOT NULL,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'READY_FOR_MEDIA_TEAM',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "ScheduledPost" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "postingDraftId" TEXT,
  "socialAccountId" TEXT,
  "clipIdsJson" JSONB NOT NULL,
  "platform" TEXT NOT NULL,
  "postingSlot" TEXT NOT NULL,
  "caption" TEXT,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'READY_FOR_MEDIA_TEAM',
  "scheduledFor" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ScheduledPost_postingDraftId_fkey" FOREIGN KEY ("postingDraftId") REFERENCES "PostingDraft" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ScheduledPost_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "SocialAccount_platform_idx" ON "SocialAccount"("platform");
CREATE INDEX "SocialAccount_status_idx" ON "SocialAccount"("status");
CREATE INDEX "SocialAccount_createdAt_idx" ON "SocialAccount"("createdAt");

CREATE INDEX "PostingDraft_status_idx" ON "PostingDraft"("status");
CREATE INDEX "PostingDraft_createdAt_idx" ON "PostingDraft"("createdAt");

CREATE INDEX "ScheduledPost_postingDraftId_idx" ON "ScheduledPost"("postingDraftId");
CREATE INDEX "ScheduledPost_socialAccountId_idx" ON "ScheduledPost"("socialAccountId");
CREATE INDEX "ScheduledPost_platform_idx" ON "ScheduledPost"("platform");
CREATE INDEX "ScheduledPost_status_idx" ON "ScheduledPost"("status");
CREATE INDEX "ScheduledPost_scheduledFor_idx" ON "ScheduledPost"("scheduledFor");
CREATE INDEX "ScheduledPost_createdAt_idx" ON "ScheduledPost"("createdAt");
