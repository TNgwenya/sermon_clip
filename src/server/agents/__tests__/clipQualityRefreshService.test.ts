import { describe, expect, it, vi } from "vitest";

import {
  refreshClipQualityRecords,
  shouldRefreshClipQuality,
  type RefreshableClip,
} from "@/server/agents/clipQualityRefreshService";
import type { ClipQualityCandidateInput, ClipQualityReviewedCandidate } from "@/server/agents/clipQualityReviewService";

const reviewedQuality: ClipQualityReviewedCandidate<ClipQualityCandidateInput> = {
  title: "Trust God in the waiting",
  hook: "What do you do while you are waiting on God?",
  caption: "God is faithful in the waiting.",
  score: 8,
  transcriptText: "God is faithful in the waiting.",
  durationSeconds: 45,
  startTimeSeconds: 10,
  endTimeSeconds: 55,
  riskLevel: "LOW",
  riskReasons: [],
  contextWarning: false,
  clipType: "pastoral",
  smartClipCategory: "Best Encouragement Clip",
  ministryValue: "Encourages the church to trust God.",
  socialValue: "Clear short-form encouragement.",
  intendedAudience: "Church members and online viewers",
  reasonSelected: "Strong encouragement moment.",
  boundaryQuality: "GOOD",
  boundaryAdjustmentReason: null,
  hookStrengthScore: 8,
  standaloneClarityScore: 8,
  emotionalImpactScore: 8,
  sermonValueScore: 8,
  shareabilityScore: 8,
  contextSafetyScore: 9,
  boundaryQualityScore: 9,
  visualReadinessScore: 6,
  overallPostScore: 8.1,
  qualitySummary: "Strong post-ready encouragement clip.",
  pastorFriendlyReason: "This clip is clear and encouraging on its own.",
  recommendedAction: "KEEP",
  suggestedStartTimeSeconds: null,
  suggestedEndTimeSeconds: null,
  qualityClipCategory: "ENCOURAGEMENT",
  qualityWarnings: [],
  qualityReviewSource: "AI",
  qualityReviewedAt: new Date("2026-06-20T10:00:00.000Z"),
};

function clip(overrides: Partial<RefreshableClip> = {}): RefreshableClip {
  return {
    id: "clip-1",
    sermonId: "sermon-1",
    status: "APPROVED",
    title: "Trust God in the waiting",
    hook: "What do you do while you are waiting on God?",
    caption: "God is faithful in the waiting.",
    score: 8,
    transcriptText: "God is faithful in the waiting.",
    transcriptSafetyStatus: "TRUSTED",
    durationSeconds: 45,
    startTimeSeconds: 10,
    endTimeSeconds: 55,
    riskLevel: "LOW",
    riskReasons: [],
    contextWarning: false,
    clipType: "pastoral",
    smartClipCategory: "Best Encouragement Clip",
    ministryValue: "Encourages the church to trust God.",
    socialValue: "Clear short-form encouragement.",
    intendedAudience: "Church members and online viewers",
    reasonSelected: "Strong encouragement moment.",
    boundaryQuality: "GOOD",
    boundaryAdjustmentReason: null,
    visualReadinessScore: null,
    qualityReviewedAt: null,
    overallPostScore: null,
    recommendedAction: null,
    qualitySummary: null,
    pastorFriendlyReason: null,
    qualityClipCategory: null,
    qualityWarnings: [],
    exportLayoutStrategy: "CENTER_CROP",
    videoSubjectTracks: [],
    renderStatus: "COMPLETED",
    captionData: null,
    audioQualityScore: null,
    averageLoudness: null,
    peakLoudness: null,
    silenceAtBeginningSeconds: null,
    silenceAtEndSeconds: null,
    audioWarnings: [],
    completenessScore: null,
    completenessAction: null,
    completenessWarnings: [],
    ...overrides,
  };
}

