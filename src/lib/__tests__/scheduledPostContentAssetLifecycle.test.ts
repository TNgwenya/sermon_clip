import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  findFirst: vi.fn(),
  linkFindMany: vi.fn(),
  reconcile: vi.fn(),
  markPublished: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    scheduledPost: {
      updateMany: mocks.updateMany,
      deleteMany: mocks.deleteMany,
      findFirst: mocks.findFirst,
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

const tenantScope = {
  organizationId: "org-1",
  campusId: "campus-1",
};

describe("scheduled-post content asset reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.findFirst.mockResolvedValue(null);
    mocks.reconcile.mockResolvedValue(1);
    mocks.markPublished.mockResolvedValue(1);
  });

  it("reconciles linked assets after a manual schedule is skipped", async () => {
    await updateScheduledPostStatus({
      tenantScope,
      id: "post-1",
      status: "SKIPPED",
    });

    expect(mocks.reconcile).toHaveBeenCalledWith({
      tenantScope,
      scheduledPostId: "post-1",
    });
    expect(mocks.markPublished).not.toHaveBeenCalled();
  });

  it("reconciles linked assets when an accidental posted mark is restored", async () => {
    await restoreScheduledPostStatus({
      tenantScope,
      id: "post-1",
      status: "READY_FOR_MEDIA_TEAM",
      expectedCurrentStatus: "POSTED",
    });

    expect(mocks.reconcile).toHaveBeenCalledWith({
      tenantScope,
      scheduledPostId: "post-1",
    });
  });

  it("captures asset IDs before deletion and unlocks them after the link cascades", async () => {
    mocks.linkFindMany.mockResolvedValue([
      { contentAssetId: "asset-1" },
      { contentAssetId: "asset-2" },
    ]);

    await expect(deleteScheduledPost({
      tenantScope,
      id: "post-1",
    })).resolves.toBe(true);

    expect(mocks.deleteMany).toHaveBeenCalled();
    expect(mocks.reconcile).toHaveBeenCalledWith({
      tenantScope,
      contentAssetIds: ["asset-1", "asset-2"],
    });
  });

  it("keeps an out-of-tenant id outside every update and conflict lookup", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.findFirst.mockResolvedValueOnce(null);

    await expect(updateScheduledPostStatus({
      tenantScope,
      id: "post-other-tenant",
      status: "SKIPPED",
    })).resolves.toBeNull();

    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "post-other-tenant",
        organizationId: "org-1",
        OR: [{ campusId: "campus-1" }, { campusId: null }],
      }),
    }));
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "post-other-tenant",
        organizationId: "org-1",
        OR: [{ campusId: "campus-1" }, { campusId: null }],
      }),
    }));
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.markPublished).not.toHaveBeenCalled();
  });
});
