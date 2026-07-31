import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/server/auth/credentials";
import {
  hashTrustToken,
  trustTokenIsWellFormed,
} from "@/server/trust/tokens";

export class InvitationOnboardingError extends Error {
  readonly code:
    | "INVALID_INVITATION"
    | "EXPIRED_INVITATION"
    | "EXISTING_ACCOUNT"
    | "INVALID_PROFILE";

  constructor(
    code:
      | "INVALID_INVITATION"
      | "EXPIRED_INVITATION"
      | "EXISTING_ACCOUNT"
      | "INVALID_PROFILE",
    message: string,
  ) {
    super(message);
    this.name = "InvitationOnboardingError";
    this.code = code;
  }
}

function displayName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 100) {
    throw new InvitationOnboardingError(
      "INVALID_PROFILE",
      "Enter the name your team should see.",
    );
  }
  return normalized;
}

export async function completeInvitationOnboarding(input: Readonly<{
  token: string;
  displayName: string;
  password: string;
  now?: Date;
}>): Promise<{
  userId: string;
  organizationId: string;
  campusId: string | null;
  membershipId: string;
}> {
  if (
    !trustTokenIsWellFormed(input.token)
    || !input.token.startsWith("sc_invite_")
  ) {
    throw new InvitationOnboardingError(
      "INVALID_INVITATION",
      "This invitation is invalid or has already been used.",
    );
  }
  const name = displayName(input.displayName);
  const passwordHash = hashPassword(input.password);
  const now = input.now ?? new Date();

  const result = await prisma.$transaction(async (transaction) => {
    const invitation = await transaction.invitation.findUnique({
      where: { tokenHash: hashTrustToken(input.token) },
      select: {
        id: true,
        organizationId: true,
        campusId: true,
        email: true,
        normalizedEmail: true,
        role: true,
        status: true,
        expiresAt: true,
        organization: { select: { status: true } },
        campus: {
          select: { organizationId: true, status: true },
        },
      },
    });
    if (
      !invitation
      || invitation.status !== "PENDING"
      || invitation.organization.status !== "ACTIVE"
      || (
        invitation.campusId !== null
        && (
          invitation.campus?.organizationId !== invitation.organizationId
          || invitation.campus.status !== "ACTIVE"
        )
      )
    ) {
      return { ok: false as const, code: "INVALID_INVITATION" as const };
    }
    if (invitation.expiresAt <= now) {
      await transaction.invitation.updateMany({
        where: { id: invitation.id, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: invitation.organizationId,
          campusId: invitation.campusId,
          actorType: "SYSTEM",
          action: "invitation.expired",
          targetType: "Invitation",
          targetId: invitation.id,
        },
      });
      return { ok: false as const, code: "EXPIRED_INVITATION" as const };
    }

    const existingUser = await transaction.user.findUnique({
      where: { normalizedEmail: invitation.normalizedEmail },
      select: {
        id: true,
        status: true,
        passwordCredential: { select: { userId: true } },
      },
    });
    if (
      existingUser
      && (
        existingUser.status !== "INVITED"
        || existingUser.passwordCredential !== null
      )
    ) {
      return { ok: false as const, code: "EXISTING_ACCOUNT" as const };
    }

    const claimed = await transaction.invitation.updateMany({
      where: {
        id: invitation.id,
        status: "PENDING",
        acceptedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        status: "ACCEPTED",
        acceptedAt: now,
      },
    });
    if (claimed.count !== 1) {
      return { ok: false as const, code: "INVALID_INVITATION" as const };
    }

    const user = existingUser
      ? await transaction.user.update({
          where: { id: existingUser.id },
          data: {
            status: "ACTIVE",
            emailVerifiedAt: now,
            passwordCredential: {
              create: { passwordHash, passwordChangedAt: now },
            },
            profile: {
              upsert: {
                create: { displayName: name },
                update: { displayName: name },
              },
            },
          },
          select: { id: true },
        })
      : await transaction.user.create({
          data: {
            email: invitation.email.trim(),
            normalizedEmail: invitation.normalizedEmail,
            status: "ACTIVE",
            emailVerifiedAt: now,
            passwordCredential: {
              create: { passwordHash, passwordChangedAt: now },
            },
            profile: { create: { displayName: name } },
          },
          select: { id: true },
        });

    const existingMembership = await transaction.membership.findFirst({
      where: {
        organizationId: invitation.organizationId,
        campusId: invitation.campusId,
        userId: user.id,
      },
      select: { id: true },
    });
    const membership = existingMembership
      ? await transaction.membership.update({
          where: { id: existingMembership.id },
          data: {
            role: invitation.role,
            status: "ACTIVE",
            joinedAt: now,
            expiresAt: null,
          },
          select: { id: true },
        })
      : await transaction.membership.create({
          data: {
            organizationId: invitation.organizationId,
            campusId: invitation.campusId,
            userId: user.id,
            role: invitation.role,
            status: "ACTIVE",
            joinedAt: now,
          },
          select: { id: true },
        });
    await transaction.invitation.update({
      where: { id: invitation.id },
      data: { acceptedByUserId: user.id },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: invitation.organizationId,
        campusId: invitation.campusId,
        actorType: "USER",
        actorUserId: user.id,
        action: "invitation.onboarding_completed",
        targetType: "Invitation",
        targetId: invitation.id,
        metadataJson: {
          membershipId: membership.id,
          role: invitation.role,
        },
      },
    });
    return {
      ok: true as const,
      userId: user.id,
      organizationId: invitation.organizationId,
      campusId: invitation.campusId,
      membershipId: membership.id,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });

  if (!result.ok) {
    if (result.code === "EXPIRED_INVITATION") {
      throw new InvitationOnboardingError(
        result.code,
        "This invitation has expired. Ask your workspace owner for a new one.",
      );
    }
    if (result.code === "EXISTING_ACCOUNT") {
      throw new InvitationOnboardingError(
        result.code,
        "This email already has an account. Sign in before accepting the invitation.",
      );
    }
    throw new InvitationOnboardingError(
      result.code,
      "This invitation is invalid or has already been used.",
    );
  }
  return result;
}
