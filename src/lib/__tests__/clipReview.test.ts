import { describe, expect, it } from "vitest";

import {
  buildClipQualityView,
  buildClipWarnings,
  filterClips,
  getQueuedMediaAssetsForRemoteBatchAction,
  summarizeReview,
  type ReviewClipModel,
} from "@/lib/clipReview";

function clip(status: ReviewClipModel["status"]): ReviewClipModel {
  return {
    id: status,
    status,
    score: 8,
    durationSeconds: 45,
    createdAt: new Date("2026-06-18T10:00:00.000Z"),
    renderStatus: "COMPLETED",
    captionStatus: "GENERATED",
    overlayStatus: "COMPLETED",
    exportStatus: status === "EXPORTED" ? "COMPLETED" : "NOT_EXPORTED",
    boundaryQuality: "GOOD",
    subtitleFilePath: "/tmp/subtitles.srt",
    overlayVideoPath: "/tmp/overlay.mp4",
  };
}

describe("clip review summaries", () => {
  it("normalizes older percentage-scale scores before showing a ten-point signal", () => {
    const qualityView = buildClipQualityView({
      ...clip("SUGGESTED"),
      score: 92,
    }, 0);

    expect(qualityView.scoreLabel).toBe("9.2");
  });
  it("treats exported clips as approved for pastor readiness", () => {
    const clips = [clip("APPROVED"), clip("EXPORTED"), clip("SUGGESTED"), clip("REJECTED")];

    expect(summarizeReview(clips)).toMatchObject({
      total: 4,
      approved: 2,
      pending: 1,
      rejected: 1,
    });
    expect(filterClips(clips, "APPROVED").map((item) => item.status)).toEqual(["APPROVED", "EXPORTED"]);
  });

  it("shows a pastor-friendly warning for unstable smart crop movement", () => {
    expect(buildClipWarnings({
      ...clip("APPROVED"),
      qualityWarnings: ["SMART_CROP_UNSTABLE"],
    })).toContain("Smart crop movement may need review");
  });

  it("labels reviewed clip scores as quality scores", () => {
    const qualityView = buildClipQualityView({
      ...clip("SUGGESTED"),
      finalQualityScore: 8.4,
      qualityLabel: "POST_READY",
      qualityReviewedAt: new Date("2026-06-18T11:00:00.000Z"),
      qualityReviewSource: "AI",
      hookStrengthScore: 8.7,
      standaloneClarityScore: 8.1,
      ministryValueScore: 8.8,
      emotionalImpactScore: 7.7,
      arcCompletenessScore: 8.3,
      socialShareabilityScore: 7.9,
      contextSafetyScore: 8.6,
      visualReadinessScore: 7.2,
      bestPlatform: "YouTube Shorts",
      recommendedNextAction: "POST_NOW",
    }, 0);

    expect(qualityView.scoreSourceLabel).toBe("Quality score");
    expect(qualityView.postReadiness.label).toBe("Strong content potential");
    expect(qualityView.openingStrength.label).toBe("Opening earns attention");
    expect(qualityView.ministryImpact.label).toBe("Strong ministry value");
    expect(qualityView.completeness.label).toBe("Thought lands completely");
    expect(qualityView.platformFit).toMatchObject({ label: "YouTube Shorts", assessed: true });
    expect(qualityView.freshness.state).toBe("current");
    expect(qualityView.nextStep).toContain("finish captions and branding");
  });

  it("does not present missing or stale content guidance as confident", () => {
    const unassessed = buildClipQualityView(clip("SUGGESTED"), 0);
    const stale = buildClipQualityView({
      ...clip("SUGGESTED"),
      finalQualityScore: 7.4,
      qualityLabel: "GOOD_NEEDS_REVIEW",
      qualityReviewedAt: null,
      bestPlatform: null,
    }, 0);

    expect(unassessed.openingStrength).toMatchObject({ label: "Not reviewed yet", scoreLabel: "-" });
    expect(unassessed.freshness.state).toBe("unassessed");
    expect(stale.freshness).toMatchObject({ state: "review", label: "Content guidance needs a refresh" });
    expect(stale.platformFit).toMatchObject({ label: "Choose in Studio", assessed: false });
  });

  it("queues local worker assets for remote batch media actions", () => {
    expect(getQueuedMediaAssetsForRemoteBatchAction("approve")).toEqual([]);
    expect(getQueuedMediaAssetsForRemoteBatchAction("prepare")).toEqual([
      "render",
      "caption",
      "captionBurn",
      "overlay",
      "export",
    ]);
    expect(getQueuedMediaAssetsForRemoteBatchAction("render")).toEqual([]);
    expect(getQueuedMediaAssetsForRemoteBatchAction("export")).toEqual(["render", "overlay", "export"]);
    expect(getQueuedMediaAssetsForRemoteBatchAction("reject")).toEqual([]);
    expect(getQueuedMediaAssetsForRemoteBatchAction("pending")).toEqual([]);
  });
});
