import { stat } from "node:fs/promises";
import os from "node:os";

import type { AutomationPost, UploadResult } from "./posting-platforms.ts";
import { uploadPlatformPost } from "./posting-platforms.ts";
import { uploadPostingMediaToR2, type StagedMedia } from "./posting-media-staging.ts";
import { createWorkerLogger, errorFields, formatBytes, formatDuration } from "./worker-log.ts";

const workerId = process.env.POSTING_WORKER_ID?.trim() || `${os.hostname()}-posting-worker`;
const apiBaseUrl = (process.env.WORKER_API_BASE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
const apiToken = process.env.WORKER_API_TOKEN?.trim() || "";
const syncIntervalMs = Number(process.env.POSTING_WORKER_SYNC_SECONDS ?? 60) * 1000;
const dueCheckIntervalMs = Number(process.env.POSTING_WORKER_DUE_CHECK_SECONDS ?? 30) * 1000;
const dryRun = process.env.POSTING_WORKER_DRY_RUN !== "false";
const upcomingWindowMinutes = Number(process.env.POSTING_WORKER_UPCOMING_WINDOW_MINUTES ?? 10080);
const seenCompletions = new Set<string>();
const logger = createWorkerLogger("posting");
let cachedPosts: AutomationPost[] = [];
let syncing = false;
let posting = false;

type PublishErrorWithStagedMedia = Error & {
  stagedMedia?: StagedMedia;
};

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
    throw new Error(data?.error ?? `Completion failed with ${response.status}`);
  }

  seenCompletions.add(post.idempotencyKey);
  cachedPosts = cachedPosts.filter((item) => item.id !== post.id);
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

async function publishPost(post: AutomationPost): Promise<UploadResult> {
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
    const zernioPlatform = post.platform === "TikTok" || post.platform === "Instagram";
    if (zernioPlatform && !stagedMedia) {
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
    const now = Date.now();
    const duePosts = cachedPosts.filter((post) => {
      if (!post.scheduledFor || seenCompletions.has(post.idempotencyKey)) {
        return false;
      }

      return new Date(post.scheduledFor).getTime() <= now;
    });

    for (const post of duePosts) {
      const startedAt = Date.now();
      const claimed = await claimPost(post);
      if (!claimed) {
        continue;
      }

      logger.info("publishing post", {
        post: post.id,
        platform: post.platform,
        account: post.socialAccountExternalAccountId ?? post.socialAccountId ?? "default",
      });

      try {
        const result = await publishPost(post);
        await completePost(post, result);
        logger.success("post completed", {
          post: post.id,
          platform: post.platform,
          status: result.status,
          duration: formatDuration(Date.now() - startedAt),
          privacy: result.finalPrivacyStatus,
          externalPost: result.externalPostId,
        });
      } catch (error) {
        const publishError = error instanceof Error ? error.message : String(error);
        const stagedMedia = error instanceof Error ? (error as PublishErrorWithStagedMedia).stagedMedia : undefined;
        await completePost(post, {
          status: "FAILED",
          publishError,
          mediaObjectKey: stagedMedia?.objectKey,
          mediaPublicUrl: stagedMedia?.publicUrl,
          mediaUploadedAt: stagedMedia?.uploadedAt,
        });
        logger.error("post failed", {
          post: post.id,
          platform: post.platform,
          duration: formatDuration(Date.now() - startedAt),
          error: publishError,
        });
      }
    }
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
  });

  await syncUpcomingPosts();
  await processDuePosts();

  setInterval(() => {
    void syncUpcomingPosts();
  }, syncIntervalMs);

  setInterval(() => {
    void processDuePosts();
  }, dueCheckIntervalMs);
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
