import { describe, expect, it } from "vitest";

import { reviewPostReady } from "@/server/agents/postReadyReviewService";

const baseReview = {
  finalQualityScore: 8.4,
  hookScore: 8,
  arcCompletenessScore: 8,
  boundaryQualityScore: 9,
  visualQualityScore: 8,
  audioQualityScore: 8,
  captionQualityScore: 8,
  boundaryQuality: "GOOD" as const,
  renderStatus: "COMPLETED",
  riskLevel: "LOW" as const,
  contextWarning: false,
};

describe("post-ready review service", () => {
  it("allows a fully passing rendered clip to be post-ready", () => {
    const result = reviewPostReady(baseReview);

    expect(result.postReadyStatus).toBe("POST_READY");
    expect(result.recommendedNextAction).toBe("POST_NOW");
  });

  it("does not punish discovery-stage clips when render status is not known yet", () => {
    const result = reviewPostReady({
      ...baseReview,
      renderStatus: undefined,
    });

    expect(result.postReadyStatus).toBe("POST_READY");
    expect(result.postReadyBlockers).not.toContain("Rendered preview is not complete yet.");
  });

  it("still blocks explicit incomplete renders before publishing", () => {
    const result = reviewPostReady({
      ...baseReview,
      renderStatus: "NOT_RENDERED",
    });

    expect(result.postReadyStatus).not.toBe("POST_READY");
    expect(result.postReadyBlockers).toContain("Rendered preview is not complete yet.");
  });

  it("keeps safe rendered low-confidence framing as pastor review instead of editing", () => {
    const result = reviewPostReady({
      ...baseReview,
      visualQualityScore: 4.8,
      qualityWarnings: ["LOW_TRACKING_CONFIDENCE", "MISSING_BODY_TRACK", "SMART_CROP_REVIEW_RECOMMENDED", "MANUAL_CROP_RECOMMENDED"],
    });

    expect(result.postReadyStatus).toBe("GOOD_NEEDS_REVIEW");
    expect(result.postReadyBlockers.join(" ")).toContain("framing");
    expect(result.recommendedNextAction).toBe("REVIEW_CLIP");
  });

  it("keeps actual crop defects as editing blockers", () => {
    const result = reviewPostReady({
      ...baseReview,
      visualQualityScore: 5.6,
      qualityWarnings: ["POSSIBLE_WRONG_PERSON", "CROP_JUMP_DETECTED"],
    });

    expect(result.postReadyStatus).toBe("NEEDS_EDITING");
    expect(result.postReadyBlockers.join(" ")).toContain("framing");
    expect(result.recommendedNextAction).toBe("FIX_CROP");
  });

  it("blocks bad boundaries and weak hooks", () => {
    const result = reviewPostReady({
      ...baseReview,
      hookScore: 4.2,
      boundaryQuality: "BAD",
      boundaryQualityScore: 2,
    });

    expect(result.postReadyStatus).not.toBe("POST_READY");
    expect(result.recommendedNextAction).toBe("REVIEW_OPENING");
  });

  it("keeps human-review-only boundary concerns out of editing", () => {
    const result = reviewPostReady({
      ...baseReview,
      finalQualityScore: 7.7,
      boundaryQuality: "NEEDS_REVIEW",
      boundaryQualityScore: 5.8,
      qualityWarnings: ["PASTOR_REVIEW_BOUNDARY"],
    });

    expect(result.postReadyStatus).toBe("GOOD_NEEDS_REVIEW");
    expect(result.recommendedNextAction).toBe("REVIEW_CLIP");
  });

  it("blocks post-ready status when duration needs editor review", () => {
    const result = reviewPostReady({
      ...baseReview,
      qualityWarnings: ["PASTOR_REVIEW_DURATION"],
    });

    expect(result.postReadyStatus).not.toBe("POST_READY");
    expect(result.postReadyBlockers.join(" ")).toContain("duration");
    expect(result.recommendedNextAction).toBe("TRIM_CLIP");
  });

  it("rejects clips with hard pastor-grade content blockers even when technical scores look ready", () => {
    const result = reviewPostReady({
      ...baseReview,
      qualityWarnings: ["PASTOR_GRADE_NO_SPIRITUAL_ANCHOR"],
    });

    expect(result.postReadyStatus).toBe("REJECT");
    expect(result.postReadyBlockers.join(" ")).toContain("Pastor-grade content gate failed");
    expect(result.recommendedNextAction).toBe("REJECT");
  });
});
