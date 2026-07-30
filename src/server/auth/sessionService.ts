import { createOpaqueToken, hashOpaqueToken } from "@/server/auth/credentials";

export const SESSION_COOKIE_NAME = "__Host-sermonclip_session";
export const SESSION_IDLE_TTL_MS = 30 * 60 * 1_000;
export const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1_000;

export type StoredSessionPrincipal = Readonly<{
  sessionId: string;
  tokenHash: string;
  userId: string;
  userStatus: string;
  organizationId: string;
  organizationStatus: string;
  campusId: string | null;
  campusStatus: string | null;
  membershipStatus: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}>;

export type ResolvedSession = Readonly<{
  sessionId: string;
  userId: string;
  organizationId: string;
  campusId: string | null;
  expiresAt: Date;
}>;

type CreateSessionRecord = Readonly<{
  tokenHash: string;
  userId: string;
  organizationId: string;
  campusId: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  ipAddressHash: string | null;
  userAgentHash: string | null;
}>;

export type SessionRepository = {
  membershipIsActive(input: {
    userId: string;
    organizationId: string;
    campusId: string | null;
  }): Promise<boolean>;
  createSession(input: CreateSessionRecord): Promise<{ id: string }>;
  findSessionByTokenHash(
    tokenHash: string,
    now?: Date,
  ): Promise<StoredSessionPrincipal | null>;
  touchSession(input: {
    sessionId: string;
    lastSeenAt: Date;
    idleExpiresAt: Date;
  }): Promise<void>;
  revokeSession(input: {
    sessionId: string;
    revokedAt: Date;
    reason: string;
  }): Promise<void>;
  revokeAllUserSessions(input: {
    userId: string;
    revokedAt: Date;
    reason: string;
    exceptSessionId?: string;
  }): Promise<number>;
};

export type SessionServiceOptions = Readonly<{
  tokenPepper: string;
  idleTtlMs?: number;
  absoluteTtlMs?: number;
}>;

export class SessionError extends Error {
  readonly reason:
    | "INVALID_REQUEST"
    | "MEMBERSHIP_INACTIVE"
    | "SESSION_INVALID"
    | "SESSION_EXPIRED";

  constructor(
    reason: SessionError["reason"],
    message = "The session is not valid.",
  ) {
    super(message);
    this.name = "SessionError";
    this.reason = reason;
  }
}

function canonicalId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized !== value) {
    throw new SessionError(
      "INVALID_REQUEST",
      `${label} must be a non-empty canonical identifier.`,
    );
  }
  return normalized;
}

function positiveTtl(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new SessionError("INVALID_REQUEST", `${label} must be positive.`);
  }
  return value;
}

function principalIsActive(principal: StoredSessionPrincipal): boolean {
  return principal.userStatus === "ACTIVE"
    && principal.organizationStatus === "ACTIVE"
    && principal.membershipStatus === "ACTIVE"
    && (
      principal.campusId === null
      || principal.campusStatus === "ACTIVE"
    );
}

export function buildSessionCookie(
  token: string,
  expiresAt: Date,
): string {
  if (!token.startsWith("scs_") || Number.isNaN(expiresAt.getTime())) {
    throw new SessionError("INVALID_REQUEST", "Session cookie input is invalid.");
  }
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ].join("; ");
}

export function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

