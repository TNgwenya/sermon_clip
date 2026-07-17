import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as startOAuth } from "@/app/api/oauth/[provider]/start/route";
import { GET as metaCallback } from "@/app/api/oauth/meta/callback/route";
import { GET as threadsCallback } from "@/app/api/oauth/threads/callback/route";
import { GET as tiktokCallback } from "@/app/api/oauth/tiktok/callback/route";
import { GET as youtubeCallback } from "@/app/api/oauth/youtube/callback/route";
import {
  createOAuthState,
  OAUTH_STATE_TTL_SECONDS,
  validateOAuthCallbackState,
} from "@/server/integrations/oauthState";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("OAuth state", () => {
  it("creates unique, HttpOnly, short-lived provider state", () => {
    vi.stubEnv("NODE_ENV", "production");
    const first = createOAuthState("youtube", 1_750_000_000_000);
    const second = createOAuthState("youtube", 1_750_000_000_000);

    expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.state).not.toBe(first.state);
    expect(first.cookie).toMatchObject({
      name: "sermon_clip_oauth_state_youtube",
      options: {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/api/oauth/youtube/callback",
        maxAge: OAUTH_STATE_TTL_SECONDS,
      },
    });
  });

  it("accepts only the matching, unexpired cookie-backed state", () => {
    const now = 1_750_000_000_000;
    const attempt = createOAuthState("meta", now);
    const request = new Request("https://church.example/api/oauth/meta/callback", {
      headers: { cookie: `${attempt.cookie.name}=${attempt.cookie.value}` },
    });
    const tamperedState = `${attempt.state.slice(0, -1)}${attempt.state.endsWith("a") ? "b" : "a"}`;

    expect(validateOAuthCallbackState(request, "meta", attempt.state, now)).toBe(true);
    expect(validateOAuthCallbackState(request, "meta", tamperedState, now)).toBe(false);
    expect(validateOAuthCallbackState(request, "meta", attempt.state, now + (OAUTH_STATE_TTL_SECONDS + 1) * 1_000)).toBe(false);
    expect(validateOAuthCallbackState(request, "youtube", attempt.state, now)).toBe(false);
  });

  it("creates state only when the user starts an OAuth connection", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("YOUTUBE_CLIENT_ID", "youtube-client-id");
    vi.stubEnv("YOUTUBE_CLIENT_SECRET", "youtube-client-secret");

    const response = await startOAuth(
      new Request("https://church.example/api/oauth/youtube/start"),
      { params: Promise.resolve({ provider: "youtube" }) },
    );
    const destination = new URL(response.headers.get("location") ?? "");
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(destination.origin).toBe("https://accounts.google.com");
    expect(destination.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(destination.searchParams.get("redirect_uri")).toBe("https://church.example/api/oauth/youtube/callback");
    expect(setCookie).toContain("sermon_clip_oauth_state_youtube=");
    expect(setCookie).toContain("Path=/api/oauth/youtube/callback");
    expect(setCookie).toContain(`Max-Age=${OAUTH_STATE_TTL_SECONDS}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not leave an OAuth state cookie when provider setup is incomplete", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("YOUTUBE_CLIENT_ID", "youtube-client-id");
    vi.stubEnv("YOUTUBE_CLIENT_SECRET", "");

    const response = await startOAuth(
      new Request("https://church.example/api/oauth/youtube/start"),
      { params: Promise.resolve({ provider: "youtube" }) },
    );
    const destination = new URL(response.headers.get("location") ?? "");

    expect(destination.pathname).toBe("/settings/social");
    expect(destination.searchParams.get("reason")).toBe("missing_server_oauth_env");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("OAuth callbacks", () => {
  const callbacks = [
    ["youtube", youtubeCallback],
    ["meta", metaCallback],
    ["tiktok", tiktokCallback],
    ["threads", threadsCallback],
  ] as const;

  it.each(callbacks)("rejects an unverified %s callback before code exchange", async (provider, callback) => {
    const response = await callback(new Request(
      `https://church.example/api/oauth/${provider}/callback?code=authorization-code&state=${"a".repeat(43)}`,
    ));
    const destination = new URL(response.headers.get("location") ?? "");
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(destination.pathname).toBe("/settings/social");
    expect(destination.searchParams.get("oauth")).toBe("failed");
    expect(destination.searchParams.get("provider")).toBe(provider);
    expect(destination.searchParams.get("reason")).toBe("invalid_oauth_state");
    expect(setCookie).toContain(`sermon_clip_oauth_state_${provider}=`);
    expect(setCookie).toContain("Max-Age=0");
  });

  it.each(callbacks)("consumes %s state when the provider returns an error", async (provider, callback) => {
    const attempt = createOAuthState(provider);
    const request = new Request(
      `https://church.example/api/oauth/${provider}/callback?error=access_denied&state=${attempt.state}`,
      { headers: { cookie: `${attempt.cookie.name}=${attempt.cookie.value}` } },
    );
    const response = await callback(request);
    const destination = new URL(response.headers.get("location") ?? "");

    expect(destination.searchParams.get("reason")).toBe("access_denied");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
