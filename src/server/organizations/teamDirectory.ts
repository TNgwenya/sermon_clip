import type { MembershipRole, MembershipStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type TeamDirectoryScope = Readonly<{
  organizationId: string;
  campusId: string | null;
}>;

export type TeamDirectoryMember = Readonly<{
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  role: MembershipRole;
  status: MembershipStatus;
  campusId: string | null;
  campusName: string | null;
  joinedAt: string | null;
  expiresAt: string | null;
}>;

export type TeamDirectoryInvitation = Readonly<{
  invitationId: string;
  email: string;
  role: MembershipRole;
  campusId: string | null;
  campusName: string | null;
  expiresAt: string;
  createdAt: string;
}>;

export type TeamDirectoryCampus = Readonly<{
  id: string;
  name: string;
}>;

export type TeamDirectory = Readonly<{
  organization: {
    id: string;
    name: string;
  };
  members: readonly TeamDirectoryMember[];
  pendingInvitations: readonly TeamDirectoryInvitation[];
  campuses: readonly TeamDirectoryCampus[];
}>;

function campusWhere(campusId: string | null): { campusId?: string } {
  return campusId === null ? {} : { campusId };
}

/**
 * Lists only the selected organization and, when present, its selected campus.
 * Invitation secrets are intentionally absent from every select and return type.
 */
export async function listOrganizationTeamDirectory(
  scope: TeamDirectoryScope,
  options: Readonly<{ includeInvitations: boolean }>,
): Promise<TeamDirectory> {
  const scopedCampusWhere = campusWhere(scope.campusId);
  const [organization, members, invitations, campuses] = await Promise.all([
    prisma.organization.findFirst({
      where: {
        id: scope.organizationId,
        status: "ACTIVE",
      },
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.membership.findMany({
      where: {
        organizationId: scope.organizationId,
        ...scopedCampusWhere,
        status: { in: ["ACTIVE", "SUSPENDED"] },
      },
      select: {
        id: true,
        userId: true,
        role: true,
        status: true,
        campusId: true,
        joinedAt: true,
        expiresAt: true,
        campus: {
          select: { name: true },
        },
        user: {
          select: {
            email: true,
            profile: {
              select: { displayName: true },
            },
          },
        },
      },
      orderBy: [
        { role: "asc" },
        { user: { email: "asc" } },
      ],
    }),
    options.includeInvitations
      ? prisma.invitation.findMany({
          where: {
            organizationId: scope.organizationId,
            ...scopedCampusWhere,
            status: "PENDING",
            expiresAt: { gt: new Date() },
          },
          select: {
            id: true,
            email: true,
            role: true,
            campusId: true,
            expiresAt: true,
            createdAt: true,
            campus: {
              select: { name: true },
            },
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    prisma.campus.findMany({
      where: {
        organizationId: scope.organizationId,
        status: "ACTIVE",
        ...(scope.campusId === null ? {} : { id: scope.campusId }),
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!organization) {
    throw new Error("The team workspace is unavailable.");
  }

  return {
    organization,
    members: members.map((membership) => ({
      membershipId: membership.id,
      userId: membership.userId,
      email: membership.user.email,
      displayName: membership.user.profile?.displayName || membership.user.email,
      role: membership.role,
      status: membership.status,
      campusId: membership.campusId,
      campusName: membership.campus?.name ?? null,
      joinedAt: membership.joinedAt?.toISOString() ?? null,
      expiresAt: membership.expiresAt?.toISOString() ?? null,
    })),
    pendingInvitations: invitations.map((invitation) => ({
      invitationId: invitation.id,
      email: invitation.email,
      role: invitation.role,
      campusId: invitation.campusId,
      campusName: invitation.campus?.name ?? null,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    })),
    campuses,
  };
}
