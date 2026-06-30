import { afterEach, describe, expect, it, vi } from "vitest";

const txMock = vi.hoisted(() => ({
  postingDraft: {
    create: vi.fn(),
  },
  socialAccount: {
    findMany: vi.fn(),
  },
  scheduledPost: {
    createMany: vi.fn(),
  },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

import { createPostingDraft, PostingDraftValidationError } from "@/lib/postingDrafts";

const createdAt = new Date("2026-06-30T08:00:00.000Z");

function setupTransaction() {
  txMock.postingDraft.create.mockResolvedValue({
    id: "draft-1",
    clipIdsJson: ["clip-1"],
    platformsJson: ["Instagram"],
    postingSlot: "Tue, Jun 30, 10:00 AM",
    note: null,
    status: "READY_FOR_MEDIA_TEAM",
    createdAt,
  });
  txMock.socialAccount.findMany.mockResolvedValue([
    {
      id: "ig-1",
      platform: "INSTAGRAM",
      externalProvider: "zernio",
      externalAccountId: "zernio-ig-1",
      createdAt,
    },
    {
      id: "ig-2",
      platform: "INSTAGRAM",
      externalProvider: "zernio",
      externalAccountId: "zernio-ig-2",
      createdAt,
    },
  ]);
  txMock.scheduledPost.createMany.mockResolvedValue({ count: 2 });
  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock));
}

describe("posting drafts", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates one scheduled post per selected social account", async () => {
    setupTransaction();

    await createPostingDraft({
      clipIds: ["clip-1"],
      platforms: ["Instagram"],
      socialAccountIdsByPlatform: {
        Instagram: ["ig-1", "ig-2"],
      },
      postingSlot: "Weekend invite",
      automationMode: "AUTOMATIC",
      scheduledFor: new Date("2026-07-01T10:00:00.000Z"),
      timezone: "Africa/Johannesburg",
      caption: "A caption for the post",
      title: "A post title",
    });

    expect(txMock.socialAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        platform: { in: ["INSTAGRAM"] },
        status: "CONNECTED",
      },
    }));
    expect(txMock.scheduledPost.createMany).toHaveBeenCalledTimes(1);
    const data = txMock.scheduledPost.createMany.mock.calls[0]?.[0]?.data;

    expect(data).toHaveLength(2);
    expect(data.map((post: { socialAccountId: string | null }) => post.socialAccountId).sort()).toEqual(["ig-1", "ig-2"]);
    expect(data.map((post: { idempotencyKey: string }) => post.idempotencyKey).sort()).toEqual([
      "draft-1:Instagram:ig-1:clip-1:2026-07-01T10:00:00.000Z:AUTOMATIC",
      "draft-1:Instagram:ig-2:clip-1:2026-07-01T10:00:00.000Z:AUTOMATIC",
    ]);
  });

  it("rejects selected accounts that are unavailable for the platform", async () => {
    setupTransaction();

    await expect(createPostingDraft({
      clipIds: ["clip-1"],
      platforms: ["Instagram"],
      socialAccountIdsByPlatform: {
        Instagram: ["ig-missing"],
      },
      postingSlot: "Weekend invite",
      automationMode: "MANUAL",
    })).rejects.toBeInstanceOf(PostingDraftValidationError);

    expect(txMock.scheduledPost.createMany).not.toHaveBeenCalled();
  });
});
