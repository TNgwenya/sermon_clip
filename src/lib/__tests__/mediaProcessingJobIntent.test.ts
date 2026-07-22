import { describe, expect, it } from "vitest";

import {
  buildForcedMediaAssetRetrySummary,
  buildForcedProcessingJobSummary,
  isForcedProcessingJobSummary,
} from "@/lib/mediaProcessingJobIntent";

describe("durable media processing job intent", () => {
  it("marks source-stage retries as forced worker work", () => {
    const summary = buildForcedProcessingJobSummary("TRANSCRIBE_AUDIO");

    expect(summary).toEqual({
      intentKey: "processing:TRANSCRIBE_AUDIO:force",
      forceProcessing: true,
    });
    expect(isForcedProcessingJobSummary(summary)).toBe(true);
    expect(isForcedProcessingJobSummary({ forceProcessing: false })).toBe(false);
  });

  it("preserves and normalizes exact media targets for a forced retry", () => {
    expect(buildForcedMediaAssetRetrySummary("EXPORT_CLIPS", {
      mediaAssetClipIds: [" clip-b ", "clip-a", "clip-b"],
      forceMediaAssets: false,
    })).toEqual({
      intentKey: "media-assets:EXPORT_CLIPS:force:clip-a,clip-b",
      mediaAssetClipIds: ["clip-a", "clip-b"],
      forceMediaAssets: true,
    });
  });

  it("fails closed instead of widening an explicit malformed target", () => {
    expect(buildForcedMediaAssetRetrySummary("BURN_SUBTITLES", {
      mediaAssetClipIds: "clip-a",
    })).toEqual({
      intentKey: "media-assets:BURN_SUBTITLES:force:none",
      mediaAssetClipIds: [],
      forceMediaAssets: true,
    });
  });

  it("keeps legacy sermon-wide jobs broad when no target field existed", () => {
    expect(buildForcedMediaAssetRetrySummary("EXPORT_CLIPS", null)).toEqual({
      intentKey: "media-assets:EXPORT_CLIPS:force:all",
      forceMediaAssets: true,
    });
  });
});
