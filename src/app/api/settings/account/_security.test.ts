import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePersistedTenantCapability = vi.hoisted(() => vi.fn());
const resolveSession = vi.hoisted(() => vi.fn());

vi.mock("@/server/auth/requestAuthorization", () => ({
  requirePersistedTenantCapability,
}));
vi.mock("@/server/auth/prismaSessionRepository", () => ({
  getPrismaSessionService: () => ({ resolveSession }),
}));

import {
  __accountRouteSecurityTestUtils,
  accountJson,
  requireAccountRouteContext,
} from "./_security";
import { SESSION_COOKIE_NAME } from "@/server/auth/sessionService";

function request(options: {
  origin?: string | null;
  authentication?: string;
  cookie?: string | null;
} = {}): Request {
  const headers = new Headers({
    "x-sermonclip-organization-id": "org_one",
    "x-sermonclip-campus-id": "campus_one",
    "x-sermonclip-actor-id": "user_one",
    "x-sermonclip-authentication": options.authentication ?? "session",
  });
  if (options.origin !== null) {
    headers.set("Origin", options.origin ?? "https://studio.sermonclip.example");
  }
  if (options.cookie !== null) {
    headers.set(
      "Cookie",
      options.cookie
        ?? `${SESSION_COOKIE_NAME}=scs_secure_account_session_token`,
    );
  }
  return new Request(
    "https://studio.sermonclip.example/api/settings/account/profile",
    { method: "POST", headers },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePersistedTenantCapability.mockResolvedValue(undefined);
  resolveSession.mockResolvedValue({
    sessionId: "session_current",
    userId: "user_one",
    organizationId: "org_one",
    campusId: "campus_one",
  });
});

describe("account route security", () => {
  it("requires a same-origin mutation before doing authorization work", async () => {
    const crossOrigin = await requireAccountRouteContext(request({
      origin: "https://malicious.example",
    }));
    const noOrigin = await requireAccountRouteContext(request({ origin: null }));

    expect(crossOrigin.error?.status).toBe(403);
    expect(noOrigin.error?.status).toBe(403);
    expect(requirePersistedTenantCapability).not.toHaveBeenCalled();
  });

  it("requires a secure session instead of legacy request authentication", async () => {
    const result = await requireAccountRouteContext(request({
      authentication: "legacy-basic",
    }));

    expect(result.error?.status).toBe(401);
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it("binds the database session to the exact trusted actor and tenant", async () => {
    const accepted = await requireAccountRouteContext(request());
    expect(accepted.context).toEqual({
      actorUserId: "user_one",
      organizationId: "org_one",
      campusId: "campus_one",
      currentSessionId: "session_current",
      requestId: null,
    });
    expect(requirePersistedTenantCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user_one",
        organizationId: "org_one",
      }),
      "organization.read",
    );

    resolveSession.mockResolvedValueOnce({
      sessionId: "session_attacker",
      userId: "user_other",
      organizationId: "org_one",
      campusId: "campus_one",
    });
    const rejected = await requireAccountRouteContext(request());
    expect(rejected.error?.status).toBe(401);
  });

  it("marks every sensitive JSON response private and non-cacheable", () => {
    const response = accountJson({ success: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("parses only the exact secure cookie name", () => {
    const req = request({
      cookie: `decoy=one; ${SESSION_COOKIE_NAME}=scs_exact%5Ftoken; other=two`,
    });
    expect(
      __accountRouteSecurityTestUtils.cookieValue(req, SESSION_COOKIE_NAME),
    ).toBe("scs_exact_token");
  });
});
