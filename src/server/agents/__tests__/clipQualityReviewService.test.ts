import { describe, expect, it } from "vitest";

import {
  calculateOverallPostScore,
  determineRecommendedAction,
  reviewClipQualityCandidates,
  sortByClipQuality,
  type ClipQualityCandidateInput,
} from "@/server/agents/clipQualityReviewService";

const baseCandidate: ClipQualityCandidateInput = {
  startTimeSeconds: 30,
  endTimeSeconds: 90,
  durationSeconds: 60,
  transcriptText: "God has not forgotten you. He is still working, even when you cannot see it.",
  title: "God Has Not Forgotten You",
  hook: "God has not forgotten you.",
  caption: "Hold on to faith today.",
  score: 8.2,
  reasonSelected: "Clear encouragement with ministry value.",
  clipType: "inspirational",
  smartClipCategory: "Best Faith Clip",
  intendedAudience: "People who need encouragement",
  ministryValue: "Encourages people to trust God in a difficult season.",
  socialValue: "Clear short-form encouragement.",
  riskLevel: "LOW",
  riskReasons: [],
  contextWarning: false,
  boundaryQuality: "GOOD",
  boundaryAdjustmentReason: "Boundary quality GOOD.",
  socialPotential: {
    ministryValueScore: 8.7,
    socialMediaPotentialScore: 8.1,
    hookStrength: 8,
    clarityScore: 8.5,
    emotionalImpactScore: 8.4,
    shareabilityScore: 7.8,
    standaloneUsefulnessScore: 8.8,
    whyMayPerformWell: "Clear pastoral encouragement.",
    whyMayNotPerformWell: "Less useful for announcements.",
    recommendedPlatforms: ["Instagram Reels"],
  },
};

