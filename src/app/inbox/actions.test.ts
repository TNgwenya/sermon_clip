import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  requireWeekDraft: vi.fn(),
  requireWeekDraftItem: vi.fn(),
  requireAssignment: vi.fn(),
  requireApprovalRequest: vi.fn(),
  addComment: vi.fn(),
  assignWork: vi.fn(),
  completeAssignment: vi.fn(),
  requestApproval: vi.fn(),
  decideApproval: vi.fn(),
  approvalPolicyFindMany: vi.fn(),
  weekDraftItemFindFirst: vi.fn(),
  approvalRequestFindFirst: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/collaboration/actionAuthorization", () => ({
  CollaborationActionTargetNotFoundError: class
    CollaborationActionTargetNotFoundError extends Error {},
  requireWeekDraftActionTarget: mocks.requireWeekDraft,
  requireWeekDraftItemActionTarget: mocks.requireWeekDraftItem,
  requireAssignmentActionTarget: mocks.requireAssignment,
  requireApprovalRequestActionTarget: mocks.requireApprovalRequest,
}));
vi.mock("@/server/collaboration/service", () => ({
  CollaborationServiceError: class CollaborationServiceError extends Error {},
  addWeekDraftComment: mocks.addComment,
  assignWeekDraftWork: mocks.assignWork,
  completeWeekDraftAssignment: mocks.completeAssignment,
}));
vi.mock("@/server/collaboration/approvalService", () => ({
  ApprovalServiceError: class ApprovalServiceError extends Error {},
  requestWeekDraftItemApproval: mocks.requestApproval,
  decideWeekDraftItemApproval: mocks.decideApproval,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (
      callback: (tx: unknown) => Promise<unknown>,
    ) => callback({
      auditEvent: { create: mocks.auditCreate },
    })),
    approvalPolicy: { findMany: mocks.approvalPolicyFindMany },
    weekDraftItem: { findFirst: mocks.weekDraftItemFindFirst },
    approvalRequest: { findFirst: mocks.approvalRequestFindFirst },
  },
}));

import {
  addWeekDraftCommentAction,
  completeWeekDraftAssignmentAction,
  decideWeekDraftItemApprovalAction,
  requestDefaultWeekDraftItemApprovalAction,
} from "@/app/inbox/actions";

const authorizedItem = {
  requestContext: {
    organizationId: "org-1",
    campusId: "campus-1",
    actorId: "pastor-1",
    authenticationMethod: "session",
  },
  target: {
    id: "item-1",
    organizationId: "org-1",
    campusId: "campus-1",
    weekDraftId: "draft-1",
    weekDraftItemId: "item-1",
  },
} as const;

describe("collaboration inbox actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWeekDraftItem.mockResolvedValue(authorizedItem);
    mocks.requireApprovalRequest.mockResolvedValue({
      ...authorizedItem,
      target: { ...authorizedItem.target, id: "approval-1" },
    });
    mocks.requireAssignment.mockResolvedValue({
      ...authorizedItem,
      target: { ...authorizedItem.target, id: "assignment-1" },
    });
    mocks.addComment.mockResolvedValue({ id: "comment-1" });
    mocks.completeAssignment.mockResolvedValue(undefined);
    mocks.requestApproval.mockResolvedValue({
      id: "approval-1",
      revisionId: "revision-1",
    });
    mocks.decideApproval.mockResolvedValue({
      status: "APPROVED",
      approvals: 1,
    });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
    mocks.weekDraftItemFindFirst.mockResolvedValue({
      currentRevisionId: "revision-1",
    });
    mocks.approvalRequestFindFirst.mockResolvedValue(null);
  });

  it("authorizes comments against the persisted Week Draft item target", async () => {
    const result = await addWeekDraftCommentAction({
      weekDraftId: "draft-1",
      weekDraftItemId: "item-1",
      body: "Please check the ending.",
    });

    expect(result).toMatchObject({ success: true, weekDraftId: "draft-1" });
    expect(mocks.requireWeekDraftItem).toHaveBeenCalledWith(
      "comments.create",
      "item-1",
    );
    expect(mocks.addComment).toHaveBeenCalledWith(expect.anything(), {
      tenant: { organizationId: "org-1", campusId: "campus-1" },
      weekDraftId: "draft-1",
      weekDraftItemId: "item-1",
      authorUserId: "pastor-1",
      body: "Please check the ending.",
      mentionedUserIds: undefined,
      parentCommentId: null,
    });
  });

  it("requires approval-decision capability on the exact approval request", async () => {
    const result = await decideWeekDraftItemApprovalAction({
      approvalRequestId: "approval-1",
      decidedAsRole: "PASTOR_APPROVER",
      decision: "APPROVE",
    });

    expect(result).toMatchObject({
      success: true,
      approvalRequestId: "approval-1",
    });
    expect(mocks.requireApprovalRequest).toHaveBeenCalledWith(
      "approvals.decide",
      "approval-1",
    );
    expect(mocks.decideApproval).toHaveBeenCalledWith(expect.anything(), {
      tenant: { organizationId: "org-1", campusId: "campus-1" },
      approvalRequestId: "approval-1",
      decidedByUserId: "pastor-1",
      decidedAsRole: "PASTOR_APPROVER",
      decision: "APPROVE",
      reason: undefined,
    });
  });

  it("fails closed when no default approval policy is configured", async () => {
    mocks.approvalPolicyFindMany.mockResolvedValue([]);

    const result = await requestDefaultWeekDraftItemApprovalAction({
      weekDraftItemId: "item-1",
      message: "Ready for pastor review.",
    });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      message: expect.stringContaining("default approval policy"),
    }));
    expect(mocks.requireWeekDraftItem).toHaveBeenCalledWith(
      "approvals.request",
      "item-1",
    );
    expect(mocks.requestApproval).not.toHaveBeenCalled();
  });

  it("lets only the exact assignment target reach assignee completion rules", async () => {
    const result = await completeWeekDraftAssignmentAction({
      assignmentId: "assignment-1",
    });

    expect(result).toMatchObject({ success: true });
    expect(mocks.requireAssignment).toHaveBeenCalledWith(
      "assignments.read",
      "assignment-1",
    );
    expect(mocks.completeAssignment).toHaveBeenCalledWith(expect.anything(), {
      tenant: { organizationId: "org-1", campusId: "campus-1" },
      assignmentId: "assignment-1",
      completedByUserId: "pastor-1",
    });
  });
});
