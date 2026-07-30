import type { AppPrismaClient } from "@/lib/prisma";
import {
  weekDraftTenantWhere,
  type WeekDraftTenantContext,
} from "@/server/weekDraft/domain";

type CollaborationTransaction = Pick<
  AppPrismaClient,
  | "membership"
  | "weekDraft"
  | "weekDraftItem"
  | "collaborationAssignment"
  | "collaborationComment"
  | "collaborationCommentMention"
>;

export class CollaborationServiceError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "MEMBERSHIP_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "CollaborationServiceError";
  }
}

async function requireActiveMember(
  tx: CollaborationTransaction,
  tenant: WeekDraftTenantContext,
  userId: string,
): Promise<void> {
  const membership = await tx.membership.findFirst({
    where: {
      organizationId: tenant.organizationId,
      userId,
      status: "ACTIVE",
      ...(tenant.campusId
        ? { OR: [{ campusId: null }, { campusId: tenant.campusId }] }
        : { campusId: null }),
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      user: { status: "ACTIVE" },
    },
    select: { id: true },
  });
  if (!membership) {
    throw new CollaborationServiceError(
      "MEMBERSHIP_REQUIRED",
      "Assignments and conversations are limited to active workspace members.",
    );
  }
}

async function requireDraftTarget(
  tx: CollaborationTransaction,
  tenant: WeekDraftTenantContext,
  weekDraftId: string,
  weekDraftItemId?: string | null,
): Promise<void> {
  if (weekDraftItemId) {
    const item = await tx.weekDraftItem.findFirst({
      where: {
        id: weekDraftItemId,
        weekDraftId,
        ...weekDraftTenantWhere(tenant),
      },
      select: { id: true },
    });
    if (!item) {
      throw new CollaborationServiceError(
        "NOT_FOUND",
        "The Week Draft item does not belong to the selected draft and tenant.",
      );
    }
    return;
  }

  const draft = await tx.weekDraft.findFirst({
    where: {
      id: weekDraftId,
      ...weekDraftTenantWhere(tenant),
    },
    select: { id: true },
  });
  if (!draft) {
    throw new CollaborationServiceError(
      "NOT_FOUND",
      "The Week Draft does not belong to the active tenant.",
    );
  }
}

export async function assignWeekDraftWork(
  tx: CollaborationTransaction,
  input: Readonly<{
    tenant: WeekDraftTenantContext;
    weekDraftId: string;
    weekDraftItemId?: string | null;
    assigneeUserId: string;
    assignedByUserId?: string | null;
    dueAt?: Date | null;
  }>,
): Promise<{ id: string }> {
  await requireDraftTarget(
    tx,
    input.tenant,
    input.weekDraftId,
    input.weekDraftItemId,
  );
  await requireActiveMember(tx, input.tenant, input.assigneeUserId);
  if (input.assignedByUserId) {
    await requireActiveMember(tx, input.tenant, input.assignedByUserId);
  }

  return tx.collaborationAssignment.create({
    data: {
      organizationId: input.tenant.organizationId,
      campusId: input.tenant.campusId ?? null,
      weekDraftId: input.weekDraftId,
      weekDraftItemId: input.weekDraftItemId ?? null,
      assigneeUserId: input.assigneeUserId,
      assignedByUserId: input.assignedByUserId ?? null,
      dueAt: input.dueAt ?? null,
    },
    select: { id: true },
  });
}

export async function completeWeekDraftAssignment(
  tx: CollaborationTransaction,
  input: Readonly<{
    tenant: WeekDraftTenantContext;
    assignmentId: string;
    completedByUserId: string;
  }>,
): Promise<void> {
  const assignment = await tx.collaborationAssignment.findFirst({
    where: {
      id: input.assignmentId,
      ...weekDraftTenantWhere(input.tenant),
      status: "ACTIVE",
    },
    select: { id: true, assigneeUserId: true },
  });
  if (!assignment) {
    throw new CollaborationServiceError(
      "NOT_FOUND",
      "The active assignment does not belong to the active tenant.",
    );
  }
  if (assignment.assigneeUserId !== input.completedByUserId) {
    throw new CollaborationServiceError(
      "INVALID_INPUT",
      "Only the assignee can mark this assignment complete.",
    );
  }
  await requireActiveMember(tx, input.tenant, input.completedByUserId);
  await tx.collaborationAssignment.update({
    where: { id: assignment.id },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

export async function addWeekDraftComment(
  tx: CollaborationTransaction,
  input: Readonly<{
    tenant: WeekDraftTenantContext;
    weekDraftId: string;
    weekDraftItemId?: string | null;
    authorUserId: string;
    body: string;
    mentionedUserIds?: readonly string[];
    parentCommentId?: string | null;
  }>,
): Promise<{ id: string }> {
  const body = input.body.trim();
  if (!body) {
    throw new CollaborationServiceError(
      "INVALID_INPUT",
      "A collaboration comment cannot be empty.",
    );
  }

  await requireDraftTarget(
    tx,
    input.tenant,
    input.weekDraftId,
    input.weekDraftItemId,
  );
  await requireActiveMember(tx, input.tenant, input.authorUserId);

  const mentionedUserIds = [
    ...new Set((input.mentionedUserIds ?? []).map((userId) => userId.trim())),
  ].filter(Boolean);
  for (const mentionedUserId of mentionedUserIds) {
    await requireActiveMember(tx, input.tenant, mentionedUserId);
  }

  if (input.parentCommentId) {
    const parent = await tx.collaborationComment.findFirst({
      where: {
        id: input.parentCommentId,
        weekDraftId: input.weekDraftId,
        weekDraftItemId: input.weekDraftItemId ?? null,
        ...weekDraftTenantWhere(input.tenant),
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!parent) {
      throw new CollaborationServiceError(
        "NOT_FOUND",
        "The parent comment is not in this conversation.",
      );
    }
  }

  const comment = await tx.collaborationComment.create({
    data: {
      organizationId: input.tenant.organizationId,
      campusId: input.tenant.campusId ?? null,
      weekDraftId: input.weekDraftId,
      weekDraftItemId: input.weekDraftItemId ?? null,
      authorUserId: input.authorUserId,
      parentCommentId: input.parentCommentId ?? null,
      body,
    },
    select: { id: true },
  });
  if (mentionedUserIds.length > 0) {
    await tx.collaborationCommentMention.createMany({
      data: mentionedUserIds.map((mentionedUserId) => ({
        organizationId: input.tenant.organizationId,
        campusId: input.tenant.campusId ?? null,
        commentId: comment.id,
        mentionedUserId,
      })),
    });
  }
  return comment;
}
