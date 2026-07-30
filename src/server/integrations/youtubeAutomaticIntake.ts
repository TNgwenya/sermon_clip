import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  getConnectedCredentials,
  upsertSocialCredential,
  type DecryptedSocialCredential,
} from "@/server/integrations/socialCredentials";
import { refreshYouTubeAccessToken } from "@/server/integrations/youtubeAnalytics";
import {
  getAudioPath,
  getSourceVideoPath,
  getTranscriptJsonPath,
} from "@/server/agents/storage";

const DEFAULT_MINIMUM_DURATION_SECONDS = 10 * 60;
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1_000;
const MAX_UPLOAD_RESULTS = 10;

type YouTubeApiError = {
  error?: { message?: string };
};

type YouTubeChannelsResponse = YouTubeApiError & {
  items?: Array<{
    contentDetails?: {
      relatedPlaylists?: { uploads?: string };
    };
  }>;
};

type YouTubePlaylistItemsResponse = YouTubeApiError & {
  items?: Array<{
    snippet?: {
      title?: string;
      publishedAt?: string;
      resourceId?: { videoId?: string };
    };
    contentDetails?: {
      videoId?: string;
      videoPublishedAt?: string;
    };
    status?: { privacyStatus?: string };
  }>;
};

type YouTubeVideosResponse = YouTubeApiError & {
  items?: Array<{
    id?: string;
    contentDetails?: { duration?: string };
    status?: { privacyStatus?: string };
  }>;
};

export type YouTubeUploadCandidate = Readonly<{
  videoId: string;
  title: string;
  publishedAt: Date;
  durationSeconds: number;
  privacyStatus: string;
}>;

