import { upsertSocialCredential } from "@/server/integrations/socialCredentials";

type ThreadsTokenResponse = {
  access_token?: string;
  user_id?: string;
  expires_in?: number;
  token_type?: string;
  error_message?: string;
  error?: {
    message?: string;
  };
};

export type ThreadsPostMetric = {
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

function threadsError(payload: ThreadsTokenResponse, fallback: string): string {
  return payload.error_message || payload.error?.message || fallback;
}

export async function exchangeThreadsAuthorizationCode(input: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{
  accessToken: string;
  externalAccountId: string;
  expiresAt: Date | null;
  tokenType: string | null;
}> {
  const response = await fetch("https://graph.threads.net/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.appId,
      client_secret: input.appSecret,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
      code: input.code,
    }),
  });
  const payload = await response.json() as ThreadsTokenResponse;

  if (!response.ok || !payload.access_token || !payload.user_id) {
    throw new Error(threadsError(payload, "Unable to exchange Threads authorization code."));
  }

  return {
    accessToken: payload.access_token,
    externalAccountId: payload.user_id,
    expiresAt: expiresAtFromSeconds(payload.expires_in),
    tokenType: payload.token_type ?? null,
  };
}

export async function exchangeThreadsLongLivedToken(input: {
  appSecret: string;
  accessToken: string;
}): Promise<{ accessToken: string; expiresAt: Date | null; tokenType: string | null }> {
  const params = new URLSearchParams({
    grant_type: "th_exchange_token",
    client_secret: input.appSecret,
    access_token: input.accessToken,
  });
  const response = await fetch(`https://graph.threads.net/access_token?${params.toString()}`);
  const payload = await response.json() as ThreadsTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(threadsError(payload, "Unable to exchange Threads long-lived token."));
  }

  return {
    accessToken: payload.access_token,
    expiresAt: expiresAtFromSeconds(payload.expires_in),
    tokenType: payload.token_type ?? null,
  };
}

export async function storeThreadsCredential(input: {
  accessToken: string;
  externalAccountId: string;
  expiresAt: Date | null;
  tokenType: string | null;
  scopes: string[];
}): Promise<void> {
  const response = await fetch(`https://graph.threads.net/v1.0/me?${new URLSearchParams({
    fields: "id,username,name,threads_profile_picture_url",
    access_token: input.accessToken,
  }).toString()}`);
  const payload = await response.json() as {
    id?: string;
    username?: string;
    name?: string;
    threads_profile_picture_url?: string;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || "Unable to read Threads profile.");
  }

  await upsertSocialCredential({
    provider: "THREADS",
    externalAccountId: payload.id ?? input.externalAccountId,
    accountName: payload.name ?? payload.username ?? "Threads profile",
    handle: payload.username ? `@${payload.username}` : null,
    accessToken: input.accessToken,
    tokenType: input.tokenType,
    scopes: input.scopes,
    metadata: {
      profilePictureUrl: payload.threads_profile_picture_url,
    },
    expiresAt: input.expiresAt,
  });
}

export async function fetchThreadsPostMetrics(input: {
  accessToken: string;
  limit?: number;
}): Promise<ThreadsPostMetric[]> {
  const params = new URLSearchParams({
    fields: "id,permalink,timestamp,text,insights.metric(views,likes,replies,reposts,quotes)",
    limit: String(input.limit ?? 25),
    access_token: input.accessToken,
  });
  const response = await fetch(`https://graph.threads.net/v1.0/me/threads?${params.toString()}`);
  const payload = await response.json() as {
    data?: Array<{
      id: string;
      permalink?: string;
      timestamp?: string;
      insights?: { data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }> };
    }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || "Unable to fetch Threads insights.");
  }

  return (payload.data ?? []).map((post) => {
    const insight = (name: string): number | undefined => {
      const raw = post.insights?.data?.find((item) => item.name === name)?.values?.at(-1)?.value;
      const parsed = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const views = insight("views");
    const likes = insight("likes");
    const replies = insight("replies");
    const reposts = insight("reposts");
    const quotes = insight("quotes");
    const interactions = (likes ?? 0) + (replies ?? 0) + (reposts ?? 0) + (quotes ?? 0);
    const engagementRate = views && interactions
      ? Number(((interactions / views) * 100).toFixed(2))
      : undefined;

    return {
      platformPostId: post.id,
      postUrl: post.permalink,
      capturedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
      views,
      likes,
      comments: replies,
      shares: (reposts ?? 0) + (quotes ?? 0),
      engagementRate,
      raw: {
        ...post,
        replies,
        reposts,
        quotes,
      },
    };
  });
}
