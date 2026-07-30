import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  acceptOrganizationInvitation,
  acceptOwnershipTransfer,
  cancelOwnershipTransfer,
  initiateOwnershipTransfer,
  issueOrganizationInvitation,
  offboardOrganizationMember,
  OrganizationTrustError,
  revokeOrganizationInvitation,
} from "@/server/organizations/trustService";
import { hashTrustToken } from "@/server/trust/tokens";

const FIXED_INVITE_TOKEN = `sc_invite_${"A".repeat(43)}`;
const FIXED_TRANSFER_TOKEN = `sc_transfer_${"B".repeat(43)}`;
const NOW = new Date("2026-07-29T12:00:00.000Z");

type TestTenant = {
  organizationId: string;
  campusAId: string;
  campusBId: string;
  ownerUserId: string;
  targetUserId: string;
  replacementUserId: string;
  targetEmail: string;
};

let tenant: TestTenant;
const cleanupOrganizationIds: string[] = [];
const cleanupUserIds: string[] = [];

function unique(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

async function expectTrustCode(
  operation: Promise<unknown>,
  code: OrganizationTrustError["code"],
): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    name: "OrganizationTrustError",
    code,
  });
}

beforeEach(async () => {
  const organizationId = unique("org_trust");
  const campusAId = unique("campus_a");
  const campusBId = unique("campus_b");
  const ownerUserId = unique("user_owner");
  const targetUserId = unique("user_target");
  const replacementUserId = unique("user_replacement");
  const targetEmail = `${targetUserId}@example.test`;

  cleanupOrganizationIds.push(organizationId);
  cleanupUserIds.push(ownerUserId, targetUserId, replacementUserId);

  await prisma.organization.create({
    data: {
      id: organizationId,
      slug: unique("trust-slug"),
      name: "Trust Service Test Church",
      campuses: {
        create: [
          { id: campusAId, slug: "north", name: "North Campus" },
          { id: campusBId, slug: "south", name: "South Campus" },
        ],
      },
    },
  });
  await prisma.user.createMany({
    data: [
      {
        id: ownerUserId,
        email: `${ownerUserId}@example.test`,
        normalizedEmail: `${ownerUserId}@example.test`,
        status: "ACTIVE",
      },
      {
        id: targetUserId,
        email: targetEmail,
        normalizedEmail: targetEmail,
        status: "INVITED",
      },
      {
        id: replacementUserId,
        email: `${replacementUserId}@example.test`,
        normalizedEmail: `${replacementUserId}@example.test`,
        status: "ACTIVE",
      },
    ],
  });
  await prisma.membership.create({
    data: {
      organizationId,
      campusId: null,
      userId: ownerUserId,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: NOW,
    },
  });

  tenant = {
    organizationId,
    campusAId,
    campusBId,
    ownerUserId,
    targetUserId,
    replacementUserId,
    targetEmail,
  };
});

afterEach(async () => {
  while (cleanupOrganizationIds.length > 0) {
    const organizationId = cleanupOrganizationIds.pop();
    if (!organizationId) {
      continue;
    }
    await prisma.auditEvent.deleteMany({ where: { organizationId } });
    await prisma.ownershipTransfer.deleteMany({ where: { organizationId } });
    await prisma.invitation.deleteMany({ where: { organizationId } });
    await prisma.membership.deleteMany({ where: { organizationId } });
    await prisma.campus.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  }
  while (cleanupUserIds.length > 0) {
    const userId = cleanupUserIds.pop();
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  }
});

