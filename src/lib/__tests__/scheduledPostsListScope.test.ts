import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scheduledPostFindMany: vi.fn(),
  scheduledPostUpdateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    scheduledPost: {
      findMany: mocks.scheduledPostFindMany,
      updateMany: mocks.scheduledPostUpdateMany,
    },
  },
}));

vi.mock("@/lib/contentAssets", () => ({
  markScheduledPostContentAssetsPublished: vi.fn(),
  reconcileScheduledPostContentAssetLifecycle: vi.fn(),
}));

import { listScheduledPosts } from "@/lib/scheduledPosts";

describe("scheduled post list scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scheduledPostUpdateMany.mockResolvedValue({ count: 0 });
    mocks.scheduledPostFindMany.mockResolvedValue([]);
  });

  it("loads only the requested scheduled post and forces an exact-id limit", async () => {
    await listScheduledPosts({ scheduledPostId: " post-42 ", take: 100 });

    expect(mocks.scheduledPostFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "post-42" },
      take: 1,
    }));
  });

  it("scopes generated-content calendar reads through the indexed asset link", async () => {
    await listScheduledPosts({
      contentAssetId: " asset-7 ",
      take: 20,
      includeContentAssetFiles: false,
    });

    expect(mocks.scheduledPostFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        contentAssetLinks: {
          some: { contentAssetId: "asset-7" },
        },
      },
      take: 20,
    }));
    const query = mocks.scheduledPostFindMany.mock.calls.at(-1)?.[0];
    expect(query.include.contentAssetLinks.select.contentAsset.select).not.toHaveProperty("files");
  });

  it("preserves the bounded full-desk query when no focus is supplied", async () => {
    await listScheduledPosts();

    expect(mocks.scheduledPostFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {},
      take: 100,
    }));
  });
});
