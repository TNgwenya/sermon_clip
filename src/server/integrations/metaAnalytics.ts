import { upsertSocialCredential } from "@/server/integrations/socialCredentials";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || "v23.0";

type MetaTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

type MetaPage = {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: {
    id: string;
    username?: string;
    name?: string;
  };
};

type MetaErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

export type MetaDailyMetric = {
  platform: "Facebook" | "Instagram";
  externalAccountId: string;
  accountName: string | null;
  capturedAt: Date;
  followers?: number;
  views?: number;
  reach?: number;
  impressions?: number;
  engagementRate?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clickThroughs?: number;
  raw: Record<string, unknown>;
};

function graphUrl(path: string, params: Record<string, string | undefined>): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) searchParams.set(key, value);
  });

  return `https://graph.facebook.com/${GRAPH_VERSION}/${path.replace(/^\//, "")}?${searchParams.toString()}`;
}

function metaApiError(payload: MetaErrorPayload, fallback: string, response: Response): string {
  const error = payload.error;
  const metadata = [
    `HTTP ${response.status}`,
    error?.type,
    typeof error?.code === "number" ? `code ${error.code}` : null,
    typeof error?.error_subcode === "number" ? `subcode ${error.error_subcode}` : null,
  ].filter(Boolean).join(", ");
  const message = error?.message || fallback;
  return metadata ? `${message} (${metadata})` : message;
}

function expiresAtFromSeconds(expiresIn: number | undefined, now = new Date()): Date | null {
  if (!expiresIn || !Number.isFinite(expiresIn)) {
    return null;
  }

  return new Date(now.getTime() + Math.max(0, expiresIn - 60) * 1000);
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function latestInsightValue(insights: Array<{ values?: Array<{ value?: unknown; end_time?: string }> }>, metricName: string): {
  value?: number;
  capturedAt?: Date;
} {
  const metric = insights.find((item) => (item as { name?: string }).name === metricName);
  const latest = metric?.values?.at(-1);
  const value = numberValue(latest?.value);
  const capturedAt = latest?.end_time ? new Date(latest.end_time) : undefined;

  return {
    value,
    capturedAt: capturedAt && !Number.isNaN(capturedAt.getTime()) ? capturedAt : undefined,
  };
}

export async function exchangeMetaAuthorizationCode(input: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{ accessToken: string; tokenType: string | null; expiresAt: Date | null }> {
  const response = await fetch(graphUrl("oauth/access_token", {
    client_id: input.appId,
    client_secret: input.appSecret,
    redirect_uri: input.redirectUri,
    code: input.code,
  }));
  const payload = await response.json() as MetaTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(metaApiError(payload, "Unable to exchange Meta authorization code.", response));
  }

  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type ?? null,
    expiresAt: expiresAtFromSeconds(payload.expires_in),
  };
}

export async function exchangeMetaLongLivedToken(input: {
  appId: string;
  appSecret: string;
  accessToken: string;
}): Promise<{ accessToken: string; tokenType: string | null; expiresAt: Date | null }> {
  const response = await fetch(graphUrl("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: input.appId,
    client_secret: input.appSecret,
    fb_exchange_token: input.accessToken,
  }));
  const payload = await response.json() as MetaTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(metaApiError(payload, "Unable to exchange Meta long-lived token.", response));
  }

  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type ?? null,
    expiresAt: expiresAtFromSeconds(payload.expires_in),
  };
}

export async function storeMetaPageCredentials(input: {
  accessToken: string;
  tokenType: string | null;
  expiresAt: Date | null;
  scopes: string[];
}): Promise<number> {
  const response = await fetch(graphUrl("me/accounts", {
    access_token: input.accessToken,
    fields: "id,name,access_token,instagram_business_account{id,username,name}",
    limit: "50",
  }));
  const payload = await response.json() as { data?: MetaPage[] } & MetaErrorPayload;

  if (!response.ok) {
    throw new Error(metaApiError(payload, "Unable to read connected Facebook pages.", response));
  }

  let stored = 0;
  for (const page of payload.data ?? []) {
    const pageAccessToken = page.access_token || input.accessToken;
    await upsertSocialCredential({
      provider: "META_FACEBOOK",
      externalAccountId: page.id,
      accountName: page.name ?? "Facebook Page",
      accessToken: pageAccessToken,
      tokenType: input.tokenType,
      scopes: input.scopes,
      metadata: { source: "meta_oauth" },
      expiresAt: input.expiresAt,
      socialAccount: {
        platform: "FACEBOOK",
        label: page.name ?? "Facebook Page",
      },
    });
    stored += 1;

    if (page.instagram_business_account?.id) {
      await upsertSocialCredential({
        provider: "META_INSTAGRAM",
        externalAccountId: page.instagram_business_account.id,
        accountName: page.instagram_business_account.name ?? page.instagram_business_account.username ?? "Instagram account",
        handle: page.instagram_business_account.username ? `@${page.instagram_business_account.username}` : null,
        accessToken: pageAccessToken,
        tokenType: input.tokenType,
        scopes: input.scopes,
        metadata: { facebookPageId: page.id, source: "meta_oauth" },
        expiresAt: input.expiresAt,
        socialAccount: {
          platform: "INSTAGRAM",
          label: page.instagram_business_account.name ?? page.instagram_business_account.username ?? "Instagram account",
          handle: page.instagram_business_account.username ? `@${page.instagram_business_account.username}` : null,
        },
      });
      stored += 1;
    }
  }

  return stored;
}

