import { describe, expect, it, vi } from "vitest";

import {
  appendWeekDraftItemRevision,
  hashWeekDraftPayload,
  reorderWeekDraftItems,
} from "@/server/weekDraft/service";

describe("Week Draft service", () => {
  it("hashes equivalent payloads deterministically regardless of key order", () => {
    expect(hashWeekDraftPayload({ title: "Hope", body: "Grace" })).toBe(
      hashWeekDraftPayload({ body: "Grace", title: "Hope" }),
    );
    expect(hashWeekDraftPayload({ title: "Hope" })).not.toBe(
      hashWeekDraftPayload({ title: "Faith" }),
    );
  });

  it("creates a new immutable revision and supersedes open approval for that item", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "item-1" }]),
      membership: { findFirst: vi.fn() },
      weekDraftItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: "item-1",
          weekDraftId: "draft-1",
          sourceType: "CONTENT_ASSET",
          sourceId: "asset-1",
          sourceRevisionId: "asset-revision-2",
        }),
        update: vi.fn().mockResolvedValue({ id: "item-1" }),
      },
      weekDraftItemRevision: {
        aggregate: vi.fn().mockResolvedValue({
          _max: { revisionNumber: 2 },
        }),
        create: vi.fn().mockResolvedValue({
          id: "revision-3",
          revisionNumber: 3,
        }),
      },
      approvalRequest: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      weekDraft: {
        update: vi.fn().mockResolvedValue({ id: "draft-1" }),
      },
    };

    const result = await appendWeekDraftItemRevision(tx as never, {
      tenant: { organizationId: "org-1", campusId: "campus-1" },
      weekDraftItemId: "item-1",
      payload: { caption: "A revised caption" },
    });

    expect(result).toEqual({ id: "revision-3", revisionNumber: 3 });
    expect(tx.weekDraftItem.findFirst).toHaveBeenCalledWith({
      where: {
        id: "item-1",
        organizationId: "org-1",
        campusId: "campus-1",
      },
      select: expect.any(Object),
    });
    expect(tx.weekDraftItemRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        campusId: "campus-1",
        weekDraftItemId: "item-1",
        revisionNumber: 3,
        sourceType: "CONTENT_ASSET",
        sourceId: "asset-1",
        sourceRevisionId: "asset-revision-2",
      }),
      select: { id: true, revisionNumber: true },
    });
    expect(tx.approvalRequest.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        weekDraftItemId: "item-1",
        status: "PENDING",
      },
      data: {
        status: "SUPERSEDED",
        resolvedAt: expect.any(Date),
      },
    });
    expect(tx.weekDraftItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: {
        currentRevisionId: "revision-3",
        approvedRevisionId: null,
        status: "DRAFT",
      },
    });
  });

  it("does not mutate another tenant's item when the scoped lookup fails", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      membership: { findFirst: vi.fn() },
      weekDraftItem: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      weekDraftItemRevision: {
        aggregate: vi.fn(),
        create: vi.fn(),
      },
      approvalRequest: { updateMany: vi.fn() },
      weekDraft: { update: vi.fn() },
    };

    await expect(
      appendWeekDraftItemRevision(tx as never, {
        tenant: { organizationId: "org-2", campusId: "campus-2" },
        weekDraftItemId: "item-from-org-1",
        payload: { caption: "Cross-tenant edit" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(tx.weekDraftItemRevision.create).not.toHaveBeenCalled();
    expect(tx.weekDraftItem.update).not.toHaveBeenCalled();
  });

  it("reorders every item with collision-safe temporary positions and stable spacing", async () => {
    const updates: Array<{ id: string; sortOrder: number }> = [];
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "draft-1" }]),
      weekDraft: {
        findFirst: vi.fn().mockResolvedValue({
          id: "draft-1",
          items: [{ id: "a" }, { id: "b" }, { id: "c" }],
        }),
        update: vi.fn().mockResolvedValue({ id: "draft-1" }),
      },
      weekDraftItem: {
        update: vi.fn().mockImplementation(({ where, data }) => {
          updates.push({ id: where.id, sortOrder: data.sortOrder });
          return { id: where.id };
        }),
      },
    };

    await reorderWeekDraftItems(tx as never, {
      tenant: { organizationId: "org-1", campusId: "campus-1" },
      weekDraftId: "draft-1",
      orderedItemIds: ["c", "a", "b"],
    });

    expect(updates).toEqual([
      { id: "c", sortOrder: -1 },
      { id: "a", sortOrder: -2 },
      { id: "b", sortOrder: -3 },
      { id: "c", sortOrder: 1_024 },
      { id: "a", sortOrder: 2_048 },
      { id: "b", sortOrder: 3_072 },
    ]);
    expect(tx.weekDraft.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "draft-1",
          organizationId: "org-1",
          campusId: "campus-1",
        },
      }),
    );
  });
});
