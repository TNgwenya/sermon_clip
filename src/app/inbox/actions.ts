"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { AuthorizationError } from "@/server/auth/authorization";
import {
  requireApprovalRequestActionTarget,
  requireAssignmentActionTarget,
  requireWeekDraftActionTarget,
  requireWeekDraftItemActionTarget,
  CollaborationActionTargetNotFoundError,
} from "@/server/collaboration/actionAuthorization";
import {
  ApprovalServiceError,
  decideWeekDraftItemApproval,
  requestWeekDraftItemApproval,
} from "@/server/collaboration/approvalService";
import {
  addWeekDraftComment,
  assignWeekDraftWork,
  CollaborationServiceError,
  completeWeekDraftAssignment,
} from "@/server/collaboration/service";

export type CollaborationActionResult = Readonly<{
  success: boolean;
  message: string;
  weekDraftId?: string;
  weekDraftItemId?: string | null;
  approvalRequestId?: string;
}>;

const idSchema = z.string().trim().min(1).max(128);
const nullableIdSchema = z.string().trim().max(128).nullish()
  .transform((value) => value || null);
const organizationRoleSchema = z.enum([
  "OWNER",
  "ORG_ADMIN",
  "CAMPUS_ADMIN",
  "PASTOR_APPROVER",
  "CONTENT_LEAD",
  "EDITOR",
  "PUBLISHER",
  "ANALYST",
  "VIEWER",
  "EXTERNAL_CONTRACTOR",
]);

const assignmentSchema = z.object({
  weekDraftId: idSchema,
  weekDraftItemId: nullableIdSchema,
  assigneeUserId: idSchema,
  dueAt: z.string().trim().max(64).nullish(),
});

const completeAssignmentSchema = z.object({
  assignmentId: idSchema,
});

const commentSchema = z.object({
  weekDraftId: idSchema,
  weekDraftItemId: nullableIdSchema,
  body: z.string().trim().min(1).max(5_000),
  mentionedUserIds: z.array(idSchema).max(20).optional(),
  parentCommentId: nullableIdSchema,
});

const requestApprovalSchema = z.object({
  weekDraftItemId: idSchema,
  approvalPolicyId: idSchema,
  message: z.string().trim().max(1_000).nullish(),
});

const requestDefaultApprovalSchema = z.object({
  weekDraftItemId: idSchema,
  message: z.string().trim().max(1_000).nullish(),
});

const decisionSchema = z.object({
  approvalRequestId: idSchema,
  decidedAsRole: organizationRoleSchema,
  decision: z.enum(["APPROVE", "REQUEST_CHANGES"]),
  reason: z.string().trim().max(5_000).nullish(),
});

function collaborationErrorResult(error: unknown): CollaborationActionResult {
  if (error instanceof z.ZodError) {
    return {
      success: false,
      message: error.issues[0]?.message || "Check the collaboration details and try again.",
    };
  }
  if (
    error instanceof ApprovalServiceError
    || error instanceof CollaborationServiceError
  ) {
    return { success: false, message: error.message };
  }
  if (
    error instanceof AuthorizationError
    || error instanceof CollaborationActionTargetNotFoundError
  ) {
    return {
      success: false,
      message: "This work item is not available in your active workspace.",
    };
  }
  return {
    success: false,
    message: "Sermon Clip could not save this collaboration update. Please try again.",
  };
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new z.ZodError([{
      code: "custom",
      path: ["dueAt"],
      message: "Enter a valid due date and time.",
    }]);
  }
  return parsed;
}

function revalidateCollaborationPaths(weekDraftId: string): void {
  revalidatePath("/inbox");
  revalidatePath("/week-drafts");
  revalidatePath(`/week-drafts/${weekDraftId}`);
}

function tenantFromTarget(target: Readonly<{
  organizationId: string;
  campusId: string | null;
}>) {
  return {
    organizationId: target.organizationId,
    campusId: target.campusId,
  };
}

