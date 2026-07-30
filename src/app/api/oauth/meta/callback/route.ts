import { NextResponse } from "next/server";

import { getMetaOAuthScopes, oauthFailureReason } from "@/lib/socialAnalyticsConnectors";
import { publicAppUrl } from "@/lib/publicAppUrl";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import {
  exchangeMetaAuthorizationCode,
  exchangeMetaLongLivedToken,
  storeMetaPageCredentials,
} from "@/server/integrations/metaAnalytics";
import { clearOAuthStateCookie, validateOAuthCallbackState } from "@/server/integrations/oauthState";

export const dynamic = "force-dynamic";

function redirectToSettings(request: Request, params: Record<string, string>): NextResponse {
  const url = publicAppUrl(request, "/settings/social");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = NextResponse.redirect(url);
  clearOAuthStateCookie(response, "meta");
  return response;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Meta OAuth.`);
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
    return redirectToSettings(request, { oauth: "failed", provider: "meta", reason: "unauthorized" });
  }

  if (!validateOAuthCallbackState(request, "meta", state, requestContext)) {
    return redirectToSettings(request, { oauth: "failed", provider: "meta", reason: "invalid_oauth_state" });
  }

  if (error) {
    return redirectToSettings(request, { oauth: "failed", provider: "meta", reason: error });
  }

  if (!code) {
    return redirectToSettings(request, { oauth: "failed", provider: "meta", reason: "missing_code" });
  }

  try {
    const appId = requiredEnv("META_APP_ID");
    const appSecret = requiredEnv("META_APP_SECRET");
    const shortLived = await exchangeMetaAuthorizationCode({
      appId,
      appSecret,
      redirectUri: publicAppUrl(
        request,
        "/api/oauth/meta/callback",
      ).toString(),
      code,
    });
    const longLived = await exchangeMetaLongLivedToken({
      appId,
      appSecret,
      accessToken: shortLived.accessToken,
    });
    const stored = await storeMetaPageCredentials({
      tenantScope: {
        organizationId: requestContext.organizationId,
        campusId: requestContext.campusId,
      },
      accessToken: longLived.accessToken,
      tokenType: longLived.tokenType ?? shortLived.tokenType,
      expiresAt: longLived.expiresAt ?? shortLived.expiresAt,
      scopes: getMetaOAuthScopes(),
    });

    if (stored === 0) {
      return redirectToSettings(request, { oauth: "failed", provider: "meta", reason: "no_facebook_pages_found" });
    }

    return redirectToSettings(request, { oauth: "connected", provider: "meta", accounts: String(stored) });
  } catch (callbackError) {
    console.warn("Meta OAuth callback failed.", callbackError);
    return redirectToSettings(request, { oauth: "failed", provider: "meta", reason: oauthFailureReason(callbackError) });
  }
}
