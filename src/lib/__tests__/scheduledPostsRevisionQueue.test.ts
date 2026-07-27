import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scheduledPostFindMany: vi.fn(),
  scheduledPostFindFirst: vi.fn(),
  scheduledPostFindUnique: vi.fn(),
  scheduledPostUpdateMany: vi.fn(),
  clipCandidateFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    scheduledPost: {
      findMany: mocks.scheduledPostFindMany,
      findFirst: mocks.scheduledPostFindFirst,
      findUnique: mocks.scheduledPostFindUnique,
      updateMany: mocks.scheduledPostUpdateMany,
    },
    clipCandidate: { findMany: mocks.clipCandidateFindMany },
  },
}));

vi.mock("@/lib/contentAssets", () => ({
  markScheduledPostContentAssetsPublished: vi.fn(),
  reconcileScheduledPostContentAssetLifecycle: vi.fn(),
}));

import {
  assertClipCompositionNotActivelyPublishing,
  claimScheduledPost,
  listUpcomingAutomationPosts,
  revalidateClaimedScheduledPostComposition,
} from "@/lib/scheduledPosts";

function queuedPost() {
  return {
    id: "post-1",
    postingDraftId: null,
    socialAccountId: null,
    clipIdsJson: [],
    platform: "INSTAGRAM",
    postingSlot: "Monday",
    title: "Mutable root title",
    caption: "Mutable root caption",
    note: null,
    status: "PLANNED",
    automationMode: "AUTOMATIC",
    scheduledFor: new Date("2099-07-23T08:00:00.000Z"),
    timezone: "Africa/Johannesburg",
    workerStatus: "IDLE",
    attemptCount: 0,
    claimedAt: null,
    workerId: null,
    lastAttemptAt: null,
    externalPostId: null,
    publishedUrl: null,
    publishError: null,
    finalPrivacyStatus: null,
    mediaObjectKey: null,
    mediaPublicUrl: null,
    mediaUploadedAt: null,
    compositionReceiptJson: null,
    idempotencyKey: "post-1-key",
    createdAt: new Date("2099-07-22T08:00:00.000Z"),
    socialAccount: null,
    contentAssetLinks: [{
      contentAssetRevision: {
        id: "revision-1",
        approvalState: "APPROVED",
        title: "Approved revision title",
        bodyContent: "Approved revision body",
        caption: "Approved revision caption",
        hashtagsJson: ["#approved"],
        callToAction: "Join us",
      },
      contentAsset: {
        id: "asset-1",
        title: "Mutable asset title",
        assetType: "QUOTE_GRAPHIC",
        status: "SCHEDULED",
        caption: "Mutable asset caption",
        bodyContent: "Mutable asset body",
        callToAction: null,
        hashtagsJson: [],
        files: [],
      },
    }],
  };
}

function readyClip(overrides: Record<string, unknown> = {}) {
  return {
    id: "clip-1",
    title: "Fresh clip",
    caption: "Fresh approved caption",
    durationSeconds: 45,
    hashtags: ["#fresh"],
    exportStatus: "COMPLETED",
    exportFreshness: "UP_TO_DATE",
    exportFormat: "VERTICAL_9_16",
    exportedFilePath: "/exports/fresh-final.mp4",
    exportPath: "/exports/older-scalar.mp4",
    captionData: null,
    transcriptSafetyStatus: "TRUSTED",
    editPlans: [{
      id: "plan-1",
      planHash: "plan-hash-1",
    }],
    artifacts: [{
      id: "artifact-1",
      editPlanId: "plan-1",
      planHash: "plan-hash-1",
      filePath: "/exports/fresh-final.mp4",
      sizeBytes: 12_345_678,
    }],
    sermon: {
      id: "sermon-1",
      title: "Faithfulness",
      churchName: "Grace Church",
    },
    ...overrides,
  };
}

