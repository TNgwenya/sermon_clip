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
  const accounts: PublishingPreflightAccount[] = accountRecords.map((account) => {
    const expectedCredentialProvider = account.platform === "YOUTUBE_SHORTS"
      ? "YOUTUBE"
      : account.platform === "FACEBOOK"
        ? "META_FACEBOOK"
        : account.platform === "TIKTOK"
          ? "TIKTOK"
          : "META_INSTAGRAM";

    return {
      id: account.id,
      platform: fromPrismaPostingPlatform(account.platform),
      status: account.status,
      externalProvider: account.externalProvider,
      externalAccountId: account.externalAccountId,
      externalPlatform: account.externalPlatform,
      credentialReady: account.credentials.some((credential) => {
        if (credential.provider !== expectedCredentialProvider) {
          return false;
        }
        if (expectedCredentialProvider === "YOUTUBE") {
          return Boolean(credential.refreshTokenCiphertext);
        }
        if (expectedCredentialProvider === "META_FACEBOOK") {
          return Boolean(credential.accessTokenCiphertext);
        }
        return true;
      }),
    };
  });
  const workerCapabilities = serviceHealth.capabilities;
  const capabilities: PublishingServerCapabilities = workerCapabilities ?? {
    zernioConfigured: false,
    youtubeConfigured: false,
    youtubeOAuthClientConfigured: false,
    facebookConfigured: false,
    youtubePrivacy: "private",
    youtubeApiVerified: false,
    facebookPublishesImmediately: false,
    tiktokPrivacy: null,
  };

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
