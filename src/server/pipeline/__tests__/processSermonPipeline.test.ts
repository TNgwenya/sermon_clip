import { describe, expect, it } from "vitest";

import { __processSermonPipelineTestUtils } from "@/server/pipeline/processSermonPipeline";

describe("process sermon pipeline review asset preparation", () => {
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
