import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  createRecoveryCodes,
  createTotpSecret,
  hashPassword,
  hashRecoveryCode,
  validatePassword,
  verifyPassword,
  verifyTotpCode,
} from "@/server/auth/credentials";
import {
  decryptSecret,
  encryptSecret,
} from "@/server/security/secretEncryption";

const MFA_ENROLLMENT_TTL_MS = 15 * 60 * 1_000;
const MFA_RECOVERY_CODE_COUNT = 10;
const TOTP_ISSUER = "SermonClip";
const MAX_REAUTHENTICATION_FAILURES = 5;
const REAUTHENTICATION_LOCKOUT_MS = 15 * 60 * 1_000;

export type AccountSecurityContext = Readonly<{
  actorUserId: string;
  organizationId: string;
  campusId: string | null;
  currentSessionId: string;
  requestId?: string | null;
}>;

export type AccountSecurityOverview = Readonly<{
  profile: {
    email: string;
    displayName: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    phone: string;
    timezone: string;
  };
  passwordChangedAt: string | null;
  mfa: {
    enabled: boolean;
    enabledAt: string | null;
    recoveryCodesRemaining: number;
  };
  sessions: ReadonlyArray<{
    id: string;
    current: boolean;
    createdAt: string;
    lastSeenAt: string;
    absoluteExpiresAt: string;
    campusId: string | null;
  }>;
}>;

export class AccountSecurityError extends Error {
  readonly code:
    | "INVALID_INPUT"
    | "REAUTHENTICATION_FAILED"
    | "CONFLICT"
    | "NOT_FOUND";

  constructor(
    code:
      | "INVALID_INPUT"
      | "REAUTHENTICATION_FAILED"
      | "CONFLICT"
      | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "AccountSecurityError";
    this.code = code;
  }
}

type ProfileInput = Readonly<{
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  timezone?: string | null;
}>;

function normalizedRequiredText(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new AccountSecurityError(
      "INVALID_INPUT",
      `${label} must contain between ${minimum} and ${maximum} characters.`,
    );
  }
  return normalized;
}

function normalizedOptionalText(
  value: string | null | undefined,
  label: string,
  maximum: number,
): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw new AccountSecurityError(
      "INVALID_INPUT",
      `${label} must contain no more than ${maximum} characters.`,
    );
  }
  return normalized;
}

function normalizedTimezone(value: string | null | undefined): string | null {
  const timezone = normalizedOptionalText(value, "Timezone", 100);
  if (!timezone) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new AccountSecurityError(
      "INVALID_INPUT",
      "Choose a valid IANA timezone such as Africa/Johannesburg.",
    );
  }
  return timezone;
}

function auditData(
  context: AccountSecurityContext,
  action: string,
  metadataJson?: Prisma.InputJsonValue,
) {
  return {
    organizationId: context.organizationId,
    campusId: context.campusId,
    actorType: "USER" as const,
    actorUserId: context.actorUserId,
    action,
    targetType: "User",
    targetId: context.actorUserId,
    requestId: context.requestId?.trim() || null,
    metadataJson,
  };
}

function recoveryCodePepper(): string {
  const pepper = process.env.AUTH_SECRET?.trim();
  if (!pepper || pepper.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters.");
  }
  return pepper;
}

function ensureContext(context: AccountSecurityContext): void {
  if (
    !context.actorUserId.trim()
    || !context.organizationId.trim()
    || !context.currentSessionId.trim()
  ) {
    throw new AccountSecurityError(
      "REAUTHENTICATION_FAILED",
      "Your secure session could not be verified.",
    );
  }
}

