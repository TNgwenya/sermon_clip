import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import os from "node:os";

type AutomationPost = {
  id: string;
  platform: "TikTok" | "Instagram" | "YouTube Shorts" | "Facebook";
  title: string;
  caption: string;
  scheduledFor: string | null;
  idempotencyKey: string;
  clips: Array<{
    id: string;
    title: string;
    caption: string;
    hashtags: unknown;
    localFileCandidates: string[];
    sermon: {
      title: string;
      churchName: string;
    };
  }>;
};

type CompletionStatus = "POSTED" | "FAILED" | "PRIVATE_ONLY_UNVERIFIED";

type UploadResult = {
  status: CompletionStatus;
  externalPostId?: string;
  publishedUrl?: string;
  publishError?: string;
  finalPrivacyStatus?: string;
};

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

function extractHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().startsWith("#") ? item.trim() : `#${item.trim()}`);
}

function buildYouTubeText(post: AutomationPost): { title: string; description: string; tags: string[] } {
  const firstClip = post.clips[0];
  const hashtags = Array.from(new Set(post.clips.flatMap((clip) => extractHashtags(clip.hashtags))));
  const title = (post.title || firstClip?.title || "Sermon clip").slice(0, 100);
  const caption = post.caption || firstClip?.caption || "";
  const description = [
    caption,
    hashtags.length > 0 ? hashtags.join(" ") : "#Shorts",
    firstClip?.sermon.churchName ? `From ${firstClip.sermon.churchName}` : "",
  ].filter(Boolean).join("\n\n");

  return {
    title,
    description,
    tags: Array.from(new Set(["Shorts", ...hashtags.map((tag) => tag.replace(/^#/, ""))])).slice(0, 20),
  };
}

async function getYouTubeAccessToken(): Promise<string> {
  const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN?.trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("YouTube credentials are incomplete. Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REFRESH_TOKEN.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || typeof data?.access_token !== "string") {
    throw new Error(data?.error_description ?? "Could not refresh YouTube access token.");
  }

  return data.access_token;
}

async function uploadYouTubeShort(post: AutomationPost, videoPath: string, videoSize: number): Promise<UploadResult> {
  const requestedPrivacy = process.env.YOUTUBE_DEFAULT_PRIVACY_STATUS?.trim() || "private";
  const apiVerified = process.env.YOUTUBE_API_VERIFIED === "true";
  const privacyStatus = apiVerified ? requestedPrivacy : "private";
  const token = await getYouTubeAccessToken();
  const text = buildYouTubeText(post);

  const metadata = {
    snippet: {
      title: text.title,
      description: text.description,
      tags: text.tags,
      categoryId: "22",
    },
    status: {
      privacyStatus,
      selfDeclaredMadeForKids: false,
    },
  };

  const createSessionResponse = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(videoSize),
      "x-upload-content-type": "video/mp4",
    },
    body: JSON.stringify(metadata),
  });
  const uploadUrl = createSessionResponse.headers.get("location");

  if (!createSessionResponse.ok || !uploadUrl) {
    const data = await createSessionResponse.json().catch(() => null);
    throw new Error(data?.error?.message ?? "Could not start YouTube resumable upload.");
  }

  const uploadRequest = {
    method: "PUT",
    headers: {
      "content-length": String(videoSize),
      "content-type": "video/mp4",
    },
    body: createReadStream(videoPath),
    duplex: "half",
  } as unknown as RequestInit & { duplex: "half" };
  const uploadResponse = await fetch(uploadUrl, uploadRequest);
  const data = await uploadResponse.json().catch(() => null);

  if (!uploadResponse.ok || typeof data?.id !== "string") {
    throw new Error(data?.error?.message ?? "YouTube upload failed.");
  }

  const publishedUrl = `https://www.youtube.com/watch?v=${data.id}`;
  const privateOnly = !apiVerified && requestedPrivacy !== "private";

  return {
    status: privateOnly ? "PRIVATE_ONLY_UNVERIFIED" : "POSTED",
    externalPostId: data.id,
    publishedUrl,
    finalPrivacyStatus: privacyStatus,
    publishError: privateOnly
      ? "Uploaded privately because YOUTUBE_API_VERIFIED is not true. Complete Google API verification before public API publishing."
      : undefined,
  };
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
      status: "POSTED",
      externalPostId: `dry-run-${post.id}`,
      publishedUrl: undefined,
      finalPrivacyStatus: "dry-run",
    };
  }

  if (post.platform !== "YouTube Shorts") {
    throw new Error(`${post.platform} automatic posting is not implemented yet.`);
  }

  return uploadYouTubeShort(post, video.path, video.size);
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
