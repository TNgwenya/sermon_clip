import { describe, expect, it } from "vitest";

import {
  buildForcedMediaAssetRetrySummary,
  buildForcedProcessingJobSummary,
  evaluateMediaAssetJobDependency,
  isForcedProcessingJobSummary,
  resolveMediaAssetJobDependencyId,
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

  it("waits for an ordered media predecessor and proceeds only after success", () => {
    const generationSummary = { mediaAssetDependsOnJobId: "caption-job" };

    expect(resolveMediaAssetJobDependencyId(generationSummary)).toBe("caption-job");
    expect(evaluateMediaAssetJobDependency({
      jobId: "render-job",
      sermonId: "sermon-1",
      generationSummary,
      dependency: {
        id: "caption-job",
        sermonId: "sermon-1",
        status: "RUNNING",
      },
    })).toEqual({
      state: "WAITING",
      dependencyId: "caption-job",
    });
    expect(evaluateMediaAssetJobDependency({
      jobId: "render-job",
      sermonId: "sermon-1",
      generationSummary,
      dependency: {
        id: "caption-job",
        sermonId: "sermon-1",
        status: "SUCCEEDED",
      },
    })).toEqual({
      state: "READY",
      dependencyId: "caption-job",
    });
  });

  it.each([
    ["missing", null],
    ["failed", {
      id: "caption-job",
      sermonId: "sermon-1",
      status: "FAILED" as const,
    }],
    ["different sermon", {
      id: "caption-job",
      sermonId: "sermon-2",
      status: "SUCCEEDED" as const,
    }],
  ])("fails closed when a required predecessor is %s", (_label, dependency) => {
    expect(evaluateMediaAssetJobDependency({
      jobId: "render-job",
      sermonId: "sermon-1",
      generationSummary: { mediaAssetDependsOnJobId: "caption-job" },
      dependency,
    })).toMatchObject({
      state: "FAILED",
      dependencyId: "caption-job",
    });
  });
});
