import { NextResponse } from "next/server";

import { buildOAuthRedirectUri, getMetaOAuthScopes } from "@/lib/socialAnalyticsConnectors";
import {
  exchangeMetaAuthorizationCode,
  exchangeMetaLongLivedToken,
  storeMetaPageCredentials,
} from "@/server/integrations/metaAnalytics";

export const dynamic = "force-dynamic";

function redirectToSettings(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL("/settings/social", request.url);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return NextResponse.redirect(url);
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
      redirectUri: buildOAuthRedirectUri("meta"),
      code,
    });
    const longLived = await exchangeMetaLongLivedToken({
      appId,
      appSecret,
      accessToken: shortLived.accessToken,
    });
    const stored = await storeMetaPageCredentials({
      accessToken: longLived.accessToken,
      tokenType: longLived.tokenType ?? shortLived.tokenType,
      expiresAt: longLived.expiresAt ?? shortLived.expiresAt,
      scopes: getMetaOAuthScopes(),
    });

    return redirectToSettings(request, { oauth: "connected", provider: "meta", accounts: String(stored) });
  } catch (callbackError) {
    console.warn("Meta OAuth callback failed.", callbackError);
    return redirectToSettings(request, { oauth: "failed", provider: "meta", reason: "exchange_failed" });
  }
}
