import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
} from "@/server/auth/credentials";

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1_000;
const PASSWORD_RESET_RATE_WINDOW_MS = 15 * 60 * 1_000;
const PASSWORD_RESET_RATE_LIMIT = 3;
const PASSWORD_RESET_TOKEN_PREFIX = "scpwr";

export type PasswordResetDelivery = Readonly<{
  email: string;
  token: string;
  expiresAt: Date;
}>;

export class PasswordResetError extends Error {
  readonly code: "INVALID_TOKEN" | "EXPIRED_TOKEN" | "INVALID_PASSWORD";

  constructor(
    code: "INVALID_TOKEN" | "EXPIRED_TOKEN" | "INVALID_PASSWORD",
    message: string,
  ) {
    super(message);
    this.name = "PasswordResetError";
    this.code = code;
  }
}

function tokenPepper(): string {
  const pepper = process.env.AUTH_SECRET?.trim();
  if (!pepper || pepper.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters.");
  }
  return pepper;
}

function resetTokenIsWellFormed(token: string): boolean {
  return token.startsWith(`${PASSWORD_RESET_TOKEN_PREFIX}_`)
    && token.length >= 48
    && token.length <= 160
    && /^[A-Za-z0-9_-]+$/.test(token);
}

export async function issuePasswordReset(input: Readonly<{
  email: string;
  now?: Date;
}>): Promise<PasswordResetDelivery | null> {
  const now = input.now ?? new Date();
  let normalizedEmail: string;
  try {
    normalizedEmail = normalizeEmail(input.email);
  } catch {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { normalizedEmail },
    select: {
      id: true,
      email: true,
      status: true,
      passwordCredential: { select: { userId: true } },
      securityTokens: {
        where: {
          purpose: "PASSWORD_RESET",
          createdAt: {
            gte: new Date(now.getTime() - PASSWORD_RESET_RATE_WINDOW_MS),
          },
        },
        select: { id: true },
      },
    },
  });
  if (
    !user
    || user.status !== "ACTIVE"
    || !user.passwordCredential
    || user.securityTokens.length >= PASSWORD_RESET_RATE_LIMIT
  ) {
    return null;
  }

  const token = createOpaqueToken(PASSWORD_RESET_TOKEN_PREFIX);
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
  await prisma.$transaction([
    prisma.securityToken.updateMany({
      where: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        consumedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    }),
    prisma.securityToken.create({
      data: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        tokenHash: hashOpaqueToken(token, tokenPepper()),
        expiresAt,
        createdAt: now,
      },
    }),
  ]);

  return { email: user.email, token, expiresAt };
}

export async function revokePasswordResetToken(
  token: string,
  now = new Date(),
): Promise<void> {
  if (!resetTokenIsWellFormed(token)) return;
  await prisma.securityToken.updateMany({
    where: {
      tokenHash: hashOpaqueToken(token, tokenPepper()),
      purpose: "PASSWORD_RESET",
      consumedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
}

export async function completePasswordReset(input: Readonly<{
  token: string;
  password: string;
  now?: Date;
}>): Promise<void> {
  if (!resetTokenIsWellFormed(input.token)) {
    throw new PasswordResetError(
      "INVALID_TOKEN",
      "This reset link is invalid or has already been used.",
    );
  }
  let passwordHash: string;
  try {
    passwordHash = hashPassword(input.password);
  } catch {
    throw new PasswordResetError(
      "INVALID_PASSWORD",
      "Choose a password containing at least 12 characters.",
    );
  }
  const now = input.now ?? new Date();
  const tokenHash = hashOpaqueToken(input.token, tokenPepper());

  const outcome = await prisma.$transaction(async (transaction) => {
    const securityToken = await transaction.securityToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        purpose: true,
        expiresAt: true,
        consumedAt: true,
        revokedAt: true,
        user: {
          select: {
            status: true,
            passwordCredential: { select: { userId: true } },
            memberships: {
              where: { status: "ACTIVE" },
              select: { organizationId: true, campusId: true },
            },
          },
        },
      },
    });
    if (
      !securityToken
      || securityToken.purpose !== "PASSWORD_RESET"
      || securityToken.consumedAt
      || securityToken.revokedAt
      || securityToken.user.status !== "ACTIVE"
      || !securityToken.user.passwordCredential
    ) {
      return "INVALID_TOKEN" as const;
    }
    if (securityToken.expiresAt <= now) {
      await transaction.securityToken.updateMany({
        where: {
          id: securityToken.id,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      return "EXPIRED_TOKEN" as const;
    }

    const claimed = await transaction.securityToken.updateMany({
      where: {
        id: securityToken.id,
        purpose: "PASSWORD_RESET",
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) {
      return "INVALID_TOKEN" as const;
    }

    await transaction.passwordCredential.update({
      where: { userId: securityToken.userId },
      data: {
        passwordHash,
        passwordChangedAt: now,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
    await transaction.userSession.updateMany({
      where: { userId: securityToken.userId, revokedAt: null },
      data: {
        revokedAt: now,
        revocationReason: "password-reset",
      },
    });
    await transaction.securityToken.updateMany({
      where: {
        userId: securityToken.userId,
        id: { not: securityToken.id },
        consumedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

    for (const membership of securityToken.user.memberships) {
      await transaction.auditEvent.create({
        data: {
          organizationId: membership.organizationId,
          campusId: membership.campusId,
          actorType: "USER",
          actorUserId: securityToken.userId,
          action: "account.password_reset_completed",
          targetType: "User",
          targetId: securityToken.userId,
        },
      });
    }
    return "COMPLETED" as const;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });

  if (outcome === "INVALID_TOKEN") {
    throw new PasswordResetError(
      outcome,
      "This reset link is invalid or has already been used.",
    );
  }
  if (outcome === "EXPIRED_TOKEN") {
    throw new PasswordResetError(
      outcome,
      "This reset link has expired. Request a new one.",
    );
  }
}

export const __passwordResetTestUtils = {
  resetTokenIsWellFormed,
  PASSWORD_RESET_RATE_LIMIT,
  PASSWORD_RESET_TTL_MS,
};