export async function assignWeekDraftWorkAction(
  input: unknown,
): Promise<CollaborationActionResult> {
  try {
    const parsed = assignmentSchema.parse(input);
    const authorized = parsed.weekDraftItemId
      ? await requireWeekDraftItemActionTarget(
          "assignments.manage",
          parsed.weekDraftItemId,
        )
      : await requireWeekDraftActionTarget(
          "assignments.manage",
          parsed.weekDraftId,
        );
    if (authorized.target.weekDraftId !== parsed.weekDraftId) {
      throw new CollaborationActionTargetNotFoundError();
    }

    await prisma.$transaction(async (tx) => {
      const assignment = await assignWeekDraftWork(
        tx as unknown as Parameters<typeof assignWeekDraftWork>[0],
        {
          tenant: tenantFromTarget(authorized.target),
          weekDraftId: authorized.target.weekDraftId,
          weekDraftItemId: authorized.target.weekDraftItemId,
          assigneeUserId: parsed.assigneeUserId,
          assignedByUserId: authorized.requestContext.actorId,
          dueAt: parseOptionalDate(parsed.dueAt),
        },
      );
      await tx.auditEvent.create({
        data: {
          organizationId: authorized.target.organizationId,
          campusId: authorized.target.campusId,
          actorType: "USER",
          actorUserId: authorized.requestContext.actorId,
          action: "collaboration.assignment.created",
          targetType: "COLLABORATION_ASSIGNMENT",
          targetId: assignment.id,
          metadataJson: {
            weekDraftId: authorized.target.weekDraftId,
            weekDraftItemId: authorized.target.weekDraftItemId,
            assigneeUserId: parsed.assigneeUserId,
          },
        },
      });
    });

    revalidateCollaborationPaths(authorized.target.weekDraftId);
    return {
      success: true,
      message: "Assignment saved.",
      weekDraftId: authorized.target.weekDraftId,
      weekDraftItemId: authorized.target.weekDraftItemId,
    };
  } catch (error) {
    return collaborationErrorResult(error);
  }
}

export async function completeWeekDraftAssignmentAction(
  input: unknown,
): Promise<CollaborationActionResult> {
  try {
    const parsed = completeAssignmentSchema.parse(input);
    const authorized = await requireAssignmentActionTarget(
      "assignments.read",
      parsed.assignmentId,
    );
    await prisma.$transaction(async (tx) => {
      await completeWeekDraftAssignment(
        tx as unknown as Parameters<typeof completeWeekDraftAssignment>[0],
        {
          tenant: tenantFromTarget(authorized.target),
          assignmentId: authorized.target.id,
          completedByUserId: authorized.requestContext.actorId,
        },
      );
      await tx.auditEvent.create({
        data: {
          organizationId: authorized.target.organizationId,
          campusId: authorized.target.campusId,
          actorType: "USER",
          actorUserId: authorized.requestContext.actorId,
          action: "collaboration.assignment.completed",
          targetType: "COLLABORATION_ASSIGNMENT",
          targetId: authorized.target.id,
          metadataJson: {
            weekDraftId: authorized.target.weekDraftId,
            weekDraftItemId: authorized.target.weekDraftItemId,
          },
        },
      });
    });

    revalidateCollaborationPaths(authorized.target.weekDraftId);
    return {
      success: true,
      message: "Assignment completed.",
      weekDraftId: authorized.target.weekDraftId,
      weekDraftItemId: authorized.target.weekDraftItemId,
    };
  } catch (error) {
    return collaborationErrorResult(error);
  }
}

export async function addWeekDraftCommentAction(
  input: unknown,
): Promise<CollaborationActionResult> {
  try {
    const parsed = commentSchema.parse(input);
    const authorized = parsed.weekDraftItemId
      ? await requireWeekDraftItemActionTarget(
          "comments.create",
          parsed.weekDraftItemId,
        )
      : await requireWeekDraftActionTarget(
          "comments.create",
          parsed.weekDraftId,
        );
    if (authorized.target.weekDraftId !== parsed.weekDraftId) {
      throw new CollaborationActionTargetNotFoundError();
    }

    await prisma.$transaction(async (tx) => {
      const comment = await addWeekDraftComment(
        tx as unknown as Parameters<typeof addWeekDraftComment>[0],
        {
          tenant: tenantFromTarget(authorized.target),
          weekDraftId: authorized.target.weekDraftId,
          weekDraftItemId: authorized.target.weekDraftItemId,
          authorUserId: authorized.requestContext.actorId,
          body: parsed.body,
          mentionedUserIds: parsed.mentionedUserIds,
          parentCommentId: parsed.parentCommentId,
        },
      );
      await tx.auditEvent.create({
        data: {
          organizationId: authorized.target.organizationId,
          campusId: authorized.target.campusId,
          actorType: "USER",
          actorUserId: authorized.requestContext.actorId,
          action: "collaboration.comment.created",
          targetType: "COLLABORATION_COMMENT",
          targetId: comment.id,
          metadataJson: {
            weekDraftId: authorized.target.weekDraftId,
            weekDraftItemId: authorized.target.weekDraftItemId,
            mentionCount: parsed.mentionedUserIds?.length ?? 0,
          },
        },
      });
    });

    revalidateCollaborationPaths(authorized.target.weekDraftId);
    return {
      success: true,
      message: "Comment added.",
      weekDraftId: authorized.target.weekDraftId,
      weekDraftItemId: authorized.target.weekDraftItemId,
    };
  } catch (error) {
    return collaborationErrorResult(error);
  }
}

