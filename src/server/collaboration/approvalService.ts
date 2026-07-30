import { Prisma } from "@prisma/client";
import type {
  ApprovalDecisionType,
  ApprovalPolicyMode,
  MembershipRole,
} from "@prisma/client";

import type { AppPrismaClient } from "@/lib/prisma";
import {
  assertCurrentApprovalRevision,
  evaluateApproval,
  weekDraftTenantWhere,
  type ApprovalPolicySnapshot,
  type WeekDraftTenantContext,
} from "@/server/weekDraft/domain";

type ApprovalTransaction = Pick<
  AppPrismaClient,
  | "$queryRaw"
  | "membership"
  | "campus"
  | "approvalPolicy"
  | "approvalPolicyRule"
  | "approvalRequest"
  | "approvalDecision"
  | "weekDraft"
  | "weekDraftItem"
>;

export class ApprovalServiceError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "MEMBERSHIP_REQUIRED"
      | "APPROVAL_FORBIDDEN"
      | "REQUEST_CLOSED",
    message: string,
  ) {
    super(message);
    this.name = "ApprovalServiceError";
  }
}

async function requireActiveMemberRole(
  tx: ApprovalTransaction,
  tenant: WeekDraftTenantContext,
  userId: string,
  role?: MembershipRole,
): Promise<MembershipRole> {
  const memberships = await tx.membership.findMany({
    where: {
      organizationId: tenant.organizationId,
      userId,
      status: "ACTIVE",
      ...(role ? { role } : {}),
      ...(tenant.campusId
        ? { OR: [{ campusId: null }, { campusId: tenant.campusId }] }
        : { campusId: null }),
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      user: { status: "ACTIVE" },
    },
    select: { role: true, campusId: true },
  });
  const membership =
    memberships.find((candidate) => candidate.campusId === tenant.campusId)
    ?? memberships.find((candidate) => candidate.campusId === null);
  if (!membership) {
    throw new ApprovalServiceError(
      "MEMBERSHIP_REQUIRED",
      "Approval work is limited to active members of this workspace.",
    );
  }
  return membership.role;
}

function validatePolicyRules(
  minimumApprovals: number,
  rules: readonly Readonly<{
    role: MembershipRole;
    minimumApprovals?: number;
  }>[],
): void {
  if (
    !Number.isSafeInteger(minimumApprovals)
    || minimumApprovals < 1
    || rules.length === 0
    || new Set(rules.map((rule) => rule.role)).size !== rules.length
    || rules.some(
      (rule) =>
        !Number.isSafeInteger(rule.minimumApprovals ?? 1)
        || (rule.minimumApprovals ?? 1) < 1,
    )
  ) {
    throw new ApprovalServiceError(
      "INVALID_INPUT",
      "Approval policies require unique roles and positive approval thresholds.",
    );
  }
}

export async function createApprovalPolicy(
  tx: ApprovalTransaction,
  input: Readonly<{
    tenant: WeekDraftTenantContext;
    name: string;
    mode: ApprovalPolicyMode;
    minimumApprovals: number;
    allowSelfApproval?: boolean;
    isDefault?: boolean;
    createdByUserId?: string | null;
    rules: readonly Readonly<{
      role: MembershipRole;
      minimumApprovals?: number;
    }>[];
  }>,
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name) {
    throw new ApprovalServiceError(
      "INVALID_INPUT",
      "An approval policy name is required.",
    );
  }
  validatePolicyRules(input.minimumApprovals, input.rules);
  if (input.createdByUserId) {
    await requireActiveMemberRole(tx, input.tenant, input.createdByUserId);
  }
  if (input.tenant.campusId) {
    const campus = await tx.campus.findFirst({
      where: {
        id: input.tenant.campusId,
        organizationId: input.tenant.organizationId,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!campus) {
      throw new ApprovalServiceError(
        "NOT_FOUND",
        "The approval policy campus is not active in this organization.",
      );
    }
  }

  const policy = await tx.approvalPolicy.create({
    data: {
      organizationId: input.tenant.organizationId,
      campusId: input.tenant.campusId ?? null,
      name,
      mode: input.mode,
      minimumApprovals: input.minimumApprovals,
      allowSelfApproval: input.allowSelfApproval ?? false,
      isDefault: input.isDefault ?? false,
      createdByUserId: input.createdByUserId ?? null,
    },
    select: { id: true },
  });
  await tx.approvalPolicyRule.createMany({
    data: input.rules.map((rule, index) => ({
      organizationId: input.tenant.organizationId,
      campusId: input.tenant.campusId ?? null,
      approvalPolicyId: policy.id,
      role: rule.role,
      minimumApprovals: rule.minimumApprovals ?? 1,
      sortOrder: index,
    })),
  });
  return policy;
}

function policySnapshot(input: Readonly<{
  id: string;
  name: string;
  mode: ApprovalPolicyMode;
  minimumApprovals: number;
  allowSelfApproval: boolean;
  rules: readonly Readonly<{
    role: MembershipRole;
    minimumApprovals: number;
  }>[];
}>): ApprovalPolicySnapshot {
  return {
    policyId: input.id,
    policyName: input.name,
    mode: input.mode,
    minimumApprovals: input.minimumApprovals,
    allowSelfApproval: input.allowSelfApproval,
    rules: input.rules.map((rule) => ({
      role: rule.role,
      minimumApprovals: rule.minimumApprovals,
    })),
  };
}

function parsePolicySnapshot(value: Prisma.JsonValue): ApprovalPolicySnapshot {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new ApprovalServiceError(
      "INVALID_INPUT",
      "The approval policy snapshot is invalid.",
    );
  }
  const record = value as Record<string, Prisma.JsonValue>;
  const rules = record.rules;
  if (
    typeof record.policyId !== "string"
    || typeof record.policyName !== "string"
    || !["ANY_APPROVER", "ALL_REQUIRED_ROLES", "QUORUM"].includes(
      String(record.mode),
    )
    || typeof record.minimumApprovals !== "number"
    || typeof record.allowSelfApproval !== "boolean"
    || !Array.isArray(rules)
  ) {
    throw new ApprovalServiceError(
      "INVALID_INPUT",
      "The approval policy snapshot is invalid.",
    );
  }

  const parsedRules = rules.map((rule) => {
    if (
      !rule
      || Array.isArray(rule)
      || typeof rule !== "object"
      || typeof rule.role !== "string"
      || typeof rule.minimumApprovals !== "number"
    ) {
      throw new ApprovalServiceError(
        "INVALID_INPUT",
        "The approval policy role snapshot is invalid.",
      );
    }
    return {
      role: rule.role,
      minimumApprovals: rule.minimumApprovals,
    };
  });

  return {
    policyId: record.policyId,
    policyName: record.policyName,
    mode: record.mode as ApprovalPolicySnapshot["mode"],
    minimumApprovals: record.minimumApprovals,
    allowSelfApproval: record.allowSelfApproval,
    rules: parsedRules,
  };
}

