import { NextResponse } from "next/server";

import { buildOAuthRedirectUriFromRequest, oauthFailureReason } from "@/lib/socialAnalyticsConnectors";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import {
  exchangeTikTokAuthorizationCode,
  storeTikTokCredential,
} from "@/server/integrations/tiktokAnalytics";
import { clearOAuthStateCookie, validateOAuthCallbackState } from "@/server/integrations/oauthState";

export const dynamic = "force-dynamic";

function redirectToSettings(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL("/settings/social", request.url);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = NextResponse.redirect(url);
  clearOAuthStateCookie(response, "tiktok");
  return response;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for TikTok OAuth.`);
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
    return redirectToSettings(request, { oauth: "failed", provider: "tiktok", reason: "unauthorized" });
  }

  if (!validateOAuthCallbackState(request, "tiktok", state, requestContext)) {
    return redirectToSettings(request, { oauth: "failed", provider: "tiktok", reason: "invalid_oauth_state" });
  }

  if (error) {
    return redirectToSettings(request, { oauth: "failed", provider: "tiktok", reason: error });
  }

  if (!code) {
    return redirectToSettings(request, { oauth: "failed", provider: "tiktok", reason: "missing_code" });
  }

  try {
    const tokenSet = await exchangeTikTokAuthorizationCode({
      clientKey: requiredEnv("TIKTOK_CLIENT_KEY"),
      clientSecret: requiredEnv("TIKTOK_CLIENT_SECRET"),
      redirectUri: buildOAuthRedirectUriFromRequest("tiktok", request.url),
      code,
    });
    await storeTikTokCredential({
      ...tokenSet,
      tenantScope: {
        organizationId: requestContext.organizationId,
        campusId: requestContext.campusId,
      },
    });
  } catch (callbackError) {
    console.warn("TikTok OAuth callback failed.", callbackError);
    return redirectToSettings(request, { oauth: "failed", provider: "tiktok", reason: oauthFailureReason(callbackError) });
  }

  return redirectToSettings(request, { oauth: "connected", provider: "tiktok" });
}
