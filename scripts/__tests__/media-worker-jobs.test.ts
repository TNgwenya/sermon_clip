import { describe, expect, it, vi } from "vitest";

import {
  runCaptionBurnBatch,
  runClipGenerationWorkerJob,
  runOverlayAndExportBatch,
  resolveClipGenerationWorkerPreviewRequest,
  resolveMediaAssetWorkerRequest,
  resolveRedoClipGenerationWorkerSourceWindow,
  summarizeCaptionBatch,
  summarizePreviewPreparation,
  summarizeQualityRefreshBatch,
  summarizeRedoClipGeneration,
  summarizeRenderBatch,
  type OverlayExportClip,
} from "../media-worker-jobs";

describe("media worker render outcomes", () => {
  it("returns a success summary only when every attempted render succeeds", () => {
    expect(summarizeRenderBatch({
      completed: 2,
      skipped: 1,
      failed: 0,
      errors: [],
    })).toBe("Rendered 2 clip(s), skipped 1, failed 0.");
  });

  it("rejects a partially successful render batch", () => {
    expect(() => summarizeRenderBatch({
      completed: 1,
      skipped: 0,
      failed: 1,
      errors: [{ clipId: "clip-b", reason: "FFmpeg exited with code 1" }],
    })).toThrow(
      "Rendered 1 clip(s), skipped 0, failed 1. Failures: clip-b: FFmpeg exited with code 1",
    );
  });
});

describe("media worker caption outcomes", () => {
  it("returns a success summary when captions generate or are intentionally reused", () => {
    expect(summarizeCaptionBatch({
      generated: 2,
      reused: 1,
      skipped: 1,
      failed: 0,
      errors: [],
    })).toBe("Generated captions for 2 clip(s), reused 1, skipped 1; 0 failed.");
  });

  it("rejects a partially successful caption batch", () => {
    expect(() => summarizeCaptionBatch({
      generated: 1,
      reused: 0,
      skipped: 0,
      failed: 1,
      errors: [{ clipId: "clip-b", reason: "Transcript timestamps are invalid" }],
    })).toThrow(
      "Generated captions for 1 clip(s), reused 0, skipped 0; 1 failed. Failures: clip-b: Transcript timestamps are invalid",
    );
  });
});