describe("organization invitation lifecycle", () => {
  it("persists only a token digest and accepts exactly once with membership and audit", async () => {
    const issued = await issueOrganizationInvitation(
      {
        organizationId: tenant.organizationId,
        campusId: tenant.campusAId,
        actorUserId: tenant.ownerUserId,
        requestId: "request-invite",
      },
      {
        email: `  ${tenant.targetEmail.toUpperCase()} `,
        role: "EDITOR",
        campusId: tenant.campusAId,
      },
      {
        now: NOW,
        tokenFactory: () => FIXED_INVITE_TOKEN,
      },
    );

    expect(issued.token).toBe(FIXED_INVITE_TOKEN);
    await expect(prisma.invitation.findUniqueOrThrow({
      where: { id: issued.invitationId },
      select: {
        tokenHash: true,
        normalizedEmail: true,
        status: true,
      },
    })).resolves.toEqual({
      tokenHash: hashTrustToken(FIXED_INVITE_TOKEN),
      normalizedEmail: tenant.targetEmail,
      status: "PENDING",
    });

    const accepted = await acceptOrganizationInvitation(
      {
        organizationId: tenant.organizationId,
        campusId: tenant.campusAId,
        actorUserId: tenant.targetUserId,
        token: issued.token,
        requestId: "request-accept",
      },
      { now: new Date(NOW.getTime() + 1_000) },
    );
    expect(accepted).toMatchObject({
      invitationId: issued.invitationId,
      role: "EDITOR",
    });
    await expect(prisma.membership.findUniqueOrThrow({
      where: { id: accepted.membershipId },
      select: {
        organizationId: true,
        campusId: true,
        userId: true,
        role: true,
        status: true,
      },
    })).resolves.toEqual({
      organizationId: tenant.organizationId,
      campusId: tenant.campusAId,
      userId: tenant.targetUserId,
      role: "EDITOR",
      status: "ACTIVE",
    });
    await expect(prisma.auditEvent.findMany({
      where: {
        organizationId: tenant.organizationId,
        targetId: issued.invitationId,
      },
      orderBy: { occurredAt: "asc" },
      select: { action: true, actorUserId: true },
    })).resolves.toEqual([
      { action: "invitation.issued", actorUserId: tenant.ownerUserId },
      { action: "invitation.accepted", actorUserId: tenant.targetUserId },
    ]);

    await expectTrustCode(
      acceptOrganizationInvitation(
        {
          organizationId: tenant.organizationId,
          campusId: tenant.campusAId,
          actorUserId: tenant.targetUserId,
          token: issued.token,
        },
        { now: new Date(NOW.getTime() + 2_000) },
      ),
      "INVITATION_INVALID",
    );
  });

  it("binds acceptance to the intended organization, campus, and email identity", async () => {
    const issued = await issueOrganizationInvitation(
      {
        organizationId: tenant.organizationId,
        campusId: tenant.campusAId,
        actorUserId: tenant.ownerUserId,
      },
      {
        email: tenant.targetEmail,
        role: "EDITOR",
        campusId: tenant.campusAId,
      },
      {
        now: NOW,
        tokenFactory: () => FIXED_INVITE_TOKEN,
      },
    );

    await expectTrustCode(
      acceptOrganizationInvitation(
        {
          organizationId: tenant.organizationId,
          campusId: tenant.campusBId,
          actorUserId: tenant.targetUserId,
          token: issued.token,
        },
        { now: new Date(NOW.getTime() + 1_000) },
      ),
      "INVITATION_INVALID",
    );
    await prisma.user.update({
      where: { id: tenant.targetUserId },
      data: { normalizedEmail: "different@example.test", email: "different@example.test" },
    });
    await expectTrustCode(
      acceptOrganizationInvitation(
        {
          organizationId: tenant.organizationId,
          campusId: tenant.campusAId,
          actorUserId: tenant.targetUserId,
          token: issued.token,
        },
        { now: new Date(NOW.getTime() + 1_000) },
      ),
      "USER_UNAVAILABLE",
    );
    await expect(prisma.invitation.findUniqueOrThrow({
      where: { id: issued.invitationId },
      select: { status: true },
    })).resolves.toEqual({ status: "PENDING" });
  });

  it("records expiration while refusing a stale invitation", async () => {
    const issued = await issueOrganizationInvitation(
      {
        organizationId: tenant.organizationId,
        campusId: null,
        actorUserId: tenant.ownerUserId,
      },
      {
        email: tenant.targetEmail,
        role: "VIEWER",
        campusId: null,
        expiresAt: new Date(NOW.getTime() + 60_000),
      },
      {
        now: NOW,
        tokenFactory: () => FIXED_INVITE_TOKEN,
      },
    );

    await expectTrustCode(
      acceptOrganizationInvitation(
        {
          organizationId: tenant.organizationId,
          campusId: null,
          actorUserId: tenant.targetUserId,
          token: issued.token,
        },
        { now: new Date(NOW.getTime() + 60_001) },
      ),
      "INVITATION_EXPIRED",
    );
    await expect(prisma.invitation.findUniqueOrThrow({
      where: { id: issued.invitationId },
      select: { status: true, acceptedAt: true },
    })).resolves.toEqual({ status: "EXPIRED", acceptedAt: null });
    await expect(prisma.auditEvent.count({
      where: {
        organizationId: tenant.organizationId,
        action: "invitation.expired",
        targetId: issued.invitationId,
      },
    })).resolves.toBe(1);
  });

  it("revokes a pending invitation in scope and prevents later acceptance", async () => {
    const issued = await issueOrganizationInvitation(
      {
        organizationId: tenant.organizationId,
        campusId: tenant.campusAId,
        actorUserId: tenant.ownerUserId,
      },
      {
        email: tenant.targetEmail,
        role: "EDITOR",
        campusId: tenant.campusAId,
      },
      {
        now: NOW,
        tokenFactory: () => FIXED_INVITE_TOKEN,
      },
    );

    await revokeOrganizationInvitation(
      {
        organizationId: tenant.organizationId,
        campusId: tenant.campusAId,
        actorUserId: tenant.ownerUserId,
      },
      issued.invitationId,
      { now: new Date(NOW.getTime() + 1_000) },
    );

    await expect(prisma.invitation.findUniqueOrThrow({
      where: { id: issued.invitationId },
      select: { status: true, revokedAt: true },
    })).resolves.toEqual({
      status: "REVOKED",
      revokedAt: new Date(NOW.getTime() + 1_000),
    });
    await expectTrustCode(
      acceptOrganizationInvitation(
        {
          organizationId: tenant.organizationId,
          campusId: tenant.campusAId,
          actorUserId: tenant.targetUserId,
          token: issued.token,
        },
        { now: new Date(NOW.getTime() + 2_000) },
      ),
      "INVITATION_INVALID",
    );
  });
});

