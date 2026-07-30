import { describe, expect, it, vi } from "vitest";

import {
  decideWeekDraftItemApproval,
  requestWeekDraftItemApproval,
} from "@/server/collaboration/approvalService";

const tenant = {
  organizationId: "org-1",
  campusId: "campus-1",
} as const;

describe("Week Draft approval service", () => {
  it("snapshots the policy and binds the request to the current immutable revision", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "item-1" }]),
      membership: {
        findMany: vi.fn().mockResolvedValue([
          { role: "CONTENT_LEAD", campusId: "campus-1" },
        ]),
      },
      weekDraftItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: "item-1",
          weekDraftId: "draft-1",
          currentRevisionId: "revision-4",
          status: "READY_FOR_REVIEW",
          weekDraft: { status: "READY_FOR_REVIEW" },
        }),
        update: vi.fn().mockResolvedValue({ id: "item-1" }),
      },
      approvalPolicy: {
        findFirst: vi.fn().mockResolvedValue({
          id: "policy-1",
          name: "Pastor approval",
          mode: "ANY_APPROVER",
          minimumApprovals: 1,
          allowSelfApproval: false,
          rules: [{ role: "PASTOR_APPROVER", minimumApprovals: 1 }],
        }),
      },
      approvalRequest: {
        create: vi.fn().mockResolvedValue({
          id: "request-1",
          revisionId: "revision-4",
        }),
      },
      weekDraft: {
        update: vi.fn().mockResolvedValue({ id: "draft-1" }),
      },
    };

    const result = await requestWeekDraftItemApproval(tx as never, {
      tenant,
      weekDraftItemId: "item-1",
      approvalPolicyId: "policy-1",
      requestedByUserId: "editor-1",
      message: "Ready for review",
    });

    expect(result).toEqual({
      id: "request-1",
      revisionId: "revision-4",
    });
    expect(tx.approvalRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        campusId: "campus-1",
        weekDraftId: "draft-1",
        weekDraftItemId: "item-1",
        revisionId: "revision-4",
        approvalPolicyId: "policy-1",
        policySnapshotJson: {
          policyId: "policy-1",
          policyName: "Pastor approval",
          mode: "ANY_APPROVER",
          minimumApprovals: 1,
          allowSelfApproval: false,
          rules: [{ role: "PASTOR_APPROVER", minimumApprovals: 1 }],
        },
      }),
      select: { id: true, revisionId: true },
    });
  });

  it("fails closed when a decision targets an approval for an older revision", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "request-1" }]),
      membership: { findMany: vi.fn() },
      approvalRequest: {
        findFirst: vi.fn().mockResolvedValue({
          id: "request-1",
          weekDraftId: "draft-1",
          weekDraftItemId: "item-1",
          revisionId: "revision-3",
          requestedByUserId: "editor-1",
          status: "PENDING",
          policySnapshotJson: {},
          weekDraftItem: { currentRevisionId: "revision-4" },
          decisions: [],
        }),
        update: vi.fn(),
      },
      approvalDecision: { create: vi.fn() },
      weekDraftItem: { update: vi.fn(), count: vi.fn() },
      weekDraft: { update: vi.fn() },
    };

    await expect(
      decideWeekDraftItemApproval(tx as never, {
        tenant,
        approvalRequestId: "request-1",
        decidedByUserId: "pastor-1",
        decidedAsRole: "PASTOR_APPROVER",
        decision: "APPROVE",
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(tx.approvalDecision.create).not.toHaveBeenCalled();
  });

  it("approves the exact revision and closes the draft when every item is resolved", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "request-1" }]),
      membership: {
        findMany: vi.fn().mockResolvedValue([
          { role: "PASTOR_APPROVER", campusId: "campus-1" },
        ]),
      },
      approvalRequest: {
        findFirst: vi.fn().mockResolvedValue({
          id: "request-1",
          weekDraftId: "draft-1",
          weekDraftItemId: "item-1",
          revisionId: "revision-4",
          requestedByUserId: "editor-1",
          status: "PENDING",
          policySnapshotJson: {
            policyId: "policy-1",
            policyName: "Pastor approval",
            mode: "ANY_APPROVER",
            minimumApprovals: 1,
            allowSelfApproval: false,
            rules: [{ role: "PASTOR_APPROVER", minimumApprovals: 1 }],
          },
          weekDraftItem: { currentRevisionId: "revision-4" },
          decisions: [],
        }),
        update: vi.fn().mockResolvedValue({ id: "request-1" }),
      },
      approvalDecision: {
        create: vi.fn().mockResolvedValue({ id: "decision-1" }),
      },
      weekDraftItem: {
        update: vi.fn().mockResolvedValue({ id: "item-1" }),
        count: vi.fn().mockResolvedValue(0),
      },
      weekDraft: {
        update: vi.fn().mockResolvedValue({ id: "draft-1" }),
      },
    };

    const result = await decideWeekDraftItemApproval(tx as never, {
      tenant,
      approvalRequestId: "request-1",
      decidedByUserId: "pastor-1",
      decidedAsRole: "PASTOR_APPROVER",
      decision: "APPROVE",
    });

    expect(result).toEqual({ status: "APPROVED", approvals: 1 });
    expect(tx.approvalDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        revisionId: "revision-4",
        decidedByUserId: "pastor-1",
        decidedAsRole: "PASTOR_APPROVER",
        decision: "APPROVE",
      }),
      select: { id: true },
    });
    expect(tx.weekDraftItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: {
        status: "APPROVED",
        approvedRevisionId: "revision-4",
      },
    });
    expect(tx.weekDraft.update).toHaveBeenCalledWith({
      where: { id: "draft-1" },
      data: { status: "APPROVED" },
    });
  });
});
