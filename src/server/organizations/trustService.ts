import {
  Prisma,
  type MembershipRole,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  AuthorizationError,
  isOrganizationRole,
  requireActorCapability,
  type AuthorizationActor,
  type AuthorizationCapability,
} from "@/server/auth/authorization";
import {
  generateTrustToken,
  hashTrustToken,
  identityEmailIsValid,
  normalizeIdentityEmail,
  trustTokenIsWellFormed,
  type TrustTokenPurpose,
} from "@/server/trust/tokens";

const DEFAULT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_INVITATION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_TRANSFER_TTL_MS = 48 * 60 * 60 * 1_000;
const MAX_TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const SERIALIZABLE_ATTEMPTS = 3;

type TransactionClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export type OrganizationTrustContext = Readonly<{
  organizationId: string;
  campusId: string | null;
  actorUserId: string;
  requestId?: string | null;
}>;

export type OrganizationTrustErrorCode =
  | "INVALID_INPUT"
  | "NOT_AUTHORIZED"
  | "ORGANIZATION_UNAVAILABLE"
  | "CAMPUS_UNAVAILABLE"
  | "USER_UNAVAILABLE"
  | "INVITATION_CONFLICT"
  | "INVITATION_INVALID"
  | "INVITATION_EXPIRED"
  | "MEMBERSHIP_UNAVAILABLE"
  | "MEMBERSHIP_PROTECTED"
  | "REASSIGNMENT_CONFLICT"
  | "TRANSFER_CONFLICT"
  | "TRANSFER_INVALID"
  | "TRANSFER_EXPIRED";

export class OrganizationTrustError extends Error {
  readonly code: OrganizationTrustErrorCode;

  constructor(code: OrganizationTrustErrorCode, message: string) {
    super(message);
    this.name = "OrganizationTrustError";
    this.code = code;
  }
}

type TrustServiceOptions = Readonly<{
  now?: Date;
  tokenFactory?: (purpose: TrustTokenPurpose) => string;
}>;

function trustedNow(options: TrustServiceOptions): Date {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new OrganizationTrustError("INVALID_INPUT", "The operation time is invalid.");
  }
  return now;
}

function canonicalId(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 191
    || value.trim() !== value
  ) {
    throw new OrganizationTrustError("INVALID_INPUT", `${label} is invalid.`);
  }
}

function optionalReason(value: string | null | undefined): string | null {
  if (value == null || value.trim() === "") {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length > 500) {
    throw new OrganizationTrustError(
      "INVALID_INPUT",
      "The transfer reason must be 500 characters or fewer.",
    );
  }
  return normalized;
}

function resolveExpiry(
  now: Date,
  requested: Date | undefined,
  defaultTtlMs: number,
  maxTtlMs: number,
): Date {
  const expiresAt = requested ?? new Date(now.getTime() + defaultTtlMs);
  const ttl = expiresAt.getTime() - now.getTime();
  if (!Number.isFinite(expiresAt.getTime()) || ttl <= 0 || ttl > maxTtlMs) {
    throw new OrganizationTrustError(
      "INVALID_INPUT",
      "The expiry must be in the future and within the allowed lifetime.",
    );
  }
  return expiresAt;
}

function tokenFromFactory(
  purpose: TrustTokenPurpose,
  options: TrustServiceOptions,
): string {
  const token = (options.tokenFactory ?? generateTrustToken)(purpose);
  if (!trustTokenIsWellFormed(token) || !token.startsWith(`sc_${purpose}_`)) {
    throw new OrganizationTrustError(
      "INVALID_INPUT",
      "The token generator returned an invalid secret.",
    );
  }
  return token;
}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2034";
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002";
}

async function inSerializableTransaction<T>(
  operation: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === SERIALIZABLE_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new Error("Unreachable transaction retry state.");
}