describe("member offboarding", () => {
  it("atomically reassigns the scoped role, revokes access and pending invitations, and audits both", async () => {
    await prisma.user.update({
      where: { id: tenant.targetUserId },
      data: { status: "ACTIVE" },
    });
    const [
      targetMembership,
      ,
      sameCampusInvitation,
      otherCampusInvitation,
    ] = await Promise.all([
      prisma.membership.create({
        data: {
          organizationId: tenant.organizationId,
          campusId: tenant.campusAId,
          userId: tenant.targetUserId,
          role: "EDITOR",
          status: "ACTIVE",
          joinedAt: NOW,
        },
      }),
      prisma.membership.create({
        data: {
          organizationId: tenant.organizationId,
          campusId: null,
          userId: tenant.replacementUserId,
          role: "VIEWER",
          status: "ACTIVE",
          joinedAt: NOW,
        },
      }),
      prisma.invitation.create({
        data: {
          organizationId: tenant.organizationId,
          campusId: tenant.campusAId,
          email: tenant.targetEmail,
          normalizedEmail: tenant.targetEmail,
          role: "VIEWER",
          tokenHash: hashTrustToken(`sc_invite_${"C".repeat(43)}`),
          invitedByUserId: tenant.ownerUserId,
          expiresAt: new Date(NOW.getTime() + 60_000),
        },
      }),
      prisma.invitation.create({
        data: {
          organizationId: tenant.organizationId,
          campusId: tenant.campusBId,
          email: tenant.targetEmail,
          normalizedEmail: tenant.targetEmail,
          role: "VIEWER",
          tokenHash: hashTrustToken(`sc_invite_${"D".repeat(43)}`),
          invitedByUserId: tenant.ownerUserId,
          expiresAt: new Date(NOW.getTime() + 60_000),
        },
      }),
    ]);

    const result = await offboardOrganizationMember(
      {
        organizationId: tenant.organizationId,
        campusId: tenant.campusAId,
        actorUserId: tenant.ownerUserId,
      },
      {
        membershipId: targetMembership.id,
        reassignRoleToUserId: tenant.replacementUserId,
      },
      { now: NOW },
    );

    expect(result.reassignedMembershipId).toBeTruthy();
    await expect(prisma.membership.findUniqueOrThrow({
      where: { id: targetMembership.id },
      select: { status: true, expiresAt: true },
    })).resolves.toEqual({ status: "REVOKED", expiresAt: NOW });
    await expect(prisma.membership.findUniqueOrThrow({
      where: { id: result.reassignedMembershipId! },
      select: {
        organizationId: true,
        campusId: true,
        userId: true,
        role: true,
        status: true,
      },
    })).resolves.toEqual({
      organizationId: tenant.organizationId,
      campusId: tenant.campusAId,
      userId: tenant.replacementUserId,
      role: "EDITOR",
      status: "ACTIVE",
    });
    await expect(prisma.invitation.findMany({
      where: {
        id: { in: [sameCampusInvitation.id, otherCampusInvitation.id] },
      },
      orderBy: { id: "asc" },
      select: { id: true, status: true },
    })).resolves.toEqual([
      { id: sameCampusInvitation.id, status: "REVOKED" },
      { id: otherCampusInvitation.id, status: "PENDING" },
    ].sort((left, right) => left.id.localeCompare(right.id)));
    await expect(prisma.auditEvent.findMany({
      where: {
        organizationId: tenant.organizationId,
        targetId: targetMembership.id,
      },
      select: { action: true },
      orderBy: { occurredAt: "asc" },
    })).resolves.toEqual([
      { action: "membership.responsibility_reassigned" },
      { action: "membership.offboarded" },
    ]);
  });

  it("protects owners and denies a campus administrator outside their campus", async () => {
    const secondOwnerId = unique("user_second_owner");
    const campusAdminId = unique("user_campus_admin");
    cleanupUserIds.push(secondOwnerId, campusAdminId);
    await prisma.user.createMany({
      data: [
        {
          id: secondOwnerId,
          email: `${secondOwnerId}@example.test`,
          normalizedEmail: `${secondOwnerId}@example.test`,
          status: "ACTIVE",
        },
        {
          id: campusAdminId,
          email: `${campusAdminId}@example.test`,
          normalizedEmail: `${campusAdminId}@example.test`,
          status: "ACTIVE",
        },
      ],
    });
    const secondOwner = await prisma.membership.create({
      data: {
        organizationId: tenant.organizationId,
        campusId: null,
        userId: secondOwnerId,
        role: "OWNER",
        status: "ACTIVE",
      },
    });
    const campusTarget = await prisma.membership.create({
      data: {
        organizationId: tenant.organizationId,
        campusId: tenant.campusBId,
        userId: tenant.targetUserId,
        role: "EDITOR",
        status: "ACTIVE",
      },
    });
    await prisma.membership.create({
      data: {
        organizationId: tenant.organizationId,
        campusId: tenant.campusAId,
        userId: campusAdminId,
        role: "CAMPUS_ADMIN",
        status: "ACTIVE",
      },
    });

    await expectTrustCode(
      offboardOrganizationMember(
        {
          organizationId: tenant.organizationId,
          campusId: null,
          actorUserId: tenant.ownerUserId,
        },
        { membershipId: secondOwner.id },
        { now: NOW },
      ),
      "MEMBERSHIP_PROTECTED",
    );
    await expectTrustCode(
      offboardOrganizationMember(
        {
          organizationId: tenant.organizationId,
          campusId: tenant.campusAId,
          actorUserId: campusAdminId,
        },
        { membershipId: campusTarget.id },
        { now: NOW },
      ),
      "NOT_AUTHORIZED",
    );
  });
});

