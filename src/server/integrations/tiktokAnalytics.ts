import { upsertSocialCredential } from "@/server/integrations/socialCredentials";

type TikTokTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  token_type?: string;
  scope?: string;
  open_id?: string;
  error?: string;
  error_description?: string;
  message?: string;
};

type TikTokUserResponse = {
  data?: {
    user?: {
      open_id?: string;
      union_id?: string;
      display_name?: string;
      username?: string;
      avatar_url?: string;
      profile_deep_link?: string;
    };
  };
  error?: {
    message?: string;
  };
};

export type TikTokVideoMetric = {
  platformPostId: string;
  postUrl?: string;
  capturedAt: Date;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  engagementRate?: number;
  raw: Record<string, unknown>;
};

function expiresAtFromSeconds(expiresIn: number | undefined, now = new Date()): Date | null {
  if (!expiresIn || !Number.isFinite(expiresIn)) {
    return null;
  }

  return new Date(now.getTime() + Math.max(0, expiresIn - 60) * 1000);
}

function tiktokError(payload: TikTokTokenResponse | TikTokUserResponse, fallback: string): string {
  if ("error_description" in payload && payload.error_description) return payload.error_description;
  if ("message" in payload && payload.message) return payload.message;
  if ("error" in payload && typeof payload.error === "string" && payload.error) return payload.error;
  if ("error" in payload && typeof payload.error === "object" && payload.error?.message) return payload.error.message;
  return fallback;
}

export async function exchangeTikTokAuthorizationCode(input: {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  externalAccountId: string;
  expiresAt: Date | null;
  tokenType: string | null;
  scope: string | null;
}> {
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: input.clientKey,
      client_secret: input.clientSecret,
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    }),
  });
  const payload = await response.json() as TikTokTokenResponse;

  if (!response.ok || !payload.access_token || !payload.open_id) {
    throw new Error(tiktokError(payload, "Unable to exchange TikTok authorization code."));
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    externalAccountId: payload.open_id,
    expiresAt: expiresAtFromSeconds(payload.expires_in),
    tokenType: payload.token_type ?? null,
    scope: payload.scope ?? null,
  };
}

export async function refreshTikTokAccessToken(input: {
  clientKey: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  tokenType: string | null;
  scope: string | null;
}> {
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: input.clientKey,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json() as TikTokTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(tiktokError(payload, "Unable to refresh TikTok access token."));
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: expiresAtFromSeconds(payload.expires_in),
    tokenType: payload.token_type ?? null,
    scope: payload.scope ?? null,
  };
}

export async function storeTikTokCredential(input: {
  accessToken: string;
  refreshToken: string | null;
  externalAccountId: string;
  expiresAt: Date | null;
  tokenType: string | null;
  scope: string | null;
}): Promise<void> {
  const response = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username,profile_deep_link", {
    headers: { authorization: `Bearer ${input.accessToken}` },
  });
  const payload = await response.json() as TikTokUserResponse;

  if (!response.ok) {
    throw new Error(tiktokError(payload, "Unable to fetch TikTok user identity."));
  }

  const user = payload.data?.user;
  await upsertSocialCredential({
    provider: "TIKTOK",
    externalAccountId: user?.open_id ?? input.externalAccountId,
    accountName: user?.display_name ?? user?.username ?? "TikTok account",
    handle: user?.username ? `@${user.username}` : null,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    tokenType: input.tokenType,
    scopes: input.scope?.split(",") ?? [],
    metadata: {
      unionId: user?.union_id,
      profileDeepLink: user?.profile_deep_link,
      avatarUrl: user?.avatar_url,
    },
    expiresAt: input.expiresAt,
    socialAccount: {
      platform: "TIKTOK",
      label: user?.display_name ?? user?.username ?? "TikTok account",
      handle: user?.username ? `@${user.username}` : null,
    },
  });
}

export async function fetchTikTokVideoMetrics(input: {
  accessToken: string;
  maxCount?: number;
}): Promise<TikTokVideoMetric[]> {
  const response = await fetch("https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,duration,cover_image_url,share_url,view_count,like_count,comment_count,share_count,create_time", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ max_count: input.maxCount ?? 20 }),
  });
  const payload = await response.json() as {
    data?: {
      videos?: Array<{
        id: string;
        title?: string;
        video_description?: string;
        share_url?: string;
        view_count?: number;
        like_count?: number;
        comment_count?: number;
        share_count?: number;
        create_time?: number;
      }>;
    };
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || "Unable to fetch TikTok video analytics.");
  }

  return (payload.data?.videos ?? []).map((video) => {
    const interactions = (video.like_count ?? 0) + (video.comment_count ?? 0) + (video.share_count ?? 0);
    const engagementRate = video.view_count && interactions
      ? Number(((interactions / video.view_count) * 100).toFixed(2))
      : undefined;

    return {
      platformPostId: video.id,
      postUrl: video.share_url,
      capturedAt: video.create_time ? new Date(video.create_time * 1000) : new Date(),
      views: video.view_count,
      likes: video.like_count,
      comments: video.comment_count,
      shares: video.share_count,
      engagementRate,
      raw: video,
    };
  });
}
