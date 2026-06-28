type YouTubeTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type YouTubeAnalyticsResponse = {
  columnHeaders?: Array<{ name: string }>;
  rows?: Array<Array<string | number>>;
};

export type YouTubeDailyMetric = {
  date: string;
  views: number;
  watchTimeSeconds: number;
  averageViewDurationSeconds: number;
  subscribersGained: number;
  subscribersLost: number;
  likes: number;
  comments: number;
  shares: number;
  raw: Record<string, string | number>;
};

export type YouTubeAnalyticsConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  channelId?: string;
};

export type YouTubeOAuthTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  tokenType: string | null;
  scope: string | null;
};

export type YouTubeChannelIdentity = {
  id: string;
  title: string;
  handle: string | null;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for YouTube analytics sync.`);
  }

  return value;
}

function expiresAtFromSeconds(expiresIn: number | undefined, now = new Date()): Date | null {
  if (!expiresIn || !Number.isFinite(expiresIn)) {
    return null;
  }

  return new Date(now.getTime() + Math.max(0, expiresIn - 60) * 1000);
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function numberValue(value: string | number | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function buildRows(response: YouTubeAnalyticsResponse): YouTubeDailyMetric[] {
  const columns = response.columnHeaders?.map((header) => header.name) ?? [];
  const rows = response.rows ?? [];

  return rows.map((row) => {
    const raw = Object.fromEntries(columns.map((column, index) => [column, row[index] ?? 0]));

    return {
      date: String(raw.day ?? ""),
      views: numberValue(raw.views),
      watchTimeSeconds: Math.round(numberValue(raw.estimatedMinutesWatched) * 60),
      averageViewDurationSeconds: numberValue(raw.averageViewDuration),
      subscribersGained: numberValue(raw.subscribersGained),
      subscribersLost: numberValue(raw.subscribersLost),
      likes: numberValue(raw.likes),
      comments: numberValue(raw.comments),
      shares: numberValue(raw.shares),
      raw,
    };
  });
}

export function getYouTubeAnalyticsConfigFromEnv(): YouTubeAnalyticsConfig {
  return {
    clientId: requiredEnv("YOUTUBE_CLIENT_ID"),
    clientSecret: requiredEnv("YOUTUBE_CLIENT_SECRET"),
    refreshToken: requiredEnv("YOUTUBE_REFRESH_TOKEN"),
    channelId: process.env.YOUTUBE_CHANNEL_ID?.trim() || undefined,
  };
}

export function buildYouTubeAnalyticsReportUrl(input: {
  startDate: string;
  endDate: string;
  channelId?: string;
}): string {
  const params = new URLSearchParams({
    ids: input.channelId ? `channel==${input.channelId}` : "channel==MINE",
    startDate: input.startDate,
    endDate: input.endDate,
    metrics: [
      "views",
      "estimatedMinutesWatched",
      "averageViewDuration",
      "subscribersGained",
      "subscribersLost",
      "likes",
      "comments",
      "shares",
    ].join(","),
    dimensions: "day",
    sort: "day",
  });

  return `https://youtubeanalytics.googleapis.com/v2/reports?${params.toString()}`;
}

export async function exchangeYouTubeRefreshToken(config: YouTubeAnalyticsConfig): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json() as YouTubeTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Unable to refresh YouTube access token.");
  }

  return payload.access_token;
}

export async function exchangeYouTubeAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<YouTubeOAuthTokenSet> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
      grant_type: "authorization_code",
    }),
  });
  const payload = await response.json() as YouTubeTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Unable to exchange YouTube authorization code.");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: expiresAtFromSeconds(payload.expires_in),
    tokenType: payload.token_type ?? null,
    scope: payload.scope ?? null,
  };
}

export async function refreshYouTubeAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<YouTubeOAuthTokenSet> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json() as YouTubeTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Unable to refresh YouTube access token.");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: expiresAtFromSeconds(payload.expires_in),
    tokenType: payload.token_type ?? null,
    scope: payload.scope ?? null,
  };
}

export async function fetchYouTubeChannelIdentity(accessToken: string): Promise<YouTubeChannelIdentity> {
  const params = new URLSearchParams({
    part: "snippet",
    mine: "true",
    maxResults: "1",
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params.toString()}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await response.json() as {
    items?: Array<{
      id?: string;
      snippet?: {
        title?: string;
        customUrl?: string;
      };
    }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || "Unable to read YouTube channel identity.");
  }

  const channel = payload.items?.[0];
  if (!channel?.id) {
    throw new Error("No YouTube channel was returned for this Google account.");
  }

  return {
    id: channel.id,
    title: channel.snippet?.title || "YouTube channel",
    handle: channel.snippet?.customUrl ?? null,
  };
}

export async function fetchYouTubeDailyAnalytics(input: {
  config: YouTubeAnalyticsConfig;
  startDate: string;
  endDate: string;
}): Promise<YouTubeDailyMetric[]> {
  const accessToken = await exchangeYouTubeRefreshToken(input.config);
  const url = buildYouTubeAnalyticsReportUrl({
    startDate: input.startDate,
    endDate: input.endDate,
    channelId: input.config.channelId,
  });
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await response.json() as YouTubeAnalyticsResponse & { error?: { message?: string } };

  if (!response.ok) {
    throw new Error(payload.error?.message || "Unable to fetch YouTube analytics.");
  }

  return buildRows(payload);
}

export async function fetchYouTubeDailyAnalyticsWithAccessToken(input: {
  accessToken: string;
  startDate: string;
  endDate: string;
  channelId?: string;
}): Promise<YouTubeDailyMetric[]> {
  const url = buildYouTubeAnalyticsReportUrl({
    startDate: input.startDate,
    endDate: input.endDate,
    channelId: input.channelId,
  });
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${input.accessToken}`,
    },
  });
  const payload = await response.json() as YouTubeAnalyticsResponse & { error?: { message?: string } };

  if (!response.ok) {
    throw new Error(payload.error?.message || "Unable to fetch YouTube analytics.");
  }

  return buildRows(payload);
}

export function getDefaultYouTubeAnalyticsWindow(days = 28, now = new Date()): { startDate: string; endDate: string } {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(1, days - 1));

  return {
    startDate: toDateString(start),
    endDate: toDateString(end),
  };
}
