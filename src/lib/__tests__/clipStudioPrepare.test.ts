import { describe, expect, it } from "vitest";

import {
  buildClipStudioPrepareAssetPlan,
  resolveClipStudioPreparationState,
  type ClipStudioPrepareAssetSnapshot,
  type ClipStudioPreparationRecord,
} from "@/lib/clipStudioPrepare";

function readySnapshot(overrides: Partial<ClipStudioPrepareAssetSnapshot> = {}): ClipStudioPrepareAssetSnapshot {
  return {
    renderStatus: "COMPLETED",
    renderFreshness: "UP_TO_DATE",
    renderedFileReady: true,
    captionsEnabled: true,
    captionStatus: "GENERATED",
    captionBurnStatus: "COMPLETED",
    captionBurnFreshness: "UP_TO_DATE",
    captionedFileReady: true,
    exportStatus: "COMPLETED",
    exportFreshness: "UP_TO_DATE",
    ...overrides,
  };
}

describe("buildClipStudioPrepareAssetPlan", () => {
  it("does not rebuild when prepared media is already current", () => {
    expect(buildClipStudioPrepareAssetPlan(readySnapshot())).toEqual({
      prepareVideo: false,
      burnCaptions: false,
      skipCaptionBurn: false,
      exportPreparedVideo: false,
    });
  });

  it("rebuilds downstream media when the base render is stale", () => {
    expect(buildClipStudioPrepareAssetPlan(readySnapshot({ renderFreshness: "NEEDS_REGENERATION" }))).toEqual({
      prepareVideo: true,
      burnCaptions: true,
      skipCaptionBurn: false,
      exportPreparedVideo: true,
    });
  });

  it("skips caption burn when on-video captions are disabled", () => {
    expect(buildClipStudioPrepareAssetPlan(readySnapshot({
      captionsEnabled: false,
      captionBurnStatus: "COMPLETED",
    }))).toEqual({
      prepareVideo: false,
      burnCaptions: false,
      skipCaptionBurn: true,
      exportPreparedVideo: true,
    });
  });

  it("exports again when only the download is stale", () => {
    expect(buildClipStudioPrepareAssetPlan(readySnapshot({ exportFreshness: "OUTDATED" }))).toEqual({
      prepareVideo: false,
      burnCaptions: false,
      skipCaptionBurn: false,
      exportPreparedVideo: true,
    });
  });

  it("rebuilds every prepared layer when the user explicitly requests a rebuild", () => {
    expect(buildClipStudioPrepareAssetPlan(readySnapshot(), { forceRebuild: true })).toEqual({
      prepareVideo: true,
      burnCaptions: true,
      skipCaptionBurn: false,
      exportPreparedVideo: true,
    });
  });

  it("forces a clean uncaptioned rebuild without requesting a caption burn", () => {
    expect(buildClipStudioPrepareAssetPlan(readySnapshot({
      captionsEnabled: false,
      captionBurnStatus: "COMPLETED",
    }), { forceRebuild: true })).toEqual({
      prepareVideo: true,
      burnCaptions: false,
      skipCaptionBurn: true,
      exportPreparedVideo: true,
    });
  });
});

function completedRecord(
  format: ClipStudioPreparationRecord["format"],
  overrides: Partial<ClipStudioPreparationRecord> = {},
): ClipStudioPreparationRecord {
  return {
    format,
    status: "COMPLETED",
    outputPath: `/exports/${format}.mp4`,
    fileExists: true,
    createdAt: "2026-07-17T10:00:00.000Z",
    isLatest: true,
    ...overrides,
  };
}

const emptyCanonicalExport = {
  format: null,
  status: "NOT_EXPORTED" as const,
  freshness: "UP_TO_DATE" as const,
  outputPath: null,
  fileExists: false,
};

