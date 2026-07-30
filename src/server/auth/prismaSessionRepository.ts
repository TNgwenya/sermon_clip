import { prisma } from "@/lib/prisma";
import {
  createSessionService,
  type SessionRepository,
  type StoredSessionPrincipal,
} from "@/server/auth/sessionService";

function activeMembershipStatus(
  memberships: ReadonlyArray<{
    campusId: string | null;
    status: string;
    expiresAt: Date | null;
  }>,
  campusId: string | null,
  now: Date,
): string {
  const membership = memberships.find(
    (candidate) => candidate.campusId === campusId,
  ) ?? memberships.find((candidate) => candidate.campusId === null);
  if (
    !membership
    || membership.status !== "ACTIVE"
    || (membership.expiresAt !== null && membership.expiresAt <= now)
  ) {
    return "INACTIVE";
  }
  return "ACTIVE";
}

export const prismaSessionRepository: SessionRepository = {
  async membershipIsActive(input) {
    const membership = await prisma.membership.findFirst({
      where: {
        userId: input.userId,
        organizationId: input.organizationId,
        status: "ACTIVE",
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        ],
        user: { status: "ACTIVE" },
        organization: { status: "ACTIVE" },
        ...(input.campusId
          ? {
            OR: [
              { campusId: null },
              {
                campusId: input.campusId,
                campus: {
                  id: input.campusId,
                  organizationId: input.organizationId,
                  status: "ACTIVE",
                },
              },
            ],
          }
          : { campusId: null }),
      },
      select: { id: true },
    });
    return membership !== null;
  },

  createSession(input) {
    return prisma.userSession.create({
      data: {
        tokenHash: input.tokenHash,
        userId: input.userId,
        organizationId: input.organizationId,
        campusId: input.campusId,
        createdAt: input.createdAt,
        lastSeenAt: input.lastSeenAt,
        idleExpiresAt: input.idleExpiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        ipAddressHash: input.ipAddressHash,
        userAgentHash: input.userAgentHash,
      },
      select: { id: true },
    });
  },

  async findSessionByTokenHash(
    tokenHash,
    now = new Date(),
  ): Promise<StoredSessionPrincipal | null> {
    const record = await prisma.userSession.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        tokenHash: true,
        userId: true,
        organizationId: true,
        campusId: true,
        createdAt: true,
        lastSeenAt: true,
        idleExpiresAt: true,
        absoluteExpiresAt: true,
        revokedAt: true,
        user: {
          select: {
            status: true,
            memberships: {
              where: {
                status: "ACTIVE",
              },
              select: {
                organizationId: true,
                campusId: true,
                status: true,
                expiresAt: true,
              },
            },
          },
        },
        organization: { select: { status: true } },
        campus: { select: { status: true } },
      },
    });
    if (!record) {
      return null;
    }

    const memberships = record.user.memberships.filter(
      (membership) => membership.organizationId === record.organizationId,
    );
    return {
      sessionId: record.id,
      tokenHash: record.tokenHash,
      userId: record.userId,
      userStatus: record.user.status,
      organizationId: record.organizationId,
      organizationStatus: record.organization.status,
      campusId: record.campusId,
      campusStatus: record.campus?.status ?? null,
      membershipStatus: activeMembershipStatus(
        memberships,
        record.campusId,
        now,
      ),
      createdAt: record.createdAt,
      lastSeenAt: record.lastSeenAt,
      idleExpiresAt: record.idleExpiresAt,
      absoluteExpiresAt: record.absoluteExpiresAt,
      revokedAt: record.revokedAt,
    };
  },

  async touchSession(input) {
    await prisma.userSession.updateMany({
      where: { id: input.sessionId, revokedAt: null },
      data: {
        lastSeenAt: input.lastSeenAt,
        idleExpiresAt: input.idleExpiresAt,
      },
    });
  },

  async revokeSession(input) {
    await prisma.userSession.updateMany({
      where: { id: input.sessionId, revokedAt: null },
      data: {
        revokedAt: input.revokedAt,
        revocationReason: input.reason,
      },
    });
  },

  async revokeAllUserSessions(input) {
    const result = await prisma.userSession.updateMany({
      where: {
        userId: input.userId,
        revokedAt: null,
        ...(input.exceptSessionId ? { id: { not: input.exceptSessionId } } : {}),
      },
      data: {
        revokedAt: input.revokedAt,
        revocationReason: input.reason,
      },
    });
    return result.count;
  },
};

function sessionTokenPepper(): string {
  const pepper = process.env.SESSION_TOKEN_PEPPER?.trim()
    || process.env.AUTH_SECRET?.trim();
  if (!pepper || pepper.length < 32) {
    throw new Error(
      "SESSION_TOKEN_PEPPER or AUTH_SECRET must contain at least 32 characters.",
    );
  }
  return pepper;
}

export function getPrismaSessionService() {
  return createSessionService(prismaSessionRepository, {
    tokenPepper: sessionTokenPepper(),
  });
}

export const __prismaSessionRepositoryTestUtils = {
  activeMembershipStatus,
};