export async function fetchFacebookPageDailyMetrics(input: {
  pageId: string;
  pageName: string | null;
  accessToken: string;
  since: string;
  until: string;
}): Promise<MetaDailyMetric[]> {
  const response = await fetch(graphUrl(`${input.pageId}/insights`, {
    access_token: input.accessToken,
    metric: "page_impressions,page_post_engagements,page_fans,page_fan_adds_unique",
    period: "day",
    since: input.since,
    until: input.until,
  }));
  const payload = await response.json() as { data?: Array<{ name?: string; values?: Array<{ value?: unknown; end_time?: string }> }>; error?: { message?: string } };

  if (!response.ok) {
    throw new Error(payload.error?.message || "Unable to fetch Facebook Page insights.");
  }

  const data = payload.data ?? [];
  const impressions = latestInsightValue(data, "page_impressions");
  const engagement = latestInsightValue(data, "page_post_engagements");
  const followers = latestInsightValue(data, "page_fans");
  const followerGrowth = latestInsightValue(data, "page_fan_adds_unique");
  const engagementRate = impressions.value && engagement.value
    ? Number(((engagement.value / impressions.value) * 100).toFixed(2))
    : undefined;

  return [{
    platform: "Facebook",
    externalAccountId: input.pageId,
    accountName: input.pageName,
    capturedAt: impressions.capturedAt ?? engagement.capturedAt ?? new Date(),
    followers: followers.value,
    impressions: impressions.value,
    reach: impressions.value,
    engagementRate,
    raw: {
      facebookPageId: input.pageId,
      followerGrowth: followerGrowth.value,
      insights: data,
    },
  }];
}

export async function fetchInstagramAccountMetrics(input: {
  instagramAccountId: string;
  accountName: string | null;
  accessToken: string;
  since: string;
  until: string;
}): Promise<MetaDailyMetric[]> {
  const response = await fetch(graphUrl(`${input.instagramAccountId}/media`, {
    access_token: input.accessToken,
    fields: "id,permalink,timestamp,like_count,comments_count,media_type,caption,insights.metric(impressions,reach,saved,shares,plays,total_interactions)",
    limit: "25",
  }));
  const payload = await response.json() as {
    data?: Array<{
      id: string;
      permalink?: string;
      timestamp?: string;
      like_count?: number;
      comments_count?: number;
      insights?: { data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }> };
    }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || "Unable to fetch Instagram media insights.");
  }

  const sinceTime = new Date(`${input.since}T00:00:00.000Z`).getTime();
  const untilTime = new Date(`${input.until}T23:59:59.999Z`).getTime();

  return (payload.data ?? [])
    .filter((media) => {
      const timestamp = media.timestamp ? new Date(media.timestamp).getTime() : 0;
      return timestamp >= sinceTime && timestamp <= untilTime;
    })
    .map((media) => {
      const insights = media.insights?.data ?? [];
      const impressions = latestInsightValue(insights, "impressions").value;
      const reach = latestInsightValue(insights, "reach").value;
      const saves = latestInsightValue(insights, "saved").value;
      const shares = latestInsightValue(insights, "shares").value;
      const views = latestInsightValue(insights, "plays").value;
      const totalInteractions = latestInsightValue(insights, "total_interactions").value
        ?? ((media.like_count ?? 0) + (media.comments_count ?? 0) + (saves ?? 0) + (shares ?? 0));
      const engagementRate = reach && totalInteractions
        ? Number(((totalInteractions / reach) * 100).toFixed(2))
        : undefined;

      return {
        platform: "Instagram",
        externalAccountId: input.instagramAccountId,
        accountName: input.accountName,
        capturedAt: media.timestamp ? new Date(media.timestamp) : new Date(),
        views,
        reach,
        impressions,
        engagementRate,
        likes: media.like_count,
        comments: media.comments_count,
        shares,
        saves,
        raw: {
          instagramAccountId: input.instagramAccountId,
          mediaId: media.id,
          permalink: media.permalink,
          insights,
        },
      };
    });
}
