import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canRunInline: vi.fn(() => false),
  queue: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
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
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