export async function requestWeekDraftItemApproval(
  tx: ApprovalTransaction,
  input: Readonly<{
    tenant: WeekDraftTenantContext;
    weekDraftItemId: string;
    approvalPolicyId: string;
    requestedByUserId: string;
    message?: string | null;
  }>,
): Promise<{ id: string; revisionId: string }> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "WeekDraftItem"
    WHERE "id" = ${input.weekDraftItemId}
      AND "organizationId" = ${input.tenant.organizationId}
    FOR UPDATE
  `);
  const item = await tx.weekDraftItem.findFirst({
    where: {
      id: input.weekDraftItemId,
      ...weekDraftTenantWhere(input.tenant),
    },
    select: {
      id: true,
      weekDraftId: true,
      currentRevisionId: true,
      status: true,
      weekDraft: { select: { status: true } },
    },
  });
  if (!item || !item.currentRevisionId) {
    throw new ApprovalServiceError(
      "NOT_FOUND",
      "The current Week Draft item revision does not belong to the active tenant.",
    );
  }
  if (
    item.status !== "READY_FOR_REVIEW"
    || !["READY_FOR_REVIEW", "IN_REVIEW"].includes(item.weekDraft.status)
  ) {
    throw new ApprovalServiceError(
      "INVALID_INPUT",
      "The Week Draft and item must be ready for review before approval is requested.",
    );
  }

  await requireActiveMemberRole(tx, input.tenant, input.requestedByUserId);
  const policy = await tx.approvalPolicy.findFirst({
    where: {
      id: input.approvalPolicyId,
      organizationId: input.tenant.organizationId,
      status: "ACTIVE",
      ...(input.tenant.campusId
        ? { OR: [{ campusId: null }, { campusId: input.tenant.campusId }] }
        : { campusId: null }),
    },
    select: {
      id: true,
      name: true,
      mode: true,
      minimumApprovals: true,
      allowSelfApproval: true,
      rules: {
        select: { role: true, minimumApprovals: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!policy) {
    throw new ApprovalServiceError(
      "NOT_FOUND",
      "The approval policy does not belong to the active tenant.",
    );
  }
  validatePolicyRules(policy.minimumApprovals, policy.rules);
  const snapshot = policySnapshot(policy);

  const request = await tx.approvalRequest.create({
    data: {
      organizationId: input.tenant.organizationId,
      campusId: input.tenant.campusId ?? null,
      weekDraftId: item.weekDraftId,
      weekDraftItemId: item.id,
      revisionId: item.currentRevisionId,
      approvalPolicyId: policy.id,
      requestedByUserId: input.requestedByUserId,
      policySnapshotJson: snapshot as Prisma.InputJsonValue,
      message: input.message?.trim() || null,
    },
    select: { id: true, revisionId: true },
  });
  await tx.weekDraftItem.update({
    where: { id: item.id },
    data: { status: "IN_REVIEW" },
  });
  if (item.weekDraft.status === "READY_FOR_REVIEW") {
    await tx.weekDraft.update({
      where: { id: item.weekDraftId },
      data: { status: "IN_REVIEW" },
    });
  }

  return request;
}

export async function decideWeekDraftItemApproval(
  tx: ApprovalTransaction,
  input: Readonly<{
    tenant: WeekDraftTenantContext;
    approvalRequestId: string;
    decidedByUserId: string;
    decidedAsRole: MembershipRole;
    decision: ApprovalDecisionType;
    reason?: string | null;
  }>,
): Promise<{
  status: "PENDING" | "APPROVED" | "CHANGES_REQUESTED";
  approvals: number;
}> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "ApprovalRequest"
    WHERE "id" = ${input.approvalRequestId}
      AND "organizationId" = ${input.tenant.organizationId}
    FOR UPDATE
  `);
  const request = await tx.approvalRequest.findFirst({
    where: {
      id: input.approvalRequestId,
      ...weekDraftTenantWhere(input.tenant),
    },
    select: {
      id: true,
      weekDraftId: true,
      weekDraftItemId: true,
      revisionId: true,
      requestedByUserId: true,
      status: true,
      policySnapshotJson: true,
      weekDraftItem: { select: { currentRevisionId: true } },
      decisions: {
        select: {
          decidedByUserId: true,
          decidedAsRole: true,
          decision: true,
        },
      },
    },
  });
  if (!request) {
    throw new ApprovalServiceError(
      "NOT_FOUND",
      "The approval request does not belong to the active tenant.",
    );
  }
  if (request.status !== "PENDING") {
    throw new ApprovalServiceError(
      "REQUEST_CLOSED",
      "This approval request is no longer open.",
    );
  }
  assertCurrentApprovalRevision(
    request.weekDraftItem.currentRevisionId,
    request.revisionId,
  );

  const snapshot = parsePolicySnapshot(request.policySnapshotJson);
  if (
    !snapshot.allowSelfApproval
    && request.requestedByUserId === input.decidedByUserId
  ) {
    throw new ApprovalServiceError(
      "APPROVAL_FORBIDDEN",
      "This policy does not allow requesters to approve their own work.",
    );
  }
  if (!snapshot.rules.some((rule) => rule.role === input.decidedAsRole)) {
    throw new ApprovalServiceError(
      "APPROVAL_FORBIDDEN",
      "The selected role is not eligible under this approval policy.",
    );
  }
  await requireActiveMemberRole(
    tx,
    input.tenant,
    input.decidedByUserId,
    input.decidedAsRole,
  );

  const reason = input.reason?.trim() || null;
  if (input.decision === "REQUEST_CHANGES" && !reason) {
    throw new ApprovalServiceError(
      "INVALID_INPUT",
      "A reason is required when requesting changes.",
    );
  }

  await tx.approvalDecision.create({
    data: {
      organizationId: input.tenant.organizationId,
      campusId: input.tenant.campusId ?? null,
      approvalRequestId: request.id,
      revisionId: request.revisionId,
      decidedByUserId: input.decidedByUserId,
      decidedAsRole: input.decidedAsRole,
      decision: input.decision,
      reason,
    },
    select: { id: true },
  });

  const evaluation = evaluateApproval(snapshot, [
    ...request.decisions.map((decision) => ({
      userId: decision.decidedByUserId,
      role: decision.decidedAsRole,
      decision: decision.decision,
    })),
    {
      userId: input.decidedByUserId,
      role: input.decidedAsRole,
      decision: input.decision,
    },
  ]);

  if (evaluation.status === "PENDING") {
    return evaluation;
  }

  const now = new Date();
  await tx.approvalRequest.update({
    where: { id: request.id },
    data: { status: evaluation.status, resolvedAt: now },
  });

  if (evaluation.status === "CHANGES_REQUESTED") {
    await tx.weekDraftItem.update({
      where: { id: request.weekDraftItemId },
      data: { status: "CHANGES_REQUESTED", approvedRevisionId: null },
    });
    await tx.weekDraft.update({
      where: { id: request.weekDraftId },
      data: { status: "CHANGES_REQUESTED" },
    });
    return evaluation;
  }

  await tx.weekDraftItem.update({
    where: { id: request.weekDraftItemId },
    data: {
      status: "APPROVED",
      approvedRevisionId: request.revisionId,
    },
  });
  const remainingItems = await tx.weekDraftItem.count({
    where: {
      weekDraftId: request.weekDraftId,
      organizationId: input.tenant.organizationId,
      status: { notIn: ["APPROVED", "SKIPPED", "ARCHIVED"] },
    },
  });
  if (remainingItems === 0) {
    await tx.weekDraft.update({
      where: { id: request.weekDraftId },
      data: { status: "APPROVED" },
    });
  }

  return evaluation;
}
