import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  findUnique: vi.fn(),
  linkFindMany: vi.fn(),
  reconcile: vi.fn(),
  markPublished: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    scheduledPost: {
      updateMany: mocks.updateMany,
      deleteMany: mocks.deleteMany,
      findUnique: mocks.findUnique,
    },
    scheduledPostContentAsset: {
      findMany: mocks.linkFindMany,
    },
  },
}));

vi.mock("@/lib/contentAssets", () => ({
  markScheduledPostContentAssetsPublished: mocks.markPublished,
  reconcileScheduledPostContentAssetLifecycle: mocks.reconcile,
}));

import {
  deleteScheduledPost,
  restoreScheduledPostStatus,
  updateScheduledPostStatus,
} from "@/lib/scheduledPosts";

describe("scheduled-post content asset reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(null);
    mocks.reconcile.mockResolvedValue(1);
    mocks.markPublished.mockResolvedValue(1);
  });

  it("reconciles linked assets after a manual schedule is skipped", async () => {
    await updateScheduledPostStatus({ id: "post-1", status: "SKIPPED" });

    expect(mocks.reconcile).toHaveBeenCalledWith({ scheduledPostId: "post-1" });
    expect(mocks.markPublished).not.toHaveBeenCalled();
  });

  it("reconciles linked assets when an accidental posted mark is restored", async () => {
    await restoreScheduledPostStatus({
      id: "post-1",
      status: "READY_FOR_MEDIA_TEAM",
      expectedCurrentStatus: "POSTED",
    });

    expect(mocks.reconcile).toHaveBeenCalledWith({ scheduledPostId: "post-1" });
  });

  it("captures asset IDs before deletion and unlocks them after the link cascades", async () => {
    mocks.linkFindMany.mockResolvedValue([
      { contentAssetId: "asset-1" },
      { contentAssetId: "asset-2" },
    ]);

    await expect(deleteScheduledPost({ id: "post-1" })).resolves.toBe(true);

    expect(mocks.deleteMany).toHaveBeenCalled();
    expect(mocks.reconcile).toHaveBeenCalledWith({
      contentAssetIds: ["asset-1", "asset-2"],
    });
  });
});
