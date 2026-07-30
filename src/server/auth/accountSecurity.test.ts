import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  passwordCredential: {
    findUnique: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
  },
  mfaFactor: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  mfaRecoveryCode: {
    findFirst: vi.fn(),
  },
  userProfile: {
    upsert: vi.fn(),
  },
  auditEvent: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import {
  __accountSecurityTestUtils,
  beginOwnTotpEnrollment,
  changeOwnPassword,
  revokeOwnSession,
  verifyOwnTotpEnrollment,
  type AccountSecurityContext,
} from "@/server/auth/accountSecurity";
import {
  createTotpSecret,
  generateTotpCode,
  hashPassword,
} from "@/server/auth/credentials";
import { encryptSecret } from "@/server/security/secretEncryption";

const NOW = new Date("2026-07-29T12:00:00.000Z");
const context: AccountSecurityContext = {
  actorUserId: "user_one",
  organizationId: "org_one",
  campusId: "campus_one",
  currentSessionId: "session_current",
  requestId: "request_one",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv(
    "AUTH_SECRET",
    "sermonclip-account-security-test-secret-with-more-than-32-characters",
  );
});

describe("account security validation", () => {
  it("normalizes profile text and accepts real IANA timezones", () => {
    expect(
      __accountSecurityTestUtils.normalizedRequiredText(
        "  Pastor   Grace  ",
        "Name",
        2,
        100,
      ),
    ).toBe("Pastor Grace");
    expect(
      __accountSecurityTestUtils.normalizedTimezone("Africa/Johannesburg"),
    ).toBe("Africa/Johannesburg");
    expect(() =>
      __accountSecurityTestUtils.normalizedTimezone("Not/A_Timezone")
    ).toThrow("valid IANA timezone");
  });

  it("builds a standards-compatible, issuer-bound TOTP URI", () => {
    const uri = __accountSecurityTestUtils.totpEnrollmentUri(
      "ABCDEFGHIJKLMNOP",
      "pastor@example.org",
    );
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("secret=ABCDEFGHIJKLMNOP");
    expect(uri).toContain("issuer=SermonClip");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});

describe("account security mutations", () => {
  it("changes the password atomically and revokes every other session", async () => {
    const oldHash = hashPassword("old password that is long enough");
    prismaMock.passwordCredential.findUnique.mockResolvedValue({
      passwordHash: oldHash,
    });
    const transaction = {
      passwordCredential: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      userSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      auditEvent: {
        create: vi.fn().mockResolvedValue({ id: "audit_one" }),
      },
    };
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof transaction) => unknown) => callback(transaction),
    );

    await expect(changeOwnPassword(context, {
      currentPassword: "old password that is long enough",
      newPassword: "new password that is also long enough",
    }, NOW)).resolves.toEqual({ revokedSessions: 2 });

    expect(transaction.userSession.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user_one",
        id: { not: "session_current" },
        revokedAt: null,
      },
      data: {
        revokedAt: NOW,
        revocationReason: "password_changed",
      },
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org_one",
        actorUserId: "user_one",
        action: "account.password.changed",
        metadataJson: { revokedSessions: 2 },
      }),
    });
    expect(
      JSON.stringify(transaction.auditEvent.create.mock.calls),
    ).not.toContain("new password");
  });

  it("encrypts a pending TOTP secret and returns the plaintext only to setup", async () => {
    const passwordHash = hashPassword("current password long enough");
    prismaMock.passwordCredential.findUnique.mockResolvedValue({ passwordHash });
    prismaMock.user.findFirst.mockResolvedValue({
      email: "pastor@example.org",
      mfaFactors: [],
    });
    const transaction = {
      mfaFactor: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: "factor_one" }),
      },
      auditEvent: {
        create: vi.fn().mockResolvedValue({ id: "audit_one" }),
      },
    };
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof transaction) => unknown) => callback(transaction),
    );

    const result = await beginOwnTotpEnrollment(context, {
      currentPassword: "current password long enough",
    }, NOW);

    expect(result.factorId).toBe("factor_one");
    expect(result.secret).toMatch(/^[A-Z2-7]+$/);
    expect(result.otpauthUri).toContain(`secret=${result.secret}`);
    const createData = transaction.mfaFactor.create.mock.calls[0][0].data;
    expect(createData.secretCiphertext).toMatch(/^v1:mfa-totp:/);
    expect(createData.secretCiphertext).not.toContain(result.secret);
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "account.mfa.enrollment_started",
      }),
    });
  });

  it("stores only recovery-code hashes when TOTP verification succeeds", async () => {
    const secret = createTotpSecret();
    prismaMock.mfaFactor.findFirst.mockResolvedValue({
      id: "factor_one",
      secretCiphertext: encryptSecret(secret, "mfa-totp"),
      createdAt: new Date(NOW.getTime() - 60_000),
    });
    const transaction = {
      mfaFactor: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      mfaRecoveryCode: {
        createMany: vi.fn().mockResolvedValue({ count: 10 }),
      },
      userSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 3 }),
      },
      auditEvent: {
        create: vi.fn().mockResolvedValue({ id: "audit_one" }),
      },
    };
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof transaction) => unknown) => callback(transaction),
    );

    const result = await verifyOwnTotpEnrollment(context, {
      factorId: "factor_one",
      code: generateTotpCode(secret, NOW),
    }, NOW);

    expect(result.recoveryCodes).toHaveLength(10);
    expect(result.revokedSessions).toBe(3);
    const stored = transaction.mfaRecoveryCode.createMany.mock.calls[0][0].data;
    expect(stored).toHaveLength(10);
    expect(stored.every((item: Record<string, unknown>) =>
      typeof item.codeHash === "string"
      && /^[a-f0-9]{64}$/.test(item.codeHash as string)
      && !("code" in item)
    )).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(result.recoveryCodes[0]);
  });

  it("revokes only an exact session owned by the actor in the active tenant", async () => {
    const transaction = {
      userSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditEvent: {
        create: vi.fn().mockResolvedValue({ id: "audit_one" }),
      },
    };
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof transaction) => unknown) => callback(transaction),
    );

    await revokeOwnSession(context, "session_other", NOW);

    expect(transaction.userSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: "session_other",
        userId: "user_one",
        organizationId: "org_one",
        revokedAt: null,
      },
      data: {
        revokedAt: NOW,
        revocationReason: "user_device_revoked",
      },
    });
  });
});
