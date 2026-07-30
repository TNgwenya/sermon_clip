import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const resolveSession = vi.hoisted(() => vi.fn());

vi.mock("@/server/auth/prismaSessionRepository", () => ({
  getPrismaSessionService: () => ({ resolveSession }),
}));

import {
  BOOTSTRAP_OWNER_USER_ID,
  DEFAULT_ORGANIZATION_ID,
  SERMONCLIP_ACTOR_HEADER,
  SERMONCLIP_AUTHENTICATION_HEADER,
  SERMONCLIP_ORGANIZATION_HEADER,
} from "@/lib/tenancy/requestHeaders";
import { proxy } from "@/proxy";

function forwardedRequestHeader(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

afterEach(() => {
  vi.unstubAllEnvs();
  resolveSession.mockReset();
});

describe("admin proxy", () => {
  it("fails closed in production when all authentication configuration is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "");
    vi.stubEnv("SESSION_TOKEN_PEPPER", "");
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("ALLOW_LOCAL_ADMIN_BYPASS", "true");

    const response = await proxy(new NextRequest("https://church.example/sermons"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it("allows local development without an admin password", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "");

    const response = await proxy(new NextRequest("http://localhost:3000/sermons"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(forwardedRequestHeader(response, SERMONCLIP_ORGANIZATION_HEADER))
      .toBe(DEFAULT_ORGANIZATION_ID);
    expect(forwardedRequestHeader(response, SERMONCLIP_ACTOR_HEADER))
      .toBe(BOOTSTRAP_OWNER_USER_ID);
    expect(forwardedRequestHeader(response, SERMONCLIP_AUTHENTICATION_HEADER))
      .toBe("local-development");
  });

  it("never accepts shared Basic authentication in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "premium-password");
    vi.stubEnv(
      "SESSION_TOKEN_PEPPER",
      "test-session-token-pepper-with-32-plus-characters",
    );
    const unauthorized = await proxy(new NextRequest("https://church.example/sermons"));
    const authorization = `Basic ${Buffer.from("admin:premium-password").toString("base64")}`;
    const sharedPasswordAttempt = await proxy(new NextRequest("https://church.example/sermons", {
      headers: { authorization },
    }));

    expect(unauthorized.status).toBe(401);
    expect(sharedPasswordAttempt.status).toBe(401);
    expect(sharedPasswordAttempt.headers.get("x-middleware-next")).toBeNull();
    expect(forwardedRequestHeader(sharedPasswordAttempt, SERMONCLIP_AUTHENTICATION_HEADER))
      .toBeNull();
  });

  it("redirects signed-out production page navigations to login with a safe return path", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "");
    vi.stubEnv(
      "SESSION_TOKEN_PEPPER",
      "test-session-token-pepper-with-32-plus-characters",
    );

    const response = await proxy(new NextRequest(
      "https://church.example/week-drafts?week=next",
      { headers: { accept: "text/html" } },
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://church.example/login?returnTo=%2Fweek-drafts%3Fweek%3Dnext",
    );
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  it("returns a non-challenging 401 for signed-out production API requests", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "");
    vi.stubEnv(
      "SESSION_TOKEN_PEPPER",
      "test-session-token-pepper-with-32-plus-characters",
    );

    const response = await proxy(new NextRequest(
      "https://church.example/api/ready-to-post/preflight",
      { headers: { accept: "application/json" } },
    ));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      error: "authentication_required",
    });
  });

  it("forwards tenant identity only after resolving a secure session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "SESSION_TOKEN_PEPPER",
      "test-session-token-pepper-with-32-plus-characters",
    );
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "");
    resolveSession.mockResolvedValue({
      sessionId: "session_one",
      userId: "user_one",
      organizationId: "org_one",
      campusId: "campus_one",
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    const response = await proxy(new NextRequest("https://church.example/sermons", {
      headers: {
        cookie: "__Host-sermonclip_session=scs_securetoken",
        [SERMONCLIP_ORGANIZATION_HEADER]: "org_attacker",
        [SERMONCLIP_ACTOR_HEADER]: "user_attacker",
      },
    }));

    expect(resolveSession).toHaveBeenCalledWith("scs_securetoken");
    expect(forwardedRequestHeader(response, SERMONCLIP_ORGANIZATION_HEADER))
      .toBe("org_one");
    expect(forwardedRequestHeader(response, SERMONCLIP_ACTOR_HEADER))
      .toBe("user_one");
    expect(forwardedRequestHeader(response, SERMONCLIP_AUTHENTICATION_HEADER))
      .toBe("session");
  });

  it("keeps the login endpoint public without trusting client tenant headers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "");
    vi.stubEnv(
      "AUTH_SECRET",
      "test-auth-secret-with-more-than-32-characters",
    );

    const response = await proxy(new NextRequest("https://church.example/login", {
      headers: {
        [SERMONCLIP_ORGANIZATION_HEADER]: "org_attacker",
        [SERMONCLIP_ACTOR_HEADER]: "user_attacker",
      },
    }));

    expect(response.status).toBe(200);
    expect(forwardedRequestHeader(response, SERMONCLIP_ORGANIZATION_HEADER))
      .toBeNull();
    expect(forwardedRequestHeader(response, SERMONCLIP_ACTOR_HEADER)).toBeNull();
  });

  it.each([
    "/s/sunday-hope",
    "/s/sunday-hope/",
    "/api/public/sermons/sunday-hope/cta",
    "/api/public/sermons/sunday-hope/logo",
  ])("keeps only the intended public sermon surface signed-out: %s", async (pathname) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "");
    vi.stubEnv(
      "AUTH_SECRET",
      "test-auth-secret-with-more-than-32-characters",
    );

    const response = await proxy(new NextRequest(`https://church.example${pathname}`, {
      headers: {
        [SERMONCLIP_ORGANIZATION_HEADER]: "org_attacker",
        [SERMONCLIP_ACTOR_HEADER]: "user_attacker",
      },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(forwardedRequestHeader(response, SERMONCLIP_ORGANIZATION_HEADER)).toBeNull();
    expect(forwardedRequestHeader(response, SERMONCLIP_ACTOR_HEADER)).toBeNull();
  });

  it.each([
    ["/s", "text/html", 307],
    ["/s/sunday-hope/share", "text/html", 307],
    ["/api/public", "application/json", 401],
    ["/api/sermons/public", "application/json", 401],
  ])("does not broaden the public sermon exemption to %s", async (pathname, accept, status) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "");
    vi.stubEnv(
      "SESSION_TOKEN_PEPPER",
      "test-session-token-pepper-with-32-plus-characters",
    );

    const response = await proxy(new NextRequest(`https://church.example${pathname}`, {
      headers: { accept },
    }));

    expect(response.status).toBe(status);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it("overwrites client-supplied tenant and actor context during local Basic smoke", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "premium-password");
    const authorization = `Basic ${Buffer.from("admin:premium-password").toString("base64")}`;

    const response = await proxy(new NextRequest("https://church.example/sermons", {
      headers: {
        authorization,
        [SERMONCLIP_ORGANIZATION_HEADER]: "org_attacker",
        [SERMONCLIP_ACTOR_HEADER]: "user_attacker",
      },
    }));

    expect(forwardedRequestHeader(response, SERMONCLIP_ORGANIZATION_HEADER))
      .toBe(DEFAULT_ORGANIZATION_ID);
    expect(forwardedRequestHeader(response, SERMONCLIP_ACTOR_HEADER))
      .toBe(BOOTSTRAP_OWNER_USER_ID);
  });

  it("removes client-supplied trusted context from automation routes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "premium-password");
    vi.stubEnv(
      "AUTH_SECRET",
      "test-auth-secret-with-more-than-32-characters",
    );

    const response = await proxy(new NextRequest("https://church.example/api/automation/process", {
      headers: {
        [SERMONCLIP_ORGANIZATION_HEADER]: "org_attacker",
        [SERMONCLIP_ACTOR_HEADER]: "user_attacker",
      },
    }));

    expect(response.status).toBe(200);
    expect(forwardedRequestHeader(response, SERMONCLIP_ORGANIZATION_HEADER)).toBeNull();
    expect(forwardedRequestHeader(response, SERMONCLIP_ACTOR_HEADER)).toBeNull();
  });

  it("never attaches a bootstrap actor to public automation routes in local mode", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "");

    const response = await proxy(new NextRequest("http://localhost:3000/api/automation/process"));

    expect(response.status).toBe(200);
    expect(forwardedRequestHeader(response, SERMONCLIP_ORGANIZATION_HEADER)).toBeNull();
    expect(forwardedRequestHeader(response, SERMONCLIP_ACTOR_HEADER)).toBeNull();
  });
});