describe("media worker clip-generation outcomes", () => {
  it("preserves a targeted one-clip preview repair request", () => {
    expect(resolveClipGenerationWorkerPreviewRequest({
      mode: "repair_previews",
      previewClipIds: ["clip-2", "clip-2", " "],
      forcePreviewRender: true,
      onlyFailedPreviews: true,
    })).toEqual({
      clipIds: ["clip-2"],
      force: true,
      onlyFailed: true,
    });
  });

  it("fails closed when an explicit preview target list is empty or malformed", () => {
    expect(resolveClipGenerationWorkerPreviewRequest({
      mode: "repair_previews",
      previewClipIds: [],
    })).toEqual({ clipIds: [], force: false, onlyFailed: false });
    expect(resolveClipGenerationWorkerPreviewRequest({
      mode: "repair_previews",
      previewClipIds: "clip-2",
    })).toEqual({ clipIds: [], force: false, onlyFailed: false });
    expect(resolveClipGenerationWorkerPreviewRequest({
      mode: "repair_previews",
    })).toEqual({ force: false, onlyFailed: false });
  });

  it("preserves exact media asset targets without widening to the sermon", () => {
    expect(resolveMediaAssetWorkerRequest({
      mediaAssetClipIds: ["clip-2", "clip-2", " "],
      forceMediaAssets: true,
    })).toEqual({ clipIds: ["clip-2"], force: true });
    expect(resolveMediaAssetWorkerRequest({ mediaAssetClipIds: [] }))
      .toEqual({ clipIds: [], force: false });
  });

  it("restores the selected source range for a queued redo job", () => {
    expect(resolveRedoClipGenerationWorkerSourceWindow({
      mode: "redo",
      sermonStartSeconds: 1_200,
      sermonEndSeconds: 3_600,
      analyzeFullRecording: false,
    })).toEqual({
      sermonStartSeconds: 1_200,
      sermonEndSeconds: 3_600,
      analyzeFullRecording: false,
    });
    expect(resolveRedoClipGenerationWorkerSourceWindow({ mode: "redo" })).toEqual({
      sermonStartSeconds: null,
      sermonEndSeconds: null,
      analyzeFullRecording: true,
    });
    expect(resolveRedoClipGenerationWorkerSourceWindow({ append: true })).toBeNull();
  });

  it("returns the preview summary when every generated preview succeeds or is skipped", () => {
    expect(summarizePreviewPreparation({
      prepared: 3,
      skipped: 1,
      failed: 0,
    })).toBe("Preview prep: 3 prepared, 1 skipped, 0 failed.");
  });

  it("rejects generated clips when preview preparation partially fails", () => {
    expect(() => summarizePreviewPreparation({
      prepared: 2,
      skipped: 0,
      failed: 1,
    })).toThrow("Preview prep: 2 prepared, 0 skipped, 1 failed.");
  });

  it("returns the redo message only for a fully successful redo", () => {
    expect(summarizeRedoClipGeneration({
      success: true,
      message: "Redo complete with 3 previews.",
    })).toBe("Redo complete with 3 previews.");
  });

  it("rejects every unsuccessful redo even when new clips were generated", () => {
    expect(() => summarizeRedoClipGeneration({
      success: false,
      message: "Redo generated 3 clips, but 1 preview needs attention.",
    })).toThrow("Redo generated 3 clips, but 1 preview needs attention.");
  });

  it("repairs failed previews without calling clip-generation AI again", async () => {
    const generateSuggestions = vi.fn(async () => ({
      clipCount: 5,
      reusedExistingSuggestions: false,
    }));
    const preparePreviews = vi.fn(async () => ({
      prepared: 5,
      skipped: 0,
      failed: 0,
    }));

    await expect(runClipGenerationWorkerJob({
      previewRepairOnly: true,
      forceGeneration: false,
      append: false,
    }, {
      generateSuggestions,
      preparePreviews,
    })).resolves.toBe(
      "Existing clip suggestions reused without a new AI call. Preview prep: 5 prepared, 0 skipped, 0 failed.",
    );
    expect(generateSuggestions).not.toHaveBeenCalled();
    expect(preparePreviews).toHaveBeenCalledTimes(1);
  });

  it("forces generation for a genuine manually retried generation failure", async () => {
    const generateSuggestions = vi.fn(async () => ({
      clipCount: 3,
      reusedExistingSuggestions: false,
    }));
    const preparePreviews = vi.fn(async () => ({
      prepared: 3,
      skipped: 0,
      failed: 0,
    }));

    await expect(runClipGenerationWorkerJob({
      previewRepairOnly: false,
      forceGeneration: true,
      append: false,
    }, {
      generateSuggestions,
      preparePreviews,
    })).resolves.toContain("Generated 3 clip suggestion(s).");
    expect(generateSuggestions).toHaveBeenCalledWith({ force: true, append: false });
  });

  it("retries an append without replacing existing suggestions", async () => {
    const generateSuggestions = vi.fn(async () => ({
      clipCount: 2,
      reusedExistingSuggestions: false,
    }));
    const preparePreviews = vi.fn(async () => ({
      prepared: 2,
      skipped: 0,
      failed: 0,
    }));

    await expect(runClipGenerationWorkerJob({
      previewRepairOnly: false,
      forceGeneration: false,
      append: true,
    }, {
      generateSuggestions,
      preparePreviews,
    })).resolves.toContain("Generated 2 new clip suggestion(s).");
    expect(generateSuggestions).toHaveBeenCalledWith({ force: false, append: true });
  });
});

describe("media worker quality-refresh outcomes", () => {
  it("returns a success summary only when all requested quality records refresh", () => {
    expect(summarizeQualityRefreshBatch({
      clipsRefreshed: 3,
      clipsFailed: 0,
      failures: [],
    })).toBe("Refreshed 3 clip quality record(s); 0 failed.");
  });

  it("rejects a partially successful quality refresh", () => {
    expect(() => summarizeQualityRefreshBatch({
      clipsRefreshed: 2,
      clipsFailed: 1,
      failures: [{ clipId: "clip-c", reason: "Quality provider timed out" }],
    })).toThrow(
      "Refreshed 2 clip quality record(s); 1 failed. Failures: clip-c: Quality provider timed out",
    );
  });
});

