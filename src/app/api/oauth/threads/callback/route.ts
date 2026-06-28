import { NextResponse } from "next/server";

import { buildOAuthRedirectUri } from "@/lib/socialAnalyticsConnectors";
import {
  exchangeThreadsAuthorizationCode,
  exchangeThreadsLongLivedToken,
  storeThreadsCredential,
} from "@/server/integrations/threadsAnalytics";

export const dynamic = "force-dynamic";

function redirectToSettings(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL("/settings/social", request.url);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return NextResponse.redirect(url);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Threads OAuth.`);
  }

  return value;
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return redirectToSettings(request, { oauth: "failed", provider: "threads", reason: error });
  }

  if (!code) {
    return redirectToSettings(request, { oauth: "failed", provider: "threads", reason: "missing_code" });
  }

  try {
    const appSecret = requiredEnv("THREADS_APP_SECRET");
    const shortLived = await exchangeThreadsAuthorizationCode({
      appId: requiredEnv("THREADS_APP_ID"),
      appSecret,
      redirectUri: buildOAuthRedirectUri("threads"),
      code,
    });
    const longLived = await exchangeThreadsLongLivedToken({
      appSecret,
      accessToken: shortLived.accessToken,
    });

    await storeThreadsCredential({
      accessToken: longLived.accessToken,
      externalAccountId: shortLived.externalAccountId,
      expiresAt: longLived.expiresAt ?? shortLived.expiresAt,
      tokenType: longLived.tokenType ?? shortLived.tokenType,
      scopes: ["threads_basic", "threads_manage_insights"],
    });
  } catch (callbackError) {
    console.warn("Threads OAuth callback failed.", callbackError);
    return redirectToSettings(request, { oauth: "failed", provider: "threads", reason: "exchange_failed" });
  }

  return redirectToSettings(request, { oauth: "connected", provider: "threads" });
}
