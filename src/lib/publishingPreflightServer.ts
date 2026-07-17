import { prisma } from "@/lib/prisma";
import {
  fromPrismaPostingPlatform,
  type PostingAutomationMode,
  type PostingPlatform,
} from "@/lib/postingDrafts";
import {
  buildPublishingPreflight,
  type PublishingPreflightAccount,
  type PublishingPreflightPacket,
  type PublishingServerCapabilities,
} from "@/lib/publishingPreflight";
import { getPublishingServiceHealth } from "@/lib/publishingServiceHealth";
import { resolveReadyMedia } from "@/lib/readyMedia";

function toDatabasePlatform(platform: PostingPlatform) {
  if (platform === "TikTok") return "TIKTOK" as const;
  if (platform === "Instagram") return "INSTAGRAM" as const;
  if (platform === "YouTube Shorts") return "YOUTUBE_SHORTS" as const;
  return "FACEBOOK" as const;
}

export async function runPublishingPreflight(input: {
  clipIds: string[];
  platforms: PostingPlatform[];
  automationMode: PostingAutomationMode;
  selectedAccountIdsByPlatform?: Partial<Record<PostingPlatform, string[]>>;
  controlPanelMode?: boolean;
}): Promise<PublishingPreflightPacket> {
  const [clipRecords, accountRecords, serviceHealth] = await Promise.all([
    prisma.clipCandidate.findMany({
      where: { id: { in: input.clipIds } },
      select: {
        id: true,
        title: true,
        durationSeconds: true,
        exportFormat: true,
        exportStatus: true,
        exportFreshness: true,
        captionData: true,
        transcriptSafetyStatus: true,
        exportedFilePath: true,
        exportPath: true,
        overlayVideoPath: true,
        captionedVideoPath: true,
        renderedFilePath: true,
      },
    }),
    prisma.socialAccount.findMany({
      where: { platform: { in: input.platforms.map(toDatabasePlatform) } },
      select: {
        id: true,
        platform: true,
        status: true,
        externalProvider: true,
        externalAccountId: true,
        externalPlatform: true,
        credentials: {
          where: { status: "CONNECTED" },
          select: {
            provider: true,
            accessTokenCiphertext: true,
            refreshTokenCiphertext: true,
            scopesJson: true,
            expiresAt: true,
          },
        },
      },
    }),
    getPublishingServiceHealth(),
  ]);

  const resolvedClips = await Promise.all(clipRecords.map(async (clip) => {
    const media = await resolveReadyMedia(clip, { trustMetadata: input.controlPanelMode === true });
    return {
      id: clip.id,
      title: clip.title,
      durationSeconds: clip.durationSeconds,
      exportFormat: clip.exportFormat,
      mediaReady: media.mediaReady,
      outputPath: media.outputPath,
      transcriptReviewRequired: clip.transcriptSafetyStatus === "REVIEW_REQUIRED",
    };
  }));
  const foundClipIds = new Set(resolvedClips.map((clip) => clip.id));
  const missingClips = input.clipIds.filter((clipId) => !foundClipIds.has(clipId)).map((clipId) => ({
    id: clipId,
    title: "Unavailable clip",
    durationSeconds: 0,
    exportFormat: null,
    mediaReady: false,
    outputPath: null,
    transcriptReviewRequired: false,
  }));
  const workerCapabilities = serviceHealth.capabilities;
  const capabilities: PublishingServerCapabilities = workerCapabilities ?? {
    zernioConfigured: false,
    youtubeConfigured: false,
    youtubeOAuthClientConfigured: false,
    facebookConfigured: false,
    youtubePrivacy: "private",
    youtubeApiVerified: false,
    facebookPublishesImmediately: false,
    tiktokProviderMode: "account",
    tiktokDirectEnabled: false,
    tiktokDirectConfigured: false,
    tiktokOAuthClientConfigured: false,
    tiktokDirectPrivacy: "SELF_ONLY",
    tiktokZernioPrivacy: null,
    tiktokPrivacy: null,
  };
  const accounts: PublishingPreflightAccount[] = accountRecords.map((account) => {
    const expectedCredentialProvider = account.platform === "YOUTUBE_SHORTS"
      ? "YOUTUBE"
      : account.platform === "FACEBOOK"
        ? "META_FACEBOOK"
        : account.platform === "TIKTOK"
          ? "TIKTOK"
          : "META_INSTAGRAM";

    const matchingCredential = account.credentials.find((credential) => (
      credential.provider === expectedCredentialProvider
    ));
    let credentialReady = false;
    let credentialIssue: string | null = null;
    if (matchingCredential) {
      if (expectedCredentialProvider === "YOUTUBE") {
        credentialReady = Boolean(matchingCredential.refreshTokenCiphertext);
      } else if (expectedCredentialProvider === "META_FACEBOOK") {
        credentialReady = Boolean(matchingCredential.accessTokenCiphertext);
      } else if (expectedCredentialProvider === "TIKTOK") {
        const scopes = Array.isArray(matchingCredential.scopesJson)
          ? matchingCredential.scopesJson.filter((scope): scope is string => typeof scope === "string")
          : typeof matchingCredential.scopesJson === "string"
            ? matchingCredential.scopesJson.split(/[\s,]+/)
            : [];
        const hasPublishScope = scopes.includes("video.publish");
        const accessTokenReady = Boolean(matchingCredential.accessTokenCiphertext);
        const unexpired = Boolean(
          matchingCredential.expiresAt
          && matchingCredential.expiresAt.getTime() > Date.now() + 60_000,
        );
        const refreshReady = Boolean(
          matchingCredential.refreshTokenCiphertext
          && capabilities.tiktokOAuthClientConfigured,
        );
        credentialReady = accessTokenReady && hasPublishScope && (unexpired || refreshReady);
        credentialIssue = !hasPublishScope
          ? "The selected TikTok account is missing the video.publish permission. Reconnect it before scheduling."
          : !accessTokenReady
            ? "The selected TikTok account has no usable access token. Reconnect it before scheduling."
            : !unexpired && !refreshReady
              ? "The selected TikTok token is expired or unverified and cannot be refreshed by this worker. Reconnect it or configure the TikTok OAuth client."
              : null;
      } else {
        credentialReady = Boolean(matchingCredential.accessTokenCiphertext);
      }
    }

    return {
      id: account.id,
      platform: fromPrismaPostingPlatform(account.platform),
      status: account.status,
      externalProvider: account.externalProvider,
      externalAccountId: account.externalAccountId,
      externalPlatform: account.externalPlatform,
      credentialReady,
      credentialIssue,
    };
  });

  return buildPublishingPreflight({
    automationMode: input.automationMode,
    platforms: input.platforms,
    clips: [...resolvedClips, ...missingClips],
    accounts,
    selectedAccountIdsByPlatform: input.selectedAccountIdsByPlatform,
    capabilities,
    serviceHealth,
  });
}
