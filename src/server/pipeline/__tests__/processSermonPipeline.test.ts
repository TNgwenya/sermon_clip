import { describe, expect, it } from "vitest";

import { __processSermonPipelineTestUtils } from "@/server/pipeline/processSermonPipeline";

describe("process sermon pipeline review asset preparation", () => {
  it("explains incomplete mobile uploads without referring to YouTube", () => {
    expect(__processSermonPipelineTestUtils.incompleteLocalUploadMessage()).toContain("Upload incomplete");
    expect(__processSermonPipelineTestUtils.incompleteLocalUploadMessage()).toContain("Re-upload the video");
  });

  it("reports premium output failures as a partial pipeline failure", () => {
    const PartialFailure = __processSermonPipelineTestUtils.PipelinePartialCompletionError;
    const failure = new PartialFailure([
      { label: "Transcribe audio", status: "SUCCEEDED", message: "Audio transcribed." },
      { label: "Generate clip suggestions", status: "SUCCEEDED", message: "Generated clips." },
      { label: "Generate content opportunities", status: "FAILED", message: "Provider unavailable." },
    ]);

    expect(failure.code).toBe("PIPELINE_PARTIAL_FAILURE");
    expect(failure.summary).toContain("premium outputs need attention");
    expect(failure.failedSteps).toEqual([
      { label: "Generate content opportunities", status: "FAILED", message: "Provider unavailable." },
    ]);
  });

  it("does not increment an already-claimed parent job attempt a second time", () => {
    expect(__processSermonPipelineTestUtils.shouldMarkParentJobRunning({
      status: "RUNNING",
      attemptCount: 0,
    })).toBe(true);

    expect(__processSermonPipelineTestUtils.shouldMarkParentJobRunning({
      status: "PENDING",
      attemptCount: 0,
    })).toBe(true);

    expect(__processSermonPipelineTestUtils.shouldMarkParentJobRunning({
      status: "RUNNING",
      attemptCount: 1,
    })).toBe(false);
  });

  it("renders suggested clip previews before pastor review", () => {
    const plan = __processSermonPipelineTestUtils.buildGeneratedClipReviewAssetPlan({
      renderStatus: "NOT_RENDERED",
    });

    expect(plan).toEqual({
      preparePreviewVideo: true,
      prepareCaptionFile: false,
    });
  });

  it("skips automatic preview rendering when a preview is already ready", () => {
    expect(__processSermonPipelineTestUtils.buildGeneratedClipReviewAssetPlan({
      renderStatus: "COMPLETED",
    })).toEqual({
      preparePreviewVideo: false,
      prepareCaptionFile: false,
    });

    expect(__processSermonPipelineTestUtils.buildGeneratedClipReviewAssetPlan({
      renderStatus: "COMPLETED",
    }, true)).toEqual({
      preparePreviewVideo: true,
      prepareCaptionFile: false,
    });
  });

  it("does not start another preview render while one is queued or rendering", () => {
    expect(__processSermonPipelineTestUtils.buildGeneratedClipReviewAssetPlan({
      renderStatus: "QUEUED",
    })).toEqual({
      preparePreviewVideo: false,
      prepareCaptionFile: false,
    });

    expect(__processSermonPipelineTestUtils.buildGeneratedClipReviewAssetPlan({
      renderStatus: "RENDERING",
    })).toEqual({
      preparePreviewVideo: false,
      prepareCaptionFile: false,
    });
  });
});
