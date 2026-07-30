import { describe, expect, it, vi } from "vitest";

import {
  classifyInboxDueDate,
  loadWorkInbox,
  type WorkInboxRepository,
} from "@/server/collaboration/inboxService";

const now = new Date("2026-07-29T10:00:00.000Z");
const tenant = { organizationId: "org-1", campusId: "campus-1" };

function repository(
  overrides: Partial<WorkInboxRepository> = {},
): WorkInboxRepository {
  return {
    listMemberships: vi.fn().mockResolvedValue([
      { role: "PASTOR_APPROVER", campusId: "campus-1" },
    ]),
    listAssignments: vi.fn().mockResolvedValue([]),
    listApprovals: vi.fn().mockResolvedValue([]),
    listMentions: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("collaboration work inbox", () => {
  it("classifies local calendar deadlines without treating later today as overdue", () => {
    expect(classifyInboxDueDate(
      new Date("2026-07-28T20:00:00.000Z"),
      now,
      "Africa/Johannesburg",
    )).toBe("OVERDUE");
    expect(classifyInboxDueDate(
      new Date("2026-07-29T23:00:00.000Z"),
      now,
      "Africa/Johannesburg",
    )).toBe("UPCOMING");
    expect(classifyInboxDueDate(
      new Date("2026-07-29T20:00:00.000Z"),
      now,
      "Africa/Johannesburg",
    )).toBe("TODAY");
    expect(classifyInboxDueDate(null, now)).toBe("NO_DUE_DATE");
  });

  it("shows only current, eligible, undecided approvals and preserves policy context", async () => {
    const listApprovals = vi.fn().mockResolvedValue([
      {
        id: "approval-1",
        weekDraftId: "draft-1",
        weekDraftItemId: "item-1",
        revisionId: "revision-2",
        requestedByUserId: "editor-1",
        policySnapshotJson: {
          policyName: "Pastor review",
          mode: "ANY_APPROVER",
          minimumApprovals: 1,
          allowSelfApproval: false,
          rules: [{ role: "PASTOR_APPROVER", minimumApprovals: 1 }],
        },
        message: "Please check the Scripture context.",
        createdAt: now,
        requestedBy: {
          email: "editor@example.com",
          profile: { displayName: "Editor One" },
        },
        weekDraft: { title: "Sunday message week" },
        weekDraftItem: {
          title: "Grace is already moving",
          format: "SHORT_FORM_VIDEO",
          currentRevisionId: "revision-2",
        },
        decisions: [],
      },
      {
        id: "stale-approval",
        weekDraftId: "draft-1",
        weekDraftItemId: "item-2",
        revisionId: "revision-1",
        requestedByUserId: "editor-1",
        policySnapshotJson: {
          policyName: "Pastor review",
          mode: "ANY_APPROVER",
          minimumApprovals: 1,
          allowSelfApproval: false,
          rules: [{ role: "PASTOR_APPROVER", minimumApprovals: 1 }],
        },
        message: null,
        createdAt: now,
        requestedBy: {
          email: "editor@example.com",
          profile: null,
        },
        weekDraft: { title: "Sunday message week" },
        weekDraftItem: {
          title: "Old revision",
          format: "TEXT_POST",
          currentRevisionId: "revision-2",
        },
        decisions: [],
      },
    ]);

    const result = await loadWorkInbox(repository({ listApprovals }), {
      tenant,
      actorId: "pastor-1",
      now,
    });

    expect(result.approvals).toEqual([
      expect.objectContaining({
        id: "approval-1",
        eligibleRole: "PASTOR_APPROVER",
        policyName: "Pastor review",
        requestedBy: "Editor One",
      }),
    ]);
    expect(result.counts.approvals).toBe(1);
    expect(listApprovals).toHaveBeenCalledWith(expect.objectContaining({
      tenant,
      actorId: "pastor-1",
    }));
  });

  it("fails closed for invalid policy snapshots, self-approval, and ineligible roles", async () => {
    const common = {
      weekDraftId: "draft-1",
      weekDraftItemId: "item-1",
      revisionId: "revision-1",
      message: null,
      createdAt: now,
      requestedBy: { email: "pastor@example.com", profile: null },
      weekDraft: { title: "Draft" },
      weekDraftItem: {
        title: "Item",
        format: "TEXT_POST",
        currentRevisionId: "revision-1",
      },
      decisions: [],
    };
    const listApprovals = vi.fn().mockResolvedValue([
      {
        ...common,
        id: "invalid",
        requestedByUserId: "editor-1",
        policySnapshotJson: {},
      },
      {
        ...common,
        id: "self",
        requestedByUserId: "pastor-1",
        policySnapshotJson: {
          policyName: "No self approval",
          mode: "ANY_APPROVER",
          minimumApprovals: 1,
          allowSelfApproval: false,
          rules: [{ role: "PASTOR_APPROVER", minimumApprovals: 1 }],
        },
      },
      {
        ...common,
        id: "owner-only",
        requestedByUserId: "editor-1",
        policySnapshotJson: {
          policyName: "Owner review",
          mode: "ANY_APPROVER",
          minimumApprovals: 1,
          allowSelfApproval: false,
          rules: [{ role: "OWNER", minimumApprovals: 1 }],
        },
      },
    ]);

    const result = await loadWorkInbox(repository({ listApprovals }), {
      tenant,
      actorId: "pastor-1",
      now,
    });

    expect(result.approvals).toEqual([]);
  });

  it("sorts overdue assignments first and scopes mention presentation", async () => {
    const listAssignments = vi.fn().mockResolvedValue([
      {
        id: "no-date",
        weekDraftId: "draft-1",
        weekDraftItemId: null,
        dueAt: null,
        createdAt: new Date("2026-07-27T10:00:00.000Z"),
        assignedBy: null,
        weekDraft: { title: "Whole week", status: "DRAFT" },
        weekDraftItem: null,
      },
      {
        id: "overdue",
        weekDraftId: "draft-1",
        weekDraftItemId: "item-1",
        dueAt: new Date("2026-07-28T12:00:00.000Z"),
        createdAt: new Date("2026-07-28T10:00:00.000Z"),
        assignedBy: {
          email: "lead@example.com",
          profile: { displayName: "Content Lead" },
        },
        weekDraft: { title: "Whole week", status: "IN_REVIEW" },
        weekDraftItem: {
          title: "Tuesday clip",
          format: "SHORT_FORM_VIDEO",
          status: "IN_REVIEW",
        },
      },
    ]);
    const listMentions = vi.fn().mockResolvedValue([
      {
        commentId: "comment-1",
        createdAt: now,
        comment: {
          weekDraftId: "draft-1",
          weekDraftItemId: "item-1",
          body: "Can you confirm this quotation?",
          createdAt: now,
          author: {
            email: "editor@example.com",
            profile: { displayName: "Editor One" },
          },
          weekDraft: { title: "Whole week" },
          weekDraftItem: { title: "Tuesday clip" },
        },
      },
    ]);

    const result = await loadWorkInbox(
      repository({ listAssignments, listMentions }),
      { tenant, actorId: "pastor-1", now },
    );

    expect(result.assignments.map((assignment) => assignment.id)).toEqual([
      "overdue",
      "no-date",
    ]);
    expect(result.assignments[0]).toMatchObject({
      assignedBy: "Content Lead",
      timing: "OVERDUE",
    });
    expect(result.mentions[0]).toMatchObject({
      commentId: "comment-1",
      author: "Editor One",
      title: "Tuesday clip",
    });
  });
});