function dependencies(overrides: Partial<Parameters<typeof refreshClipQualityRecords>[0]["dependencies"]> = {}) {
  return {
    reviewCandidates: vi.fn(async <T extends ClipQualityCandidateInput>(candidates: T[]) => candidates.map((candidate) => ({
      ...candidate,
      ...reviewedQuality,
    }) as ClipQualityReviewedCandidate<T>)),
    refreshVisualQuality: vi.fn(async () => null),
    refreshTracking: vi.fn(async () => ({ clipId: "clip-1", trackCount: 1, source: "HEURISTIC_CENTER" as const, tracks: [] })),
    scoreProfessionalQuality: vi.fn(() => ({
      hookScore: 8,
      hookType: "BOLD_STATEMENT" as const,
      hookProblem: null,
      suggestedStartAdjustment: null,
      hookReason: "Strong opening.",
      clipArcType: "PROBLEM_TRUTH_APPLICATION" as const,
      arcSummary: "Clear sermon thought.",
      setupStartTime: 10,
      mainPointTime: 20,
      payoffTime: 40,
      applicationTime: 50,
      arcCompletenessScore: 8,
      whyThisClipFeelsComplete: "The clip lands with application.",
      whatContextMightBeMissing: null,
      durationQualityScore: 8,
      durationQualityLabel: "IDEAL" as const,
      durationReason: "Good duration.",
      targetMinSeconds: 45,
      targetMaxSeconds: 90,
      audioQualityScore: 8,
      averageLoudness: null,
      peakLoudness: null,
      silenceAtBeginningSeconds: null,
      silenceAtEndSeconds: null,
      longestInternalSilenceSeconds: null,
      internalSilenceCount: null,
      audioWarnings: [],
      standaloneClarityScore: 8,
      emotionalWeightScore: 8,
      ministryValueScore: 8,
      boundaryQualityScore: 9,
      visualConfidenceScore: 7,
      socialShareabilityScore: 8,
      captionQualityScore: 8,
      captionQualityWarnings: [],
      finalQualityScore: 8.2,
      qualityLabel: "POST_READY" as const,
      qualityReasons: ["Strong clip."],
      qualityWarnings: [],
      rankingCategory: "BEST_OVERALL" as const,
      bestPlatform: "YouTube Shorts",
      postReadyStatus: "POST_READY" as const,
      postReadyReasons: ["Ready."],
      postReadyBlockers: [],
      recommendedNextAction: "POST_NOW" as const,
    })),
    updateClipQuality: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("clip quality refresh service", () => {
  it("identifies clips missing quality data", () => {
    expect(shouldRefreshClipQuality(clip())).toBe(true);
    expect(shouldRefreshClipQuality(clip({
      overallPostScore: 8,
      qualityReviewedAt: new Date("2026-06-20T10:00:00.000Z"),
      recommendedAction: "KEEP",
      qualitySummary: "Strong clip.",
      pastorFriendlyReason: "Clear and useful.",
      qualityClipCategory: "ENCOURAGEMENT",
    }))).toBe(false);
  });

  it("refreshes missing quality only by default", async () => {
    const deps = dependencies();
    const freshClip = clip({
      id: "clip-fresh",
      overallPostScore: 8,
      qualityReviewedAt: new Date("2026-06-20T10:00:00.000Z"),
      recommendedAction: "KEEP",
      qualitySummary: "Strong clip.",
      pastorFriendlyReason: "Clear and useful.",
      qualityClipCategory: "ENCOURAGEMENT",
    });

    const result = await refreshClipQualityRecords({
      clips: [clip({ id: "clip-old" }), freshClip],
      dependencies: deps,
    });

    expect(result).toMatchObject({ clipsFound: 2, clipsRefreshed: 1, clipsSkipped: 1, clipsFailed: 0 });
    expect(deps.updateClipQuality).toHaveBeenCalledTimes(1);
    expect(deps.updateClipQuality).toHaveBeenCalledWith(
      "clip-old",
      expect.objectContaining({ overallPostScore: 8.1 }),
      expect.objectContaining({ finalQualityScore: 8.2, qualityLabel: "POST_READY" }),
    );
  });

  it("supports force refresh for already reviewed clips", async () => {
    const deps = dependencies();
    const result = await refreshClipQualityRecords({
      mode: "force",
      clips: [clip({
        overallPostScore: 8,
        qualityReviewedAt: new Date("2026-06-20T10:00:00.000Z"),
        recommendedAction: "KEEP",
        qualitySummary: "Strong clip.",
        pastorFriendlyReason: "Clear and useful.",
        qualityClipCategory: "ENCOURAGEMENT",
      })],
      dependencies: deps,
    });

    expect(result.clipsRefreshed).toBe(1);
    expect(deps.reviewCandidates).toHaveBeenCalledTimes(1);
    expect(deps.reviewCandidates).toHaveBeenCalledWith(
      expect.any(Array),
      { bypassCache: true, sermonId: "sermon-1" },
    );
  });

  it("reviews clips in bounded batches instead of one AI request per clip", async () => {
    const deps = dependencies();
    const clips = Array.from({ length: 9 }, (_, index) => clip({ id: `clip-${index}` }));

    const result = await refreshClipQualityRecords({ clips, dependencies: deps });

    expect(result.clipsRefreshed).toBe(9);
    expect(deps.reviewCandidates).toHaveBeenCalledTimes(2);
    const reviewMock = vi.mocked(deps.reviewCandidates);
    expect(reviewMock.mock.calls[0][0]).toHaveLength(8);
    expect(reviewMock.mock.calls[1][0]).toHaveLength(1);
  });

  it("preserves pastor clip status by only updating quality fields", async () => {
    const deps = dependencies();
    const approvedClip = clip({ id: "clip-approved", status: "APPROVED" });

    await refreshClipQualityRecords({ clips: [approvedClip], dependencies: deps });

    expect(approvedClip.status).toBe("APPROVED");
    expect(deps.updateClipQuality).toHaveBeenCalledWith(
      "clip-approved",
      expect.not.objectContaining({ status: expect.any(String) }),
      expect.objectContaining({ qualityLabel: "POST_READY" }),
    );
  });

  it("passes review, audio, caption, and completeness data into professional scoring", async () => {
    const deps = dependencies();

    await refreshClipQualityRecords({
      clips: [clip({
        id: "clip-professional",
        renderStatus: "COMPLETED",
        audioQualityScore: 7.5,
        audioWarnings: ["LOW_AUDIO_VOLUME"],
        completenessScore: 5.5,
        completenessAction: "NEEDS_REVIEW",
        completenessWarnings: ["MISSING_SETUP"],
      })],
      dependencies: deps,
    });

    expect(deps.scoreProfessionalQuality).toHaveBeenCalledWith(expect.objectContaining({
      overallPostScore: 8.1,
      audioQualityScore: 7.5,
      audioWarnings: ["LOW_AUDIO_VOLUME"],
      completenessScore: 5.5,
      completenessAction: "NEEDS_REVIEW",
      completenessWarnings: ["MISSING_SETUP"],
    }));
  });

  it("uses refreshed visual QC before professional scoring", async () => {
    const deps = dependencies({
      refreshVisualQuality: vi.fn(async () => ({
        visualReadinessScore: 4.2,
        speakerVisiblePercentage: 34,
        averageTrackingConfidence: 0.42,
        cropStabilityScore: 4,
        wrongPersonSwitchRisk: 0.5,
        majorCropJumpCount: 1,
        faceOrBodyDetectionCoverage: 0.34,
        visualQualityScore: 4.2,
        manualCropRecommended: true,
        overallPostScore: 5.8,
        recommendedAction: "NEEDS_REVIEW" as const,
        pastorFriendlyReason: "Framing needs review.",
        qualitySummary: "Visual quality refreshed.",
        qualityWarnings: ["SMART_CROP_REVIEW_RECOMMENDED", "MANUAL_CROP_RECOMMENDED"],
      })),
    });

    await refreshClipQualityRecords({
      clips: [clip({ id: "clip-visual" })],
      dependencies: deps,
    });

    expect(deps.reviewCandidates).toHaveBeenCalledWith([
      expect.objectContaining({ visualReadinessScore: 4.2 }),
    ], { bypassCache: false, sermonId: "sermon-1" });
    expect(deps.scoreProfessionalQuality).toHaveBeenCalledWith(expect.objectContaining({
      visualReadinessScore: 4.2,
      visualConfidenceScore: 4.2,
      visualQualityScore: 4.2,
      qualityWarnings: ["SMART_CROP_REVIEW_RECOMMENDED", "MANUAL_CROP_RECOMMENDED"],
    }));
  });

  it("handles partial failures without blocking other clips", async () => {
    const deps = dependencies({
      reviewCandidates: vi.fn(async <T extends ClipQualityCandidateInput>(candidates: T[]) => {
        if (candidates.some((candidate) => candidate.title === "Broken")) {
          throw new Error("Review failed for this clip.");
        }
        return candidates.map((candidate) => ({ ...candidate, ...reviewedQuality }) as ClipQualityReviewedCandidate<T>);
      }),
    });

    const result = await refreshClipQualityRecords({
      clips: [clip({ id: "clip-ok" }), clip({ id: "clip-bad", title: "Broken" })],
      dependencies: deps,
    });

    expect(result).toMatchObject({ clipsFound: 2, clipsRefreshed: 1, clipsFailed: 1 });
    expect(result.failures[0]).toMatchObject({ clipId: "clip-bad", reason: "Review failed for this clip." });
  });

  it("counts fallback quality reviews", async () => {
    const deps = dependencies({
      reviewCandidates: vi.fn(async <T extends ClipQualityCandidateInput>(candidates: T[]) => candidates.map((candidate) => ({
        ...candidate,
        ...reviewedQuality,
        qualityReviewSource: "FALLBACK",
      }) as ClipQualityReviewedCandidate<T>)),
    });

    const result = await refreshClipQualityRecords({ clips: [clip()], dependencies: deps });

    expect(result.fallbackReviews).toBe(1);
  });

  it("refreshes subject tracking for smart crop clips without tracks", async () => {
    const deps = dependencies();

    await refreshClipQualityRecords({
      clips: [clip({ exportLayoutStrategy: "SMART_CROP", videoSubjectTracks: [] })],
      dependencies: deps,
    });

    expect(deps.refreshTracking).toHaveBeenCalledWith("clip-1");
  });
});
