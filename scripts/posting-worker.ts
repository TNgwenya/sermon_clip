import { stat } from "node:fs/promises";
import os from "node:os";

import type { AutomationPost, UploadResult } from "./posting-platforms.ts";
import { uploadPlatformPost } from "./posting-platforms.ts";

const workerId = process.env.POSTING_WORKER_ID?.trim() || `${os.hostname()}-posting-worker`;
const apiBaseUrl = (process.env.WORKER_API_BASE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
const apiToken = process.env.WORKER_API_TOKEN?.trim() || "";
const syncIntervalMs = Number(process.env.POSTING_WORKER_SYNC_SECONDS ?? 300) * 1000;
const dueCheckIntervalMs = Number(process.env.POSTING_WORKER_DUE_CHECK_SECONDS ?? 30) * 1000;
const dryRun = process.env.POSTING_WORKER_DRY_RUN !== "false";
const upcomingWindowMinutes = Number(process.env.POSTING_WORKER_UPCOMING_WINDOW_MINUTES ?? 10080);
const seenCompletions = new Set<string>();
let cachedPosts: AutomationPost[] = [];
let syncing = false;
let posting = false;

function log(message: string, data?: unknown): void {
  const suffix = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[posting-worker] ${new Date().toISOString()} ${message}${suffix}`);
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
    log(`synced ${cachedPosts.length} upcoming post(s)`);
  } catch (error) {
    log("sync failed", { error: error instanceof Error ? error.message : String(error) });
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
  log("claim skipped", { id: post.id, error: data?.error ?? response.statusText });
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

  if (dryRun) {
    log("dry run publish", { id: post.id, platform: post.platform, videoPath: video.path });
    return {
      status: "SKIPPED",
      externalPostId: `dry-run-${post.id}`,
      publishedUrl: undefined,
      finalPrivacyStatus: "dry-run",
      publishError: "Dry run only. Set POSTING_WORKER_DRY_RUN=false to upload to the platform.",
    };
  }

  return uploadPlatformPost(post, video.path, video.size);
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
      const claimed = await claimPost(post);
      if (!claimed) {
        continue;
      }

      try {
        const result = await publishPost(post);
        await completePost(post, result);
        log("post completed", { id: post.id, status: result.status });
      } catch (error) {
        const publishError = error instanceof Error ? error.message : String(error);
        await completePost(post, {
          status: "FAILED",
          publishError,
        });
        log("post failed", { id: post.id, error: publishError });
      }
    }
  } finally {
    posting = false;
  }
}

async function main(): Promise<void> {
  log("starting", {
    apiBaseUrl,
    workerId,
    dryRun,
    syncIntervalSeconds: syncIntervalMs / 1000,
    dueCheckIntervalSeconds: dueCheckIntervalMs / 1000,
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
  log("stopping");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("stopping");
  process.exit(0);
});

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
