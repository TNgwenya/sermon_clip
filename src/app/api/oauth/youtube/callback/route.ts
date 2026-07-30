import { NextResponse } from "next/server";

import { oauthFailureReason } from "@/lib/socialAnalyticsConnectors";
import { publicAppUrl } from "@/lib/publicAppUrl";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import { upsertSocialCredential } from "@/server/integrations/socialCredentials";
import { clearOAuthStateCookie, validateOAuthCallbackState } from "@/server/integrations/oauthState";
import {
  exchangeYouTubeAuthorizationCode,
  fetchYouTubeChannelIdentity,
} from "@/server/integrations/youtubeAnalytics";

export const dynamic = "force-dynamic";

function redirectToSettings(request: Request, params: Record<string, string>): NextResponse {
  const url = publicAppUrl(request, "/settings/social");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = NextResponse.redirect(url);
  clearOAuthStateCookie(response, "youtube");
  return response;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for YouTube OAuth.`);
  }

  return value;
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  let requestContext: Awaited<ReturnType<typeof requireRequestCapability>>;
  try {
    requestContext = await requireRequestCapability("channels.connect");
  } catch {
    return redirectToSettings(request, { oauth: "failed", provider: "youtube", reason: "unauthorized" });
  }

  if (!validateOAuthCallbackState(request, "youtube", state, requestContext)) {
    return redirectToSettings(request, { oauth: "failed", provider: "youtube", reason: "invalid_oauth_state" });
  }

  if (error) {
    return redirectToSettings(request, { oauth: "failed", provider: "youtube", reason: error });
  }

  if (!code) {
    return redirectToSettings(request, { oauth: "failed", provider: "youtube", reason: "missing_code" });
  }

  try {
    const tokenSet = await exchangeYouTubeAuthorizationCode({
      clientId: requiredEnv("YOUTUBE_CLIENT_ID"),
      clientSecret: requiredEnv("YOUTUBE_CLIENT_SECRET"),
      redirectUri: publicAppUrl(
        request,
        "/api/oauth/youtube/callback",
      ).toString(),
      code,
    });
    const channel = await fetchYouTubeChannelIdentity(tokenSet.accessToken);

    await upsertSocialCredential({
      tenantScope: {
        organizationId: requestContext.organizationId,
        campusId: requestContext.campusId,
      },
      provider: "YOUTUBE",
      externalAccountId: channel.id,
      accountName: channel.title,
      handle: channel.handle,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      tokenType: tokenSet.tokenType,
      scopes: tokenSet.scope?.split(" ") ?? [],
      metadata: { channelId: channel.id, source: "google_oauth" },
      expiresAt: tokenSet.expiresAt,
      socialAccount: {
        platform: "YOUTUBE_SHORTS",
        label: channel.title,
        handle: channel.handle,
      },
    });
  } catch (callbackError) {
    console.warn("YouTube OAuth callback failed.", callbackError);
    return redirectToSettings(request, { oauth: "failed", provider: "youtube", reason: oauthFailureReason(callbackError) });
  }

  return redirectToSettings(request, { oauth: "connected", provider: "youtube" });
}