async function existingPendingApproval(
  target: Readonly<{
    id: string;
    organizationId: string;
    campusId: string | null;
  }>,
): Promise<{ id: string } | null> {
  const item = await prisma.weekDraftItem.findFirst({
    where: {
      id: target.id,
      organizationId: target.organizationId,
      campusId: target.campusId,
    },
    select: { currentRevisionId: true },
  });
  if (!item?.currentRevisionId) return null;
  return prisma.approvalRequest.findFirst({
    where: {
      organizationId: target.organizationId,
      campusId: target.campusId,
      weekDraftItemId: target.id,
      revisionId: item.currentRevisionId,
      status: "PENDING",
    },
    select: { id: true },
  });
}

async function requestApprovalWithPolicy(input: Readonly<{
  weekDraftItemId: string;
  approvalPolicyId: string;
  message?: string | null;
}>): Promise<CollaborationActionResult> {
  const authorized = await requireWeekDraftItemActionTarget(
    "approvals.request",
    input.weekDraftItemId,
  );
  const existing = await existingPendingApproval(authorized.target);
  if (existing) {
    return {
      success: true,
      message: "This revision is already waiting for approval.",
      weekDraftId: authorized.target.weekDraftId,
      weekDraftItemId: authorized.target.weekDraftItemId,
      approvalRequestId: existing.id,
    };
  }

  const approvalRequest = await prisma.$transaction(async (tx) => {
    const created = await requestWeekDraftItemApproval(
      tx as unknown as Parameters<typeof requestWeekDraftItemApproval>[0],
      {
        tenant: tenantFromTarget(authorized.target),
        weekDraftItemId: authorized.target.id,
        approvalPolicyId: input.approvalPolicyId,
        requestedByUserId: authorized.requestContext.actorId,
        message: input.message,
      },
    );
    await tx.auditEvent.create({
      data: {
        organizationId: authorized.target.organizationId,
        campusId: authorized.target.campusId,
        actorType: "USER",
        actorUserId: authorized.requestContext.actorId,
        action: "approval.requested",
        targetType: "APPROVAL_REQUEST",
        targetId: created.id,
        metadataJson: {
          weekDraftId: authorized.target.weekDraftId,
          weekDraftItemId: authorized.target.id,
          revisionId: created.revisionId,
          approvalPolicyId: input.approvalPolicyId,
        },
      },
    });
    return created;
  });

  revalidateCollaborationPaths(authorized.target.weekDraftId);
  return {
    success: true,
    message: "Sent for approval.",
    weekDraftId: authorized.target.weekDraftId,
    weekDraftItemId: authorized.target.id,
    approvalRequestId: approvalRequest.id,
  };
}

export async function requestWeekDraftItemApprovalAction(
  input: unknown,
): Promise<CollaborationActionResult> {
  try {
    const parsed = requestApprovalSchema.parse(input);
    return await requestApprovalWithPolicy(parsed);
  } catch (error) {
    return collaborationErrorResult(error);
  }
}

