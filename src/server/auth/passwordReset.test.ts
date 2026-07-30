import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  securityToken: {
    updateMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  passwordCredential: { update: vi.fn() },
  userSession: { updateMany: vi.fn() },
  auditEvent: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  completePasswordReset,
  issuePasswordReset,
  PasswordResetError,
} from "@/server/auth/passwordReset";

const AUTH_SECRET = "test-password-reset-pepper-with-more-than-32-characters";
const NOW = new Date("2026-07-29T10:00:00.000Z");

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  db.securityToken.updateMany.mockResolvedValue({ count: 1 });
  db.securityToken.create.mockResolvedValue({ id: "token-row" });
  db.passwordCredential.update.mockResolvedValue({ userId: "user-1" });
  db.userSession.updateMany.mockResolvedValue({ count: 2 });
  db.auditEvent.create.mockResolvedValue({ id: "audit-1" });
  db.$transaction.mockImplementation(async (input: unknown) => {
    if (Array.isArray(input)) return Promise.all(input);
    if (typeof input === "function") return input(db);
    throw new Error("Unexpected transaction input");
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("password reset", () => {
  it("does not disclose or persist a reset for an unknown account", async () => {
    db.user.findUnique.mockResolvedValue(null);

    await expect(issuePasswordReset({
      email: "unknown@example.com",
      now: NOW,
    })).resolves.toBeNull();
    expect(db.securityToken.create).not.toHaveBeenCalled();
  });

  it("stores only a hash and returns a short-lived delivery token", async () => {
    db.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "pastor@example.com",
      status: "ACTIVE",
      passwordCredential: { userId: "user-1" },
      securityTokens: [],
    });

    const delivery = await issuePasswordReset({
      email: "Pastor@Example.com",
      now: NOW,
    });

    expect(delivery?.token).toMatch(/^scpwr_[A-Za-z0-9_-]+$/);
    expect(delivery?.expiresAt.toISOString()).toBe("2026-07-29T10:30:00.000Z");
    const createInput = db.securityToken.create.mock.calls[0][0];
    expect(createInput.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createInput.data.tokenHash).not.toContain(delivery!.token);
  });

  it("consumes the token, rotates the password, and revokes active sessions", async () => {
    const issuedToken = `scpwr_${"a".repeat(48)}`;
    db.securityToken.findUnique.mockResolvedValue({
      id: "token-row",
      userId: "user-1",
      purpose: "PASSWORD_RESET",
      expiresAt: new Date("2026-07-29T10:30:00.000Z"),
      consumedAt: null,
      revokedAt: null,
      user: {
        status: "ACTIVE",
        passwordCredential: { userId: "user-1" },
        memberships: [{
          organizationId: "org-1",
          campusId: "campus-1",
        }],
      },
    });

    await completePasswordReset({
      token: issuedToken,
      password: "a secure replacement password",
      now: NOW,
    });

    expect(db.securityToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "token-row",
        consumedAt: null,
      }),
      data: { consumedAt: NOW },
    }));
    expect(db.passwordCredential.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1" },
      data: expect.objectContaining({
        failedAttempts: 0,
        lockedUntil: null,
      }),
    }));
    expect(db.userSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        revocationReason: "password-reset",
      }),
    }));
  });

  it("rejects malformed reset links before touching storage", async () => {
    await expect(completePasswordReset({
      token: "not-a-reset-token",
      password: "a secure replacement password",
      now: NOW,
    })).rejects.toEqual(expect.objectContaining<Partial<PasswordResetError>>({
      code: "INVALID_TOKEN",
    }));
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
