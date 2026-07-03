import { describe, expect, it } from "vitest";

import { buildClipStudioPrepareAssetPlan, type ClipStudioPrepareAssetSnapshot } from "@/lib/clipStudioPrepare";

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
});
