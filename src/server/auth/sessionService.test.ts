import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_COOKIE_NAME,
  SessionError,
  createSessionService,
  type SessionRepository,
  type StoredSessionPrincipal,
} from "@/server/auth/sessionService";

const NOW = new Date("2026-07-29T12:00:00.000Z");
const PEPPER = "sermonclip-test-session-pepper-with-32-plus-characters";

function principal(
  overrides: Partial<StoredSessionPrincipal> = {},
): StoredSessionPrincipal {
  return {
    sessionId: "session_one",
    tokenHash: "hash",
    userId: "user_one",
    userStatus: "ACTIVE",
    organizationId: "org_one",
    organizationStatus: "ACTIVE",
    campusId: "campus_one",
    campusStatus: "ACTIVE",
    membershipStatus: "ACTIVE",
    createdAt: NOW,
    lastSeenAt: NOW,
    idleExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
    absoluteExpiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60_000),
    revokedAt: null,
    ...overrides,
  };
}

function fixture(options: {
  activeMembership?: boolean;
  storedPrincipal?: StoredSessionPrincipal | null;
} = {}) {
  let capturedPrincipal = options.storedPrincipal;
  const repository: SessionRepository = {
    membershipIsActive: vi.fn(async () => options.activeMembership ?? true),
    createSession: vi.fn(async (input) => {
      capturedPrincipal = principal({
        tokenHash: input.tokenHash,
        userId: input.userId,
        organizationId: input.organizationId,
        campusId: input.campusId,
        createdAt: input.createdAt,
        lastSeenAt: input.lastSeenAt,
        idleExpiresAt: input.idleExpiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      });
      return { id: "session_one" };
    }),
    findSessionByTokenHash: vi.fn(async () => capturedPrincipal ?? null),
    touchSession: vi.fn(async () => undefined),
    revokeSession: vi.fn(async () => undefined),
    revokeAllUserSessions: vi.fn(async () => 2),
  };
  return {
    repository,
    service: createSessionService(repository, {
      tokenPepper: PEPPER,
    }),
  };
}

describe("secure session lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an opaque, HttpOnly host cookie only for active members", async () => {
    const { repository, service } = fixture();
    const created = await service.createSession({
      userId: "user_one",
      organizationId: "org_one",
      campusId: "campus_one",
      now: NOW,
    });

    expect(created.token).toMatch(/^scs_/);
    expect(created.cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(created.cookie).toContain("HttpOnly");
    expect(created.cookie).toContain("Secure");
    expect(created.cookie).toContain("SameSite=Lax");
    expect(repository.createSession).toHaveBeenCalledOnce();
  });

  it("fails closed when membership is inactive", async () => {
    const { service } = fixture({ activeMembership: false });

    await expect(service.createSession({
      userId: "user_one",
      organizationId: "org_one",
      now: NOW,
    })).rejects.toMatchObject({ reason: "MEMBERSHIP_INACTIVE" });
  });

  it("resolves an active session and slides idle expiry", async () => {
    const active = principal({
      lastSeenAt: new Date(NOW.getTime() - 10 * 60_000),
    });
    const { repository, service } = fixture({ storedPrincipal: active });

    await expect(service.resolveSession(
      "scs_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      NOW,
    )).resolves.toMatchObject({
      sessionId: "session_one",
      organizationId: "org_one",
      campusId: "campus_one",
    });
    expect(repository.touchSession).toHaveBeenCalledOnce();
  });

  it.each([
    { revokedAt: NOW },
    { userStatus: "SUSPENDED" },
    { organizationStatus: "SUSPENDED" },
    { membershipStatus: "REVOKED" },
    { campusStatus: "INACTIVE" },
  ])("rejects inactive principal state %#", async (state) => {
    const { service } = fixture({
      storedPrincipal: principal(state),
    });

    await expect(service.resolveSession(
      "scs_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      NOW,
    )).rejects.toBeInstanceOf(SessionError);
  });

  it("rejects idle and absolute expiry", async () => {
    const { service: idle } = fixture({
      storedPrincipal: principal({
        idleExpiresAt: NOW,
      }),
    });
    const { service: absolute } = fixture({
      storedPrincipal: principal({
        absoluteExpiresAt: NOW,
      }),
    });

    await expect(idle.resolveSession(
      "scs_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      NOW,
    )).rejects.toMatchObject({ reason: "SESSION_EXPIRED" });
    await expect(absolute.resolveSession(
      "scs_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      NOW,
    )).rejects.toMatchObject({ reason: "SESSION_EXPIRED" });
  });

  it("supports single-session and account-wide revocation", async () => {
    const { repository, service } = fixture();

    await service.revokeSession("session_one", "user_sign_out", NOW);
    await expect(service.revokeAllUserSessions("user_one", {
      exceptSessionId: "session_one",
      revokedAt: NOW,
    })).resolves.toBe(2);
    expect(repository.revokeSession).toHaveBeenCalledWith({
      sessionId: "session_one",
      revokedAt: NOW,
      reason: "user_sign_out",
    });
  });
});