export function createSessionService(
  repository: SessionRepository,
  options: SessionServiceOptions,
) {
  const idleTtlMs = positiveTtl(
    options.idleTtlMs ?? SESSION_IDLE_TTL_MS,
    "Idle session TTL",
  );
  const absoluteTtlMs = positiveTtl(
    options.absoluteTtlMs ?? SESSION_ABSOLUTE_TTL_MS,
    "Absolute session TTL",
  );
  if (idleTtlMs > absoluteTtlMs) {
    throw new SessionError(
      "INVALID_REQUEST",
      "Idle session TTL cannot exceed the absolute session TTL.",
    );
  }

  async function createSession(input: Readonly<{
    userId: string;
    organizationId: string;
    campusId?: string | null;
    ipAddressHash?: string | null;
    userAgentHash?: string | null;
    now?: Date;
  }>): Promise<{
    token: string;
    session: ResolvedSession;
    cookie: string;
  }> {
    canonicalId(input.userId, "User id");
    canonicalId(input.organizationId, "Organization id");
    if (input.campusId) canonicalId(input.campusId, "Campus id");
    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime())) {
      throw new SessionError("INVALID_REQUEST", "Session time is invalid.");
    }

    const active = await repository.membershipIsActive({
      userId: input.userId,
      organizationId: input.organizationId,
      campusId: input.campusId ?? null,
    });
    if (!active) {
      throw new SessionError(
        "MEMBERSHIP_INACTIVE",
        "An active membership is required to start a session.",
      );
    }

    const token = createOpaqueToken("scs");
    const idleExpiresAt = new Date(now.getTime() + idleTtlMs);
    const absoluteExpiresAt = new Date(now.getTime() + absoluteTtlMs);
    const stored = await repository.createSession({
      tokenHash: hashOpaqueToken(token, options.tokenPepper),
      userId: input.userId,
      organizationId: input.organizationId,
      campusId: input.campusId ?? null,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt,
      absoluteExpiresAt,
      ipAddressHash: input.ipAddressHash ?? null,
      userAgentHash: input.userAgentHash ?? null,
    });
    const session: ResolvedSession = {
      sessionId: stored.id,
      userId: input.userId,
      organizationId: input.organizationId,
      campusId: input.campusId ?? null,
      expiresAt: absoluteExpiresAt,
    };
    return {
      token,
      session,
      cookie: buildSessionCookie(token, absoluteExpiresAt),
    };
  }

  async function resolveSession(
    token: string,
    now = new Date(),
  ): Promise<ResolvedSession> {
    if (!token.startsWith("scs_") || Number.isNaN(now.getTime())) {
      throw new SessionError("SESSION_INVALID");
    }
    const principal = await repository.findSessionByTokenHash(
      hashOpaqueToken(token, options.tokenPepper),
      now,
    );
    if (!principal || principal.revokedAt || !principalIsActive(principal)) {
      throw new SessionError("SESSION_INVALID");
    }
    if (
      principal.idleExpiresAt <= now
      || principal.absoluteExpiresAt <= now
    ) {
      throw new SessionError("SESSION_EXPIRED", "The session has expired.");
    }

    if (now.getTime() - principal.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
      const idleExpiresAt = new Date(Math.min(
        now.getTime() + idleTtlMs,
        principal.absoluteExpiresAt.getTime(),
      ));
      await repository.touchSession({
        sessionId: principal.sessionId,
        lastSeenAt: now,
        idleExpiresAt,
      });
    }

    return {
      sessionId: principal.sessionId,
      userId: principal.userId,
      organizationId: principal.organizationId,
      campusId: principal.campusId,
      expiresAt: principal.absoluteExpiresAt,
    };
  }

  return {
    createSession,
    resolveSession,
    revokeSession(
      sessionId: string,
      reason: string,
      revokedAt = new Date(),
    ) {
      canonicalId(sessionId, "Session id");
      return repository.revokeSession({
        sessionId,
        revokedAt,
        reason: reason.trim() || "user_sign_out",
      });
    },
    revokeAllUserSessions(
      userId: string,
      options: Readonly<{
        reason?: string;
        exceptSessionId?: string;
        revokedAt?: Date;
      }> = {},
    ) {
      canonicalId(userId, "User id");
      return repository.revokeAllUserSessions({
        userId,
        revokedAt: options.revokedAt ?? new Date(),
        reason: options.reason?.trim() || "security_revocation",
        exceptSessionId: options.exceptSessionId,
      });
    },
  };
}

export const __sessionTestUtils = {
  principalIsActive,
};
