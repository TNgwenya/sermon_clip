import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  organization: {
    findFirst: vi.fn(),
  },
  membership: {
    findMany: vi.fn(),
  },
  invitation: {
    findMany: vi.fn(),
  },
  campus: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { listOrganizationTeamDirectory } from "./teamDirectory";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.organization.findFirst.mockResolvedValue({
    id: "org_one",
    name: "Grace Church",
  });
  prismaMock.membership.findMany.mockResolvedValue([{
    id: "membership_one",
    userId: "user_one",
    role: "CONTENT_LEAD",
    status: "ACTIVE",
    campusId: "campus_one",
    joinedAt: new Date("2026-07-01T00:00:00.000Z"),
    expiresAt: null,
    campus: { name: "Central" },
    user: {
      email: "lead@grace.example",
      profile: { displayName: "Content Lead" },
    },
  }]);
  prismaMock.invitation.findMany.mockResolvedValue([{
    id: "invitation_one",
    email: "editor@grace.example",
    role: "EDITOR",
    campusId: "campus_one",
    expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-07-25T00:00:00.000Z"),
    campus: { name: "Central" },
  }]);
  prismaMock.campus.findMany.mockResolvedValue([{
    id: "campus_one",
    name: "Central",
  }]);
});

describe("team directory", () => {
  it("applies the exact organization and campus to every scoped query", async () => {
    const directory = await listOrganizationTeamDirectory(
      { organizationId: "org_one", campusId: "campus_one" },
      { includeInvitations: true },
    );

    expect(prismaMock.organization.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org_one", status: "ACTIVE" },
      }),
    );
    expect(prismaMock.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org_one",
          campusId: "campus_one",
        }),
      }),
    );
    expect(prismaMock.invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org_one",
          campusId: "campus_one",
          status: "PENDING",
        }),
        select: expect.not.objectContaining({
          tokenHash: expect.anything(),
        }),
      }),
    );
    expect(prismaMock.campus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org_one",
          id: "campus_one",
        }),
      }),
    );
    expect(directory.members[0]).toMatchObject({
      membershipId: "membership_one",
      displayName: "Content Lead",
      campusName: "Central",
    });
    expect(JSON.stringify(directory)).not.toContain("token");
  });

  it("does not query or return invitations for read-only members", async () => {
    const directory = await listOrganizationTeamDirectory(
      { organizationId: "org_one", campusId: null },
      { includeInvitations: false },
    );

    expect(prismaMock.invitation.findMany).not.toHaveBeenCalled();
    expect(directory.pendingInvitations).toEqual([]);
    expect(prismaMock.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ campusId: expect.anything() }),
      }),
    );
  });
});
