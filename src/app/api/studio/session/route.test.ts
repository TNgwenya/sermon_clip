import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ resolveSession: vi.fn(), headers: new Headers() }));
vi.mock("@/server/auth/prismaSessionRepository", () => ({
  getPrismaSessionService: () => ({ resolveSession: fixture.resolveSession }),
}));
vi.mock("next/headers", () => ({ headers: async () => fixture.headers }));

import { proxy } from "@/proxy";
import { GET } from "./route";
import { SERMONCLIP_ACTOR_HEADER, SERMONCLIP_ORGANIZATION_HEADER } from "@/lib/tenancy/requestHeaders";

describe("Studio session endpoint authentication", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_TOKEN_PEPPER", "test-session-token-pepper-with-32-plus-characters");
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "");
    fixture.resolveSession.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("does not expose identity to a signed-out request or trust forged headers", async () => {
    const response = await proxy(new NextRequest("https://church.example/api/studio/session", {
      headers: { [SERMONCLIP_ACTOR_HEADER]: "forged-actor", [SERMONCLIP_ORGANIZATION_HEADER]: "forged-church" },
    }));
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: "authentication_required" });
  });

  it("rejects an expired session", async () => {
    fixture.resolveSession.mockRejectedValue(new Error("expired"));
    const response = await proxy(new NextRequest("https://church.example/api/studio/session", {
      headers: { cookie: "__Host-sermonclip_session=scs_expired" },
    }));
    expect(response.status).toBe(401);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it("returns only verified actor and church identity without caching", async () => {
    fixture.resolveSession.mockResolvedValue({
      sessionId: "session-one", userId: "user-one", organizationId: "church-one", campusId: null,
      expiresAt: new Date("2030-01-01"),
    });
    const response = await proxy(new NextRequest("https://church.example/api/studio/session", {
      headers: { cookie: "__Host-sermonclip_session=scs_valid", [SERMONCLIP_ACTOR_HEADER]: "forged" },
    }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    fixture.headers = new Headers();
    response.headers.forEach((value, key) => {
      if (key.startsWith("x-middleware-request-")) fixture.headers.set(key.slice("x-middleware-request-".length), value);
    });
    const result = await GET();
    expect(await result.json()).toEqual({ actorId: "user-one", organizationId: "church-one" });
    expect(result.headers.get("cache-control")).toBe("no-store");
  });
});