describe("clip quality review service", () => {
  it("applies successful AI quality review and calculates an overall post score", async () => {
    const reviewed = await reviewClipQualityCandidates([baseCandidate], {
      rawResponseOverride: JSON.stringify({
        reviews: [
          {
            candidateIndex: 0,
            hookStrengthScore: 8.5,
            standaloneClarityScore: 9,
            emotionalImpactScore: 8.2,
            sermonValueScore: 9.1,
            shareabilityScore: 7.4,
            contextSafetyScore: 9.2,
            qualitySummary: "A clear encouragement clip that can stand on its own.",
            pastorFriendlyReason: "This clip is clear, encouraging, and safe to post as a sermon highlight.",
            recommendedAction: "KEEP",
            suggestedStartTimeSeconds: null,
            suggestedEndTimeSeconds: null,
            clipCategory: "ENCOURAGEMENT",
            qualityWarnings: [],
          },
        ],
      }),
    });

    expect(reviewed[0].qualityReviewSource).toBe("AI");
    expect(reviewed[0].overallPostScore).toBeGreaterThan(7);
    expect(reviewed[0].recommendedAction).toBe("KEEP");
    expect(reviewed[0].pastorFriendlyReason).toContain("safe to post");
  });

  it("falls back with clear warnings when AI quality review fails", async () => {
    const reviewed = await reviewClipQualityCandidates([baseCandidate], {
      rawResponseOverride: "not json",
    });

    expect(reviewed[0].qualityReviewSource).toBe("FALLBACK");
    expect(reviewed[0].qualityWarnings).toContain("AI_REVIEW_FAILED");
    expect(reviewed[0].qualityWarnings).toContain("FALLBACK_REVIEW");
    expect(reviewed[0].overallPostScore).toBeGreaterThan(0);
    expect(reviewed[0].pastorFriendlyReason.length).toBeGreaterThan(0);
    expect(reviewed[0].qualitySummary).toContain("Deterministic quality review was used");
    expect(reviewed[0].qualitySummary).not.toContain("not json");
    expect(reviewed[0].qualitySummary).not.toContain("Invalid option");
  });

  it("ranks candidates by overall post score before legacy score", () => {
    const sorted = sortByClipQuality([
      { ...baseCandidate, title: "Legacy high score", score: 9.6, overallPostScore: 5.2 },
      { ...baseCandidate, title: "Post ready", score: 7.2, overallPostScore: 8.4 },
    ]);

    expect(sorted[0].title).toBe("Post ready");
  });

  it("penalizes context warnings and weak boundaries in composite scoring", () => {
    const cleanScore = calculateOverallPostScore({
      existingAiScore: 8,
      hookStrengthScore: 8,
      standaloneClarityScore: 8,
      emotionalImpactScore: 8,
      sermonValueScore: 8,
      shareabilityScore: 8,
      contextSafetyScore: 9,
      boundaryQualityScore: 9,
      visualReadinessScore: 7,
      riskLevel: "LOW",
      contextWarning: false,
      boundaryQuality: "GOOD",
    });
    const riskyScore = calculateOverallPostScore({
      existingAiScore: 8,
      hookStrengthScore: 8,
      standaloneClarityScore: 6,
      emotionalImpactScore: 8,
      sermonValueScore: 8,
      shareabilityScore: 8,
      contextSafetyScore: 5,
      boundaryQualityScore: 5.5,
      visualReadinessScore: 7,
      riskLevel: "MEDIUM",
      contextWarning: true,
      boundaryQuality: "NEEDS_REVIEW",
    });

    expect(riskyScore).toBeLessThan(cleanScore);
    expect(cleanScore - riskyScore).toBeGreaterThan(2);
  });

  it("marks unclear, risky, or weak clips as needing review or rejection", () => {
    expect(determineRecommendedAction({
      overallPostScore: 6.5,
      standaloneClarityScore: 5.5,
      contextSafetyScore: 7,
      boundaryQuality: "GOOD",
      riskLevel: "LOW",
      contextWarning: false,
    })).toBe("NEEDS_REVIEW");

    expect(determineRecommendedAction({
      overallPostScore: 6.8,
      standaloneClarityScore: 7,
      contextSafetyScore: 7,
      boundaryQuality: "NEEDS_REVIEW",
      riskLevel: "LOW",
      contextWarning: false,
    })).toBe("NEEDS_REVIEW");

    expect(determineRecommendedAction({
      overallPostScore: 5.1,
      standaloneClarityScore: 7,
      contextSafetyScore: 3.8,
      boundaryQuality: "GOOD",
      riskLevel: "HIGH",
      contextWarning: true,
    })).toBe("REJECT");
  });

  it("reflects completeness findings in warnings and recommended action", async () => {
    const reviewed = await reviewClipQualityCandidates([
      {
        ...baseCandidate,
        completenessScore: 5.2,
        completenessAction: "NEEDS_REVIEW",
        completenessWarnings: ["MISSING_SETUP", "INCOMPLETE_ENDING"],
      },
    ], {
      rawResponseOverride: JSON.stringify({
        reviews: [
          {
            candidateIndex: 0,
            hookStrengthScore: 8.5,
            standaloneClarityScore: 8.5,
            emotionalImpactScore: 8.2,
            sermonValueScore: 9.1,
            shareabilityScore: 7.4,
            contextSafetyScore: 9.2,
            qualitySummary: "Strong sentence, but the full thought needs review.",
            pastorFriendlyReason: "This clip may need a little more setup or ending context before posting.",
            recommendedAction: "KEEP",
            suggestedStartTimeSeconds: null,
            suggestedEndTimeSeconds: null,
            clipCategory: "ENCOURAGEMENT",
            qualityWarnings: [],
          },
        ],
      }),
    });

    expect(reviewed[0].recommendedAction).toBe("NEEDS_REVIEW");
    expect(reviewed[0].qualityWarnings).toContain("INCOMPLETE_THOUGHT");
    expect(reviewed[0].qualityWarnings).toContain("CONTEXT_RISK");
    expect(reviewed[0].qualityWarnings).toContain("AWKWARD_BOUNDARY");
  });

  it("keeps older clips rankable when quality data is missing", () => {
    const sorted = sortByClipQuality([
      { ...baseCandidate, title: "Older clip", score: 8.1, overallPostScore: null },
      { ...baseCandidate, title: "Reviewed clip", score: 6.5, overallPostScore: 7.5 },
    ]);

    expect(sorted[0].title).toBe("Older clip");
  });
});