export async function requestDefaultWeekDraftItemApprovalAction(
  input: unknown,
): Promise<CollaborationActionResult> {
  try {
    const parsed = requestDefaultApprovalSchema.parse(input);
    const authorized = await requireWeekDraftItemActionTarget(
      "approvals.request",
      parsed.weekDraftItemId,
    );
    const policies = await prisma.approvalPolicy.findMany({
      where: {
        organizationId: authorized.target.organizationId,
        status: "ACTIVE",
        isDefault: true,
        ...(authorized.target.campusId
          ? {
              OR: [
                { campusId: authorized.target.campusId },
                { campusId: null },
              ],
            }
          : { campusId: null }),
      },
      select: { id: true, campusId: true },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    const policy = policies.find(
      (candidate) => candidate.campusId === authorized.target.campusId,
    ) ?? policies.find((candidate) => candidate.campusId === null);
    if (!policy) {
      return {
        success: false,
        message: "A workspace admin must choose a default approval policy before this item can be sent.",
        weekDraftId: authorized.target.weekDraftId,
        weekDraftItemId: authorized.target.id,
      };
    }
    return await requestApprovalWithPolicy({
      ...parsed,
      approvalPolicyId: policy.id,
    });
  } catch (error) {
    return collaborationErrorResult(error);
  }
}

export async function decideWeekDraftItemApprovalAction(
  input: unknown,
): Promise<CollaborationActionResult> {
  try {
    const parsed = decisionSchema.parse(input);
    const authorized = await requireApprovalRequestActionTarget(
      "approvals.decide",
      parsed.approvalRequestId,
    );
    const decision = await prisma.$transaction(async (tx) => {
      const result = await decideWeekDraftItemApproval(
        tx as unknown as Parameters<typeof decideWeekDraftItemApproval>[0],
        {
          tenant: tenantFromTarget(authorized.target),
          approvalRequestId: authorized.target.id,
          decidedByUserId: authorized.requestContext.actorId,
          decidedAsRole: parsed.decidedAsRole,
          decision: parsed.decision,
          reason: parsed.reason,
        },
      );
      await tx.auditEvent.create({
        data: {
          organizationId: authorized.target.organizationId,
          campusId: authorized.target.campusId,
          actorType: "USER",
          actorUserId: authorized.requestContext.actorId,
          action: parsed.decision === "APPROVE"
            ? "approval.approved"
            : "approval.changes_requested",
          targetType: "APPROVAL_REQUEST",
          targetId: authorized.target.id,
          metadataJson: {
            weekDraftId: authorized.target.weekDraftId,
            weekDraftItemId: authorized.target.weekDraftItemId,
            decidedAsRole: parsed.decidedAsRole,
            resultingStatus: result.status,
            approvals: result.approvals,
          },
        },
      });
      return result;
    });

    revalidateCollaborationPaths(authorized.target.weekDraftId);
    return {
      success: true,
      message: decision.status === "APPROVED"
        ? "Approved. This exact revision is now locked as the approved version."
        : decision.status === "CHANGES_REQUESTED"
          ? "Changes requested. The content team can now revise this item."
          : "Your approval is saved. This item still needs another approver.",
      weekDraftId: authorized.target.weekDraftId,
      weekDraftItemId: authorized.target.weekDraftItemId,
      approvalRequestId: authorized.target.id,
    };
  } catch (error) {
    return collaborationErrorResult(error);
  }
}

function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function redirectToInbox(result: CollaborationActionResult): never {
  const params = new URLSearchParams({
    [result.success ? "notice" : "error"]: result.message,
  });
  redirect(`/inbox?${params.toString()}`);
}

export async function approveInboxApprovalFormAction(
  formData: FormData,
): Promise<void> {
  const result = await decideWeekDraftItemApprovalAction({
    approvalRequestId: formText(formData, "approvalRequestId"),
    decidedAsRole: formText(formData, "decidedAsRole"),
    decision: "APPROVE",
  });
  redirectToInbox(result);
}

export async function requestInboxChangesFormAction(
  formData: FormData,
): Promise<void> {
  const result = await decideWeekDraftItemApprovalAction({
    approvalRequestId: formText(formData, "approvalRequestId"),
    decidedAsRole: formText(formData, "decidedAsRole"),
    decision: "REQUEST_CHANGES",
    reason: formText(formData, "reason"),
  });
  redirectToInbox(result);
}

export async function completeInboxAssignmentFormAction(
  formData: FormData,
): Promise<void> {
  const result = await completeWeekDraftAssignmentAction({
    assignmentId: formText(formData, "assignmentId"),
  });
  redirectToInbox(result);
}

export async function addInboxCommentFormAction(
  formData: FormData,
): Promise<void> {
  const result = await addWeekDraftCommentAction({
    weekDraftId: formText(formData, "weekDraftId"),
    weekDraftItemId: formText(formData, "weekDraftItemId"),
    body: formText(formData, "body"),
  });
  redirectToInbox(result);
}
