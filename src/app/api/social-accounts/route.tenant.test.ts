import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRequestCapability: vi.fn(),
  listSocialAccounts: vi.fn(),
  createSocialAccount: vi.fn(),
}));

vi.mock("@/server/auth/requestAuthorization", () => ({
  requireRequestCapability: mocks.requireRequestCapability,
}));
vi.mock("@/lib/socialAccounts", () => ({
  listSocialAccounts: mocks.listSocialAccounts,
  createSocialAccount: mocks.createSocialAccount,
  normalizeSocialPlatform: (value: unknown) => (
    value === "Facebook" ? "Facebook" : null
  ),
}));

import { GET, POST } from "@/app/api/social-accounts/route";

const context = {
  organizationId: "org-church-1",
  campusId: "campus-main",
  actorId: "user-publisher-1",
  authenticationMethod: "session",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRequestCapability.mockResolvedValue(context);
  mocks.listSocialAccounts.mockResolvedValue([]);
  mocks.createSocialAccount.mockResolvedValue({
    id: "account-1",
    platform: "Facebook",
    label: "Church Facebook",
  });
});

describe("social account tenant routes", () => {
  it("lists only the trusted tenant's accounts", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.requireRequestCapability).toHaveBeenCalledWith("channels.read");
    expect(mocks.listSocialAccounts).toHaveBeenCalledWith({
      organizationId: context.organizationId,
      campusId: context.campusId,
    });
  });

  it("attributes new account placeholders to the trusted tenant", async () => {
    const response = await POST(new Request("https://church.example/api/social-accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        platform: "Facebook",
        label: "Church Facebook",
        handle: "@church",
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.requireRequestCapability).toHaveBeenCalledWith("channels.manage");
    expect(mocks.createSocialAccount).toHaveBeenCalledWith({
      tenantScope: {
        organizationId: context.organizationId,
        campusId: context.campusId,
      },
      platform: "Facebook",
      label: "Church Facebook",
      handle: "@church",
    });
  });
});