describe("scheduled content revision queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scheduledPostUpdateMany.mockResolvedValue({ count: 0 });
    mocks.scheduledPostFindMany.mockResolvedValue([queuedPost()]);
    mocks.scheduledPostFindFirst.mockResolvedValue(null);
    mocks.scheduledPostFindUnique.mockResolvedValue(null);
    mocks.clipCandidateFindMany.mockResolvedValue([]);
  });

  it("queries only links with an approved immutable revision", async () => {
    await listUpcomingAutomationPosts({
      now: new Date("2099-07-22T08:00:00.000Z"),
      windowMinutes: 2_880,
    });

    expect(mocks.scheduledPostFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        contentAssetLinks: {
          every: {
            contentAssetRevision: {
              is: { approvalState: "APPROVED" },
            },
          },
        },
      }),
    }));
  });

  it("blocks Studio composition saves while a matching clip post is actively claimed", async () => {
    mocks.scheduledPostFindFirst.mockResolvedValue({ id: "post-1" });

    await expect(assertClipCompositionNotActivelyPublishing(" clip-1 "))
      .rejects.toMatchObject({ name: "ClipCompositionPublishingConflictError" });

    expect(mocks.scheduledPostFindFirst).toHaveBeenCalledWith({
      where: {
        status: "POSTING",
        workerStatus: { in: ["CLAIMED", "POSTING"] },
        claimedAt: { not: null },
        clipIdsJson: { array_contains: ["clip-1"] },
      },
      select: { id: true },
    });
  });

  it("allows Studio composition saves when no matching post is active", async () => {
    await expect(assertClipCompositionNotActivelyPublishing("clip-1")).resolves.toBeUndefined();
  });

  it("publishes the scheduled revision copy instead of mutable root copy", async () => {
    const posts = await listUpcomingAutomationPosts({
      now: new Date("2099-07-22T08:00:00.000Z"),
      windowMinutes: 2_880,
    });

    expect(posts[0]?.contentAssets?.[0]).toMatchObject({
      revisionId: "revision-1",
      revisionApprovalState: "APPROVED",
      title: "Approved revision title",
      bodyContent: "Approved revision body",
      caption: "Approved revision caption",
      hashtags: ["#approved"],
      callToAction: "Join us",
    });
  });

  it("queues only the canonical fresh final export for a clip post", async () => {
    mocks.scheduledPostFindMany.mockResolvedValue([{
      ...queuedPost(),
      clipIdsJson: ["clip-1"],
    }]);
    mocks.clipCandidateFindMany.mockResolvedValue([readyClip()]);

    const posts = await listUpcomingAutomationPosts({
      now: new Date("2099-07-22T08:00:00.000Z"),
      windowMinutes: 2_880,
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.clips[0]?.localFileCandidates).toEqual(["/exports/fresh-final.mp4"]);
    expect(posts[0]?.clips[0]?.compositionIdentity).toEqual({
      schemaVersion: 1,
      clipId: "clip-1",
      editPlanId: "plan-1",
      artifactId: "artifact-1",
      planHash: "plan-hash-1",
      filePath: "/exports/fresh-final.mp4",
      sizeBytes: 12_345_678,
      snapshotSha256: null,
      snapshotSizeBytes: null,
    });
  });

  it.each([
    ["stale", [readyClip({ exportFreshness: "OUTDATED" })]],
    ["missing", []],
    ["not a completed export", [readyClip({ exportStatus: "EXPORTING" })]],
    ["not the canonical vertical export", [readyClip({ exportFormat: "HORIZONTAL_16_9" })]],
    ["review blocked", [readyClip({ transcriptSafetyStatus: "REVIEW_REQUIRED" })]],
    ["missing an active edit plan", [readyClip({ editPlans: [] })]],
    ["bound to multiple active edit plans", [readyClip({
      editPlans: [
        { id: "plan-1", planHash: "plan-hash-1" },
        { id: "plan-2", planHash: "plan-hash-2" },
      ],
    })]],
    ["missing a ready export artifact", [readyClip({ artifacts: [] })]],
    ["bound to an artifact from another plan", [readyClip({
      artifacts: [{
        id: "artifact-1",
        editPlanId: "plan-old",
        planHash: "plan-hash-old",
        filePath: "/exports/fresh-final.mp4",
        sizeBytes: 12_345_678,
      }],
    })]],
    ["bound to an artifact at another path", [readyClip({
      artifacts: [{
        id: "artifact-1",
        editPlanId: "plan-1",
        planHash: "plan-hash-1",
        filePath: "/exports/old-final.mp4",
        sizeBytes: 12_345_678,
      }],
    })]],
  ])("withholds a clip post when its final media is %s", async (_label, clips) => {
    mocks.scheduledPostFindMany.mockResolvedValue([{
      ...queuedPost(),
      clipIdsJson: ["clip-1"],
    }]);
    mocks.clipCandidateFindMany.mockResolvedValue(clips);

    await expect(listUpcomingAutomationPosts({
      now: new Date("2099-07-22T08:00:00.000Z"),
      windowMinutes: 2_880,
    })).resolves.toEqual([]);
  });

  it("returns a fully re-resolved ready payload from claim and clears unversioned staged media", async () => {
    const claimedPost = {
      ...queuedPost(),
      clipIdsJson: ["clip-1"],
      status: "POSTING",
      workerStatus: "CLAIMED",
      claimedAt: new Date("2099-07-23T08:00:00.000Z"),
      workerId: "worker-1",
    };
    mocks.scheduledPostUpdateMany.mockResolvedValue({ count: 1 });
    mocks.scheduledPostFindUnique.mockResolvedValue(claimedPost);
    mocks.clipCandidateFindMany.mockResolvedValue([readyClip()]);

    const claimed = await claimScheduledPost({
      id: "post-1",
      workerId: "worker-1",
      now: new Date("2099-07-23T08:00:00.000Z"),
    });

    expect(claimed?.clips[0]?.localFileCandidates).toEqual(["/exports/fresh-final.mp4"]);
    expect(claimed?.clips[0]?.compositionIdentity.artifactId).toBe("artifact-1");
    expect(mocks.scheduledPostUpdateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        mediaObjectKey: null,
        mediaPublicUrl: null,
        mediaUploadedAt: null,
      }),
    }));
    expect(mocks.scheduledPostUpdateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: {
        compositionReceiptJson: [{
          schemaVersion: 1,
          clipId: "clip-1",
          editPlanId: "plan-1",
          artifactId: "artifact-1",
          planHash: "plan-hash-1",
          filePath: "/exports/fresh-final.mp4",
          sizeBytes: 12_345_678,
          snapshotSha256: null,
          snapshotSizeBytes: null,
        }],
      },
    }));
  });

  it("releases a claim when the clip became stale after the worker queue sync", async () => {
    mocks.scheduledPostUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.scheduledPostFindUnique.mockResolvedValue({
      ...queuedPost(),
      clipIdsJson: ["clip-1"],
      status: "POSTING",
      workerStatus: "CLAIMED",
      claimedAt: new Date("2099-07-23T08:00:00.000Z"),
      workerId: "worker-1",
    });
    mocks.clipCandidateFindMany.mockResolvedValue([readyClip({ exportFreshness: "OUTDATED" })]);

    await expect(claimScheduledPost({
      id: "post-1",
      workerId: "worker-1",
      now: new Date("2099-07-23T08:00:00.000Z"),
    })).resolves.toBeNull();

    expect(mocks.scheduledPostUpdateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        status: "PLANNED",
        workerStatus: "IDLE",
        claimedAt: null,
        workerId: null,
      }),
    }));
  });

  it("revalidates the bound artifact immediately before publishing", async () => {
    const identity = {
      schemaVersion: 1 as const,
      clipId: "clip-1",
      editPlanId: "plan-1",
      artifactId: "artifact-1",
      planHash: "plan-hash-1",
      filePath: "/exports/fresh-final.mp4",
      sizeBytes: 12_345_678,
      snapshotSha256: null,
      snapshotSizeBytes: null,
    };
    const snapshotIdentity = {
      ...identity,
      snapshotSha256: "a".repeat(64),
      snapshotSizeBytes: 12_345_678,
    };
    mocks.scheduledPostFindUnique.mockResolvedValue({
      ...queuedPost(),
      clipIdsJson: ["clip-1"],
      status: "POSTING",
      workerStatus: "CLAIMED",
      claimedAt: new Date("2099-07-23T08:00:00.000Z"),
      workerId: "worker-1",
      compositionReceiptJson: [identity],
    });
    mocks.clipCandidateFindMany.mockResolvedValue([readyClip()]);
    mocks.scheduledPostUpdateMany.mockResolvedValue({ count: 1 });

    await expect(revalidateClaimedScheduledPostComposition({
      id: "post-1",
      workerId: "worker-1",
      compositionIdentities: [snapshotIdentity],
      now: new Date("2099-07-23T08:01:00.000Z"),
    })).resolves.toEqual({ valid: true });

    expect(mocks.scheduledPostUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workerStatus: "POSTING",
        claimedAt: new Date("2099-07-23T08:01:00.000Z"),
        compositionReceiptJson: [snapshotIdentity],
      }),
    }));
  });

  it("releases the claim when the active export artifact changed", async () => {
    const claimedIdentity = {
      schemaVersion: 1 as const,
      clipId: "clip-1",
      editPlanId: "plan-1",
      artifactId: "artifact-1",
      planHash: "plan-hash-1",
      filePath: "/exports/fresh-final.mp4",
      sizeBytes: 12_345_678,
      snapshotSha256: null,
      snapshotSizeBytes: null,
    };
    const snapshotIdentity = {
      ...claimedIdentity,
      snapshotSha256: "b".repeat(64),
      snapshotSizeBytes: 12_345_678,
    };
    mocks.scheduledPostFindUnique.mockResolvedValue({
      ...queuedPost(),
      clipIdsJson: ["clip-1"],
      status: "POSTING",
      workerStatus: "CLAIMED",
      claimedAt: new Date("2099-07-23T08:00:00.000Z"),
      workerId: "worker-1",
      compositionReceiptJson: [claimedIdentity],
    });
    mocks.clipCandidateFindMany.mockResolvedValue([readyClip({
      artifacts: [{
        id: "artifact-2",
        editPlanId: "plan-1",
        planHash: "plan-hash-1",
        filePath: "/exports/fresh-final.mp4",
        sizeBytes: 12_345_678,
      }],
    })]);
    mocks.scheduledPostUpdateMany.mockResolvedValue({ count: 1 });

    await expect(revalidateClaimedScheduledPostComposition({
      id: "post-1",
      workerId: "worker-1",
      compositionIdentities: [snapshotIdentity],
    })).resolves.toEqual(expect.objectContaining({
      valid: false,
      released: true,
    }));

    expect(mocks.scheduledPostUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "PLANNED",
        workerStatus: "IDLE",
        claimedAt: null,
        workerId: null,
        mediaObjectKey: null,
        compositionReceiptJson: expect.anything(),
      }),
    }));
  });
});