describe("ownership transfer", () => {
  it("uses a one-time hashed secret and atomically promotes and demotes the two members", async () => {
    await prisma.user.update({
      where: { id: tenant.targetUserId },
      data: { status: "ACTIVE" },
    });
    await prisma.membership.create({
      data: {
        organizationId: tenant.organizationId,
        campusId: null,
        userId: tenant.targetUserId,
        role: "ORG_ADMIN",
        status: "ACTIVE",
      },
    });

    const initiated = await initiateOwnershipTransfer(
      {
        organizationId: tenant.organizationId,
        campusId: tenant.campusAId,
        actorUserId: tenant.ownerUserId,
        requestId: "request-transfer",
      },
      {
        toUserId: tenant.targetUserId,
        reason: "Planned leadership transition",
      },
      {
        now: NOW,
        tokenFactory: () => FIXED_TRANSFER_TOKEN,
      },
    );
    await expect(prisma.ownershipTransfer.findUniqueOrThrow({
      where: { id: initiated.transferId },
      select: { tokenHash: true, status: true },
    })).resolves.toEqual({
      tokenHash: hashTrustToken(FIXED_TRANSFER_TOKEN),
      status: "PENDING",
    });

    const accepted = await acceptOwnershipTransfer(
      {
        organizationId: tenant.organizationId,
        actorUserId: tenant.targetUserId,
        token: initiated.token,
      },
      { now: new Date(NOW.getTime() + 1_000) },
    );
    expect(accepted).toEqual({
      transferId: initiated.transferId,
      previousOwnerUserId: tenant.ownerUserId,
      ownerUserId: tenant.targetUserId,
    });
    await expect(prisma.membership.findMany({
      where: {
        organizationId: tenant.organizationId,
        campusId: null,
        userId: { in: [tenant.ownerUserId, tenant.targetUserId] },
      },
      orderBy: { userId: "asc" },
      select: { userId: true, role: true, status: true },
    })).resolves.toEqual([
      {
        userId: tenant.ownerUserId,
        role: "ORG_ADMIN",
        status: "ACTIVE",
      },
      {
        userId: tenant.targetUserId,
        role: "OWNER",
        status: "ACTIVE",
      },
    ].sort((left, right) => left.userId.localeCompare(right.userId)));
    await expect(prisma.auditEvent.findMany({
      where: {
        organizationId: tenant.organizationId,
        targetId: initiated.transferId,
      },
      select: { action: true, actorUserId: true },
      orderBy: { occurredAt: "asc" },
    })).resolves.toEqual([
      {
        action: "ownership_transfer.initiated",
        actorUserId: tenant.ownerUserId,
      },
      {
        action: "ownership_transfer.accepted",
        actorUserId: tenant.targetUserId,
      },
    ]);

    await expectTrustCode(
      acceptOwnershipTransfer(
        {
          organizationId: tenant.organizationId,
          actorUserId: tenant.targetUserId,
          token: initiated.token,
        },
        { now: new Date(NOW.getTime() + 2_000) },
      ),
      "TRANSFER_INVALID",
    );
  });

  it("lets the initiating owner cancel a pending transfer and invalidates its secret", async () => {
    await prisma.user.update({
      where: { id: tenant.targetUserId },
      data: { status: "ACTIVE" },
    });
    await prisma.membership.create({
      data: {
        organizationId: tenant.organizationId,
        campusId: null,
        userId: tenant.targetUserId,
        role: "ORG_ADMIN",
        status: "ACTIVE",
      },
    });
    const initiated = await initiateOwnershipTransfer(
      {
        organizationId: tenant.organizationId,
        campusId: null,
        actorUserId: tenant.ownerUserId,
      },
      { toUserId: tenant.targetUserId },
      {
        now: NOW,
        tokenFactory: () => FIXED_TRANSFER_TOKEN,
      },
    );

    await cancelOwnershipTransfer(
      {
        organizationId: tenant.organizationId,
        campusId: null,
        actorUserId: tenant.ownerUserId,
      },
      initiated.transferId,
      { now: new Date(NOW.getTime() + 1_000) },
    );

    await expect(prisma.ownershipTransfer.findUniqueOrThrow({
      where: { id: initiated.transferId },
      select: { status: true, cancelledAt: true },
    })).resolves.toEqual({
      status: "CANCELLED",
      cancelledAt: new Date(NOW.getTime() + 1_000),
    });
    await expectTrustCode(
      acceptOwnershipTransfer(
        {
          organizationId: tenant.organizationId,
          actorUserId: tenant.targetUserId,
          token: initiated.token,
        },
        { now: new Date(NOW.getTime() + 2_000) },
      ),
      "TRANSFER_INVALID",
    );
  });
});
