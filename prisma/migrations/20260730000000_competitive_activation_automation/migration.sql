CREATE TABLE "OrganizationAutomationSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "youtubeSocialAccountId" TEXT,
    "automaticYoutubeImportEnabled" BOOLEAN NOT NULL DEFAULT false,
    "youtubeRightsConfirmedAt" TIMESTAMP(3),
    "youtubeRightsConfirmedByUserId" TEXT,
    "defaultSpeakerName" TEXT,
    "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
    "includeWorshipMoments" BOOLEAN NOT NULL DEFAULT false,
    "notificationEmail" TEXT,
    "weeklyCadenceJson" JSONB,
    "onboardingCompletedAt" TIMESTAMP(3),
    "lastYoutubeScanAt" TIMESTAMP(3),
    "lastYoutubeImportAt" TIMESTAMP(3),
    "lastYoutubeVideoId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationAutomationSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationAutomationSettings_organizationId_key"
ON "OrganizationAutomationSettings"("organizationId");

CREATE INDEX "OrganizationAutomationSettings_youtubeSocialAccountId_idx"
ON "OrganizationAutomationSettings"("youtubeSocialAccountId");

CREATE INDEX "OrganizationAutomationSettings_automaticYoutubeImportEnabled_lastYoutubeScanAt_idx"
ON "OrganizationAutomationSettings"("automaticYoutubeImportEnabled", "lastYoutubeScanAt");

ALTER TABLE "OrganizationAutomationSettings"
ADD CONSTRAINT "OrganizationAutomationSettings_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationAutomationSettings"
ADD CONSTRAINT "OrganizationAutomationSettings_youtubeSocialAccountId_organizationId_fkey"
FOREIGN KEY ("youtubeSocialAccountId", "organizationId")
REFERENCES "SocialAccount"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrganizationAutomationSettings"
ADD CONSTRAINT "OrganizationAutomationSettings_youtubeRightsConfirmedByUserId_fkey"
FOREIGN KEY ("youtubeRightsConfirmedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