export type YouTubeAutomaticIntakeResult = Readonly<{
  organizationId: string;
  scanned: number;
  imported: number;
  sermonId: string | null;
  reason: string;
}>;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for YouTube automation.`);
  return value;
}

function minimumDurationSeconds(): number {
  const configured = Number(process.env.YOUTUBE_AUTOMATION_MIN_DURATION_SECONDS);
  if (!Number.isFinite(configured)) return DEFAULT_MINIMUM_DURATION_SECONDS;
  return Math.min(7_200, Math.max(60, Math.round(configured)));
}

export function parseIso8601DurationSeconds(value: string): number | null {
  const match = value.trim().match(
    /^P(?:(\d+(?:\.\d+)?)D)?T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/,
  );
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const total = days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total >= 0 ? total : null;
}

async function youtubeJson<T extends YouTubeApiError>(
  path: string,
  params: URLSearchParams,
  accessToken: string,
): Promise<T> {
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/${path}?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );
  const payload = await response.json() as T;
  if (!response.ok) {
    throw new Error(
      payload.error?.message
      || `YouTube ${path} request failed with status ${response.status}.`,
    );
  }
  return payload;
}

export async function fetchRecentYouTubeUploads(input: Readonly<{
  channelId: string;
  accessToken: string;
}>): Promise<YouTubeUploadCandidate[]> {
  const channels = await youtubeJson<YouTubeChannelsResponse>(
    "channels",
    new URLSearchParams({
      part: "contentDetails",
      id: input.channelId,
      maxResults: "1",
    }),
    input.accessToken,
  );
  const uploadsPlaylistId = channels.items?.[0]
    ?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    throw new Error("The connected YouTube channel did not return an uploads playlist.");
  }

  const playlist = await youtubeJson<YouTubePlaylistItemsResponse>(
    "playlistItems",
    new URLSearchParams({
      part: "snippet,contentDetails,status",
      playlistId: uploadsPlaylistId,
      maxResults: String(MAX_UPLOAD_RESULTS),
    }),
    input.accessToken,
  );
  const videoIds = Array.from(new Set(
    (playlist.items ?? [])
      .map((item) => item.contentDetails?.videoId || item.snippet?.resourceId?.videoId)
      .filter((videoId): videoId is string => Boolean(videoId)),
  ));
  if (videoIds.length === 0) return [];

  const videos = await youtubeJson<YouTubeVideosResponse>(
    "videos",
    new URLSearchParams({
      part: "contentDetails,status",
      id: videoIds.join(","),
      maxResults: String(MAX_UPLOAD_RESULTS),
    }),
    input.accessToken,
  );
  const detailsById = new Map(
    (videos.items ?? []).map((video) => [video.id, video]),
  );

  return (playlist.items ?? []).flatMap((item) => {
    const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
    const details = videoId ? detailsById.get(videoId) : null;
    const durationSeconds = details?.contentDetails?.duration
      ? parseIso8601DurationSeconds(details.contentDetails.duration)
      : null;
    const publishedRaw = item.contentDetails?.videoPublishedAt
      || item.snippet?.publishedAt;
    const publishedAt = publishedRaw ? new Date(publishedRaw) : null;
    const privacyStatus = details?.status?.privacyStatus
      || item.status?.privacyStatus
      || "unknown";
    const title = item.snippet?.title?.trim() ?? "";
    if (
      !videoId
      || !title
      || durationSeconds === null
      || !publishedAt
      || Number.isNaN(publishedAt.getTime())
      || privacyStatus !== "public"
    ) {
      return [];
    }
    return [{
      videoId,
      title,
      publishedAt,
      durationSeconds,
      privacyStatus,
    }];
  }).sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime());
}

async function usableAccessToken(
  credential: DecryptedSocialCredential,
  now: Date,
): Promise<string> {
  if (
    !credential.expiresAt
    || credential.expiresAt.getTime() > now.getTime() + TOKEN_REFRESH_SKEW_MS
  ) {
    return credential.accessToken;
  }
  if (!credential.refreshToken) {
    throw new Error("Reconnect YouTube because its access token has expired.");
  }
  const refreshed = await refreshYouTubeAccessToken({
    clientId: requiredEnv("YOUTUBE_CLIENT_ID"),
    clientSecret: requiredEnv("YOUTUBE_CLIENT_SECRET"),
    refreshToken: credential.refreshToken,
  });
  await upsertSocialCredential({
    tenantScope: {
      organizationId: credential.organizationId,
      campusId: credential.campusId,
    },
    provider: "YOUTUBE",
    externalAccountId: credential.externalAccountId,
    accountName: credential.accountName,
    handle: credential.handle,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken || credential.refreshToken,
    tokenType: refreshed.tokenType || credential.tokenType,
    scopes: credential.scopes,
    expiresAt: refreshed.expiresAt,
  });
  return refreshed.accessToken;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 500) || "YouTube automatic intake failed.";
}

export async function runAutomaticYoutubeIntakeForOrganization(
  organizationId: string,
  now = new Date(),
): Promise<YouTubeAutomaticIntakeResult> {
  const settings = await prisma.organizationAutomationSettings.findUnique({
    where: { organizationId },
    include: {
      organization: { select: { name: true } },
      youtubeSocialAccount: {
        select: { id: true, campusId: true, externalAccountId: true },
      },
    },
  });
  if (
    !settings
    || !settings.automaticYoutubeImportEnabled
    || !settings.youtubeRightsConfirmedAt
  ) {
    return {
      organizationId,
      scanned: 0,
      imported: 0,
      sermonId: null,
      reason: "automatic-intake-disabled",
    };
  }

  try {
    const credentials = await getConnectedCredentials("YOUTUBE", {
      organizationId,
      campusId: settings.youtubeSocialAccount?.campusId ?? null,
    });
    const credential = credentials.find((candidate) => (
      settings.youtubeSocialAccountId
        ? candidate.socialAccountId === settings.youtubeSocialAccountId
        : candidate.externalAccountId === settings.youtubeSocialAccount?.externalAccountId
    )) ?? credentials[0];
    if (!credential) {
      throw new Error("Connect a YouTube channel before enabling automatic intake.");
    }
    const accessToken = await usableAccessToken(credential, now);
    const uploads = await fetchRecentYouTubeUploads({
      channelId: credential.externalAccountId,
      accessToken,
    });
    const eligible = uploads.filter((upload) => (
      upload.durationSeconds >= minimumDurationSeconds()
      && upload.publishedAt >= settings.youtubeRightsConfirmedAt!
    ));

    let selected: YouTubeUploadCandidate | null = null;
    for (const candidate of eligible) {
      const youtubeUrl = `https://www.youtube.com/watch?v=${candidate.videoId}`;
      const exists = await prisma.sermon.findFirst({
        where: { organizationId, youtubeUrl },
        select: { id: true },
      });
      if (!exists) {
        selected = candidate;
        break;
      }
    }
    if (!selected) {
      await prisma.organizationAutomationSettings.update({
        where: { organizationId },
        data: { lastYoutubeScanAt: now, lastError: null },
      });
      return {
        organizationId,
        scanned: uploads.length,
        imported: 0,
        sermonId: null,
        reason: eligible.length === 0 ? "no-eligible-sermon" : "already-imported",
      };
    }

    const youtubeUrl = `https://www.youtube.com/watch?v=${selected.videoId}`;
    const sermon = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.sermon.findFirst({
        where: { organizationId, youtubeUrl },
        select: { id: true },
      });
      if (existing) return existing;
      const created = await transaction.sermon.create({
        data: {
          organizationId,
          campusId: credential.campusId,
          youtubeUrl,
          title: selected!.title,
          speakerName: settings.defaultSpeakerName?.trim()
            || credential.accountName
            || "Pastor",
          churchName: settings.organization.name,
          language: settings.defaultLanguage,
          sourceDurationSeconds: selected!.durationSeconds,
          includeWorshipMoments: settings.includeWorshipMoments,
          sermonDate: selected!.publishedAt,
          rightsConfirmed: true,
          status: "CREATED",
        },
        select: { id: true },
      });
      await transaction.sermon.update({
        where: { id: created.id },
        data: {
          sourceVideoPath: getSourceVideoPath(created.id),
          audioPath: getAudioPath(created.id),
          transcriptJsonPath: getTranscriptJsonPath(created.id),
        },
      });
      await transaction.processingJob.create({
        data: {
          sermonId: created.id,
          type: "PROCESS_SERMON",
          status: "PENDING",
          generationSummary: {
            source: "youtube-automatic-intake",
            videoId: selected!.videoId,
          },
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId,
          campusId: credential.campusId,
          actorType: "SYSTEM",
          action: "sermon.youtube_auto_imported",
          targetType: "Sermon",
          targetId: created.id,
          metadataJson: {
            youtubeVideoId: selected!.videoId,
            publishedAt: selected!.publishedAt.toISOString(),
            durationSeconds: selected!.durationSeconds,
          },
        },
      });
      await transaction.organizationAutomationSettings.update({
        where: { organizationId },
        data: {
          lastYoutubeScanAt: now,
          lastYoutubeImportAt: now,
          lastYoutubeVideoId: selected!.videoId,
          lastError: null,
        },
      });
      return created;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    return {
      organizationId,
      scanned: uploads.length,
      imported: 1,
      sermonId: sermon.id,
      reason: "imported",
    };
  } catch (error) {
    const message = safeError(error);
    await prisma.organizationAutomationSettings.updateMany({
      where: { organizationId },
      data: { lastYoutubeScanAt: now, lastError: message },
    }).catch(() => undefined);
    throw new Error(message);
  }
}

export async function runAutomaticYoutubeIntakeSweep(input: Readonly<{
  now?: Date;
  limit?: number;
}> = {}): Promise<{
  checked: number;
  imported: number;
  failed: number;
  results: YouTubeAutomaticIntakeResult[];
}> {
  const now = input.now ?? new Date();
  const settings = await prisma.organizationAutomationSettings.findMany({
    where: {
      automaticYoutubeImportEnabled: true,
      youtubeRightsConfirmedAt: { not: null },
    },
    orderBy: [{ lastYoutubeScanAt: "asc" }, { createdAt: "asc" }],
    take: Math.min(100, Math.max(1, input.limit ?? 25)),
    select: { organizationId: true },
  });
  const results: YouTubeAutomaticIntakeResult[] = [];
  let failed = 0;
  for (const setting of settings) {
    try {
      results.push(await runAutomaticYoutubeIntakeForOrganization(
        setting.organizationId,
        now,
      ));
    } catch {
      failed += 1;
    }
  }
  return {
    checked: settings.length,
    imported: results.reduce((sum, result) => sum + result.imported, 0),
    failed,
    results,
  };
}
