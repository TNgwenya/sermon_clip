import { describe, expect, it } from "vitest";

import { __clipReviewAssetServiceTestUtils } from "@/server/agents/clipReviewAssetService";

describe("clip review asset service", () => {
  it("renders missing review previews for active generated clips", () => {
    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "SUGGESTED",
      isAiGenerated: true,
      renderStatus: "NOT_RENDERED",
    })).toBe(true);

    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "APPROVED",
      isAiGenerated: true,
      renderStatus: "NOT_RENDERED",
    })).toBe(true);
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

  it("repairs completed preview records when their media is no longer usable", () => {
    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "SUGGESTED",
      isAiGenerated: true,
      renderStatus: "COMPLETED",
    }, false, false)).toBe(true);

    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "SUGGESTED",
      isAiGenerated: true,
      renderStatus: "COMPLETED",
    }, false, true)).toBe(false);
  });

  it("reuses a healthy downstream preview instead of invalidating it with a raw rerender", () => {
    expect(__clipReviewAssetServiceTestUtils.shouldRenderReviewPreview({
      status: "APPROVED",
      isAiGenerated: true,
      renderStatus: "FAILED",
    }, false, true)).toBe(false);
  });
});