async function verifiedPasswordCredential(
  userId: string,
  currentPassword: string,
  now = new Date(),
): Promise<{ passwordHash: string }> {
  const credential = await prisma.passwordCredential.findUnique({
    where: { userId },
    select: {
      passwordHash: true,
      failedAttempts: true,
      lockedUntil: true,
    },
  });
  const locked = Boolean(
    credential?.lockedUntil && credential.lockedUntil > now,
  );
  if (
    !credential
    || locked
    || !currentPassword
    || !verifyPassword(currentPassword, credential.passwordHash)
  ) {
    if (credential && !locked) {
      const nextFailures = credential.failedAttempts + 1;
      await prisma.passwordCredential.updateMany({
        where: { userId, passwordHash: credential.passwordHash },
        data: {
          failedAttempts: { increment: 1 },
          lockedUntil: nextFailures >= MAX_REAUTHENTICATION_FAILURES
            ? new Date(now.getTime() + REAUTHENTICATION_LOCKOUT_MS)
            : null,
        },
      });
    }
    throw new AccountSecurityError(
      "REAUTHENTICATION_FAILED",
      "Your identity could not be verified.",
    );
  }
  if (credential.failedAttempts > 0 || credential.lockedUntil) {
    await prisma.passwordCredential.updateMany({
      where: { userId, passwordHash: credential.passwordHash },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  }
  return credential;
}

function totpEnrollmentUri(secret: string, email: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${email}`);
  const query = new URLSearchParams({
    secret,
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export async function getAccountSecurityOverview(
  context: AccountSecurityContext,
  now = new Date(),
): Promise<AccountSecurityOverview> {
  ensureContext(context);
  const user = await prisma.user.findFirst({
    where: {
      id: context.actorUserId,
      status: "ACTIVE",
      memberships: {
        some: {
          organizationId: context.organizationId,
          status: "ACTIVE",
        },
      },
    },
    select: {
      email: true,
      profile: {
        select: {
          displayName: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
          phone: true,
          timezone: true,
        },
      },
      passwordCredential: {
        select: { passwordChangedAt: true },
      },
      mfaFactors: {
        where: {
          type: "TOTP",
          verifiedAt: { not: null },
          disabledAt: null,
        },
        orderBy: { verifiedAt: "desc" },
        take: 1,
        select: {
          id: true,
          verifiedAt: true,
          _count: {
            select: {
              recoveryCodes: {
                where: { usedAt: null },
              },
            },
          },
        },
      },
      sessions: {
        where: {
          organizationId: context.organizationId,
          revokedAt: null,
          idleExpiresAt: { gt: now },
          absoluteExpiresAt: { gt: now },
        },
        orderBy: { lastSeenAt: "desc" },
        select: {
          id: true,
          campusId: true,
          createdAt: true,
          lastSeenAt: true,
          absoluteExpiresAt: true,
        },
      },
    },
  });
  if (!user) {
    throw new AccountSecurityError(
      "NOT_FOUND",
      "The requested account is unavailable.",
    );
  }

  const factor = user.mfaFactors[0] ?? null;
  return {
    profile: {
      email: user.email,
      displayName: user.profile?.displayName ?? user.email,
      firstName: user.profile?.firstName ?? "",
      lastName: user.profile?.lastName ?? "",
      jobTitle: user.profile?.jobTitle ?? "",
      phone: user.profile?.phone ?? "",
      timezone: user.profile?.timezone ?? "",
    },
    passwordChangedAt:
      user.passwordCredential?.passwordChangedAt.toISOString() ?? null,
    mfa: {
      enabled: factor !== null,
      enabledAt: factor?.verifiedAt?.toISOString() ?? null,
      recoveryCodesRemaining: factor?._count.recoveryCodes ?? 0,
    },
    sessions: user.sessions.map((session) => ({
      id: session.id,
      current: session.id === context.currentSessionId,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      campusId: session.campusId,
    })),
  };
}

export async function updateOwnProfile(
  context: AccountSecurityContext,
  input: ProfileInput,
): Promise<AccountSecurityOverview["profile"]> {
  ensureContext(context);
  const profile = {
    displayName: normalizedRequiredText(
      input.displayName,
      "Display name",
      2,
      100,
    ),
    firstName: normalizedOptionalText(input.firstName, "First name", 100),
    lastName: normalizedOptionalText(input.lastName, "Last name", 100),
    jobTitle: normalizedOptionalText(input.jobTitle, "Job title", 120),
    phone: normalizedOptionalText(input.phone, "Phone", 40),
    timezone: normalizedTimezone(input.timezone),
  };

  const user = await prisma.user.findFirst({
    where: { id: context.actorUserId, status: "ACTIVE" },
    select: { id: true, email: true },
  });
  if (!user) {
    throw new AccountSecurityError(
      "NOT_FOUND",
      "The requested account is unavailable.",
    );
  }

  await prisma.$transaction([
    prisma.userProfile.upsert({
      where: { userId: context.actorUserId },
      create: { userId: context.actorUserId, ...profile },
      update: profile,
    }),
    prisma.auditEvent.create({
      data: auditData(context, "account.profile.updated", {
        fields: Object.keys(profile),
      }),
    }),
  ]);
  return {
    email: user.email,
    displayName: profile.displayName,
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
    jobTitle: profile.jobTitle ?? "",
    phone: profile.phone ?? "",
    timezone: profile.timezone ?? "",
  };
}

export async function changeOwnPassword(
  context: AccountSecurityContext,
  input: Readonly<{
    currentPassword: string;
    newPassword: string;
  }>,
  now = new Date(),
): Promise<{ revokedSessions: number }> {
  ensureContext(context);
  const credential = await verifiedPasswordCredential(
    context.actorUserId,
    input.currentPassword,
    now,
  );
  try {
    validatePassword(input.newPassword);
  } catch {
    throw new AccountSecurityError(
      "INVALID_INPUT",
      "Your new password must contain between 12 and 1,024 characters.",
    );
  }
  if (verifyPassword(input.newPassword, credential.passwordHash)) {
    throw new AccountSecurityError(
      "INVALID_INPUT",
      "Choose a new password that is different from your current password.",
    );
  }
  const passwordHash = hashPassword(input.newPassword);

  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.passwordCredential.updateMany({
      where: {
        userId: context.actorUserId,
        passwordHash: credential.passwordHash,
      },
      data: {
        passwordHash,
        passwordChangedAt: now,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
    if (updated.count !== 1) {
      throw new AccountSecurityError(
        "CONFLICT",
        "Your security details changed. Verify your identity and try again.",
      );
    }
    const revoked = await transaction.userSession.updateMany({
      where: {
        userId: context.actorUserId,
        id: { not: context.currentSessionId },
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revocationReason: "password_changed",
      },
    });
    await transaction.auditEvent.create({
      data: auditData(context, "account.password.changed", {
        revokedSessions: revoked.count,
      }),
    });
    return { revokedSessions: revoked.count };
  });
}

export async function beginOwnTotpEnrollment(
  context: AccountSecurityContext,
  input: Readonly<{ currentPassword: string }>,
  now = new Date(),
): Promise<{
  factorId: string;
  secret: string;
  otpauthUri: string;
  expiresAt: string;
}> {
  ensureContext(context);
  await verifiedPasswordCredential(
    context.actorUserId,
    input.currentPassword,
    now,
  );
  const user = await prisma.user.findFirst({
    where: { id: context.actorUserId, status: "ACTIVE" },
    select: {
      email: true,
      mfaFactors: {
        where: {
          type: "TOTP",
          verifiedAt: { not: null },
          disabledAt: null,
        },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!user) {
    throw new AccountSecurityError(
      "NOT_FOUND",
      "The requested account is unavailable.",
    );
  }
  if (user.mfaFactors.length > 0) {
    throw new AccountSecurityError(
      "CONFLICT",
      "Two-step verification is already enabled.",
    );
  }

  const secret = createTotpSecret();
  const factor = await prisma.$transaction(async (transaction) => {
    await transaction.mfaFactor.updateMany({
      where: {
        userId: context.actorUserId,
        verifiedAt: null,
        disabledAt: null,
      },
      data: { disabledAt: now },
    });
    const created = await transaction.mfaFactor.create({
      data: {
        userId: context.actorUserId,
        type: "TOTP",
        label: "Authenticator app",
        secretCiphertext: encryptSecret(secret, "mfa-totp"),
      },
      select: { id: true },
    });
    await transaction.auditEvent.create({
      data: auditData(context, "account.mfa.enrollment_started"),
    });
    return created;
  });

  return {
    factorId: factor.id,
    secret,
    otpauthUri: totpEnrollmentUri(secret, user.email),
    expiresAt: new Date(now.getTime() + MFA_ENROLLMENT_TTL_MS).toISOString(),
  };
}

export async function verifyOwnTotpEnrollment(
  context: AccountSecurityContext,
  input: Readonly<{ factorId: string; code: string }>,
  now = new Date(),
): Promise<{
  recoveryCodes: readonly string[];
  revokedSessions: number;
}> {
  ensureContext(context);
  const factor = await prisma.mfaFactor.findFirst({
    where: {
      id: input.factorId.trim(),
      userId: context.actorUserId,
      type: "TOTP",
      verifiedAt: null,
      disabledAt: null,
    },
    select: {
      id: true,
      secretCiphertext: true,
      createdAt: true,
    },
  });
  if (!factor) {
    throw new AccountSecurityError(
      "NOT_FOUND",
      "The verification setup is unavailable. Start again.",
    );
  }
  if (factor.createdAt.getTime() + MFA_ENROLLMENT_TTL_MS <= now.getTime()) {
    await prisma.mfaFactor.updateMany({
      where: { id: factor.id, userId: context.actorUserId, disabledAt: null },
      data: { disabledAt: now },
    });
    throw new AccountSecurityError(
      "CONFLICT",
      "The verification setup expired. Start again.",
    );
  }

  let codeMatches = false;
  try {
    codeMatches = verifyTotpCode(
      decryptSecret(factor.secretCiphertext, "mfa-totp"),
      input.code.trim(),
      { at: now },
    );
  } catch {
    codeMatches = false;
  }
  if (!codeMatches) {
    throw new AccountSecurityError(
      "REAUTHENTICATION_FAILED",
      "The authentication code could not be verified.",
    );
  }

  const recoveryCodes = createRecoveryCodes(MFA_RECOVERY_CODE_COUNT);
  const pepper = recoveryCodePepper();
  const codeHashes = recoveryCodes.map((code) =>
    hashRecoveryCode(code, pepper)
  );

  const result = await prisma.$transaction(async (transaction) => {
    const verified = await transaction.mfaFactor.updateMany({
      where: {
        id: factor.id,
        userId: context.actorUserId,
        verifiedAt: null,
        disabledAt: null,
      },
      data: { verifiedAt: now, lastUsedAt: now },
    });
    if (verified.count !== 1) {
      throw new AccountSecurityError(
        "CONFLICT",
        "Your security details changed. Start setup again.",
      );
    }
    await transaction.mfaRecoveryCode.createMany({
      data: codeHashes.map((codeHash) => ({
        userId: context.actorUserId,
        factorId: factor.id,
        codeHash,
      })),
    });
    const revoked = await transaction.userSession.updateMany({
      where: {
        userId: context.actorUserId,
        id: { not: context.currentSessionId },
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revocationReason: "mfa_enabled",
      },
    });
    await transaction.auditEvent.create({
      data: auditData(context, "account.mfa.enabled", {
        recoveryCodeCount: codeHashes.length,
        revokedSessions: revoked.count,
      }),
    });
    return { revokedSessions: revoked.count };
  });

  return { recoveryCodes, revokedSessions: result.revokedSessions };
}

export async function disableOwnTotp(
  context: AccountSecurityContext,
  input: Readonly<{
    currentPassword: string;
    authenticationCode: string;
  }>,
  now = new Date(),
): Promise<{ revokedSessions: number }> {
  ensureContext(context);
  await verifiedPasswordCredential(
    context.actorUserId,
    input.currentPassword,
    now,
  );
  const factor = await prisma.mfaFactor.findFirst({
    where: {
      userId: context.actorUserId,
      type: "TOTP",
      verifiedAt: { not: null },
      disabledAt: null,
    },
    orderBy: { verifiedAt: "desc" },
    select: {
      id: true,
      secretCiphertext: true,
    },
  });
  if (!factor) {
    throw new AccountSecurityError(
      "NOT_FOUND",
      "Two-step verification is not enabled.",
    );
  }

  const submitted = input.authenticationCode.trim();
  let recoveryCodeHash: string | null = null;
  let codeMatches = false;
  if (/^\d{6}$/.test(submitted)) {
    try {
      codeMatches = verifyTotpCode(
        decryptSecret(factor.secretCiphertext, "mfa-totp"),
        submitted,
        { at: now },
      );
    } catch {
      codeMatches = false;
    }
  } else {
    try {
      recoveryCodeHash = hashRecoveryCode(submitted, recoveryCodePepper());
      const stored = await prisma.mfaRecoveryCode.findFirst({
        where: {
          userId: context.actorUserId,
          factorId: factor.id,
          codeHash: recoveryCodeHash,
          usedAt: null,
        },
        select: { id: true },
      });
      codeMatches = stored !== null;
    } catch {
      codeMatches = false;
    }
  }
  if (!codeMatches) {
    throw new AccountSecurityError(
      "REAUTHENTICATION_FAILED",
      "Your identity could not be verified.",
    );
  }

  return prisma.$transaction(async (transaction) => {
    if (recoveryCodeHash) {
      const consumed = await transaction.mfaRecoveryCode.updateMany({
        where: {
          userId: context.actorUserId,
          factorId: factor.id,
          codeHash: recoveryCodeHash,
          usedAt: null,
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        throw new AccountSecurityError(
          "REAUTHENTICATION_FAILED",
          "Your identity could not be verified.",
        );
      }
    }
    const disabled = await transaction.mfaFactor.updateMany({
      where: {
        id: factor.id,
        userId: context.actorUserId,
        disabledAt: null,
      },
      data: { disabledAt: now },
    });
    if (disabled.count !== 1) {
      throw new AccountSecurityError(
        "CONFLICT",
        "Your security details changed. Refresh and try again.",
      );
    }
    const revoked = await transaction.userSession.updateMany({
      where: {
        userId: context.actorUserId,
        id: { not: context.currentSessionId },
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revocationReason: "mfa_disabled",
      },
    });
    await transaction.auditEvent.create({
      data: auditData(context, "account.mfa.disabled", {
        revokedSessions: revoked.count,
      }),
    });
    return { revokedSessions: revoked.count };
  });
}

export async function revokeOwnSession(
  context: AccountSecurityContext,
  sessionId: string,
  now = new Date(),
): Promise<{ revokedCurrentSession: boolean }> {
  ensureContext(context);
  const canonicalSessionId = sessionId.trim();
  if (!canonicalSessionId) {
    throw new AccountSecurityError(
      "NOT_FOUND",
      "The requested session is unavailable.",
    );
  }
  const result = await prisma.$transaction(async (transaction) => {
    const revoked = await transaction.userSession.updateMany({
      where: {
        id: canonicalSessionId,
        userId: context.actorUserId,
        organizationId: context.organizationId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revocationReason: "user_device_revoked",
      },
    });
    if (revoked.count !== 1) {
      throw new AccountSecurityError(
        "NOT_FOUND",
        "The requested session is unavailable.",
      );
    }
    const revokedCurrentSession =
      canonicalSessionId === context.currentSessionId;
    await transaction.auditEvent.create({
      data: auditData(context, "account.session.revoked", {
        revokedCurrentSession,
      }),
    });
    return { revokedCurrentSession };
  });
  return result;
}

export async function revokeAllOwnSessions(
  context: AccountSecurityContext,
  input: Readonly<{ currentPassword: string }>,
  now = new Date(),
): Promise<{ revokedSessions: number }> {
  ensureContext(context);
  await verifiedPasswordCredential(
    context.actorUserId,
    input.currentPassword,
    now,
  );
  return prisma.$transaction(async (transaction) => {
    const revoked = await transaction.userSession.updateMany({
      where: {
        userId: context.actorUserId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revocationReason: "user_sign_out_all",
      },
    });
    await transaction.auditEvent.create({
      data: auditData(context, "account.sessions.revoked_all", {
        revokedSessions: revoked.count,
      }),
    });
    return { revokedSessions: revoked.count };
  });
}

export const __accountSecurityTestUtils = {
  normalizedOptionalText,
  normalizedRequiredText,
  normalizedTimezone,
  totpEnrollmentUri,
};
