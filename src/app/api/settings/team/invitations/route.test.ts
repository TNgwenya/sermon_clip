import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requirePersistedTenantCapability = vi.hoisted(() => vi.fn());
const issueOrganizationInvitation = vi.hoisted(() => vi.fn());

vi.mock("@/server/auth/requestAuthorization", () => ({
  requirePersistedTenantCapability,
}));
vi.mock("@/server/organizations/trustService", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/organizations/trustService")
  >();
  return {
    ...actual,
    issueOrganizationInvitation,
  };
});

import { AuthorizationError } from "@/server/auth/authorization";
import { POST } from "./route";

const trustedHeaders = {
  "x-sermonclip-organization-id": "org_one",
  "x-sermonclip-campus-id": "campus_one",
  "x-sermonclip-actor-id": "user_admin",
  "x-sermonclip-authentication": "session",
};

function invitationRequest(
  body: unknown,
  headers: HeadersInit = trustedHeaders,
): Request {
  return new Request("https://studio.sermonclip.example/api/settings/team/invitations", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://studio.sermonclip.example");
  requirePersistedTenantCapability.mockResolvedValue(undefined);
  issueOrganizationInvitation.mockResolvedValue({
    invitationId: "invitation_one",
    token: "sc_invite_super-secret-token",
    expiresAt: new Date("2026-08-05T00:00:00.000Z"),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("team invitation API", () => {
  it("returns the acceptance URL once without a separate secret field", async () => {
    const response = await POST(invitationRequest({
      email: "editor@church.example",
      role: "EDITOR",
      campusId: "campus_one",
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toEqual({
      success: true,
      invitation: {
        invitationId: "invitation_one",
        expiresAt: "2026-08-05T00:00:00.000Z",
        acceptUrl:
          "https://studio.sermonclip.example/accept-invitation?token=sc_invite_super-secret-token",
      },
    });
    expect(body.invitation).not.toHaveProperty("token");
    expect(requirePersistedTenantCapability).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: "org_one",
        campusId: "campus_one",
        actorId: "user_admin",
      }),
      "invitations.manage",
      { campusId: "campus_one" },
    );
    expect(issueOrganizationInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_one",
        campusId: "campus_one",
        actorUserId: "user_admin",
      }),
      {
        email: "editor@church.example",
        role: "EDITOR",
        campusId: "campus_one",
      },
    );
  });

  it("does not call the trust service without trusted request context", async () => {
    const response = await POST(invitationRequest(
      {
        email: "editor@church.example",
        role: "EDITOR",
      },
      {},
    ));

    expect(response.status).toBe(401);
    expect(issueOrganizationInvitation).not.toHaveBeenCalled();
  });

  it("does not reveal whether a denied campus or invitation exists", async () => {
    requirePersistedTenantCapability.mockRejectedValue(
      new AuthorizationError("SCOPE_MISMATCH"),
    );

    const response = await POST(invitationRequest({
      email: "editor@other.example",
      role: "EDITOR",
      campusId: "campus_other",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "You do not have permission to manage this team.",
    });
    expect(issueOrganizationInvitation).not.toHaveBeenCalled();
  });
});