describe("resolveClipStudioPreparationState", () => {
  it("requires a verified local file for every selected format", () => {
    const state = resolveClipStudioPreparationState({
      selectedFormats: ["VERTICAL_9_16", "HORIZONTAL_16_9"],
      records: [
        completedRecord("VERTICAL_9_16"),
        completedRecord("HORIZONTAL_16_9", { fileExists: false }),
      ],
      canonicalExport: emptyCanonicalExport,
      trustCompletedOutputMetadata: false,
    });

    expect(state).toMatchObject({
      state: "MISSING",
      ready: false,
      needsUpdate: true,
      missing: true,
      missingFormats: ["HORIZONTAL_16_9"],
      readyFormats: ["VERTICAL_9_16"],
    });
  });

  it("trusts completed output metadata for remote worker files", () => {
    const state = resolveClipStudioPreparationState({
      selectedFormats: ["VERTICAL_9_16", "HORIZONTAL_16_9"],
      records: [
        completedRecord("VERTICAL_9_16", { fileExists: false }),
        completedRecord("HORIZONTAL_16_9", { fileExists: false }),
      ],
      canonicalExport: emptyCanonicalExport,
      trustCompletedOutputMetadata: true,
    });

    expect(state).toMatchObject({
      state: "READY",
      ready: true,
      missing: false,
      readyFormats: ["VERTICAL_9_16", "HORIZONTAL_16_9"],
    });
  });

  it("uses canonical export metadata when no Studio history exists", () => {
    const state = resolveClipStudioPreparationState({
      selectedFormats: ["VERTICAL_9_16"],
      records: [],
      canonicalExport: {
        format: "VERTICAL_9_16",
        status: "COMPLETED",
        freshness: "UP_TO_DATE",
        outputPath: "/mac/exports/clip.mp4",
        fileExists: false,
      },
      trustCompletedOutputMetadata: true,
    });

    expect(state.ready).toBe(true);
    expect(state.availableFormats).toEqual(["VERTICAL_9_16"]);
  });

  it("reports the exact failed format in a partial batch", () => {
    const state = resolveClipStudioPreparationState({
      selectedFormats: ["VERTICAL_9_16", "SQUARE_1_1"],
      records: [
        completedRecord("VERTICAL_9_16"),
        completedRecord("SQUARE_1_1", { status: "FAILED", outputPath: null, fileExists: false }),
      ],
      canonicalExport: emptyCanonicalExport,
      trustCompletedOutputMetadata: false,
    });

    expect(state).toMatchObject({
      state: "FAILED",
      ready: false,
      failed: true,
      failedFormats: ["SQUARE_1_1"],
    });
  });

  it("distinguishes active preparation from missing media", () => {
    const state = resolveClipStudioPreparationState({
      selectedFormats: ["VERTICAL_9_16"],
      records: [completedRecord("VERTICAL_9_16", { status: "WAITING", outputPath: null, fileExists: false })],
      canonicalExport: emptyCanonicalExport,
      trustCompletedOutputMetadata: false,
    });

    expect(state).toMatchObject({
      state: "PREPARING",
      preparing: true,
      missing: false,
      needsUpdate: false,
      preparingFormats: ["VERTICAL_9_16"],
    });
  });

  it("keeps completed files blocked while an upstream asset is stale", () => {
    const state = resolveClipStudioPreparationState({
      selectedFormats: ["VERTICAL_9_16"],
      records: [completedRecord("VERTICAL_9_16")],
      canonicalExport: emptyCanonicalExport,
      trustCompletedOutputMetadata: false,
      upstreamNeedsUpdate: true,
    });

    expect(state).toMatchObject({
      state: "NEEDS_UPDATE",
      ready: false,
      needsUpdate: true,
      availableFormats: ["VERTICAL_9_16"],
    });
  });

  it("prefers an explicitly latest failed record over an older completed record", () => {
    const state = resolveClipStudioPreparationState({
      selectedFormats: ["VERTICAL_9_16"],
      records: [
        completedRecord("VERTICAL_9_16", {
          isLatest: false,
          createdAt: "2026-07-17T09:00:00.000Z",
        }),
        completedRecord("VERTICAL_9_16", {
          status: "FAILED",
          outputPath: null,
          fileExists: false,
          createdAt: "2026-07-17T11:00:00.000Z",
        }),
      ],
      canonicalExport: emptyCanonicalExport,
      trustCompletedOutputMetadata: false,
    });

    expect(state.failedFormats).toEqual(["VERTICAL_9_16"]);
    expect(state.ready).toBe(false);
  });
});
