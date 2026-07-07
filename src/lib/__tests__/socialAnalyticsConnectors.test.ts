import { afterEach, describe, expect, it } from "vitest";

import {
  buildMetaOAuthUrl,
  buildOAuthRedirectUri,
  buildOAuthRedirectUriFromRequest,
  buildRequestBaseUrl,
  buildThreadsOAuthUrl,
  buildTikTokOAuthUrl,
  buildYouTubeOAuthUrl,
  oauthFailureReason,
} from "@/lib/socialAnalyticsConnectors";

const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalMetaOAuthExtraScopes = process.env.META_OAUTH_EXTRA_SCOPES;

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl;
  process.env.META_OAUTH_EXTRA_SCOPES = originalMetaOAuthExtraScopes;
});

describe("social analytics connector OAuth helpers", () => {
  it("builds provider callback URLs from the configured app base URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://church.example/";

    expect(buildOAuthRedirectUri("youtube")).toBe("https://church.example/api/oauth/youtube/callback");
    expect(buildOAuthRedirectUri("meta")).toBe("https://church.example/api/oauth/meta/callback");
    expect(buildOAuthRedirectUri("tiktok")).toBe("https://church.example/api/oauth/tiktok/callback");
    expect(buildOAuthRedirectUri("threads")).toBe("https://church.example/api/oauth/threads/callback");
  });

  it("builds provider callback URLs from the current request host", () => {
    const localHeaders = new Headers({ host: "localhost:3000" });
    const vercelHeaders = new Headers({
      "x-forwarded-host": "sermon-clip.vercel.app",
      "x-forwarded-proto": "https",
    });

    expect(buildRequestBaseUrl(localHeaders)).toBe("http://localhost:3000");
    expect(buildRequestBaseUrl(vercelHeaders)).toBe("https://sermon-clip.vercel.app");
    expect(buildOAuthRedirectUri("youtube", buildRequestBaseUrl(localHeaders))).toBe("http://localhost:3000/api/oauth/youtube/callback");
    expect(buildOAuthRedirectUriFromRequest("meta", "http://localhost:3000/api/oauth/meta/callback?code=123")).toBe("http://localhost:3000/api/oauth/meta/callback");
  });

  it("includes platform analytics scopes in OAuth URLs", () => {
    const redirectUri = "https://church.example/api/oauth/youtube/callback";
    const youtubeUrl = new URL(buildYouTubeOAuthUrl({ clientId: "google-client", redirectUri, state: "state" }));
    const metaUrl = new URL(buildMetaOAuthUrl({ appId: "meta-app", redirectUri, state: "state" }));
    const tiktokUrl = new URL(buildTikTokOAuthUrl({ clientKey: "tiktok-key", redirectUri, state: "state" }));
    const threadsUrl = new URL(buildThreadsOAuthUrl({ appId: "threads-app", redirectUri, state: "state" }));

    expect(youtubeUrl.searchParams.get("scope")).toContain("yt-analytics.readonly");
    expect(youtubeUrl.searchParams.get("scope")).toContain("youtube.upload");
    expect(metaUrl.searchParams.get("scope")).toContain("pages_show_list");
    expect(metaUrl.searchParams.get("scope")).toContain("pages_manage_posts");
    expect(metaUrl.searchParams.get("scope")).not.toContain("instagram_manage_insights");
    expect(tiktokUrl.searchParams.get("scope")).toContain("video.publish");
    expect(tiktokUrl.searchParams.get("scope")).toContain("video.list");
    expect(threadsUrl.searchParams.get("scope")).toContain("threads_manage_insights");
  });

  it("allows Meta OAuth advanced scopes to be opted in by environment", () => {
    process.env.META_OAUTH_EXTRA_SCOPES = "pages_read_engagement, instagram_basic, instagram_manage_insights";

    const metaUrl = new URL(buildMetaOAuthUrl({
      appId: "meta-app",
      redirectUri: "https://church.example/api/oauth/meta/callback",
      state: "state",
    }));

    expect(metaUrl.searchParams.get("scope")).toContain("pages_manage_posts");
    expect(metaUrl.searchParams.get("scope")).toContain("instagram_basic");
    expect(metaUrl.searchParams.get("scope")).toContain("instagram_manage_insights");
  });

  it("normalizes OAuth callback failures into safe setup reasons", () => {
    expect(oauthFailureReason(new Error("Error 400: redirect_uri_mismatch"))).toBe("redirect_uri_mismatch");
    expect(oauthFailureReason(new Error("META_APP_SECRET is required for Meta OAuth."))).toBe("missing_server_oauth_env");
    expect(oauthFailureReason(new Error("Missing pages_manage_posts permission"))).toBe("missing_or_unapproved_permission");
    expect(oauthFailureReason(new Error("invalid_client"))).toBe("invalid_client");
  });
});
