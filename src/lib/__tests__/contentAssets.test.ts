import { afterEach, describe, expect, it, vi } from "vitest";

const txMock = vi.hoisted(() => ({
  scheduledPost: { findUnique: vi.fn() },
  contentAsset: { findMany: vi.fn(), updateMany: vi.fn() },
  scheduledPostContentAsset: { upsert: vi.fn() },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  contentOpportunity: { findUnique: vi.fn() },
  contentAsset: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  scheduledPostContentAsset: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import {
  attachContentAssetsToScheduledPost,
  buildContentAssetStatusUpdate,
  canTransitionContentAssetStatus,
  ContentAssetTransitionError,
  ContentAssetValidationError,
  createContentAsset,
  markScheduledPostContentAssetsPublished,
  normalizeContentAssetIds,
  resolveContentAssetLifecycleFromScheduledPosts,
} from "@/lib/contentAssets";

describe("content asset lifecycle", () => {
  it("represents the complete generated-to-published path", () => {
    expect(canTransitionContentAssetStatus("GENERATED", "APPROVED")).toBe(true);
    expect(canTransitionContentAssetStatus("APPROVED", "PREPARED")).toBe(true);
    expect(canTransitionContentAssetStatus("PREPARED", "READY")).toBe(true);
    expect(canTransitionContentAssetStatus("READY", "SCHEDULED")).toBe(true);
    expect(canTransitionContentAssetStatus("SCHEDULED", "PUBLISHED")).toBe(true);
  });

  it("rejects shortcuts that bypass review or preparation", () => {
    expect(canTransitionContentAssetStatus("GENERATED", "READY")).toBe(false);
    expect(() => buildContentAssetStatusUpdate({
      current: "APPROVED",
      next: "PUBLISHED",
    })).toThrow(ContentAssetTransitionError);
  });

  it("clears downstream timestamps when a prepared asset returns to approval", () => {
    const now = new Date("2026-07-16T15:00:00.000Z");
    expect(buildContentAssetStatusUpdate({
      current: "PREPARED",
      next: "APPROVED",
      now,
    })).toEqual({
      status: "APPROVED",
      approvedAt: now,
      preparedAt: null,
      readyAt: null,
      scheduledAt: null,
      publishedAt: null,
      archivedAt: null,
    });
  });

  it("normalizes and deduplicates content asset IDs", () => {
    expect(normalizeContentAssetIds([" asset-1 ", "", "asset-1", null, "asset-2"])).toEqual([
      "asset-1",
      "asset-2",
    ]);
  });

  it("unlocks an asset when every linked schedule is skipped or removed", () => {
    const now = new Date("2026-07-16T17:00:00.000Z");
    expect(resolveContentAssetLifecycleFromScheduledPosts({
      links: [{ status: "SKIPPED", scheduledFor: new Date("2026-07-20T08:00:00.000Z") }],
      currentReadyAt: null,
      currentPublishedAt: null,
      now,
    })).toEqual({
      status: "READY",
      readyAt: now,
      scheduledAt: null,
      publishedAt: null,
      archivedAt: null,
    });
  });

  it("keeps an asset scheduled while another live schedule remains", () => {
    const firstRemainingSchedule = new Date("2026-07-19T08:00:00.000Z");
    expect(resolveContentAssetLifecycleFromScheduledPosts({
      links: [
        { status: "SKIPPED", scheduledFor: new Date("2026-07-18T08:00:00.000Z") },
        { status: "FAILED", scheduledFor: firstRemainingSchedule },
        { status: "PLANNED", scheduledFor: new Date("2026-07-21T08:00:00.000Z") },
      ],
      currentReadyAt: new Date("2026-07-16T08:00:00.000Z"),
      currentPublishedAt: new Date("2026-07-18T09:00:00.000Z"),
    })).toEqual({
      status: "SCHEDULED",
      scheduledAt: firstRemainingSchedule,
      publishedAt: null,
      archivedAt: null,
    });
  });

  it("keeps publication immutable while any confirmed posted link remains", () => {
    const publishedAt = new Date("2026-07-18T09:00:00.000Z");
    expect(resolveContentAssetLifecycleFromScheduledPosts({
      links: [
        { status: "POSTED", scheduledFor: new Date("2026-07-18T08:00:00.000Z") },
        { status: "SKIPPED", scheduledFor: new Date("2026-07-20T08:00:00.000Z") },
      ],
      currentReadyAt: null,
      currentPublishedAt: publishedAt,
    })).toMatchObject({ status: "PUBLISHED", publishedAt });
  });
});

describe("content asset persistence", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects file metadata that has no usable location", async () => {
    await expect(createContentAsset({
      sermonId: "sermon-1",
      assetType: "QUOTE_GRAPHIC",
      title: "Grace",
      files: [{ fileName: "grace.png", mimeType: "image/png" }],
    })).rejects.toBeInstanceOf(ContentAssetValidationError);

    expect(prismaMock.contentAsset.create).not.toHaveBeenCalled();
  });

  it("rejects an opportunity from another sermon", async () => {
    prismaMock.contentOpportunity.findUnique.mockResolvedValue({ sermonId: "sermon-2" });

    await expect(createContentAsset({
      sermonId: "sermon-1",
      contentOpportunityId: "opportunity-1",
      assetType: "TEXT_POST",
      title: "Post",
    })).rejects.toThrow("does not belong to the source sermon");
  });

  it("attaches ordered ready assets without changing clip storage", async () => {
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock));
    txMock.scheduledPost.findUnique.mockResolvedValue({ id: "post-1", platform: "INSTAGRAM" });
    txMock.contentAsset.findMany.mockResolvedValue([
      { id: "asset-1", platform: "INSTAGRAM", status: "READY" },
      { id: "asset-2", platform: null, status: "READY" },
    ]);
    txMock.scheduledPostContentAsset.upsert.mockResolvedValue({});
    txMock.contentAsset.updateMany.mockResolvedValue({ count: 2 });

    await expect(attachContentAssetsToScheduledPost({
      scheduledPostId: "post-1",
      contentAssetIds: ["asset-1", "asset-2"],
      now: new Date("2026-07-16T15:00:00.000Z"),
    })).resolves.toEqual({
      scheduledPostId: "post-1",
      contentAssetIds: ["asset-1", "asset-2"],
    });

    expect(txMock.scheduledPostContentAsset.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      create: { scheduledPostId: "post-1", contentAssetId: "asset-1", sortOrder: 0 },
    }));
    expect(txMock.scheduledPostContentAsset.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      create: { scheduledPostId: "post-1", contentAssetId: "asset-2", sortOrder: 1 },
    }));
    expect(txMock.contentAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["asset-1", "asset-2"] }, status: "READY" },
      data: expect.objectContaining({ status: "SCHEDULED" }),
    }));
  });

  it("rejects assets prepared for a different platform", async () => {
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock));
    txMock.scheduledPost.findUnique.mockResolvedValue({ id: "post-1", platform: "FACEBOOK" });
    txMock.contentAsset.findMany.mockResolvedValue([
      { id: "asset-1", platform: "INSTAGRAM", status: "READY" },
    ]);

    await expect(attachContentAssetsToScheduledPost({
      scheduledPostId: "post-1",
      contentAssetIds: ["asset-1"],
    })).rejects.toThrow("was prepared for INSTAGRAM, not FACEBOOK");
  });

  it("marks only scheduled linked assets as published", async () => {
    prismaMock.scheduledPostContentAsset.findMany.mockResolvedValue([
      { contentAssetId: "asset-1" },
      { contentAssetId: "asset-2" },
    ]);
    prismaMock.contentAsset.updateMany.mockResolvedValue({ count: 2 });
    const now = new Date("2026-07-16T16:00:00.000Z");

    await expect(markScheduledPostContentAssetsPublished({
      scheduledPostId: "post-1",
      now,
    })).resolves.toBe(2);

    expect(prismaMock.contentAsset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1", "asset-2"] }, status: { in: ["READY", "SCHEDULED"] } },
      data: { status: "PUBLISHED", publishedAt: now, archivedAt: null },
    });
  });
});
