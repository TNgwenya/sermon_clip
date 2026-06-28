import { afterEach, describe, expect, it } from "vitest";

import {
  buildMetaOAuthUrl,
  buildOAuthRedirectUri,
  buildThreadsOAuthUrl,
  buildTikTokOAuthUrl,
  buildYouTubeOAuthUrl,
} from "@/lib/socialAnalyticsConnectors";

const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl;
});

describe("social analytics connector OAuth helpers", () => {
  it("builds provider callback URLs from the configured app base URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://church.example/";

    expect(buildOAuthRedirectUri("youtube")).toBe("https://church.example/api/oauth/youtube/callback");
    expect(buildOAuthRedirectUri("meta")).toBe("https://church.example/api/oauth/meta/callback");
    expect(buildOAuthRedirectUri("tiktok")).toBe("https://church.example/api/oauth/tiktok/callback");
    expect(buildOAuthRedirectUri("threads")).toBe("https://church.example/api/oauth/threads/callback");
  });

  it("includes platform analytics scopes in OAuth URLs", () => {
    const redirectUri = "https://church.example/api/oauth/youtube/callback";
    const youtubeUrl = new URL(buildYouTubeOAuthUrl({ clientId: "google-client", redirectUri, state: "state" }));
    const metaUrl = new URL(buildMetaOAuthUrl({ appId: "meta-app", redirectUri, state: "state" }));
    const tiktokUrl = new URL(buildTikTokOAuthUrl({ clientKey: "tiktok-key", redirectUri, state: "state" }));
    const threadsUrl = new URL(buildThreadsOAuthUrl({ appId: "threads-app", redirectUri, state: "state" }));

    expect(youtubeUrl.searchParams.get("scope")).toContain("yt-analytics.readonly");
    expect(youtubeUrl.searchParams.get("scope")).toContain("youtube.upload");
    expect(metaUrl.searchParams.get("scope")).toContain("instagram_manage_insights");
    expect(metaUrl.searchParams.get("scope")).toContain("pages_manage_posts");
    expect(tiktokUrl.searchParams.get("scope")).toContain("video.publish");
    expect(tiktokUrl.searchParams.get("scope")).toContain("video.list");
    expect(threadsUrl.searchParams.get("scope")).toContain("threads_manage_insights");
  });
});