describe("media worker caption burn orchestration", () => {
  it("completes enabled clips and treats captions-off clips as intentional skips", async () => {
    const burnCaptions = vi.fn(async () => undefined);

    await expect(runCaptionBurnBatch([
      { id: "clip-a", captionData: {} },
      { id: "clip-b", captionData: { applyCaptionsToClip: false } },
    ], { burnCaptions })).resolves.toBe(
      "Caption burn completed for 1 clip(s), skipped 1 with captions off.",
    );
    expect(burnCaptions).toHaveBeenCalledTimes(1);
    expect(burnCaptions).toHaveBeenCalledWith("clip-a", {
      allowReburn: true,
      force: true,
    });
  });

  it("processes the remaining clips but rejects the parent batch after a partial failure", async () => {
    const burnCaptions = vi.fn(async (clipId: string) => {
      if (clipId === "clip-b") {
        throw new Error("Subtitle filter failed");
      }
    });

    await expect(runCaptionBurnBatch([
      { id: "clip-a", captionData: {} },
      { id: "clip-b", captionData: {} },
      { id: "clip-c", captionData: { applyCaptionsToClip: false } },
    ], { burnCaptions })).rejects.toThrow(
      "Caption burn failed for 1 of 2 attempted clip(s) after completing 1; skipped 1. Failures: clip-b: Subtitle filter failed",
    );
    expect(burnCaptions.mock.calls.map(([clipId]) => clipId)).toEqual(["clip-a", "clip-b"]);
  });
});

function overlayClip(
  id: string,
  overrides: Partial<OverlayExportClip> = {},
): OverlayExportClip {
  return {
    id,
    overlayStatus: "NOT_RENDERED",
    overlayFreshness: "NEEDS_REGENERATION",
    exportStatus: "NOT_EXPORTED",
    exportFreshness: "NEEDS_REGENERATION",
    exportLayoutStrategy: "SMART_CROP",
    ...overrides,
  };
}

describe("media worker overlay/export orchestration", () => {
  it("uses the fit-blurred fallback and succeeds only after the fallback export completes", async () => {
    const renderOverlay = vi.fn(async () => undefined);
    const prepareFitBlurredFallback = vi.fn(async () => undefined);
    const exportClip = vi.fn(async (
      _clipId: string,
      options: { layoutStrategy: string },
    ) => {
      if (options.layoutStrategy === "SMART_CROP") {
        throw new Error("Face tracking unavailable");
      }
    });

    await expect(runOverlayAndExportBatch([overlayClip("clip-a")], {
      renderOverlay,
      exportClip,
      prepareFitBlurredFallback,
    })).resolves.toBe("Overlay/export completed: 1 overlay(s), 1 export(s).");
    expect(prepareFitBlurredFallback).toHaveBeenCalledWith("clip-a");
    expect(exportClip.mock.calls.map(([, options]) => options.layoutStrategy)).toEqual([
      "SMART_CROP",
      "FIT_BLURRED_BACKGROUND",
    ]);
  });

  it("continues other clips but rejects the parent batch after an overlay failure", async () => {
    const renderOverlay = vi.fn(async (clipId: string) => {
      if (clipId === "clip-a") {
        throw new Error("Overlay renderer failed");
      }
    });
    const exportClip = vi.fn(async () => undefined);
    const prepareFitBlurredFallback = vi.fn(async () => undefined);

    await expect(runOverlayAndExportBatch([
      overlayClip("clip-a"),
      overlayClip("clip-b"),
    ], {
      renderOverlay,
      exportClip,
      prepareFitBlurredFallback,
    })).rejects.toThrow(
      "Overlay/export failed for 1 of 2 clip(s) after completing 1 overlay(s) and 1 export(s). Failures: clip-a: Overlay renderer failed",
    );
    expect(renderOverlay.mock.calls.map(([clipId]) => clipId)).toEqual(["clip-a", "clip-b"]);
    expect(exportClip).toHaveBeenCalledTimes(1);
    expect(exportClip).toHaveBeenCalledWith("clip-b", expect.objectContaining({
      layoutStrategy: "SMART_CROP",
    }));
  });
});
