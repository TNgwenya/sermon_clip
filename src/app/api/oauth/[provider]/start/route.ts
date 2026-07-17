import { NextResponse } from "next/server";

import {
  buildMetaOAuthUrl,
  buildOAuthRedirectUriFromRequest,
  buildThreadsOAuthUrl,
  buildTikTokOAuthUrl,
  buildYouTubeOAuthUrl,
  oauthFailureReason,
  type OAuthProvider,
} from "@/lib/socialAnalyticsConnectors";
import { createOAuthState, setOAuthStateCookie } from "@/server/integrations/oauthState";

export const dynamic = "force-dynamic";

const OAUTH_PROVIDERS = new Set<OAuthProvider>(["youtube", "meta", "tiktok", "threads"]);

function isOAuthProvider(value: string): value is OAuthProvider {
  return OAUTH_PROVIDERS.has(value as OAuthProvider);
}

function requiredEnv(name: string, provider: OAuthProvider): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for ${provider} OAuth.`);
  return value;
}

function redirectToSettings(request: Request, provider: string, reason: string): NextResponse {
  const url = new URL("/settings/social", request.url);
  url.searchParams.set("oauth", "failed");
  url.searchParams.set("provider", provider);
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

function providerAuthorizationUrl(provider: OAuthProvider, requestUrl: string, state: string): string {
  const redirectUri = buildOAuthRedirectUriFromRequest(provider, requestUrl);

  switch (provider) {
    case "youtube": {
      const clientId = requiredEnv("YOUTUBE_CLIENT_ID", provider);
      requiredEnv("YOUTUBE_CLIENT_SECRET", provider);
      return buildYouTubeOAuthUrl({
        clientId,
        redirectUri,
        state,
      });
    }
    case "meta": {
      const appId = requiredEnv("META_APP_ID", provider);
      requiredEnv("META_APP_SECRET", provider);
      return buildMetaOAuthUrl({
        appId,
        redirectUri,
        state,
      });
    }
    case "tiktok": {
      const clientKey = requiredEnv("TIKTOK_CLIENT_KEY", provider);
      requiredEnv("TIKTOK_CLIENT_SECRET", provider);
      return buildTikTokOAuthUrl({
        clientKey,
        redirectUri,
        state,
      });
    }
    case "threads": {
      const appId = requiredEnv("THREADS_APP_ID", provider);
      requiredEnv("THREADS_APP_SECRET", provider);
      return buildThreadsOAuthUrl({
        appId,
        redirectUri,
        state,
      });
    }
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider: rawProvider } = await context.params;
  if (!isOAuthProvider(rawProvider)) {
    return redirectToSettings(request, rawProvider, "unsupported_provider");
  }

  try {
    const attempt = createOAuthState(rawProvider);
    const response = NextResponse.redirect(providerAuthorizationUrl(rawProvider, request.url, attempt.state));
    setOAuthStateCookie(response, attempt.cookie);
    return response;
  } catch (error) {
    console.warn(`${rawProvider} OAuth initiation failed.`, error instanceof Error ? error.message : "Unknown error");
    return redirectToSettings(request, rawProvider, oauthFailureReason(error));
  }
}
