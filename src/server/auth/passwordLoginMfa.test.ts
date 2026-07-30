import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  passwordCredential: {
    updateMany: vi.fn(),
  },
  mfaRecoveryCode: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { hashPassword } from "@/server/auth/credentials";
import {
  authenticatePasswordLogin,
  PasswordLoginError,
} from "@/server/auth/passwordLogin";

const now = new Date("2026-07-29T12:00:00.000Z");
const password = "A valid test password";

function loginUser(failedAttempts: number) {
  return {
    id: "user-one",
    status: "ACTIVE",
    passwordCredential: {
      passwordHash: hashPassword(password),
      failedAttempts,
      lockedUntil: null,
    },
    memberships: [],
    mfaFactors: [{
      id: "factor-one",
      secretCiphertext: "invalid-encrypted-secret",
    }],
  };
}

describe("password login MFA throttling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.passwordCredential.updateMany.mockResolvedValue({ count: 1 });
  });

  it("counts a supplied invalid second factor as a failed sign-in", async () => {
    prismaMock.user.findUnique.mockResolvedValue(loginUser(0));

    await expect(authenticatePasswordLogin({
      email: "pastor@example.com",
      password,
      totpCode: "000000",
      now,
    })).rejects.toEqual(expect.objectContaining<Partial<PasswordLoginError>>({
      code: "INVALID_CREDENTIALS",
    }));

    expect(prismaMock.passwordCredential.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-one" },
      data: {
        failedAttempts: { increment: 1 },
        lockedUntil: null,
      },
    });
  });

  it("locks sign-in after the fifth invalid second-factor attempt", async () => {
    prismaMock.user.findUnique.mockResolvedValue(loginUser(4));

    await expect(authenticatePasswordLogin({
      email: "pastor@example.com",
      password,
      recoveryCode: "NOT-A-RECOVERY-CODE",
      now,
    })).rejects.toEqual(expect.objectContaining<Partial<PasswordLoginError>>({
      code: "INVALID_CREDENTIALS",
    }));

    expect(prismaMock.passwordCredential.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-one" },
      data: {
        failedAttempts: { increment: 1 },
        lockedUntil: new Date("2026-07-29T12:15:00.000Z"),
      },
    });
  });

  it("does not spend a failure before the UI has asked for the second factor", async () => {
    prismaMock.user.findUnique.mockResolvedValue(loginUser(0));

    await expect(authenticatePasswordLogin({
      email: "pastor@example.com",
      password,
      now,
    })).rejects.toEqual(expect.objectContaining<Partial<PasswordLoginError>>({
      code: "MFA_REQUIRED",
    }));

    expect(prismaMock.passwordCredential.updateMany).not.toHaveBeenCalled();
  });
});
