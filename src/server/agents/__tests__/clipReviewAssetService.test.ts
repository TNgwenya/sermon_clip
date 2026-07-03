import { describe, expect, it } from "vitest";

import { __clipReviewAssetServiceTestUtils } from "@/server/agents/clipReviewAssetService";

describe("clip review asset service", () => {
  it("renders missing review previews only for generated suggestions", () => {
    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "SUGGESTED",
      isAiGenerated: true,
      renderStatus: "NOT_RENDERED",
    })).toBe(true);

    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "APPROVED",
      isAiGenerated: true,
      renderStatus: "NOT_RENDERED",
    })).toBe(false);
  });

  it("does not rerender completed generated suggestions unless forced", () => {
    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "SUGGESTED",
      isAiGenerated: true,
      renderStatus: "COMPLETED",
    })).toBe(false);

    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "SUGGESTED",
      isAiGenerated: true,
      renderStatus: "COMPLETED",
    }, true)).toBe(true);
  });
});
