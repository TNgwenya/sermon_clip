import { describe, expect, it, vi } from "vitest";

import {
  addWeekDraftComment,
  assignWeekDraftWork,
} from "@/server/collaboration/service";

describe("Week Draft collaboration service", () => {
  it("stores deduplicated mentions with the comment's tenant identity", async () => {
    const tx = {
      weekDraftItem: {
        findFirst: vi.fn().mockResolvedValue({ id: "item-1" }),
      },
      weekDraft: { findFirst: vi.fn() },
      membership: {
        findFirst: vi.fn().mockResolvedValue({ id: "membership-1" }),
      },
      collaborationComment: {
        findFirst: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: "comment-1" }),
      },
      collaborationCommentMention: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };

    const result = await addWeekDraftComment(tx as never, {
      tenant: { organizationId: "org-1", campusId: "campus-1" },
      weekDraftId: "draft-1",
      weekDraftItemId: "item-1",
      authorUserId: "editor-1",
      body: "  Please check the Scripture reference.  ",
      mentionedUserIds: ["pastor-1", "pastor-1", "lead-1"],
    });

    expect(result).toEqual({ id: "comment-1" });
    expect(tx.weekDraftItem.findFirst).toHaveBeenCalledWith({
      where: {
        id: "item-1",
        weekDraftId: "draft-1",
        organizationId: "org-1",
        campusId: "campus-1",
      },
      select: { id: true },
    });
    expect(tx.collaborationComment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        campusId: "campus-1",
        weekDraftId: "draft-1",
        weekDraftItemId: "item-1",
        authorUserId: "editor-1",
        body: "Please check the Scripture reference.",
      }),
      select: { id: true },
    });
    expect(tx.collaborationCommentMention.createMany).toHaveBeenCalledWith({
      data: [
        {
          organizationId: "org-1",
          campusId: "campus-1",
          commentId: "comment-1",
          mentionedUserId: "pastor-1",
        },
        {
          organizationId: "org-1",
          campusId: "campus-1",
          commentId: "comment-1",
          mentionedUserId: "lead-1",
        },
      ],
    });
  });

  it("cannot assign work through a draft/item pairing outside the active tenant", async () => {
    const tx = {
      weekDraftItem: { findFirst: vi.fn().mockResolvedValue(null) },
      weekDraft: { findFirst: vi.fn() },
      membership: { findFirst: vi.fn() },
      collaborationAssignment: { create: vi.fn() },
      collaborationCommentMention: { createMany: vi.fn() },
    };

    await expect(
      assignWeekDraftWork(tx as never, {
        tenant: { organizationId: "org-2", campusId: "campus-2" },
        weekDraftId: "draft-from-org-1",
        weekDraftItemId: "item-from-org-1",
        assigneeUserId: "editor-2",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(tx.membership.findFirst).not.toHaveBeenCalled();
    expect(tx.collaborationAssignment.create).not.toHaveBeenCalled();
  });
});
