import { stat } from "node:fs/promises";
import os from "node:os";

import type { AutomationImageMedia, AutomationPost, UploadResult } from "./posting-platforms.ts";
import {
  AmbiguousPlatformPublishError,
  postingRequiresPublicMedia,
  selectPostImageMedia,
  uploadPlatformPost,
} from "./posting-platforms.ts";
import { uploadPostingMediaToR2, type StagedMedia } from "./posting-media-staging.ts";
import { createWorkerLogger, errorFields, formatBytes, formatDuration } from "./worker-log.ts";

const workerId = process.env.POSTING_WORKER_ID?.trim() || `${os.hostname()}-posting-worker`;
const apiBaseUrl = (process.env.WORKER_API_BASE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
const apiToken = process.env.WORKER_API_TOKEN?.trim() || "";
const syncIntervalMs = Number(process.env.POSTING_WORKER_SYNC_SECONDS ?? 60) * 1000;
const dueCheckIntervalMs = Number(process.env.POSTING_WORKER_DUE_CHECK_SECONDS ?? 30) * 1000;
const heartbeatIntervalMs = Number(process.env.POSTING_WORKER_HEARTBEAT_SECONDS ?? 30) * 1000;
const dryRun = process.env.POSTING_WORKER_DRY_RUN !== "false";
const upcomingWindowMinutes = Number(process.env.POSTING_WORKER_UPCOMING_WINDOW_MINUTES ?? 10080);
const configuredTikTokProvider = process.env.TIKTOK_POSTING_PROVIDER?.trim().toLowerCase();
const tiktokProviderMode = configuredTikTokProvider === "zernio" || configuredTikTokProvider === "direct"
  ? configuredTikTokProvider
  : "account";
const tiktokDirectPrivacy = process.env.TIKTOK_DEFAULT_PRIVACY_LEVEL?.trim() || "SELF_ONLY";
const tiktokZernioPrivacy = process.env.ZERNIO_TIKTOK_PRIVACY_LEVEL?.trim() || null;
const tiktokDirectEnabled = process.env.TIKTOK_DIRECT_POST_EXPERIMENTAL === "true";
const seenCompletions = new Set<string>();
const dryRunObservedPosts = new Set<string>();
const activeLeasePostIds = new Set<string>();
const pendingCompletions = new Map<string, {
  post: AutomationPost;
  result: UploadResult;
  startedAt: number;
  platformAccepted: boolean;
}>();
const logger = createWorkerLogger("posting");
let cachedPosts: AutomationPost[] = [];
let syncing = false;
let posting = false;

type PublishErrorWithStagedMedia = Error & {
  stagedMedia?: StagedMedia;
};

class CompletionPersistenceError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "CompletionPersistenceError";
    this.statusCode = statusCode;
  }
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (apiToken) {
    headers.set("authorization", `Bearer ${apiToken}`);
  }
  headers.set("content-type", headers.get("content-type") ?? "application/json");

  return fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
  });
}

async function syncUpcomingPosts(): Promise<void> {
  if (syncing) {
    return;
  }

  syncing = true;
  try {
    const response = await apiFetch(`/api/automation/upcoming?windowMinutes=${upcomingWindowMinutes}`);
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data?.scheduledPosts)) {
      throw new Error(data?.error ?? `Upcoming sync failed with ${response.status}`);
    }

    cachedPosts = data.scheduledPosts;
    logger.info("synced upcoming posts", {
      count: cachedPosts.length,
      window: `${upcomingWindowMinutes}m`,
    });
  } catch (error) {
    logger.error("sync failed", errorFields(error));
  } finally {
    syncing = false;
  }
}

async function sendHeartbeat(): Promise<void> {
  try {
    const response = await apiFetch("/api/automation/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        workerId,
        dryRun,
        cachedPostCount: cachedPosts.length,
        capabilities: {
          zernioConfigured: Boolean(process.env.ZERNIO_API_KEY?.trim()),
          youtubeConfigured: Boolean(
            process.env.YOUTUBE_CLIENT_ID?.trim()
            && process.env.YOUTUBE_CLIENT_SECRET?.trim()
            && process.env.YOUTUBE_REFRESH_TOKEN?.trim()
          ),
          youtubeOAuthClientConfigured: Boolean(
            process.env.YOUTUBE_CLIENT_ID?.trim()
            && process.env.YOUTUBE_CLIENT_SECRET?.trim()
          ),
          facebookConfigured: Boolean(
            process.env.FACEBOOK_PAGE_ID?.trim()
            && process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim()
          ),
          youtubePrivacy: process.env.YOUTUBE_DEFAULT_PRIVACY_STATUS?.trim() || "private",
          youtubeApiVerified: process.env.YOUTUBE_API_VERIFIED === "true",
          facebookPublishesImmediately: process.env.FACEBOOK_DEFAULT_PUBLISHED === "true",
          tiktokProviderMode,
          tiktokDirectEnabled,
          tiktokDirectConfigured: Boolean(process.env.TIKTOK_ACCESS_TOKEN?.trim()),
          tiktokOAuthClientConfigured: Boolean(
            process.env.TIKTOK_CLIENT_KEY?.trim()
            && process.env.TIKTOK_CLIENT_SECRET?.trim()
          ),
          tiktokDirectPrivacy,
          tiktokZernioPrivacy,
          tiktokPrivacy: tiktokProviderMode === "zernio" ? tiktokZernioPrivacy : tiktokDirectPrivacy,
        },
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error ?? `Heartbeat failed with ${response.status}`);
    }
  } catch (error) {
    logger.warn("heartbeat failed", errorFields(error));
  }
}

