import type { MembershipRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  hashRecoveryCode,
  normalizeEmail,
  verifyPassword,
  verifyTotpCode,
} from "@/server/auth/credentials";
import { decryptSecret } from "@/server/security/secretEncryption";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1_000;
const DUMMY_PASSWORD_HASH = hashPassword(
  "SermonClip timing defense password that is never accepted",
);

export type LoginWorkspace = Readonly<{
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  campusId: string | null;
  campusSlug: string | null;
  campusName: string | null;
  role: MembershipRole;
}>;

export class PasswordLoginError extends Error {
  constructor(
    readonly code:
      | "INVALID_CREDENTIALS"
      | "MFA_REQUIRED"
      | "WORKSPACE_REQUIRED",
    readonly workspaces: readonly LoginWorkspace[] = [],
  ) {
    super(
      code === "MFA_REQUIRED"
        ? "Enter your authentication code."
        : code === "WORKSPACE_REQUIRED"
          ? "Choose the church workspace you want to open."
          : "The email, password, or authentication code is incorrect.",
    );
    this.name = "PasswordLoginError";
  }
}

type LoginMembership = Readonly<{
  organizationId: string;
  campusId: string | null;
  role: MembershipRole;
  status: string;
  expiresAt: Date | null;
  organization: {
    slug: string;
    name: string;
    status: string;
  };
  campus: {
    slug: string;
    name: string;
    status: string;
    organizationId: string;
  } | null;
}>;

function membershipIsAvailable(
  membership: LoginMembership,
  now: Date,
): boolean {
  return membership.status === "ACTIVE"
    && membership.organization.status === "ACTIVE"
    && (membership.expiresAt === null || membership.expiresAt > now)
    && (
      membership.campusId === null
      || (
        membership.campus?.status === "ACTIVE"
        && membership.campus.organizationId === membership.organizationId
      )
    );
}

function workspaceFromMembership(
  membership: LoginMembership,
): LoginWorkspace {
  return {
    organizationId: membership.organizationId,
    organizationSlug: membership.organization.slug,
    organizationName: membership.organization.name,
    campusId: membership.campusId,
    campusSlug: membership.campus?.slug ?? null,
    campusName: membership.campus?.name ?? null,
    role: membership.role,
  };
}

export function selectLoginWorkspace(
  memberships: readonly LoginMembership[],
  input: Readonly<{
    organizationSlug?: string | null;
    campusSlug?: string | null;
    now: Date;
  }>,
): LoginWorkspace {
  const available = memberships
    .filter((membership) => membershipIsAvailable(membership, input.now))
    .map(workspaceFromMembership);
  const requestedOrganization = input.organizationSlug?.trim().toLowerCase();
  const requestedCampus = input.campusSlug?.trim().toLowerCase();
  const matching = available.filter((workspace) => (
    (!requestedOrganization
      || workspace.organizationSlug.toLowerCase() === requestedOrganization)
    && (!requestedCampus
      || workspace.campusSlug?.toLowerCase() === requestedCampus)
  ));

  if (matching.length === 1) {
    return matching[0];
  }
  if (
    matching.length > 1
    && requestedOrganization
    && !requestedCampus
  ) {
    const organizationWide = matching.find(
      (workspace) => workspace.campusId === null,
    );
    if (organizationWide) {
      return organizationWide;
    }
  }
  if (matching.length === 0) {
    throw new PasswordLoginError("INVALID_CREDENTIALS");
  }
  throw new PasswordLoginError("WORKSPACE_REQUIRED", matching);
}

async function recordFailedPassword(
  userId: string,
  currentFailedAttempts: number,
  now: Date,
): Promise<void> {
  const nextFailedAttempts = currentFailedAttempts + 1;
  await prisma.passwordCredential.updateMany({
    where: { userId },
    data: {
      failedAttempts: { increment: 1 },
      lockedUntil: nextFailedAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(now.getTime() + LOCKOUT_MS)
        : null,
    },
  });
}

function recoveryCodePepper(): string {
  const pepper = process.env.AUTH_SECRET?.trim();
  if (!pepper || pepper.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters.");
  }
  return pepper;
}

