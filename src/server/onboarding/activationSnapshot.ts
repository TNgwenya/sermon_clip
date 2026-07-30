import { prisma } from "@/lib/prisma";
import {
  buildActivationReadiness,
  buildYouTubeIntakeReadiness,
} from "@/lib/activationReadiness";
import { listSocialAccounts } from "@/lib/socialAccounts";

export type ActivationTenantScope = Readonly<{
  organizationId: string;
  campusId: string | null;
}>;

function visibleCampusWhere(campusId: string | null) {
  return campusId
    ? { OR: [{ campusId }, { campusId: null }] }
    : { campusId: null };
}

export async function getActivationSnapshot(
  scope: ActivationTenantScope,
  actorUserId: string,
) {
  const campusScope = visibleCampusWhere(scope.campusId);
  const [
    organization,
    branding,
    socialAccounts,
    scheduledPostCount,
    activeApproverCount,
    defaultApprovalPolicy,
    actor,
    automationSettings,
  ] = await Promise.all([
    prisma.organization.findFirst({
      where: { id: scope.organizationId, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        timezone: true,
        defaultLanguage: true,
      },
    }),
    prisma.brandingSettings.findUnique({
      where: { organizationId: scope.organizationId },
      select: {
        churchName: true,
        churchLogoPath: true,
        primaryBrandColor: true,
        secondaryBrandColor: true,
      },
    }),
    listSocialAccounts({
      organizationId: scope.organizationId,
      campusId: scope.campusId,
    }),
    prisma.scheduledPost.count({
      where: {
        organizationId: scope.organizationId,
        ...campusScope,
        status: { notIn: ["SKIPPED", "FAILED"] },
      },
    }),
    prisma.membership.count({
      where: {
        organizationId: scope.organizationId,
        ...campusScope,
        role: "PASTOR_APPROVER",
        status: "ACTIVE",
        AND: [
          {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
        ],
        user: { status: "ACTIVE" },
      },
    }),
    prisma.approvalPolicy.findFirst({
      where: {
        organizationId: scope.organizationId,
        ...campusScope,
        status: "ACTIVE",
        isDefault: true,
      },
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.user.findFirst({
      where: {
        id: actorUserId,
        status: "ACTIVE",
      },
      select: {
        email: true,
        profile: {
          select: {
            displayName: true,
          },
        },
      },
    }),
    prisma.organizationAutomationSettings.findUnique({
      where: { organizationId: scope.organizationId },
      select: {
        defaultSpeakerName: true,
        defaultLanguage: true,
        notificationEmail: true,
        weeklyCadenceJson: true,
        onboardingCompletedAt: true,
      },
    }),
  ]);

  if (!organization) {
    throw new Error("The active church workspace could not be loaded.");
  }

  const readiness = buildActivationReadiness({
    organization,
    branding,
    connectedChannelCount: socialAccounts.filter((account) => (
      account.status === "CONNECTED"
    )).length,
    scheduledPostCount,
    cadenceConfigured: Boolean(automationSettings?.weeklyCadenceJson),
    activeApproverCount,
    hasDefaultApprovalPolicy: Boolean(defaultApprovalPolicy),
  });

  return {
    organization,
    branding,
    socialAccounts,
    scheduledPostCount,
    activeApproverCount,
    defaultApprovalPolicy,
    actor: {
      email: actor?.email ?? "",
      displayName: actor?.profile?.displayName?.trim() || actor?.email || "",
    },
    automationSettings,
    readiness,
  };
}

export async function getYouTubeIntakeSnapshot(
  scope: ActivationTenantScope,
) {
  const campusScope = visibleCampusWhere(scope.campusId);
  const [youtubeAccounts, youtubeCredential, lastManualSermon, automationSettings] = await Promise.all([
    prisma.socialAccount.findMany({
      where: {
        organizationId: scope.organizationId,
        ...campusScope,
        platform: "YOUTUBE_SHORTS",
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        label: true,
        handle: true,
        status: true,
        externalAccountId: true,
        updatedAt: true,
        credentials: {
          where: {
            provider: "YOUTUBE",
            status: "CONNECTED",
          },
          select: { id: true },
        },
      },
    }),
    prisma.socialCredential.findFirst({
      where: {
        organizationId: scope.organizationId,
        ...campusScope,
        provider: "YOUTUBE",
      },
      orderBy: { updatedAt: "desc" },
      select: {
        status: true,
        accountName: true,
        handle: true,
        externalAccountId: true,
        lastSyncAt: true,
        lastError: true,
        updatedAt: true,
      },
    }),
    prisma.sermon.findFirst({
      where: {
        organizationId: scope.organizationId,
        ...campusScope,
        youtubeUrl: {
          contains: "youtu",
          mode: "insensitive",
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.organizationAutomationSettings.findUnique({
      where: { organizationId: scope.organizationId },
      select: {
        youtubeSocialAccountId: true,
        automaticYoutubeImportEnabled: true,
        youtubeRightsConfirmedAt: true,
        youtubeRightsConfirmedByUserId: true,
        defaultSpeakerName: true,
        defaultLanguage: true,
        weeklyCadenceJson: true,
        notificationEmail: true,
        lastYoutubeScanAt: true,
        lastYoutubeImportAt: true,
        lastYoutubeVideoId: true,
        lastError: true,
      },
    }),
  ]);
  const selectedYoutubeAccount = youtubeAccounts.find((account) => (
    account.id === automationSettings?.youtubeSocialAccountId
  )) ?? youtubeAccounts[0] ?? null;
  const accountLabel = selectedYoutubeAccount?.label
    || youtubeCredential?.accountName
    || selectedYoutubeAccount?.handle
    || youtubeCredential?.handle
    || null;
  const oauthAppConfigured = Boolean(
    process.env.YOUTUBE_CLIENT_ID?.trim()
      && process.env.YOUTUBE_CLIENT_SECRET?.trim(),
  );

  const intakeReceiverImplemented = true;
  const scanIntervalSeconds = Math.max(
    60,
    Number(process.env.YOUTUBE_AUTOMATION_SCAN_SECONDS) || 300,
  );
  const lastScanAgeMs = automationSettings?.lastYoutubeScanAt
    ? Date.now() - automationSettings.lastYoutubeScanAt.getTime()
    : Number.POSITIVE_INFINITY;
  const workflowDefaultsConfigured = Boolean(
    automationSettings?.defaultSpeakerName?.trim()
      && automationSettings.defaultLanguage.trim()
      && automationSettings.notificationEmail?.trim()
      && automationSettings.weeklyCadenceJson,
  );
  const readiness = buildYouTubeIntakeReadiness({
    oauthAppConfigured,
    accountConnected: Boolean(
      selectedYoutubeAccount
        && selectedYoutubeAccount.credentials.length > 0,
    ),
    accountNeedsAttention: selectedYoutubeAccount?.status === "NEEDS_REVIEW",
    connectedAccountLabel: accountLabel,
    monitoringWorkerConfigured: process.env.YOUTUBE_AUTOMATION_WORKER_ENABLED !== "false",
    intakeReceiverImplemented,
    rightsConfirmed: Boolean(
      automationSettings?.youtubeRightsConfirmedAt
        && automationSettings.youtubeRightsConfirmedByUserId,
    ),
    workflowDefaultsConfigured,
    automaticImportEnabled: automationSettings?.automaticYoutubeImportEnabled === true,
    workerRecentlyObserved: lastScanAgeMs <= scanIntervalSeconds * 3 * 1_000,
  });

  return {
    readiness,
    account: selectedYoutubeAccount
      ? {
          id: selectedYoutubeAccount.id,
          label: selectedYoutubeAccount.label,
          handle: selectedYoutubeAccount.handle,
          channelId: selectedYoutubeAccount.externalAccountId,
          updatedAt: selectedYoutubeAccount.updatedAt.toISOString(),
        }
      : null,
    accounts: youtubeAccounts.map((account) => ({
      id: account.id,
      label: account.label,
      handle: account.handle,
      status: account.status,
      credentialReady: account.credentials.length > 0,
    })),
    credential: youtubeCredential
      ? {
          status: youtubeCredential.status,
          lastSyncAt: youtubeCredential.lastSyncAt?.toISOString() ?? null,
          lastError: youtubeCredential.lastError,
          updatedAt: youtubeCredential.updatedAt.toISOString(),
        }
      : null,
    settings: automationSettings
      ? {
          youtubeSocialAccountId: automationSettings.youtubeSocialAccountId,
          automaticYoutubeImportEnabled: automationSettings.automaticYoutubeImportEnabled,
          youtubeRightsConfirmedAt: automationSettings.youtubeRightsConfirmedAt?.toISOString() ?? null,
          youtubeRightsConfirmedByUserId: automationSettings.youtubeRightsConfirmedByUserId,
          defaultSpeakerName: automationSettings.defaultSpeakerName,
          defaultLanguage: automationSettings.defaultLanguage,
          weeklyCadenceJson: automationSettings.weeklyCadenceJson,
          notificationEmail: automationSettings.notificationEmail,
          lastYoutubeScanAt: automationSettings.lastYoutubeScanAt?.toISOString() ?? null,
          lastYoutubeImportAt: automationSettings.lastYoutubeImportAt?.toISOString() ?? null,
          lastYoutubeVideoId: automationSettings.lastYoutubeVideoId,
          lastError: automationSettings.lastError,
        }
      : null,
    lastManualSermon: lastManualSermon
      ? {
          ...lastManualSermon,
          createdAt: lastManualSermon.createdAt.toISOString(),
        }
      : null,
  };
}

export async function getSermonStartDefaults(
  scope: ActivationTenantScope,
  actorUserId: string,
  now = new Date(),
) {
  const [organization, branding, actor, automationSettings] = await Promise.all([
    prisma.organization.findFirst({
      where: { id: scope.organizationId, status: "ACTIVE" },
      select: {
        name: true,
        defaultLanguage: true,
      },
    }),
    prisma.brandingSettings.findUnique({
      where: { organizationId: scope.organizationId },
      select: { churchName: true },
    }),
    prisma.user.findFirst({
      where: { id: actorUserId, status: "ACTIVE" },
      select: {
        profile: {
          select: { displayName: true },
        },
      },
    }),
    prisma.organizationAutomationSettings.findUnique({
      where: { organizationId: scope.organizationId },
      select: {
        defaultSpeakerName: true,
        defaultLanguage: true,
      },
    }),
  ]);

  if (!organization) {
    throw new Error("The active church workspace could not be loaded.");
  }

  const date = now.toISOString().slice(0, 10);
  const titleDate = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(now);

  return {
    title: `Sunday message · ${titleDate}`,
    speakerName: automationSettings?.defaultSpeakerName?.trim()
      || actor?.profile?.displayName?.trim()
      || "Pastor",
    churchName: branding?.churchName?.trim() || organization.name,
    language: automationSettings?.defaultLanguage
      || organization.defaultLanguage
      || "en",
    sermonDate: date,
  };
}
