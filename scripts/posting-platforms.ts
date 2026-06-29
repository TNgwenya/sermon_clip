import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";

import { PrismaClient, type SocialConnectorProvider } from "@prisma/client";
import {
  createZernioPost,
  getPlatformStatus,
  getPublishedPlatformUrl,
  getZernioPost,
  ZernioApiError,
  type ZernioCreatePostInput,
  type ZernioPlatform,
  type ZernioPost,
} from "../src/server/integrations/zernioClient.ts";

export type PostingPlatform = "TikTok" | "Instagram" | "YouTube Shorts" | "Facebook";

export type AutomationPost = {
  id: string;
  socialAccountId: string | null;
  socialAccountExternalProvider?: string | null;
  socialAccountExternalAccountId?: string | null;
  socialAccountExternalPlatform?: string | null;
  platform: PostingPlatform;
  title: string;
  caption: string;
  scheduledFor: string | null;
  timezone?: string | null;
  mediaObjectKey?: string | null;
  mediaPublicUrl?: string | null;
  mediaUploadedAt?: string | null;
  idempotencyKey: string;
  clips: Array<{
    id: string;
    title: string;
    caption: string;
    durationSeconds?: number;
    hashtags: unknown;
    localFileCandidates: string[];
    sermon: {
      title: string;
      churchName: string;
    };
  }>;
};

export type CompletionStatus = "POSTED" | "FAILED" | "PRIVATE_ONLY_UNVERIFIED" | "SKIPPED";

export type UploadResult = {
  status: CompletionStatus;
  externalPostId?: string;
  publishedUrl?: string;
  publishError?: string;
  finalPrivacyStatus?: string;
  mediaObjectKey?: string;
  mediaPublicUrl?: string;
  mediaUploadedAt?: string;
};

type FetchLike = typeof fetch;

const TIKTOK_MAX_TITLE_LENGTH = 2200;
const INSTAGRAM_MAX_REEL_SECONDS = 60;
const TIKTOK_DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024;
const FACEBOOK_MAX_TITLE_LENGTH = 255;
const STORED_CREDENTIAL_PROVIDERS: Record<Exclude<PostingPlatform, "Instagram">, SocialConnectorProvider> = {
  "YouTube Shorts": "YOUTUBE",
  TikTok: "TIKTOK",
  Facebook: "META_FACEBOOK",
};

let prismaClient: PrismaClient | null = null;

function getPrismaClient(): PrismaClient {
  prismaClient ??= new PrismaClient();
  return prismaClient;
}

function encryptionSecret(): string {
  const secret = process.env.OAUTH_TOKEN_ENCRYPTION_KEY?.trim()
    || process.env.AUTH_SECRET?.trim()
    || process.env.NEXTAUTH_SECRET?.trim();

  if (!secret) {
    throw new Error("Stored social credentials require OAUTH_TOKEN_ENCRYPTION_KEY or AUTH_SECRET in the worker environment.");
  }

  return secret;
}

function encryptionKey(): Buffer {
  return crypto.createHash("sha256").update(encryptionSecret()).digest();
}

function decryptToken(value: string): string {
  const [version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Unsupported encrypted social credential format.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function encryptToken(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

function isExpiringSoon(expiresAt: Date | null, now = new Date()): boolean {
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime() + 60_000);
}

type StoredPostingCredential = {
  id: string;
  provider: SocialConnectorProvider;
  externalAccountId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
};

async function getStoredPostingCredential(
  provider: SocialConnectorProvider,
  socialAccountId: string | null,
): Promise<StoredPostingCredential | null> {
  const credential = await getPrismaClient().socialCredential.findFirst({
    where: {
      provider,
      status: "CONNECTED",
      ...(socialAccountId ? { socialAccountId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      provider: true,
      externalAccountId: true,
      accessTokenCiphertext: true,
      refreshTokenCiphertext: true,
      expiresAt: true,
    },
  }).catch(() => null);

  if (!credential) {
    return null;
  }

  return {
    id: credential.id,
    provider: credential.provider,
    externalAccountId: credential.externalAccountId,
    accessToken: decryptToken(credential.accessTokenCiphertext),
    refreshToken: credential.refreshTokenCiphertext ? decryptToken(credential.refreshTokenCiphertext) : null,
    expiresAt: credential.expiresAt,
  };
}

function clampText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength).trimEnd() : value;
}

export function extractHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().startsWith("#") ? item.trim() : `#${item.trim()}`);
}

