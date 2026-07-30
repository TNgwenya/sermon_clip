import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  backfill: vi.fn(),
  clipFindMany: vi.fn(),
  regenerate: vi.fn(),
  repair: vi.fn(),
  revalidatePath: vi.fn(),
  retry: vi.fn(),
  processingFindMany: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clipCandidate: {
      findMany: mocks.clipFindMany,
    },
    processingJob: {
      findMany: mocks.processingFindMany,
    },
  },
}));
vi.mock("@/server/auth/requestAuthorization", () => ({
  requireRequestCapability: mocks.authorize,
}));
vi.mock("@/server/runtime/workerRuntime", () => ({
  canRunInlineMediaProcessing: vi.fn(() => true),
}));
vi.mock("@/server/workflow/operationsDiagnostics", () => ({
  repairMissingLocalAssetReferences: mocks.repair,
  selectUnresolvedFailedProcessingJobRetries: vi.fn((jobs) => jobs),
}));
vi.mock("@/server/agents/clipThumbnailService", () => ({
  backfillClipThumbnails: mocks.backfill,
}));
vi.mock("@/server/actions/sermons", () => ({
  regenerateClipOutdatedAssetsAction: mocks.regenerate,
  retryFailedProcessingJobById: mocks.retry,
}));

import {
  prepareMissingPostersAction,
  rebuildPriorityLibraryAssetsAction,
  repairLocalLibraryAction,
  retryLatestFailedProcessingJobsAction,
} from "@/app/health/actions";

const organizationAContext = {
  actorId: "user-a",
  organizationId: "org-a",
  campusId: "campus-a",
};

describe("health recovery tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue(organizationAContext);
    mocks.backfill.mockResolvedValue({
      attemptedCount: 0,
      generatedCount: 0,
      existingCount: 0,
      fallbackCount: 0,
      preparedClipCount: 0,
      readyPosterCount: 0,
      optimizedPosterCount: 0,
      missingPosterCount: 0,
      failedPosterCount: 0,
    });
    mocks.repair.mockResolvedValue({
      scannedClips: 0,
      repairedClips: 0,
      repairedAssets: 0,
      messages: [],
    });
    mocks.clipFindMany.mockResolvedValue([]);
    mocks.processingFindMany.mockResolvedValue([]);
  });

  it("scopes poster backfill and local-reference repair to the authorized tenant", async () => {
    await prepareMissingPostersAction();
    await repairLocalLibraryAction();

    const expectedScope = {
      organizationId: "org-a",
      campusId: "campus-a",
    };
    expect(mocks.backfill).toHaveBeenCalledWith({
      limit: 50,
      tenantScope: expectedScope,
    });
    expect(mocks.repair).toHaveBeenCalledWith(200, expectedScope);
  });

  it("does not select another organization's clips for bulk regeneration", async () => {
    await rebuildPriorityLibraryAssetsAction();

    expect(mocks.clipFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          expect.any(Object),
          {
            sermon: {
              organizationId: "org-a",
              campusId: "campus-a",
            },
          },
        ],
      },
    }));
    expect(mocks.regenerate).not.toHaveBeenCalled();
  });

  it("does not select another organization's jobs for retry", async () => {
    await retryLatestFailedProcessingJobsAction();

    expect(mocks.processingFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        sermon: {
          organizationId: "org-a",
          campusId: "campus-a",
        },
      },
    }));
    expect(mocks.retry).not.toHaveBeenCalled();
  });

  it("performs no repair when the actor lacks the required capability", async () => {
    mocks.authorize.mockRejectedValueOnce(new Error("Forbidden"));

    await expect(repairLocalLibraryAction()).rejects.toThrow("Forbidden");
    expect(mocks.repair).not.toHaveBeenCalled();
  });
});
