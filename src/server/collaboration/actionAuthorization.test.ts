import { describe, expect, it, vi } from "vitest";

import {
  CollaborationActionTargetNotFoundError,
  createCollaborationActionAuthorizer,
  type CollaborationActionTargetRepository,
} from "@/server/collaboration/actionAuthorization";

const context = {
  organizationId: "org-1",
  campusId: "campus-1",
  actorId: "pastor-1",
  authenticationMethod: "session",
} as const;

function repository(
  target: {
    id: string;
    organizationId: string;
    campusId: string | null;
    weekDraftId: string;
    weekDraftItemId: string | null;
  } | null,
): CollaborationActionTargetRepository {
  return {
    findWeekDraft: vi.fn().mockResolvedValue(target),
    findWeekDraftItem: vi.fn().mockResolvedValue(target),
    findAssignment: vi.fn().mockResolvedValue(target),
    findApprovalRequest: vi.fn().mockResolvedValue(target),
  };
}

describe("collaboration action target authorization", () => {
  it("authorizes a Week Draft item against its persisted campus and parent draft", async () => {
    const repo = repository({
      id: "item-1",
      organizationId: "org-1",
      campusId: "campus-1",
      weekDraftId: "draft-1",
      weekDraftItemId: "item-1",
    });
    const authorize = vi.fn().mockResolvedValue(context);
    const service = createCollaborationActionAuthorizer(repo, authorize);

    await expect(
      service.requireWeekDraftItem(
        context,
        "comments.create",
        "item-1",
      ),
    ).resolves.toMatchObject({ weekDraftId: "draft-1" });

    expect(repo.findWeekDraftItem).toHaveBeenCalledWith(context, "item-1");
    expect(authorize).toHaveBeenCalledWith(context, "comments.create", {
      campusId: "campus-1",
      resource: { kind: "WEEK_DRAFT", id: "draft-1" },
    });
  });

  it("uses the approval-request resource identity for decision capability", async () => {
    const authorize = vi.fn().mockResolvedValue(context);
    const service = createCollaborationActionAuthorizer(repository({
      id: "approval-1",
      organizationId: "org-1",
      campusId: "campus-1",
      weekDraftId: "draft-1",
      weekDraftItemId: "item-1",
    }), authorize);

    await service.requireApprovalRequest(
      context,
      "approvals.decide",
      "approval-1",
    );

    expect(authorize).toHaveBeenCalledWith(context, "approvals.decide", {
      campusId: "campus-1",
      resource: { kind: "APPROVAL_REQUEST", id: "approval-1" },
    });
  });

  it("does not call the capability authorizer when the tenant-scoped target is absent", async () => {
    const authorize = vi.fn();
    const service = createCollaborationActionAuthorizer(
      repository(null),
      authorize,
    );

    await expect(
      service.requireAssignment(
        context,
        "assignments.read",
        "assignment-from-another-tenant",
      ),
    ).rejects.toBeInstanceOf(CollaborationActionTargetNotFoundError);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("rejects non-canonical identifiers before repository access", async () => {
    const repo = repository(null);
    const service = createCollaborationActionAuthorizer(repo, vi.fn());

    await expect(
      service.requireWeekDraft(
        context,
        "assignments.manage",
        " draft-1 ",
      ),
    ).rejects.toBeInstanceOf(CollaborationActionTargetNotFoundError);
    expect(repo.findWeekDraft).not.toHaveBeenCalled();
  });
});