export function buildYouTubeText(post: AutomationPost): { title: string; description: string; tags: string[] } {
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

export function buildTikTokTitle(post: AutomationPost): string {
  const firstClip = post.clips[0];
  const hashtags = Array.from(new Set(post.clips.flatMap((clip) => extractHashtags(clip.hashtags))));
  const title = post.caption || firstClip?.caption || post.title || firstClip?.title || "Sermon clip";
  const tagText = hashtags.length > 0 ? `\n\n${hashtags.join(" ")}` : "";

  return clampText(`${title}${tagText}`, TIKTOK_MAX_TITLE_LENGTH);
}

function platformToZernioPlatform(platform: PostingPlatform): ZernioPlatform | null {
  switch (platform) {
    case "TikTok":
      return "tiktok";
    case "Instagram":
      return "instagram";
    default:
      return null;
  }
}

export function buildDeterministicRequestId(value: string): string {
  const hash = crypto.createHash("sha256").update(value).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    ((Number.parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join("-");
}

function getZernioAccountId(post: AutomationPost, zernioPlatform: ZernioPlatform): string {
  if (
    post.socialAccountExternalProvider === "zernio"
    && post.socialAccountExternalPlatform === zernioPlatform
    && post.socialAccountExternalAccountId
  ) {
    return post.socialAccountExternalAccountId;
  }

  throw new Error(`Connect and sync a Zernio ${post.platform} account before automatic posting.`);
}

function getPreparedMediaUrl(post: AutomationPost): string {
  if (post.mediaPublicUrl?.trim()) {
    return post.mediaPublicUrl.trim();
  }

  throw new Error("A public R2 media URL is required before publishing through Zernio.");
}

function assertInstagramDuration(post: AutomationPost): void {
  const firstClip = post.clips[0];
  const durationSeconds = firstClip?.durationSeconds;
  if (typeof durationSeconds === "number" && durationSeconds > INSTAGRAM_MAX_REEL_SECONDS) {
    throw new Error("Instagram automatic posting is limited to clips of 60 seconds or less until longer Reels are verified.");
  }
}

export function buildZernioPostRequest(
  post: AutomationPost,
  videoSize: number,
): ZernioCreatePostInput {
  const zernioPlatform = platformToZernioPlatform(post.platform);
  if (!zernioPlatform) {
    throw new Error(`${post.platform} is not supported by the Zernio publisher.`);
  }
  if (zernioPlatform === "instagram") {
    assertInstagramDuration(post);
  }

  const firstClip = post.clips[0];
  const title = clampText(post.title || firstClip?.title || "Sermon clip", zernioPlatform === "tiktok" ? TIKTOK_MAX_TITLE_LENGTH : 2200);
  const content = zernioPlatform === "tiktok"
    ? buildTikTokTitle(post)
    : clampText(post.caption || firstClip?.caption || title, 2200);
  const platformSpecificData: Record<string, unknown> = {};
  const privacyLevel = process.env.ZERNIO_TIKTOK_PRIVACY_LEVEL?.trim();
  if (zernioPlatform === "tiktok" && privacyLevel) {
    platformSpecificData.privacyLevel = privacyLevel;
  }
  if (zernioPlatform === "instagram") {
    platformSpecificData.shareToFeed = true;
  }

  return {
    requestId: buildDeterministicRequestId(post.idempotencyKey),
    title,
    content,
    mediaItems: [{
      type: "video",
      url: getPreparedMediaUrl(post),
      title,
      filename: `${post.id}.mp4`,
      size: videoSize,
      mimeType: "video/mp4",
    }],
    platforms: [{
      platform: zernioPlatform,
      accountId: getZernioAccountId(post, zernioPlatform),
      platformSpecificData: Object.keys(platformSpecificData).length > 0 ? platformSpecificData : undefined,
    }],
    publishNow: true,
    timezone: post.timezone || undefined,
    hashtags: Array.from(new Set(post.clips.flatMap((clip) => extractHashtags(clip.hashtags)))),
    metadata: {
      sermonClipScheduledPostId: post.id,
      sermonClipClipIds: post.clips.map((clip) => clip.id),
      sermonClipIdempotencyKey: post.idempotencyKey,
    },
  };
}

function zernioPostId(resultPost: ZernioPost | null | undefined): string | undefined {
  return resultPost?._id;
}

export async function uploadZernioVideo(
  post: AutomationPost,
  _videoPath: string,
  videoSize: number,
  fetchImpl: FetchLike = fetch,
): Promise<UploadResult> {
  const zernioPlatform = platformToZernioPlatform(post.platform);
  if (!zernioPlatform) {
    throw new Error(`${post.platform} is not supported by the Zernio publisher.`);
  }

  const request = buildZernioPostRequest(post, videoSize);
  let resultPost: ZernioPost | null | undefined;

  try {
    const result = await createZernioPost(request, fetchImpl);
    resultPost = result.post ?? result.existingPost ?? null;
  } catch (error) {
    if (!(error instanceof ZernioApiError) || error.status !== 409 || !error.existingPostId) {
      throw error;
    }

    const existingPost = await getZernioPost(error.existingPostId, fetchImpl);
    const publishedUrl = getPublishedPlatformUrl(existingPost, zernioPlatform);
    if (!publishedUrl) {
      throw error;
    }

    resultPost = existingPost;
  }

  if (!resultPost) {
    throw new Error("Zernio did not return a post.");
  }

  return {
    status: "POSTED",
    externalPostId: zernioPostId(resultPost),
    publishedUrl: getPublishedPlatformUrl(resultPost, zernioPlatform) ?? undefined,
    finalPrivacyStatus: getPlatformStatus(resultPost, zernioPlatform) ?? resultPost.status,
  };
}

export function buildFacebookText(post: AutomationPost): { title: string; description: string; published: boolean } {
  const firstClip = post.clips[0];
  const hashtags = Array.from(new Set(post.clips.flatMap((clip) => extractHashtags(clip.hashtags))));
  const title = clampText(post.title || firstClip?.title || "Sermon clip", FACEBOOK_MAX_TITLE_LENGTH);
  const caption = post.caption || firstClip?.caption || "";
  const description = [
    caption || title,
    hashtags.length > 0 ? hashtags.join(" ") : "",
    firstClip?.sermon.churchName ? `From ${firstClip.sermon.churchName}` : "",
  ].filter(Boolean).join("\n\n");

  return {
    title,
    description,
    published: process.env.FACEBOOK_DEFAULT_PUBLISHED === "true",
  };
}

async function getYouTubeAccessToken(post: AutomationPost, fetchImpl: FetchLike = fetch): Promise<string> {
  const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
  const envRefreshToken = process.env.YOUTUBE_REFRESH_TOKEN?.trim();
  const storedCredential = post.socialAccountId || !envRefreshToken
    ? await getStoredPostingCredential(STORED_CREDENTIAL_PROVIDERS["YouTube Shorts"], post.socialAccountId)
    : null;
  const refreshToken = storedCredential?.refreshToken || envRefreshToken;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("YouTube credentials are incomplete. Connect YouTube in Social settings or set YOUTUBE_REFRESH_TOKEN, plus YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET.");
  }

  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
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

export async function uploadYouTubeShort(
  post: AutomationPost,
  videoPath: string,
  videoSize: number,
  fetchImpl: FetchLike = fetch,
): Promise<UploadResult> {
  const requestedPrivacy = process.env.YOUTUBE_DEFAULT_PRIVACY_STATUS?.trim() || "private";
  const apiVerified = process.env.YOUTUBE_API_VERIFIED === "true";
  const privacyStatus = apiVerified ? requestedPrivacy : "private";
  const token = await getYouTubeAccessToken(post, fetchImpl);
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

  const createSessionResponse = await fetchImpl("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
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
  const uploadResponse = await fetchImpl(uploadUrl, uploadRequest);
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

export function buildTikTokInitBody(post: AutomationPost, videoSize: number): {
  post_info: {
    title: string;
    privacy_level: string;
    disable_duet: boolean;
    disable_comment: boolean;
    disable_stitch: boolean;
  };
  source_info: {
    source: "FILE_UPLOAD";
    video_size: number;
    chunk_size: number;
    total_chunk_count: number;
  };
} {
  const chunkSize = Math.min(videoSize, Number(process.env.TIKTOK_UPLOAD_CHUNK_BYTES ?? TIKTOK_DEFAULT_CHUNK_SIZE));
  const normalizedChunkSize = Math.max(1, chunkSize);

  return {
    post_info: {
      title: buildTikTokTitle(post),
      privacy_level: process.env.TIKTOK_DEFAULT_PRIVACY_LEVEL?.trim() || "SELF_ONLY",
      disable_duet: process.env.TIKTOK_DISABLE_DUET !== "false",
      disable_comment: process.env.TIKTOK_DISABLE_COMMENT !== "false",
      disable_stitch: process.env.TIKTOK_DISABLE_STITCH !== "false",
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: videoSize,
      chunk_size: normalizedChunkSize,
      total_chunk_count: Math.ceil(videoSize / normalizedChunkSize),
    },
  };
}

async function uploadTikTokChunks(
  uploadUrl: string,
  videoPath: string,
  videoSize: number,
  chunkSize: number,
  fetchImpl: FetchLike,
): Promise<void> {
  let start = 0;

  while (start < videoSize) {
    const end = Math.min(start + chunkSize, videoSize) - 1;
    const contentLength = end - start + 1;
    const uploadRequest = {
      method: "PUT",
      headers: {
        "content-type": "video/mp4",
        "content-length": String(contentLength),
        "content-range": `bytes ${start}-${end}/${videoSize}`,
      },
      body: createReadStream(videoPath, { start, end }),
      duplex: "half",
    } as unknown as RequestInit & { duplex: "half" };
    const response = await fetchImpl(uploadUrl, uploadRequest);

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error?.message ?? data?.error?.log_id ?? `TikTok upload failed with ${response.status}`);
    }

    start = end + 1;
  }
}

async function refreshTikTokCredential(
  credential: StoredPostingCredential,
  fetchImpl: FetchLike,
): Promise<string> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();

  if (!clientKey || !clientSecret || !credential.refreshToken) {
    return credential.accessToken;
  }

  const response = await fetchImpl("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      refresh_token: credential.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok || typeof payload?.access_token !== "string") {
    throw new Error(payload?.error_description ?? payload?.message ?? "Could not refresh TikTok access token.");
  }

  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : credential.refreshToken;
  const expiresAt = typeof payload.expires_in === "number"
    ? new Date(Date.now() + Math.max(0, payload.expires_in - 60) * 1000)
    : credential.expiresAt;

  await getPrismaClient().socialCredential.update({
    where: { id: credential.id },
    data: {
      accessTokenCiphertext: encryptToken(payload.access_token),
      refreshTokenCiphertext: refreshToken ? encryptToken(refreshToken) : null,
      tokenType: typeof payload.token_type === "string" ? payload.token_type : undefined,
      expiresAt,
      status: "CONNECTED",
      lastError: null,
    },
  }).catch(() => undefined);

  return payload.access_token;
}

async function getTikTokAccessToken(
  credential: StoredPostingCredential,
  fetchImpl: FetchLike,
): Promise<string> {
  return isExpiringSoon(credential.expiresAt)
    ? refreshTikTokCredential(credential, fetchImpl)
    : credential.accessToken;
}

export async function uploadTikTokVideo(
  post: AutomationPost,
  videoPath: string,
  videoSize: number,
  fetchImpl: FetchLike = fetch,
): Promise<UploadResult> {
  const envToken = process.env.TIKTOK_ACCESS_TOKEN?.trim();
  const storedCredential = post.socialAccountId || !envToken
    ? await getStoredPostingCredential(STORED_CREDENTIAL_PROVIDERS.TikTok, post.socialAccountId)
    : null;
  const token = storedCredential
    ? await getTikTokAccessToken(storedCredential, fetchImpl)
    : envToken;

  if (!token) {
    throw new Error("TikTok credentials are incomplete. Connect TikTok in Social settings or set TIKTOK_ACCESS_TOKEN with video.publish access.");
  }

  const initBody = buildTikTokInitBody(post, videoSize);
  const initResponse = await fetchImpl("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(initBody),
  });
  const initData = await initResponse.json().catch(() => null);
  const publishId = initData?.data?.publish_id;
  const uploadUrl = initData?.data?.upload_url;

  if (!initResponse.ok || typeof publishId !== "string" || typeof uploadUrl !== "string") {
    throw new Error(initData?.error?.message ?? "Could not start TikTok direct post upload.");
  }

  await uploadTikTokChunks(uploadUrl, videoPath, videoSize, initBody.source_info.chunk_size, fetchImpl);

  return {
    status: "POSTED",
    externalPostId: publishId,
    finalPrivacyStatus: initBody.post_info.privacy_level,
  };
}

export async function uploadFacebookVideo(
  post: AutomationPost,
  videoPath: string,
  _videoSize: number,
  fetchImpl: FetchLike = fetch,
): Promise<UploadResult> {
  const envPageId = process.env.FACEBOOK_PAGE_ID?.trim();
  const envPageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim();
  const storedCredential = post.socialAccountId || !envPageId || !envPageAccessToken
    ? await getStoredPostingCredential(STORED_CREDENTIAL_PROVIDERS.Facebook, post.socialAccountId)
    : null;
  const pageId = storedCredential?.externalAccountId || envPageId;
  const pageAccessToken = storedCredential?.accessToken || envPageAccessToken;
  const graphVersion = process.env.FACEBOOK_GRAPH_VERSION?.trim() || "v23.0";

  if (!pageId || !pageAccessToken) {
    throw new Error("Facebook credentials are incomplete. Connect Facebook in Social settings or set FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN.");
  }

  const text = buildFacebookText(post);
  const videoBuffer = await readFile(videoPath);
  const formData = new FormData();
  formData.set("access_token", pageAccessToken);
  formData.set("title", text.title);
  formData.set("description", text.description);
  formData.set("published", text.published ? "true" : "false");
  formData.set("source", new Blob([videoBuffer], { type: "video/mp4" }), `${post.id}.mp4`);

  const response = await fetchImpl(`https://graph.facebook.com/${graphVersion}/${pageId}/videos`, {
    method: "POST",
    body: formData,
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || typeof data?.id !== "string") {
    throw new Error(data?.error?.message ?? "Facebook video upload failed.");
  }

  return {
    status: "POSTED",
    externalPostId: data.id,
    publishedUrl: `https://www.facebook.com/${data.id}`,
    finalPrivacyStatus: text.published ? "published" : "unpublished",
    publishError: text.published ? undefined : "Uploaded to the Facebook Page as unpublished. Set FACEBOOK_DEFAULT_PUBLISHED=true to publish automatically.",
  };
}

export async function uploadPlatformPost(
  post: AutomationPost,
  videoPath: string,
  videoSize: number,
  fetchImpl: FetchLike = fetch,
): Promise<UploadResult> {
  switch (post.platform) {
    case "YouTube Shorts":
      return uploadYouTubeShort(post, videoPath, videoSize, fetchImpl);
    case "TikTok":
      return uploadZernioVideo(post, videoPath, videoSize, fetchImpl);
    case "Facebook":
      return uploadFacebookVideo(post, videoPath, videoSize, fetchImpl);
    case "Instagram":
      return uploadZernioVideo(post, videoPath, videoSize, fetchImpl);
    default: {
      const exhaustivePlatform: never = post.platform;
      throw new Error(`Unsupported posting platform: ${exhaustivePlatform}`);
    }
  }
}
