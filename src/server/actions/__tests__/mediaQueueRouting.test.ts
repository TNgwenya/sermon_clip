import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendPipelineLog: vi.fn(async () => undefined),
  canRunInline: vi.fn(() => false),
  clipFindUnique: vi.fn(),
  clipCount: vi.fn(),
  clipUpdate: vi.fn(async () => ({})),
  processingFindFirst: vi.fn(),
  processingFindMany: vi.fn(),
  queue: vi.fn(async () => ({
    id: "job-1",
    reusedExisting: false,
    intentConflict: false,
  })),
  render: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clipCandidate: {
      count: mocks.clipCount,
      findUnique: mocks.clipFindUnique,
      update: mocks.clipUpdate,
    },
    processingJob: {
      findFirst: mocks.processingFindFirst,
      findMany: mocks.processingFindMany,
    },
  },
}));
vi.mock("@/server/agents/storage", () => ({
  appendPipelineLog: mocks.appendPipelineLog,
}));
vi.mock("@/server/agents/processing", () => ({
  appendJobLog: vi.fn(),
  createProcessingJob: vi.fn(),
  markJobFailed: vi.fn(),
  markJobRunning: vi.fn(),
  markJobSucceeded: vi.fn(),
  queueSermonProcessingJob: mocks.queue,
}));
vi.mock("@/server/runtime/workerRuntime", () => ({
  canRunInlineMediaProcessing: mocks.canRunInline,
  canRunLocalMediaProcessing: vi.fn(() => true),
  localMediaProcessingUnavailableMessage: vi.fn(() => "Inline media processing is unavailable."),
}));
vi.mock("@/server/agents/clipRenderService", () => ({
  renderApprovedClip: mocks.render,
}));

import {
  downloadVideoAction,
  extractAudioAction,
  exportApprovedClipsAction,
  generateAndBurnSubtitlesForExportedClipsAction,
  generateClipSuggestionsAction,
  prepareClipStudioForPostingAction,
  renderClipCandidateAction,
  reexportVerticalClipAction,
  retryFailedProcessingJobById,
  transcribeAudioAction,
} from "@/server/actions/sermons";

function clipSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: "clip-1",
    sermonId: "sermon-1",
    status: "APPROVED",
    renderStatus: "NOT_RENDERED",
    renderFreshness: "NEEDS_REGENERATION",
    captionStatus: "NOT_GENERATED",
    captionFreshness: "NEEDS_REGENERATION",
    captionBurnStatus: "NOT_BURNED",
    captionBurnFreshness: "NEEDS_REGENERATION",
    captionData: null,
    overlayStatus: "NOT_RENDERED",
    overlayFreshness: "NEEDS_REGENERATION",
    exportStatus: "NOT_EXPORTED",
    exportFreshness: "NEEDS_REGENERATION",
    ...overrides,
  };
}