async function assertActiveTenantScope(
  tx: TransactionClient,
  organizationId: string,
  campusId: string | null,
): Promise<void> {
  const organization = await tx.organization.findFirst({
    where: { id: organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!organization) {
    throw new OrganizationTrustError(
      "ORGANIZATION_UNAVAILABLE",
      "The organization is not active.",
    );
  }

  if (campusId === null) {
    return;
  }

  const campus = await tx.campus.findFirst({
    where: {
      id: campusId,
      organizationId,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (!campus) {
    throw new OrganizationTrustError(
      "CAMPUS_UNAVAILABLE",
      "The campus is not active in this organization.",
    );
  }
}

async function authorizationActor(
  tx: TransactionClient,
  organizationId: string,
  actorUserId: string,
): Promise<AuthorizationActor | null> {
  const principal = await tx.user.findFirst({
    where: { id: actorUserId },
    select: {
      id: true,
      status: true,
      memberships: {
        where: {
          organizationId,
          status: "ACTIVE",
        },
        select: {
          organizationId: true,
          campusId: true,
          role: true,
          expiresAt: true,
          organization: {
            select: { status: true },
          },
          campus: {
            select: {
              organizationId: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!principal) {
    return null;
  }

  return {
    userId: principal.id,
    organizationId,
    active: principal.status === "ACTIVE",
    roleBindings: principal.memberships
      .filter((membership) => (
        membership.organizationId === organizationId
        && membership.organization.status === "ACTIVE"
        && (
          membership.campusId === null
          || (
            membership.campus?.organizationId === organizationId
            && membership.campus.status === "ACTIVE"
          )
        )
        && isOrganizationRole(membership.role)
      ))
      .map((membership) => ({
        role: membership.role as Extract<typeof membership.role, MembershipRole>,
        scope: membership.campusId
          ? { kind: "CAMPUS" as const, campusId: membership.campusId }
          : { kind: "ORGANIZATION" as const },
        expiresAt: membership.expiresAt,
      })),
  };
}

async function assertCapability(
  tx: TransactionClient,
  context: OrganizationTrustContext,
  capability: AuthorizationCapability,
  campusId: string | null,
): Promise<void> {
  try {
    requireActorCapability(
      await authorizationActor(
        tx,
        context.organizationId,
        context.actorUserId,
      ),
      capability,
      {
        organizationId: context.organizationId,
        campusId,
        resource: null,
      },
    );
  } catch (error) {
    if (!(error instanceof AuthorizationError)) {
      throw error;
    }
    throw new OrganizationTrustError(
      "NOT_AUTHORIZED",
      "The actor is not authorized to perform this organization action.",
    );
  }
}

function assertInvitationRoleScope(
  role: MembershipRole,
  campusId: string | null,
): void {
  if (role === "OWNER") {
    throw new OrganizationTrustError(
      "INVALID_INPUT",
      "Ownership must be granted through the ownership-transfer workflow.",
    );
  }
  if (role === "EXTERNAL_CONTRACTOR") {
    throw new OrganizationTrustError(
      "INVALID_INPUT",
      "Contractor invitations require a membership-expiry field that is not yet available.",
    );
  }
  if (role === "ORG_ADMIN" && campusId !== null) {
    throw new OrganizationTrustError(
      "INVALID_INPUT",
      "Organization administrators must have organization scope.",
    );
  }
  if (role === "CAMPUS_ADMIN" && campusId === null) {
    throw new OrganizationTrustError(
      "INVALID_INPUT",
      "Campus administrators must have campus scope.",
    );
  }
}

export async function issueOrganizationInvitation(
  context: OrganizationTrustContext,
  input: Readonly<{
    email: string;
    role: MembershipRole;
    campusId: string | null;
    expiresAt?: Date;
  }>,
  options: TrustServiceOptions = {},
): Promise<Readonly<{
  invitationId: string;
  token: string;
  expiresAt: Date;
}>> {
  canonicalId(context.organizationId, "Organization id");
  canonicalId(context.actorUserId, "Actor user id");
  if (input.campusId !== null) {
    canonicalId(input.campusId, "Campus id");
  }
  if (!identityEmailIsValid(input.email)) {
    throw new OrganizationTrustError("INVALID_INPUT", "The invitation email is invalid.");
  }
  if (!isOrganizationRole(input.role)) {
    throw new OrganizationTrustError("INVALID_INPUT", "The invitation role is invalid.");
  }
  assertInvitationRoleScope(input.role, input.campusId);

  const now = trustedNow(options);
  const expiresAt = resolveExpiry(
    now,
    input.expiresAt,
    DEFAULT_INVITATION_TTL_MS,
    MAX_INVITATION_TTL_MS,
  );
  const normalizedEmail = normalizeIdentityEmail(input.email);
  const token = tokenFromFactory("invite", options);
  const tokenHash = hashTrustToken(token);

  try {
    const invitation = await inSerializableTransaction(async (tx) => {
      await assertActiveTenantScope(tx, context.organizationId, input.campusId);
      await assertCapability(tx, context, "invitations.manage", input.campusId);

      await tx.invitation.updateMany({
        where: {
          organizationId: context.organizationId,
          campusId: input.campusId,
          normalizedEmail,
          status: "PENDING",
          expiresAt: { lte: now },
        },
        data: { status: "EXPIRED" },
      });

      const duplicate = await tx.invitation.findFirst({
        where: {
          organizationId: context.organizationId,
          campusId: input.campusId,
          normalizedEmail,
          status: "PENDING",
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new OrganizationTrustError(
          "INVITATION_CONFLICT",
          "A pending invitation already exists for this email and scope.",
        );
      }

      const created = await tx.invitation.create({
        data: {
          organizationId: context.organizationId,
          campusId: input.campusId,
          email: input.email.trim(),
          normalizedEmail,
          role: input.role,
          tokenHash,
          invitedByUserId: context.actorUserId,
          expiresAt,
        },
        select: { id: true },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          campusId: input.campusId,
          actorType: "USER",
          actorUserId: context.actorUserId,
          action: "invitation.issued",
          targetType: "Invitation",
          targetId: created.id,
          requestId: context.requestId ?? null,
          metadataJson: {
            role: input.role,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });
      return created;
    });

    return { invitationId: invitation.id, token, expiresAt };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new OrganizationTrustError(
        "INVITATION_CONFLICT",
        "A pending invitation already exists for this email and scope.",
      );
    }
    throw error;
  }
}

export async function acceptOrganizationInvitation(
  input: Readonly<{
    organizationId: string;
    campusId: string | null;
    actorUserId: string;
    token: string;
    requestId?: string | null;
  }>,
  options: TrustServiceOptions = {},
): Promise<Readonly<{
  invitationId: string;
  membershipId: string;
  role: MembershipRole;
}>> {
  canonicalId(input.organizationId, "Organization id");
  canonicalId(input.actorUserId, "Actor user id");
  if (input.campusId !== null) {
    canonicalId(input.campusId, "Campus id");
  }
  if (!trustTokenIsWellFormed(input.token) || !input.token.startsWith("sc_invite_")) {
    throw new OrganizationTrustError("INVITATION_INVALID", "The invitation is invalid.");
  }

  const now = trustedNow(options);
  const result = await inSerializableTransaction(async (tx) => {
    const invitation = await tx.invitation.findFirst({
      where: {
        organizationId: input.organizationId,
        campusId: input.campusId,
        tokenHash: hashTrustToken(input.token),
      },
      select: {
        id: true,
        organizationId: true,
        campusId: true,
        normalizedEmail: true,
        role: true,
        status: true,
        expiresAt: true,
      },
    });
    if (!invitation || invitation.status !== "PENDING") {
      return { ok: false as const, code: "INVITATION_INVALID" as const };
    }

    if (invitation.expiresAt.getTime() <= now.getTime()) {
      await tx.invitation.updateMany({
        where: { id: invitation.id, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          campusId: input.campusId,
          actorType: "SYSTEM",
          action: "invitation.expired",
          targetType: "Invitation",
          targetId: invitation.id,
          requestId: input.requestId ?? null,
        },
      });
      return { ok: false as const, code: "INVITATION_EXPIRED" as const };
    }

    await assertActiveTenantScope(tx, input.organizationId, input.campusId);
    assertInvitationRoleScope(invitation.role, invitation.campusId);

    const user = await tx.user.findFirst({
      where: {
        id: input.actorUserId,
        normalizedEmail: invitation.normalizedEmail,
        status: { in: ["INVITED", "ACTIVE"] },
      },
      select: { id: true, status: true },
    });
    if (!user) {
      return { ok: false as const, code: "USER_UNAVAILABLE" as const };
    }

    const claimed = await tx.invitation.updateMany({
      where: {
        id: invitation.id,
        status: "PENDING",
        acceptedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        status: "ACCEPTED",
        acceptedAt: now,
        acceptedByUserId: user.id,
      },
    });
    if (claimed.count !== 1) {
      return { ok: false as const, code: "INVITATION_INVALID" as const };
    }

    const existingMembership = await tx.membership.findFirst({
      where: {
        organizationId: input.organizationId,
        campusId: input.campusId,
        userId: user.id,
      },
      select: { id: true },
    });
    const membership = existingMembership
      ? await tx.membership.update({
          where: { id: existingMembership.id },
          data: {
            role: invitation.role,
            status: "ACTIVE",
            joinedAt: now,
            expiresAt: null,
          },
          select: { id: true, role: true },
        })
      : await tx.membership.create({
          data: {
            organizationId: input.organizationId,
            campusId: input.campusId,
            userId: user.id,
            role: invitation.role,
            status: "ACTIVE",
            joinedAt: now,
          },
          select: { id: true, role: true },
        });

    if (user.status === "INVITED") {
      await tx.user.update({
        where: { id: user.id },
        data: { status: "ACTIVE" },
      });
    }
    await tx.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        campusId: input.campusId,
        actorType: "USER",
        actorUserId: user.id,
        action: "invitation.accepted",
        targetType: "Invitation",
        targetId: invitation.id,
        requestId: input.requestId ?? null,
        metadataJson: {
          membershipId: membership.id,
          role: membership.role,
        },
      },
    });
    return {
      ok: true as const,
      invitationId: invitation.id,
      membershipId: membership.id,
      role: membership.role,
    };
  });

  if (!result.ok) {
    const messages: Record<typeof result.code, string> = {
      INVITATION_INVALID: "The invitation is invalid or has already been used.",
      INVITATION_EXPIRED: "The invitation has expired.",
      USER_UNAVAILABLE: "The signed-in user does not match this invitation.",
    };
    throw new OrganizationTrustError(result.code, messages[result.code]);
  }
  return {
    invitationId: result.invitationId,
    membershipId: result.membershipId,
    role: result.role,
  };
}

export async function revokeOrganizationInvitation(
  context: OrganizationTrustContext,
  invitationId: string,
  options: TrustServiceOptions = {},
): Promise<void> {
  canonicalId(context.organizationId, "Organization id");
  canonicalId(context.actorUserId, "Actor user id");
  canonicalId(invitationId, "Invitation id");
  const now = trustedNow(options);

  await inSerializableTransaction(async (tx) => {
    const invitation = await tx.invitation.findFirst({
      where: {
        id: invitationId,
        organizationId: context.organizationId,
      },
      select: { id: true, campusId: true, status: true },
    });
    if (!invitation || invitation.status !== "PENDING") {
      throw new OrganizationTrustError(
        "INVITATION_INVALID",
        "The pending invitation was not found in this organization.",
      );
    }
    await assertActiveTenantScope(tx, context.organizationId, invitation.campusId);
    await assertCapability(tx, context, "invitations.manage", invitation.campusId);
    const revoked = await tx.invitation.updateMany({
      where: { id: invitation.id, status: "PENDING" },
      data: { status: "REVOKED", revokedAt: now },
    });
    if (revoked.count !== 1) {
      throw new OrganizationTrustError(
        "INVITATION_INVALID",
        "The invitation is no longer pending.",
      );
    }
    await tx.auditEvent.create({
      data: {
        organizationId: context.organizationId,
        campusId: invitation.campusId,
        actorType: "USER",
        actorUserId: context.actorUserId,
        action: "invitation.revoked",
        targetType: "Invitation",
        targetId: invitation.id,
        requestId: context.requestId ?? null,
      },
    });
  });
}

export async function offboardOrganizationMember(
  context: OrganizationTrustContext,
  input: Readonly<{
    membershipId: string;
    reassignRoleToUserId?: string | null;
  }>,
  options: TrustServiceOptions = {},
): Promise<Readonly<{
  membershipId: string;
  reassignedMembershipId: string | null;
}>> {
  canonicalId(context.organizationId, "Organization id");
  canonicalId(context.actorUserId, "Actor user id");
  canonicalId(input.membershipId, "Membership id");
  if (input.reassignRoleToUserId != null) {
    canonicalId(input.reassignRoleToUserId, "Replacement user id");
  }
  const now = trustedNow(options);

  return inSerializableTransaction(async (tx) => {
    const target = await tx.membership.findFirst({
      where: {
        id: input.membershipId,
        organizationId: context.organizationId,
        status: { in: ["ACTIVE", "SUSPENDED"] },
      },
      select: {
        id: true,
        organizationId: true,
        campusId: true,
        userId: true,
        role: true,
        user: { select: { normalizedEmail: true } },
      },
    });
    if (!target) {
      throw new OrganizationTrustError(
        "MEMBERSHIP_UNAVAILABLE",
        "The active membership was not found in this organization.",
      );
    }
    await assertActiveTenantScope(tx, context.organizationId, target.campusId);
    await assertCapability(tx, context, "members.manage", target.campusId);

    if (target.userId === context.actorUserId) {
      throw new OrganizationTrustError(
        "MEMBERSHIP_PROTECTED",
        "Self-offboarding requires another administrator.",
      );
    }
    if (target.role === "OWNER") {
      throw new OrganizationTrustError(
        "MEMBERSHIP_PROTECTED",
        "Owners must use the ownership-transfer workflow before offboarding.",
      );
    }
    const pendingTransfer = await tx.ownershipTransfer.findFirst({
      where: {
        organizationId: context.organizationId,
        status: "PENDING",
        OR: [
          { fromUserId: target.userId },
          { toUserId: target.userId },
        ],
      },
      select: { id: true },
    });
    if (pendingTransfer) {
      throw new OrganizationTrustError(
        "MEMBERSHIP_PROTECTED",
        "Resolve the member's pending ownership transfer before offboarding.",
      );
    }

    let reassignedMembershipId: string | null = null;
    const replacementUserId = input.reassignRoleToUserId ?? null;
    if (replacementUserId !== null) {
      if (replacementUserId === target.userId) {
        throw new OrganizationTrustError(
          "REASSIGNMENT_CONFLICT",
          "The replacement must be a different user.",
        );
      }
      const replacement = await tx.user.findFirst({
        where: {
          id: replacementUserId,
          status: "ACTIVE",
          memberships: {
            some: {
              organizationId: context.organizationId,
              status: "ACTIVE",
            },
          },
        },
        select: { id: true },
      });
      if (!replacement) {
        throw new OrganizationTrustError(
          "REASSIGNMENT_CONFLICT",
          "The replacement must be an active member of this organization.",
        );
      }

      const exactReplacementMembership = await tx.membership.findFirst({
        where: {
          organizationId: context.organizationId,
          campusId: target.campusId,
          userId: replacement.id,
        },
        select: { id: true, role: true, status: true },
      });
      if (
        exactReplacementMembership?.status === "ACTIVE"
        && exactReplacementMembership.role !== target.role
      ) {
        throw new OrganizationTrustError(
          "REASSIGNMENT_CONFLICT",
          "The replacement already has a different active role in this scope.",
        );
      }

      const reassignedMembership = exactReplacementMembership
        ? await tx.membership.update({
            where: { id: exactReplacementMembership.id },
            data: {
              role: target.role,
              status: "ACTIVE",
              joinedAt: now,
              expiresAt: null,
            },
            select: { id: true },
          })
        : await tx.membership.create({
            data: {
              organizationId: context.organizationId,
              campusId: target.campusId,
              userId: replacement.id,
              role: target.role,
              status: "ACTIVE",
              joinedAt: now,
            },
            select: { id: true },
          });
      reassignedMembershipId = reassignedMembership.id;
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          campusId: target.campusId,
          actorType: "USER",
          actorUserId: context.actorUserId,
          action: "membership.responsibility_reassigned",
          targetType: "Membership",
          targetId: target.id,
          requestId: context.requestId ?? null,
          metadataJson: {
            replacementUserId: replacement.id,
            replacementMembershipId: reassignedMembership.id,
            role: target.role,
          },
        },
      });
    }

    const revoked = await tx.membership.updateMany({
      where: {
        id: target.id,
        organizationId: context.organizationId,
        status: { in: ["ACTIVE", "SUSPENDED"] },
      },
      data: {
        status: "REVOKED",
        expiresAt: now,
      },
    });
    if (revoked.count !== 1) {
      throw new OrganizationTrustError(
        "MEMBERSHIP_UNAVAILABLE",
        "The membership changed before it could be offboarded.",
      );
    }
    const reassignedAssignments = replacementUserId
      ? await tx.collaborationAssignment.updateMany({
          where: {
            organizationId: context.organizationId,
            campusId: target.campusId,
            assigneeUserId: target.userId,
            status: "ACTIVE",
          },
          data: { assigneeUserId: replacementUserId },
        })
      : await tx.collaborationAssignment.updateMany({
          where: {
            organizationId: context.organizationId,
            campusId: target.campusId,
            assigneeUserId: target.userId,
            status: "ACTIVE",
          },
          data: { status: "CANCELLED" },
        });
    const reassignedItems = await tx.weekDraftItem.updateMany({
      where: {
        organizationId: context.organizationId,
        campusId: target.campusId,
        assigneeUserId: target.userId,
        status: {
          in: [
            "DRAFT",
            "READY_FOR_REVIEW",
            "IN_REVIEW",
            "CHANGES_REQUESTED",
            "APPROVED",
          ],
        },
      },
      data: { assigneeUserId: replacementUserId },
    });
    const revokedSessions = await tx.userSession.updateMany({
      where: {
        organizationId: context.organizationId,
        ...(target.campusId === null ? {} : { campusId: target.campusId }),
        userId: target.userId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revocationReason: "membership_offboarded",
      },
    });
    await tx.invitation.updateMany({
      where: {
        organizationId: context.organizationId,
        campusId: target.campusId,
        normalizedEmail: target.user.normalizedEmail,
        status: "PENDING",
      },
      data: {
        status: "REVOKED",
        revokedAt: now,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: context.organizationId,
        campusId: target.campusId,
        actorType: "USER",
        actorUserId: context.actorUserId,
        action: "membership.offboarded",
        targetType: "Membership",
        targetId: target.id,
        requestId: context.requestId ?? null,
        metadataJson: {
          userId: target.userId,
          role: target.role,
          reassignedMembershipId,
          reassignedAssignmentCount: reassignedAssignments.count,
          reassignedWeekDraftItemCount: reassignedItems.count,
          revokedSessionCount: revokedSessions.count,
        },
      },
    });

    return {
      membershipId: target.id,
      reassignedMembershipId,
    };
  });
}

export async function initiateOwnershipTransfer(
  context: OrganizationTrustContext,
  input: Readonly<{
    toUserId: string;
    reason?: string | null;
    expiresAt?: Date;
  }>,
  options: TrustServiceOptions = {},
): Promise<Readonly<{
  transferId: string;
  token: string;
  expiresAt: Date;
}>> {
  canonicalId(context.organizationId, "Organization id");
  canonicalId(context.actorUserId, "Actor user id");
  canonicalId(input.toUserId, "Target user id");
  if (input.toUserId === context.actorUserId) {
    throw new OrganizationTrustError(
      "INVALID_INPUT",
      "Ownership cannot be transferred to the current owner.",
    );
  }

  const now = trustedNow(options);
  const expiresAt = resolveExpiry(
    now,
    input.expiresAt,
    DEFAULT_TRANSFER_TTL_MS,
    MAX_TRANSFER_TTL_MS,
  );
  const reason = optionalReason(input.reason);
  const token = tokenFromFactory("transfer", options);
  const tokenHash = hashTrustToken(token);

  try {
    const transfer = await inSerializableTransaction(async (tx) => {
      await assertActiveTenantScope(tx, context.organizationId, null);
      await assertCapability(tx, context, "organization.transfer", null);

      const sourceMembership = await tx.membership.findFirst({
        where: {
          organizationId: context.organizationId,
          campusId: null,
          userId: context.actorUserId,
          role: "OWNER",
          status: "ACTIVE",
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
        select: { id: true },
      });
      if (!sourceMembership) {
        throw new OrganizationTrustError(
          "NOT_AUTHORIZED",
          "Only an active organization owner can transfer ownership.",
        );
      }

      const targetMembership = await tx.membership.findFirst({
        where: {
          organizationId: context.organizationId,
          campusId: null,
          userId: input.toUserId,
          status: "ACTIVE",
          user: { status: "ACTIVE" },
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
        select: { id: true, role: true },
      });
      if (!targetMembership) {
        throw new OrganizationTrustError(
          "USER_UNAVAILABLE",
          "The new owner must be an active organization-level member.",
        );
      }
      if (targetMembership.role === "OWNER") {
        throw new OrganizationTrustError(
          "TRANSFER_CONFLICT",
          "The selected member is already an owner.",
        );
      }

      await tx.ownershipTransfer.updateMany({
        where: {
          organizationId: context.organizationId,
          status: "PENDING",
          expiresAt: { lte: now },
        },
        data: { status: "EXPIRED" },
      });
      const existing = await tx.ownershipTransfer.findFirst({
        where: {
          organizationId: context.organizationId,
          status: "PENDING",
        },
        select: { id: true },
      });
      if (existing) {
        throw new OrganizationTrustError(
          "TRANSFER_CONFLICT",
          "This organization already has a pending ownership transfer.",
        );
      }

      const created = await tx.ownershipTransfer.create({
        data: {
          organizationId: context.organizationId,
          campusId: null,
          fromUserId: context.actorUserId,
          toUserId: input.toUserId,
          initiatedByUserId: context.actorUserId,
          tokenHash,
          reason,
          expiresAt,
        },
        select: { id: true },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          campusId: null,
          actorType: "USER",
          actorUserId: context.actorUserId,
          action: "ownership_transfer.initiated",
          targetType: "OwnershipTransfer",
          targetId: created.id,
          requestId: context.requestId ?? null,
          metadataJson: {
            toUserId: input.toUserId,
            expiresAt: expiresAt.toISOString(),
            ...(reason ? { reason } : {}),
          },
        },
      });
      return created;
    });
    return { transferId: transfer.id, token, expiresAt };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new OrganizationTrustError(
        "TRANSFER_CONFLICT",
        "This organization already has a pending ownership transfer.",
      );
    }
    throw error;
  }
}

export async function acceptOwnershipTransfer(
  input: Readonly<{
    organizationId: string;
    actorUserId: string;
    token: string;
    requestId?: string | null;
  }>,
  options: TrustServiceOptions = {},
): Promise<Readonly<{
  transferId: string;
  previousOwnerUserId: string;
  ownerUserId: string;
}>> {
  canonicalId(input.organizationId, "Organization id");
  canonicalId(input.actorUserId, "Actor user id");
  if (!trustTokenIsWellFormed(input.token) || !input.token.startsWith("sc_transfer_")) {
    throw new OrganizationTrustError("TRANSFER_INVALID", "The ownership transfer is invalid.");
  }
  const now = trustedNow(options);

  const result = await inSerializableTransaction(async (tx) => {
    const transfer = await tx.ownershipTransfer.findFirst({
      where: {
        organizationId: input.organizationId,
        toUserId: input.actorUserId,
        tokenHash: hashTrustToken(input.token),
      },
      select: {
        id: true,
        status: true,
        fromUserId: true,
        toUserId: true,
        expiresAt: true,
      },
    });
    if (!transfer || transfer.status !== "PENDING") {
      return { ok: false as const, code: "TRANSFER_INVALID" as const };
    }
    if (transfer.expiresAt.getTime() <= now.getTime()) {
      await tx.ownershipTransfer.updateMany({
        where: { id: transfer.id, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          campusId: null,
          actorType: "SYSTEM",
          action: "ownership_transfer.expired",
          targetType: "OwnershipTransfer",
          targetId: transfer.id,
          requestId: input.requestId ?? null,
        },
      });
      return { ok: false as const, code: "TRANSFER_EXPIRED" as const };
    }

    await assertActiveTenantScope(tx, input.organizationId, null);
    const [sourceMembership, targetMembership] = await Promise.all([
      tx.membership.findFirst({
        where: {
          organizationId: input.organizationId,
          campusId: null,
          userId: transfer.fromUserId,
          role: "OWNER",
          status: "ACTIVE",
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
        select: { id: true },
      }),
      tx.membership.findFirst({
        where: {
          organizationId: input.organizationId,
          campusId: null,
          userId: transfer.toUserId,
          status: "ACTIVE",
          user: { status: "ACTIVE" },
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
        select: { id: true },
      }),
    ]);
    if (!sourceMembership || !targetMembership) {
      return { ok: false as const, code: "TRANSFER_INVALID" as const };
    }

    const claimed = await tx.ownershipTransfer.updateMany({
      where: {
        id: transfer.id,
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
      return { ok: false as const, code: "TRANSFER_INVALID" as const };
    }

    await tx.membership.update({
      where: { id: targetMembership.id },
      data: {
        role: "OWNER",
        status: "ACTIVE",
        joinedAt: now,
        expiresAt: null,
      },
    });
    await tx.membership.update({
      where: { id: sourceMembership.id },
      data: {
        role: "ORG_ADMIN",
        status: "ACTIVE",
        expiresAt: null,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        campusId: null,
        actorType: "USER",
        actorUserId: input.actorUserId,
        action: "ownership_transfer.accepted",
        targetType: "OwnershipTransfer",
        targetId: transfer.id,
        requestId: input.requestId ?? null,
        metadataJson: {
          previousOwnerUserId: transfer.fromUserId,
          ownerUserId: transfer.toUserId,
        },
      },
    });
    return {
      ok: true as const,
      transferId: transfer.id,
      previousOwnerUserId: transfer.fromUserId,
      ownerUserId: transfer.toUserId,
    };
  });

  if (!result.ok) {
    throw new OrganizationTrustError(
      result.code,
      result.code === "TRANSFER_EXPIRED"
        ? "The ownership transfer has expired."
        : "The ownership transfer is invalid or has already been used.",
    );
  }
  return {
    transferId: result.transferId,
    previousOwnerUserId: result.previousOwnerUserId,
    ownerUserId: result.ownerUserId,
  };
}

export async function cancelOwnershipTransfer(
  context: OrganizationTrustContext,
  transferId: string,
  options: TrustServiceOptions = {},
): Promise<void> {
  canonicalId(context.organizationId, "Organization id");
  canonicalId(context.actorUserId, "Actor user id");
  canonicalId(transferId, "Transfer id");
  const now = trustedNow(options);

  await inSerializableTransaction(async (tx) => {
    await assertActiveTenantScope(tx, context.organizationId, null);
    await assertCapability(tx, context, "organization.transfer", null);
    const transfer = await tx.ownershipTransfer.findFirst({
      where: {
        id: transferId,
        organizationId: context.organizationId,
        status: "PENDING",
      },
      select: { id: true, fromUserId: true },
    });
    if (!transfer || transfer.fromUserId !== context.actorUserId) {
      throw new OrganizationTrustError(
        "TRANSFER_INVALID",
        "The pending ownership transfer was not found.",
      );
    }
    const cancelled = await tx.ownershipTransfer.updateMany({
      where: { id: transfer.id, status: "PENDING" },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
      },
    });
    if (cancelled.count !== 1) {
      throw new OrganizationTrustError(
        "TRANSFER_INVALID",
        "The ownership transfer is no longer pending.",
      );
    }
    await tx.auditEvent.create({
      data: {
        organizationId: context.organizationId,
        campusId: null,
        actorType: "USER",
        actorUserId: context.actorUserId,
        action: "ownership_transfer.cancelled",
        targetType: "OwnershipTransfer",
        targetId: transfer.id,
        requestId: context.requestId ?? null,
      },
    });
  });
}