export async function authenticatePasswordLogin(input: Readonly<{
  email: string;
  password: string;
  organizationSlug?: string | null;
  campusSlug?: string | null;
  totpCode?: string | null;
  recoveryCode?: string | null;
  now?: Date;
}>): Promise<{
  userId: string;
  workspace: LoginWorkspace;
}> {
  const now = input.now ?? new Date();
  let normalizedEmail: string | null = null;
  try {
    normalizedEmail = normalizeEmail(input.email);
  } catch {
    // Keep the response and password work indistinguishable from an unknown user.
  }

  const user = normalizedEmail
    ? await prisma.user.findUnique({
        where: { normalizedEmail },
        select: {
          id: true,
          status: true,
          passwordCredential: {
            select: {
              passwordHash: true,
              failedAttempts: true,
              lockedUntil: true,
            },
          },
          memberships: {
            select: {
              organizationId: true,
              campusId: true,
              role: true,
              status: true,
              expiresAt: true,
              organization: {
                select: { slug: true, name: true, status: true },
              },
              campus: {
                select: {
                  slug: true,
                  name: true,
                  status: true,
                  organizationId: true,
                },
              },
            },
          },
          mfaFactors: {
            where: {
              type: "TOTP",
              verifiedAt: { not: null },
              disabledAt: null,
            },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: {
              id: true,
              secretCiphertext: true,
            },
          },
        },
      })
    : null;

  const passwordHash = user?.passwordCredential?.passwordHash
    ?? DUMMY_PASSWORD_HASH;
  const passwordMatches = verifyPassword(input.password, passwordHash);
  const credentialLocked = Boolean(
    user?.passwordCredential?.lockedUntil
    && user.passwordCredential.lockedUntil > now,
  );
  if (
    !user
    || user.status !== "ACTIVE"
    || !user.passwordCredential
    || !passwordMatches
    || credentialLocked
  ) {
    if (
      user?.passwordCredential
      && !credentialLocked
    ) {
      await recordFailedPassword(
        user.id,
        user.passwordCredential.failedAttempts,
        now,
      );
    }
    throw new PasswordLoginError("INVALID_CREDENTIALS");
  }

  const factor = user.mfaFactors[0];
  let recoveryCodeHash: string | null = null;
  if (factor) {
    const totpCode = input.totpCode?.trim();
    const recoveryCode = input.recoveryCode?.trim();
    if (!totpCode && !recoveryCode) {
      throw new PasswordLoginError("MFA_REQUIRED");
    }

    let mfaMatches = false;
    if (totpCode) {
      try {
        mfaMatches = verifyTotpCode(
          decryptSecret(factor.secretCiphertext, "mfa-totp"),
          totpCode,
          { at: now },
        );
      } catch {
        mfaMatches = false;
      }
    } else if (recoveryCode) {
      try {
        recoveryCodeHash = hashRecoveryCode(
          recoveryCode,
          recoveryCodePepper(),
        );
        const storedCode = await prisma.mfaRecoveryCode.findFirst({
          where: {
            userId: user.id,
            factorId: factor.id,
            codeHash: recoveryCodeHash,
            usedAt: null,
          },
          select: { id: true },
        });
        mfaMatches = storedCode !== null;
      } catch {
        mfaMatches = false;
      }
    }
    if (!mfaMatches) {
      await recordFailedPassword(
        user.id,
        user.passwordCredential.failedAttempts,
        now,
      );
      throw new PasswordLoginError("INVALID_CREDENTIALS");
    }
  }

  const workspace = selectLoginWorkspace(user.memberships, {
    organizationSlug: input.organizationSlug,
    campusSlug: input.campusSlug,
    now,
  });

  await prisma.$transaction(async (transaction) => {
    if (recoveryCodeHash && factor) {
      const consumed = await transaction.mfaRecoveryCode.updateMany({
        where: {
          userId: user.id,
          factorId: factor.id,
          codeHash: recoveryCodeHash,
          usedAt: null,
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        throw new PasswordLoginError("INVALID_CREDENTIALS");
      }
    } else if (factor) {
      await transaction.mfaFactor.update({
        where: { id: factor.id },
        data: { lastUsedAt: now },
      });
    }
    await transaction.passwordCredential.update({
      where: { userId: user.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    await transaction.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now },
    });
  });

  return { userId: user.id, workspace };
}

export const __passwordLoginTestUtils = {
  membershipIsAvailable,
};