async function claimPost(post: AutomationPost): Promise<boolean> {
  const response = await apiFetch(`/api/automation/scheduled-posts/${post.id}/claim`, {
    method: "POST",
    body: JSON.stringify({ workerId }),
  });

  if (response.ok) {
    return true;
  }

  const data = await response.json().catch(() => null);
  logger.warn("claim skipped", {
    post: post.id,
    platform: post.platform,
    error: data?.error ?? response.statusText,
  });
  return false;
}

async function completePost(post: AutomationPost, result: UploadResult): Promise<void> {
  const response = await apiFetch(`/api/automation/scheduled-posts/${post.id}/complete`, {
    method: "POST",
    body: JSON.stringify({
      workerId,
      status: result.status,
      externalPostId: result.externalPostId,
      publishedUrl: result.publishedUrl,
      publishError: result.publishError,
      finalPrivacyStatus: result.finalPrivacyStatus,
      mediaObjectKey: result.mediaObjectKey,
      mediaPublicUrl: result.mediaPublicUrl,
      mediaUploadedAt: result.mediaUploadedAt,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new CompletionPersistenceError(data?.error ?? `Completion failed with ${response.status}`, response.status);
  }

  seenCompletions.add(post.idempotencyKey);
  activeLeasePostIds.delete(post.id);
  cachedPosts = cachedPosts.filter((item) => item.id !== post.id);
}

async function renewActiveClaims(): Promise<void> {
  for (const postId of activeLeasePostIds) {
    try {
      const response = await apiFetch(`/api/automation/scheduled-posts/${postId}/heartbeat`, {
        method: "POST",
        body: JSON.stringify({ workerId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (response.status === 409) {
          activeLeasePostIds.delete(postId);
        }
        throw new Error(data?.error ?? `Claim heartbeat failed with ${response.status}`);
      }
    } catch (error) {
      logger.warn("publishing claim heartbeat failed", {
        post: postId,
        ...errorFields(error),
      });
    }
  }
}

async function flushPendingCompletions(): Promise<void> {
  for (const [postId, pending] of pendingCompletions) {
    try {
      await completePost(pending.post, pending.result);
      pendingCompletions.delete(postId);
      logger.success("publishing receipt recorded after retry", {
        post: postId,
        platform: pending.post.platform,
        status: pending.result.status,
        platformAccepted: pending.platformAccepted,
      });
    } catch (error) {
      if (error instanceof CompletionPersistenceError && error.statusCode === 404) {
        pendingCompletions.delete(postId);
        activeLeasePostIds.delete(postId);
        logger.error("publishing receipt needs manual verification; platform upload will not be repeated", {
          post: postId,
          platform: pending.post.platform,
          platformAccepted: pending.platformAccepted,
          duration: formatDuration(Date.now() - pending.startedAt),
        });
        continue;
      }
      logger.error("publishing receipt still pending; platform upload will not be repeated", {
        post: postId,
        platform: pending.post.platform,
        platformAccepted: pending.platformAccepted,
        duration: formatDuration(Date.now() - pending.startedAt),
        ...errorFields(error),
      });
    }
  }
}

function rememberPendingCompletion(input: {
  post: AutomationPost;
  result: UploadResult;
  startedAt: number;
  platformAccepted: boolean;
}): void {
  pendingCompletions.set(input.post.id, input);
  cachedPosts = cachedPosts.filter((item) => item.id !== input.post.id);
}

async function firstExistingFile(candidates: string[]): Promise<{ path: string; size: number }> {
  for (const candidate of candidates) {
    try {
      const fileStat = await stat(candidate);
      if (fileStat.isFile() && fileStat.size > 0) {
        return { path: candidate, size: fileStat.size };
      }
    } catch {
      // Try the next candidate path from the shared metadata.
    }
  }

  throw new Error("No local video file exists for this scheduled post.");
}

async function prepareImageMedia(post: AutomationPost, mediaItems: AutomationImageMedia[]): Promise<{
  post: AutomationPost;
  stagedMedia: StagedMedia[];
}> {
  const stagedByFileId = new Map<string, StagedMedia>();

  for (const media of mediaItems) {
    if (media.publicUrl?.trim()) continue;
    if (!media.filePath?.trim()) {
      throw new Error(`Prepared image ${media.fileName} has no public URL or local file to stage.`);
    }
    const localImage = await firstExistingFile([media.filePath]);
    const staged = await uploadPostingMediaToR2({
      scheduledPostId: post.id,
      clipId: `${media.assetId}-${media.id}`,
      videoPath: localImage.path,
      videoSize: localImage.size,
      contentType: media.mimeType,
    });
    stagedByFileId.set(media.id, staged);
    logger.success("image staged for Meta publishing", {
      post: post.id,
      platform: post.platform,
      file: media.fileName,
      size: formatBytes(localImage.size),
    });
  }

  if (stagedByFileId.size === 0) {
    return { post, stagedMedia: [] };
  }

  return {
    post: {
      ...post,
      contentAssets: post.contentAssets?.map((asset) => ({
        ...asset,
        files: asset.files.map((file) => {
          const staged = stagedByFileId.get(file.id);
          return staged
            ? {
                ...file,
                objectKey: staged.objectKey,
                publicUrl: staged.publicUrl,
              }
            : file;
        }),
      })),
    },
    stagedMedia: Array.from(stagedByFileId.values()),
  };
}

async function publishPost(post: AutomationPost): Promise<UploadResult> {
  const imageMedia = selectPostImageMedia(post);
  if (imageMedia.length > 0) {
    if (dryRun) {
      logger.warn("dry-run image publish skipped", {
        post: post.id,
        platform: post.platform,
        images: imageMedia.length,
      });
      return {
        status: "SKIPPED",
        externalPostId: `dry-run-${post.id}`,
        finalPrivacyStatus: "dry-run",
        publishError: "Dry run only. Set POSTING_WORKER_DRY_RUN=false to upload to the platform.",
      };
    }

    let stagedMedia: StagedMedia[] = [];
    try {
      const prepared = await prepareImageMedia(post, imageMedia);
      stagedMedia = prepared.stagedMedia;
      const result = await uploadPlatformPost(prepared.post, "", 0);
      const firstStaged = stagedMedia[0];
      return {
        ...result,
        mediaObjectKey: result.mediaObjectKey ?? firstStaged?.objectKey,
        mediaPublicUrl: result.mediaPublicUrl ?? firstStaged?.publicUrl,
        mediaUploadedAt: result.mediaUploadedAt ?? firstStaged?.uploadedAt,
      };
    } catch (error) {
      const firstStaged = stagedMedia[0];
      if (error instanceof Error && firstStaged) {
        (error as PublishErrorWithStagedMedia).stagedMedia = firstStaged;
      }
      throw error;
    }
  }

  const firstClip = post.clips[0];
  if (!firstClip) {
    throw new Error("Scheduled post does not include a clip.");
  }

  const video = await firstExistingFile(firstClip.localFileCandidates);
  let stagedMedia: StagedMedia | undefined = post.mediaPublicUrl && post.mediaObjectKey
    ? {
      publicUrl: post.mediaPublicUrl,
      objectKey: post.mediaObjectKey,
      uploadedAt: post.mediaUploadedAt ?? new Date().toISOString(),
    }
    : undefined;

  if (dryRun) {
    logger.warn("dry-run publish skipped", {
      post: post.id,
      platform: post.platform,
      video: video.path,
      size: formatBytes(video.size),
    });
    return {
      status: "SKIPPED",
      externalPostId: `dry-run-${post.id}`,
      publishedUrl: undefined,
      finalPrivacyStatus: "dry-run",
      publishError: "Dry run only. Set POSTING_WORKER_DRY_RUN=false to upload to the platform.",
    };
  }

  try {
    if (postingRequiresPublicMedia(post) && !stagedMedia) {
      stagedMedia = await uploadPostingMediaToR2({
        scheduledPostId: post.id,
        clipId: firstClip.id,
        videoPath: video.path,
        videoSize: video.size,
      });
      logger.success("media staged for publisher", {
        post: post.id,
        platform: post.platform,
        size: formatBytes(video.size),
      });
    }

    const result = await uploadPlatformPost({
      ...post,
      mediaObjectKey: stagedMedia?.objectKey ?? post.mediaObjectKey,
      mediaPublicUrl: stagedMedia?.publicUrl ?? post.mediaPublicUrl,
      mediaUploadedAt: stagedMedia?.uploadedAt ?? post.mediaUploadedAt,
    }, video.path, video.size);

    return {
      ...result,
      mediaObjectKey: result.mediaObjectKey ?? stagedMedia?.objectKey,
      mediaPublicUrl: result.mediaPublicUrl ?? stagedMedia?.publicUrl,
      mediaUploadedAt: result.mediaUploadedAt ?? stagedMedia?.uploadedAt,
    };
  } catch (error) {
    if (error instanceof Error && stagedMedia) {
      (error as PublishErrorWithStagedMedia).stagedMedia = stagedMedia;
    }
    throw error;
  }
}

async function processDuePosts(): Promise<void> {
  if (posting) {
    return;
  }

  posting = true;
  try {
    await flushPendingCompletions();
    const now = Date.now();
    const duePosts = cachedPosts.filter((post) => {
      if (!post.scheduledFor || seenCompletions.has(post.idempotencyKey)) {
        return false;
      }

      return new Date(post.scheduledFor).getTime() <= now;
    });

    if (dryRun) {
      for (const post of duePosts) {
        if (dryRunObservedPosts.has(post.id)) {
          continue;
        }
        dryRunObservedPosts.add(post.id);
        logger.warn("dry-run observed due post without claiming it", {
          post: post.id,
          platform: post.platform,
          scheduledFor: post.scheduledFor,
        });
      }
      return;
    }

    for (const post of duePosts) {
      const startedAt = Date.now();
      const claimed = await claimPost(post);
      if (!claimed) {
        continue;
      }
      activeLeasePostIds.add(post.id);

      logger.info("publishing post", {
        post: post.id,
        platform: post.platform,
        account: post.socialAccountExternalAccountId ?? post.socialAccountId ?? "default",
      });

      let result: UploadResult;
      try {
        result = await publishPost(post);
      } catch (error) {
        const publishError = error instanceof Error ? error.message : String(error);
        const stagedMedia = error instanceof Error ? (error as PublishErrorWithStagedMedia).stagedMedia : undefined;
        const ambiguousPlatformResult = error instanceof AmbiguousPlatformPublishError;
        const failedResult: UploadResult = {
          status: ambiguousPlatformResult ? "PRIVATE_ONLY_UNVERIFIED" : "FAILED",
          publishError,
          mediaObjectKey: stagedMedia?.objectKey,
          mediaPublicUrl: stagedMedia?.publicUrl,
          mediaUploadedAt: stagedMedia?.uploadedAt,
        };
        try {
          await completePost(post, failedResult);
        } catch (completionError) {
          rememberPendingCompletion({
            post,
            result: failedResult,
            startedAt,
            platformAccepted: ambiguousPlatformResult,
          });
          logger.error("publishing failure could not be recorded; receipt retry queued", {
            post: post.id,
            platform: post.platform,
            ...errorFields(completionError),
          });
        }
        logger.error("post failed", {
          post: post.id,
          platform: post.platform,
          duration: formatDuration(Date.now() - startedAt),
          error: publishError,
        });
        continue;
      }

      try {
        await completePost(post, result);
        logger.success("post completed", {
          post: post.id,
          platform: post.platform,
          status: result.status,
          duration: formatDuration(Date.now() - startedAt),
          privacy: result.finalPrivacyStatus,
          externalPost: result.externalPostId,
        });
      } catch (completionError) {
        rememberPendingCompletion({
          post,
          result,
          startedAt,
          platformAccepted: result.status !== "FAILED",
        });
        logger.error("platform response received but publishing receipt could not be recorded; upload will not be repeated", {
          post: post.id,
          platform: post.platform,
          duration: formatDuration(Date.now() - startedAt),
          status: result.status,
          externalPost: result.externalPostId,
          ...errorFields(completionError),
        });
      }
    }
  } catch (error) {
    logger.error("due check failed; will retry", errorFields(error));
  } finally {
    posting = false;
  }
}

async function main(): Promise<void> {
  logger.banner("posting worker started", {
    apiBaseUrl,
    workerId,
    dryRun,
    syncEvery: `${syncIntervalMs / 1000}s`,
    dueEvery: `${dueCheckIntervalMs / 1000}s`,
    heartbeatEvery: `${heartbeatIntervalMs / 1000}s`,
  });

  await sendHeartbeat();
  await syncUpcomingPosts();
  await processDuePosts();

  setInterval(() => {
    void syncUpcomingPosts();
  }, syncIntervalMs);

  setInterval(() => {
    void processDuePosts();
  }, dueCheckIntervalMs);

  setInterval(() => {
    void sendHeartbeat();
    void renewActiveClaims();
  }, heartbeatIntervalMs);
}

process.on("SIGINT", () => {
  logger.warn("stopping");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.warn("stopping");
  process.exit(0);
});

void main().catch((error) => {
  logger.error("fatal startup failure", errorFields(error));
  process.exit(1);
});