describe("production media action queue routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canRunInline.mockReturnValue(false);
    mocks.queue.mockResolvedValue({ id: "job-1", reusedExisting: false, intentConflict: false });
    mocks.processingFindMany.mockResolvedValue([]);
  });

  it("stores forced source-stage and clip-generation intent in queued jobs", async () => {
    const downloadForm = new FormData();
    downloadForm.set("sermonId", "sermon-1");
    downloadForm.set("force", "true");
    const extractForm = new FormData();
    extractForm.set("sermonId", "sermon-1");
    extractForm.set("force", "true");
    const transcribeForm = new FormData();
    transcribeForm.set("sermonId", "sermon-1");
    transcribeForm.set("force", "true");
    const clipsForm = new FormData();
    clipsForm.set("sermonId", "sermon-1");
    clipsForm.set("append", "true");
    clipsForm.set("force", "true");

    await downloadVideoAction({ success: false, message: "" }, downloadForm);
    await extractAudioAction({ success: false, message: "" }, extractForm);
    await transcribeAudioAction({ success: false, message: "" }, transcribeForm);
    await generateClipSuggestionsAction({ success: false, message: "" }, clipsForm);

    expect(mocks.queue).toHaveBeenNthCalledWith(1, "sermon-1", "DOWNLOAD_VIDEO", {
      intentKey: "processing:DOWNLOAD_VIDEO:force",
      forceProcessing: true,
    });
    expect(mocks.queue).toHaveBeenNthCalledWith(2, "sermon-1", "EXTRACT_AUDIO", {
      intentKey: "processing:EXTRACT_AUDIO:force",
      forceProcessing: true,
    });
    expect(mocks.queue).toHaveBeenNthCalledWith(3, "sermon-1", "TRANSCRIBE_AUDIO", {
      intentKey: "processing:TRANSCRIBE_AUDIO:force",
      forceProcessing: true,
    });
    expect(mocks.queue).toHaveBeenNthCalledWith(4, "sermon-1", "GENERATE_CLIPS", {
      append: true,
      forceGeneration: true,
    });
  });

  it("queues forced export and caption-burn work with durable worker intent", async () => {
    const exportForm = new FormData();
    exportForm.set("sermonId", "sermon-1");
    exportForm.set("force", "true");
    const captionsForm = new FormData();
    captionsForm.set("sermonId", "sermon-1");

    await exportApprovedClipsAction({ success: false, message: "" }, exportForm);
    await generateAndBurnSubtitlesForExportedClipsAction(
      { success: false, message: "" },
      captionsForm,
    );

    expect(mocks.queue).toHaveBeenCalledWith("sermon-1", "EXPORT_CLIPS", {
      intentKey: "media-assets:EXPORT_CLIPS:force:all",
      forceMediaAssets: true,
    });
    expect(mocks.queue).toHaveBeenCalledWith("sermon-1", "GENERATE_SUBTITLES", {
      intentKey: "media-assets:GENERATE_SUBTITLES:force:all",
      forceMediaAssets: true,
    });
    expect(mocks.queue).toHaveBeenCalledWith("sermon-1", "BURN_SUBTITLES", {
      intentKey: "media-assets:BURN_SUBTITLES:force:all",
      forceMediaAssets: true,
    });
  });

  it("preserves a targeted failed asset scope when queueing its forced retry", async () => {
    const failedJob = {
      id: "failed-burn-1",
      sermonId: "sermon-1",
      type: "BURN_SUBTITLES",
      status: "FAILED",
      updatedAt: new Date(),
      errorMessage: "Caption burn failed.",
      generationSummary: {
        mediaAssetClipIds: ["clip-b", "clip-a"],
        forceMediaAssets: false,
      },
    };
    mocks.processingFindFirst
      .mockResolvedValueOnce(failedJob)
      .mockResolvedValueOnce(failedJob);

    const result = await retryFailedProcessingJobById({
      sermonId: "sermon-1",
      jobId: "failed-burn-1",
    });

    expect(result.success).toBe(true);
    expect(mocks.queue).toHaveBeenCalledWith("sermon-1", "BURN_SUBTITLES", {
      intentKey: "media-assets:BURN_SUBTITLES:force:clip-a,clip-b",
      mediaAssetClipIds: ["clip-a", "clip-b"],
      forceMediaAssets: true,
    });
  });

  it("rejects unsupported queued Studio formats before saving or approving", async () => {
    mocks.clipFindUnique.mockResolvedValueOnce({
      id: "clip-1",
      sermonId: "sermon-1",
      transcriptSafetyStatus: "SAFE",
    });

    const result = await prepareClipStudioForPostingAction({
      clipId: "clip-1",
      exportSettings: {
        primaryFormat: "HORIZONTAL_16_9",
        selectedFormats: ["HORIZONTAL_16_9"],
      },
    } as never);

    expect(result).toEqual({
      success: false,
      message: "Multi-format Studio exports are not queued yet. Choose Vertical 9:16 before preparing this clip.",
      results: [],
    });
    expect(mocks.clipUpdate).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("queues an approved clip render instead of importing the FFmpeg service", async () => {
    mocks.clipFindUnique.mockResolvedValueOnce(clipSnapshot());

    const result = await renderClipCandidateAction("clip-1");

    expect(result).toMatchObject({ success: true, message: "Clip render queued for the media worker." });
    expect(mocks.queue).toHaveBeenCalledWith("sermon-1", "EXPORT_CLIPS", {
      intentKey: "media-assets:EXPORT_CLIPS:normal:clip-1",
      mediaAssetClipIds: ["clip-1"],
    });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("queues only the selected suggested preview", async () => {
    mocks.clipFindUnique.mockResolvedValueOnce(clipSnapshot({ status: "SUGGESTED" }));

    const result = await renderClipCandidateAction("clip-1");

    expect(result.success).toBe(true);
    expect(mocks.queue).toHaveBeenCalledWith("sermon-1", "GENERATE_CLIPS", {
      mode: "repair_previews",
      existingActiveSuggestionCount: 1,
      previewClipIds: ["clip-1"],
      forcePreviewRender: false,
    });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("persists re-export intent before queueing the overlay/export worker", async () => {
    mocks.clipFindUnique.mockResolvedValueOnce(clipSnapshot({
      renderStatus: "COMPLETED",
      renderFreshness: "UP_TO_DATE",
      exportStatus: "COMPLETED",
      exportFreshness: "UP_TO_DATE",
    }));

    const result = await reexportVerticalClipAction("clip-1");

    expect(result.success).toBe(true);
    expect(mocks.clipUpdate).toHaveBeenCalledWith({
      where: { id: "clip-1" },
      data: {
        exportFreshness: "NEEDS_REGENERATION",
        assetInvalidationReason: "Clip re-export requested.",
      },
    });
    expect(mocks.queue).toHaveBeenCalledWith("sermon-1", "RENDER_OVERLAY", {
      intentKey: "media-assets:RENDER_OVERLAY:force:clip-1",
      mediaAssetClipIds: ["clip-1"],
      forceMediaAssets: true,
    });
  });
});
