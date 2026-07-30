import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAccountRouteContext = vi.hoisted(() => vi.fn());
const updateOwnProfile = vi.hoisted(() => vi.fn());

vi.mock("../_security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_security")>();
  return { ...actual, requireAccountRouteContext };
});
vi.mock("@/server/auth/accountSecurity", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/auth/accountSecurity")
  >();
  return { ...actual, updateOwnProfile };
});

import { POST } from "./route";

const context = {
  actorUserId: "user_one",
  organizationId: "org_one",
  campusId: "campus_one",
  currentSessionId: "session_one",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAccountRouteContext.mockResolvedValue({ context });
  updateOwnProfile.mockResolvedValue({
    email: "pastor@example.org",
    displayName: "Pastor Grace",
    firstName: "Grace",
    lastName: "",
    jobTitle: "",
    phone: "",
    timezone: "Africa/Johannesburg",
  });
});

describe("account profile route", () => {
  it("uses only the authenticated account context and ignores identity fields", async () => {
    const response = await POST(new Request(
      "https://studio.sermonclip.example/api/settings/account/profile",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorUserId: "user_attacker",
          organizationId: "org_attacker",
          displayName: "Pastor Grace",
          timezone: "Africa/Johannesburg",
        }),
      },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(updateOwnProfile).toHaveBeenCalledWith(context, {
      displayName: "Pastor Grace",
      firstName: null,
      lastName: null,
      jobTitle: null,
      phone: null,
      timezone: "Africa/Johannesburg",
    });
  });
});
