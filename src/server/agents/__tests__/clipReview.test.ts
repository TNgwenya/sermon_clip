import { describe, expect, it } from "vitest";

import {
  applyClipApprovalStatus,
  buildClipQualityView,
  buildClipWarnings,
  filterClips,
  getQualityCategoryLabel,
  persistClipNote,
  sortClips,
  summarizeBatchSelection,
  summarizeReview,
  type ReviewClipModel,
} from "@/lib/clipReview";

const baseClip: ReviewClipModel = {
  id: "clip-1",
  status: "SUGGESTED",
  score: 7.5,
  durationSeconds: 42,
  createdAt: new Date("2026-06-18T00:00:00.000Z"),
  renderStatus: "NOT_RENDERED",
  captionStatus: "NOT_GENERATED",
  overlayStatus: "NOT_RENDERED",
  exportStatus: "NOT_EXPORTED",
  boundaryQuality: "GOOD",
  subtitleFilePath: null,
  overlayVideoPath: null,
};

describe("clip review helpers", () => {
  it("supports approval and rejection filter logic", () => {
    const clips: ReviewClipModel[] = [
      baseClip,
      { ...baseClip, id: "clip-2", status: "APPROVED" },
      { ...baseClip, id: "clip-3", status: "REJECTED" },
    ];

    expect(filterClips(clips, "APPROVED")).toHaveLength(1);
    expect(filterClips(clips, "REJECTED")).toHaveLength(1);
    expect(filterClips(clips, "PENDING")).toHaveLength(1);
  });

  it("supports rendered and not rendered filters", () => {
    const clips: ReviewClipModel[] = [
      { ...baseClip, id: "clip-1", renderStatus: "COMPLETED" },
      { ...baseClip, id: "clip-2", renderStatus: "NOT_RENDERED" },
    ];

    expect(filterClips(clips, "RENDERED")).toHaveLength(1);
    expect(filterClips(clips, "NOT_RENDERED")).toHaveLength(1);
  });

  it("supports batch sort modes", () => {
    const clips: ReviewClipModel[] = [
      { ...baseClip, id: "clip-1", score: 5, startTimeSeconds: 420, durationSeconds: 50, createdAt: new Date("2026-06-15") },
      { ...baseClip, id: "clip-2", score: 9, startTimeSeconds: 90, durationSeconds: 20, createdAt: new Date("2026-06-18") },
      { ...baseClip, id: "clip-3", score: 4, durationSeconds: 35, createdAt: new Date("2026-06-10") },
    ];

    expect(sortClips(clips, "HIGHEST_SCORE")[0].id).toBe("clip-2");
    expect(sortClips(clips, "SERMON_ORDER").map((clip) => clip.id)).toEqual(["clip-2", "clip-1", "clip-3"]);
    expect(sortClips(clips, "NEWEST")[0].id).toBe("clip-2");
    expect(sortClips(clips, "SHORTEST")[0].id).toBe("clip-2");
    expect(sortClips(clips, "LONGEST")[0].id).toBe("clip-1");
  });

  it("uses overall post score when available and falls back to legacy score for older clips", () => {
    const clips: ReviewClipModel[] = [
      { ...baseClip, id: "clip-1", score: 9.1, overallPostScore: null },
      { ...baseClip, id: "clip-2", score: 7.2, overallPostScore: 8.4 },
      { ...baseClip, id: "clip-3", score: 6.2, overallPostScore: 9.3 },
    ];

    expect(sortClips(clips, "HIGHEST_SCORE").map((clip) => clip.id)).toEqual(["clip-3", "clip-1", "clip-2"]);
  });

  it("builds warnings for missing assets and long duration", () => {
    const warnings = buildClipWarnings({
      ...baseClip,
      durationSeconds: 75,
      boundaryQuality: "NEEDS_REVIEW",
    });

    expect(warnings).toContain("Captions not generated");
    expect(warnings).toContain("Overlay not generated");
    expect(warnings).toContain("Clip duration exceeds recommendation");
    expect(warnings).toContain("Clip start or ending may need review");
  });

  it("translates quality warning codes into pastor-friendly messages", () => {
    const warnings = buildClipWarnings({
      ...baseClip,
      recommendedAction: "NEEDS_REVIEW",
      qualityWarnings: ["CONTEXT_RISK", "HEURISTIC_TRACKING_USED", "MISSING_BODY_TRACK", "LOW_POST_WORTHINESS"],
    });

    expect(warnings).toContain("Needs pastor review before posting");
    expect(warnings).toContain("May need more context");
    expect(warnings).toContain("Video framing may need review");
    expect(warnings).toContain("Pastor may not stay centered throughout");
    expect(warnings).toContain("Weak post candidate");
  });

  it("builds a pastor-facing quality view with scores, action, and category", () => {
    const qualityView = buildClipQualityView(
      {
        ...baseClip,
        overallPostScore: 8.7,
        standaloneClarityScore: 8.2,
        contextSafetyScore: 8.9,
        visualReadinessScore: 6.4,
        recommendedAction: "NEEDS_REVIEW",
        qualityClipCategory: "SCRIPTURE_TEACHING",
        pastorFriendlyReason: "Strong message, but the video framing should be checked before posting.",
      },
      0,
    );

    expect(qualityView.rankLabel).toBe("Best first post");
    expect(qualityView.scoreLabel).toBe("8.7");
    expect(qualityView.scoreSourceLabel).toBe("Post score");
    expect(qualityView.actionLabel).toBe("Needs pastor review");
    expect(qualityView.categoryLabel).toBe("Scripture Teaching");
    expect(qualityView.contextSafety.label).toBe("Safe to post");
    expect(qualityView.visualReadiness.label).toBe("Check framing");
  });

  it("falls back cleanly for older clips without quality review data", () => {
    const qualityView = buildClipQualityView(baseClip, 2);

    expect(qualityView.rankLabel).toBe("Post pick #3");
    expect(qualityView.scoreLabel).toBe("7.5");
    expect(qualityView.scoreSourceLabel).toBe("Earlier estimate");
    expect(qualityView.actionLabel).toBe("Ready to review");
    expect(qualityView.hasQualityReview).toBe(false);
    expect(qualityView.reason).toContain("older clip");
  });

  it("formats quality category labels for pastors", () => {
    expect(getQualityCategoryLabel("ALTAR_CALL")).toBe("Altar Call");
    expect(getQualityCategoryLabel("testimony_moment")).toBe("Testimony Moment");
    expect(getQualityCategoryLabel(null)).toBe("General");
  });

  it("summarizes review counts", () => {
    const summary = summarizeReview([
      { ...baseClip, id: "clip-1", status: "APPROVED", renderStatus: "COMPLETED" },
      { ...baseClip, id: "clip-2", status: "REJECTED" },
      { ...baseClip, id: "clip-3", status: "SUGGESTED" },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.approved).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.rendered).toBe(1);
  });

  it("applies approval and rejection status changes", () => {
    const clips: ReviewClipModel[] = [
      { ...baseClip, id: "clip-1", status: "SUGGESTED" },
    ];

    const approved = applyClipApprovalStatus(clips, "clip-1", "APPROVED");
    expect(approved[0].status).toBe("APPROVED");

    const rejected = applyClipApprovalStatus(approved, "clip-1", "REJECTED");
    expect(rejected[0].status).toBe("REJECTED");
  });

  it("persists note updates", () => {
    const notes = persistClipNote({}, "clip-1", "Use this for Sunday promotion.");
    expect(notes["clip-1"]).toBe("Use this for Sunday promotion.");
  });

  it("summarizes batch action selection", () => {
    const clips: ReviewClipModel[] = [
      { ...baseClip, id: "clip-1", status: "APPROVED" },
      { ...baseClip, id: "clip-2", status: "REJECTED" },
      { ...baseClip, id: "clip-3", status: "SUGGESTED" },
    ];

    const summary = summarizeBatchSelection(clips, ["clip-1", "clip-2", "clip-3"]);
    expect(summary.selectedCount).toBe(3);
    expect(summary.approvedSelected).toBe(1);
    expect(summary.rejectedSelected).toBe(1);
    expect(summary.pendingSelected).toBe(1);
  });
});
