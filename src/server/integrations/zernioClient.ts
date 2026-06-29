export type ZernioPlatform = "instagram" | "tiktok";

export type ZernioAccount = {
  _id: string;
  platform: string;
  username?: string | null;
  displayName?: string | null;
  profileUrl?: string | null;
  isActive?: boolean | null;
  profileId?: {
    _id?: string;
    name?: string;
    slug?: string;
  } | null;
};

export type ZernioMediaItem = {
  type: "video";
  url: string;
  title?: string;
  filename?: string;
  size?: number;
  mimeType?: string;
};

export type ZernioPostPlatform = {
  platform: ZernioPlatform;
  accountId: string;
  customContent?: string;
  platformSpecificData?: Record<string, unknown>;
};

export type ZernioCreatePostInput = {
  requestId?: string;
  title: string;
  content: string;
  mediaItems: ZernioMediaItem[];
  platforms: ZernioPostPlatform[];
  publishNow?: boolean;
  scheduledFor?: string | null;
  timezone?: string | null;
  metadata?: Record<string, unknown>;
  hashtags?: string[];
};

export type ZernioPostPlatformStatus = {
  platform?: string;
  status?: string;
  platformPostId?: string;
  platformPostUrl?: string;
  accountId?: unknown;
};

export type ZernioPost = {
  _id: string;
  status?: string;
  platforms?: ZernioPostPlatformStatus[];
};

export type ZernioCreatePostResult = {
  post?: ZernioPost;
  existingPost?: ZernioPost;
  message?: string;
};

export class ZernioApiError extends Error {
  status: number;
  details: unknown;
  existingPostId: string | null;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ZernioApiError";
    this.status = status;
    this.details = details;
    this.existingPostId = typeof details === "object" && details !== null && "existingPostId" in details
      ? typeof (details as { existingPostId?: unknown }).existingPostId === "string"
        ? (details as { existingPostId: string }).existingPostId
        : null
      : null;
  }
}

type FetchLike = typeof fetch;

function getZernioApiKey(): string {
  const apiKey = process.env.ZERNIO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ZERNIO_API_KEY is required for Zernio publishing.");
  }

  return apiKey;
}

function getZernioBaseUrl(): string {
  return (process.env.ZERNIO_API_BASE_URL?.trim() || "https://zernio.com/api").replace(/\/$/, "");
}

async function zernioFetch<T>(
  path: string,
  init: RequestInit = {},
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${getZernioApiKey()}`);
  headers.set("content-type", headers.get("content-type") ?? "application/json");

  const response = await fetchImpl(`${getZernioBaseUrl()}${path}`, {
    ...init,
    headers,
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = typeof payload?.error === "string"
      ? payload.error
      : typeof payload?.message === "string"
        ? payload.message
        : `Zernio request failed with ${response.status}.`;
    throw new ZernioApiError(message, response.status, payload?.details ?? payload);
  }

  return payload as T;
}

export async function listZernioAccounts(input: {
  platform?: ZernioPlatform;
  status?: "connected" | "disconnected";
  fetchImpl?: FetchLike;
} = {}): Promise<ZernioAccount[]> {
  const params = new URLSearchParams();
  if (input.platform) {
    params.set("platform", input.platform);
  }
  if (input.status) {
    params.set("status", input.status);
  }

  const query = params.toString();
  const data = await zernioFetch<{ accounts?: ZernioAccount[] }>(
    `/v1/accounts${query ? `?${query}` : ""}`,
    {},
    input.fetchImpl,
  );

  return Array.isArray(data.accounts) ? data.accounts : [];
}

export async function createZernioPost(
  input: ZernioCreatePostInput,
  fetchImpl: FetchLike = fetch,
): Promise<ZernioCreatePostResult> {
  const headers = new Headers();
  if (input.requestId) {
    headers.set("x-request-id", input.requestId);
  }

  return zernioFetch<ZernioCreatePostResult>("/v1/posts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: input.title,
      content: input.content,
      mediaItems: input.mediaItems,
      platforms: input.platforms,
      publishNow: input.publishNow ?? true,
      scheduledFor: input.scheduledFor ?? undefined,
      timezone: input.timezone ?? undefined,
      metadata: input.metadata,
      hashtags: input.hashtags,
    }),
  }, fetchImpl);
}

export async function getZernioPost(
  postId: string,
  fetchImpl: FetchLike = fetch,
): Promise<ZernioPost | null> {
  const data = await zernioFetch<{ post?: ZernioPost }>(`/v1/posts/${encodeURIComponent(postId)}`, {}, fetchImpl);
  return data.post ?? null;
}

export function getPublishedPlatformUrl(post: ZernioPost | null | undefined, platform: ZernioPlatform): string | null {
  const platformPost = post?.platforms?.find((item) => item.platform === platform && item.platformPostUrl);
  return platformPost?.platformPostUrl ?? null;
}

export function getPlatformStatus(post: ZernioPost | null | undefined, platform: ZernioPlatform): string | null {
  const platformPost = post?.platforms?.find((item) => item.platform === platform);
  return platformPost?.status ?? post?.status ?? null;
}
