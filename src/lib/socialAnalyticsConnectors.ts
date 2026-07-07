import type { SocialConnectorProvider } from "@prisma/client";

import { listConnectorCredentialSummaries } from "@/server/integrations/socialCredentials";

export type ConnectorStatus = "ready" | "needs_setup" | "planned" | "manual";

export type SocialAnalyticsConnector = {
  platform: string;
  status: ConnectorStatus;
  capability: string;
  setupHref?: string;
  syncAction?: "youtube" | "meta" | "tiktok" | "threads";
  missingEnv?: string[];
  connectedAccounts?: number;
};

function missingEnv(keys: string[]): string[] {
  return keys.filter((key) => !process.env[key]?.trim());
}

function hasCredential(summary: Partial<Record<SocialConnectorProvider, number>>, providers: SocialConnectorProvider[]): number {
  return providers.reduce((sum, provider) => sum + (summary[provider] ?? 0), 0);
}

export async function listSocialAnalyticsConnectors(): Promise<SocialAnalyticsConnector[]> {
  let credentialSummary: Partial<Record<SocialConnectorProvider, number>> = {};
  try {
    credentialSummary = await listConnectorCredentialSummaries();
  } catch (error) {
    console.warn("Unable to load social connector credential summary.", error);
  }

  const youtubeMissing = missingEnv(["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"]);
  const metaMissing = missingEnv(["META_APP_ID", "META_APP_SECRET"]);
  const tiktokMissing = missingEnv(["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]);
  const threadsMissing = missingEnv(["THREADS_APP_ID", "THREADS_APP_SECRET"]);
  const youtubeConnected = hasCredential(credentialSummary, ["YOUTUBE"]);
  const metaConnected = hasCredential(credentialSummary, ["META_FACEBOOK", "META_INSTAGRAM"]);
  const tiktokConnected = hasCredential(credentialSummary, ["TIKTOK"]);
  const threadsConnected = hasCredential(credentialSummary, ["THREADS"]);

  return [
    {
      platform: "YouTube",
      status: youtubeMissing.length === 0 && (youtubeConnected > 0 || process.env.YOUTUBE_REFRESH_TOKEN?.trim()) ? "ready" : "needs_setup",
      capability: "Imports channel-level views, watch time, subscribers, likes, comments, and shares.",
      setupHref: "/settings/social",
      syncAction: "youtube",
      missingEnv: youtubeMissing,
      connectedAccounts: youtubeConnected,
    },
    {
      platform: "Instagram / Facebook",
      status: metaMissing.length === 0 && metaConnected > 0 ? "ready" : "needs_setup",
      capability: "Meta Graph API insights for reach, impressions, engagement, saves, shares, and clicks.",
      setupHref: "/settings/social",
      syncAction: "meta",
      missingEnv: metaMissing,
      connectedAccounts: metaConnected,
    },
    {
      platform: "TikTok",
      status: tiktokMissing.length === 0 && tiktokConnected > 0 ? "ready" : "needs_setup",
      capability: "TikTok analytics and content posting where account permissions allow.",
      setupHref: "/settings/social",
      syncAction: "tiktok",
      missingEnv: tiktokMissing,
      connectedAccounts: tiktokConnected,
    },
    {
      platform: "Threads",
      status: threadsMissing.length === 0 && threadsConnected > 0 ? "ready" : "needs_setup",
      capability: "Threads insights for posts, replies, reposts, and follower growth.",
      setupHref: "/settings/social",
      syncAction: "threads",
      missingEnv: threadsMissing,
      connectedAccounts: threadsConnected,
    },
    {
      platform: "Website / Blog",
      status: "manual",
      capability: "Track traffic, signups, and next steps manually until Google Analytics is connected.",
      setupHref: "/growth",
    },
  ];
}

export type OAuthProvider = "youtube" | "meta" | "tiktok" | "threads";

type HeaderReader = {
  get(name: string): string | null;
};

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function firstHeaderValue(value: string | null): string | null {
  return value?.split(",").at(0)?.trim() || null;
}

function isLocalHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized.startsWith("localhost")
    || normalized.startsWith("127.0.0.1")
    || normalized.startsWith("[::1]");
}

export function buildAppBaseUrl(baseUrl?: string | null): string {
  if (baseUrl?.trim()) {
    return normalizeBaseUrl(baseUrl);
  }

  return normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.WORKER_API_BASE_URL?.trim() || "http://localhost:3000");
}

