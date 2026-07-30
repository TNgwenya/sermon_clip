import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canRunInline: vi.fn(() => false),
  queue: vi.fn(),
  revalidatePath: vi.fn(),
  sermonFindFirst: vi.fn(),
  requireSermonResource: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    sermon: { findFirst: mocks.sermonFindFirst },
  },
}));
vi.mock("@/server/auth/resourceAuthorization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/resourceAuthorization")>()),
  requireSermonResource: mocks.requireSermonResource,
}));
vi.mock("@/server/agents/processing", () => ({
  queueSermonProcessingJob: mocks.queue,
}));
vi.mock("@/server/runtime/workerRuntime", () => ({
  canRunInlineMediaProcessing: mocks.canRunInline,
  localMediaProcessingUnavailableMessage: vi.fn(() => "Inline processing is unavailable."),
}));
vi.mock("@/server/agents/clipReviewAssetService", () => ({
  prepareGeneratedClipReviewAssets: vi.fn(),
}));

import { regenerateSmartClipsAction } from "@/server/actions/sermonIntelligence";

describe("queued smart clip regeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canRunInline.mockReturnValue(false);
    mocks.requireSermonResource.mockResolvedValue({
      id: "sermon-1",
      organizationId: "org-1",
      campusId: "campus-1",
    });
    mocks.sermonFindFirst.mockResolvedValue({ id: "sermon-1" });
  });

  it("returns a structured failure when a normal clip request owns the queue", async () => {
    mocks.queue.mockResolvedValue({
      id: "normal-job",
      reusedExisting: true,
      intentConflict: true,
    });

    await expect(regenerateSmartClipsAction("sermon-1")).resolves.toEqual({
      success: false,
      message: "A different clip-generation request is already running. Wait for it to finish, then regenerate smart clips.",
    });
    expect(mocks.queue).toHaveBeenCalledWith("sermon-1", "GENERATE_CLIPS", {
      mode: "retry_generation",
    });
    expect(mocks.requireSermonResource).toHaveBeenCalledWith(
      "content.create",
      "sermon-1",
    );
    expect(mocks.sermonFindFirst).toHaveBeenCalledWith({
      where: {
        id: "sermon-1",
        organizationId: "org-1",
        campusId: "campus-1",
      },
      select: { id: true },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not inspect or queue a sermon denied by resource authorization", async () => {
    const {
      AuthorizedResourceNotFoundError,
    } = await import("@/server/auth/resourceAuthorization");
    mocks.requireSermonResource.mockRejectedValue(
      new AuthorizedResourceNotFoundError(),
    );

    await expect(regenerateSmartClipsAction("foreign-sermon")).resolves.toEqual({
      success: false,
      message: "This sermon is unavailable or you do not have permission to change it.",
    });
    expect(mocks.sermonFindFirst).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});
