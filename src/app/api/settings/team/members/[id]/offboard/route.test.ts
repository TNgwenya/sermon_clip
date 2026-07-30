import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePersistedTenantCapability = vi.hoisted(() => vi.fn());
const offboardOrganizationMember = vi.hoisted(() => vi.fn());

vi.mock("@/server/auth/requestAuthorization", () => ({
  requirePersistedTenantCapability,
}));
vi.mock("@/server/organizations/trustService", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/organizations/trustService")
  >();
  return {
    ...actual,
    offboardOrganizationMember,
  };
});

import { OrganizationTrustError } from "@/server/organizations/trustService";
import { POST } from "./route";

function trustedRequest(body: unknown): Request {
  return new Request(
    "https://studio.sermonclip.example/api/settings/team/members/member_other/offboard",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sermonclip-organization-id": "org_one",
        "x-sermonclip-campus-id": "campus_one",
        "x-sermonclip-actor-id": "user_admin",
        "x-sermonclip-authentication": "session",
      },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePersistedTenantCapability.mockResolvedValue(undefined);
  offboardOrganizationMember.mockResolvedValue({
    membershipId: "membership_one",
    reassignedMembershipId: "membership_replacement",
  });
});

describe("team offboarding API", () => {
  it("passes tenant and reassignment context to the atomic trust workflow", async () => {
    const response = await POST(
      trustedRequest({ reassignRoleToUserId: "user_replacement" }),
      { params: Promise.resolve({ id: "membership_one" }) },
    );

    expect(response.status).toBe(200);
    expect(offboardOrganizationMember).toHaveBeenCalledWith(
      {
        organizationId: "org_one",
        campusId: "campus_one",
        actorUserId: "user_admin",
        requestId: null,
      },
      {
        membershipId: "membership_one",
        reassignRoleToUserId: "user_replacement",
      },
    );
  });

  it("uses a generic response for a membership outside the tenant", async () => {
    offboardOrganizationMember.mockRejectedValue(
      new OrganizationTrustError(
        "MEMBERSHIP_UNAVAILABLE",
        "The active membership was not found in this organization.",
      ),
    );

    const response = await POST(
      trustedRequest({}),
      { params: Promise.resolve({ id: "membership_other_tenant" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "The requested team record is unavailable.",
    });
  });
});