export function buildRequestBaseUrl(headers: HeaderReader): string {
  const forwardedHost = firstHeaderValue(headers.get("x-forwarded-host"));
  const host = forwardedHost || firstHeaderValue(headers.get("host"));
  if (!host) {
    return buildAppBaseUrl();
  }

  const forwardedProto = firstHeaderValue(headers.get("x-forwarded-proto"));
  const proto = forwardedProto || (isLocalHost(host) ? "http" : "https");
  return buildAppBaseUrl(`${proto}://${host}`);
}

export function buildOAuthRedirectUri(provider: OAuthProvider, baseUrl?: string | null): string {
  return `${buildAppBaseUrl(baseUrl)}/api/oauth/${provider}/callback`;
}

export function buildOAuthRedirectUriFromRequest(provider: OAuthProvider, requestUrl: string): string {
  return new URL(`/api/oauth/${provider}/callback`, requestUrl).toString();
}

export function oauthFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes(" is required for ") && normalized.includes(" oauth")) {
    return "missing_server_oauth_env";
  }

  if (normalized.includes("redirect_uri_mismatch")
    || normalized.includes("redirect uri")
    || normalized.includes("redirect_uri")
    || normalized.includes("domain of this url")
    || normalized.includes("url blocked")
    || normalized.includes("can't load url")
    || normalized.includes("cant load url")
  ) {
    return "redirect_uri_mismatch";
  }

  if (normalized.includes("invalid_grant")
    || normalized.includes("authorization code")
    || normalized.includes("verification code")
  ) {
    return "invalid_grant";
  }

  if (normalized.includes("invalid_client") || normalized.includes("client_secret")) {
    return "invalid_client";
  }

  if (normalized.includes("fetch failed") || normalized.includes("network")) {
    return "provider_network_failed";
  }

  if (normalized.includes("permission")
    || normalized.includes("permissions")
    || normalized.includes("scope")
    || normalized.includes("not authorized")
  ) {
    return "missing_or_unapproved_permission";
  }

  if (normalized.includes("access token") || normalized.includes("oauth")) {
    return "oauth_exchange_failed";
  }

  return "exchange_failed";
}

export function getMetaOAuthScopes(): string[] {
  const baseScopes = ["pages_show_list", "pages_manage_posts"];
  const extraScopes = (process.env.META_OAUTH_EXTRA_SCOPES ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  return Array.from(new Set([...baseScopes, ...extraScopes]));
}

export function buildYouTubeOAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    state: input.state,
    scope: [
      "https://www.googleapis.com/auth/yt-analytics.readonly",
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube.upload",
    ].join(" "),
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function buildMetaOAuthUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.appId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    state: input.state,
    scope: getMetaOAuthScopes().join(","),
  });

  return `https://www.facebook.com/${process.env.META_GRAPH_VERSION?.trim() || "v23.0"}/dialog/oauth?${params.toString()}`;
}

export function buildTikTokOAuthUrl(input: {
  clientKey: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_key: input.clientKey,
    redirect_uri: input.redirectUri,
    response_type: "code",
    state: input.state,
    scope: [
      "user.info.basic",
      "video.publish",
      "video.list",
    ].join(","),
  });

  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

export function buildThreadsOAuthUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.appId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    state: input.state,
    scope: [
      "threads_basic",
      "threads_manage_insights",
    ].join(","),
  });

  return `https://threads.net/oauth/authorize?${params.toString()}`;
}
