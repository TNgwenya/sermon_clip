import { describe, expect, it } from "vitest";

import {
  __clipVisualQualityTestUtils,
  adjustFinalQualityScoreAfterPostQc,
  resolveQualityLabelAfterPostQc,
  type RenderQcResult,
  type VisualQualityInput,
} from "@/server/agents/clipVisualQualityService";

const goodRenderQc: RenderQcResult = {
  outputExists: true,
  renderStatus: "COMPLETED",
  fileSizeBytes: 2_500_000,
  durationSeconds: 60.2,
  width: 1080,
  height: 1920,
  hasAudio: true,
};

const baseInput: VisualQualityInput = {
  score: 8.2,
  hookStrengthScore: 8,
  standaloneClarityScore: 8.4,
  emotionalImpactScore: 8,
  sermonValueScore: 8.8,
  shareabilityScore: 7.5,
  contextSafetyScore: 8.6,
  boundaryQualityScore: 9,
  riskLevel: "LOW",
  contextWarning: false,
  boundaryQuality: "GOOD",
  recommendedAction: "KEEP",
  pastorFriendlyReason: "This clip is clear on its own and pastorally useful.",
  qualitySummary: "Strong church-ready clip.",
  qualityWarnings: [],
  expectedDurationSeconds: 60,
  exportLayoutStrategy: "SMART_CROP",
  renderStatus: "COMPLETED",
  tracking: [
    { kind: "FACE", source: "MODEL", confidenceScore: 0.82, sampleCount: 5 },
    { kind: "BODY", source: "MODEL", confidenceScore: 0.88, sampleCount: 5 },
    { kind: "SPEAKER_AREA", source: "MODEL", confidenceScore: 0.9, sampleCount: 5 },
  ],
};

describe("clip visual quality refresh", () => {
  it("keeps model tracking with good confidence post-ready", () => {
    const result = __clipVisualQualityTestUtils.computeVisualQualityRefresh({
      ...baseInput,
      renderQc: goodRenderQc,
    });

    expect(result.visualReadinessScore).toBeGreaterThan(8);
    expect(result.qualityWarnings).not.toContain("LOW_TRACKING_CONFIDENCE");
    expect(result.recommendedAction).toBe("KEEP");
    expect(result.pastorFriendlyReason).toContain("looks safe to review");
  });

  it("marks heuristic tracking fallback for pastor review without rejecting", () => {
    const result = __clipVisualQualityTestUtils.computeVisualQualityRefresh({
      ...baseInput,
      tracking: [
        { kind: "FACE", source: "HEURISTIC_CENTER", confidenceScore: 0.48, sampleCount: 5 },
        { kind: "BODY", source: "HEURISTIC_CENTER", confidenceScore: 0.58, sampleCount: 5 },
        { kind: "SPEAKER_AREA", source: "HEURISTIC_CENTER", confidenceScore: 0.64, sampleCount: 5 },
      ],
    });

    expect(result.qualityWarnings).toContain("HEURISTIC_TRACKING_USED");
    expect(result.qualityWarnings).toContain("SMART_CROP_REVIEW_RECOMMENDED");
    expect(result.recommendedAction).toBe("NEEDS_REVIEW");
  });

  it("marks low tracking confidence", () => {
    const result = __clipVisualQualityTestUtils.computeVisualQualityRefresh({
      ...baseInput,
      tracking: [
        { kind: "BODY", source: "MODEL", confidenceScore: 0.42, sampleCount: 5 },
      ],
    });

    expect(result.qualityWarnings).toContain("LOW_TRACKING_CONFIDENCE");
    expect(result.recommendedAction).toBe("NEEDS_REVIEW");
  });

  it("marks unstable smart crop tracking for review", () => {
    const result = __clipVisualQualityTestUtils.computeVisualQualityRefresh({
      ...baseInput,
      tracking: [
        {
          kind: "BODY",
          source: "MODEL",
          confidenceScore: 0.62,
          sampleCount: 3,
          boxesJson: [
            { timeSeconds: 0, x: 0.4, y: 0.2, width: 0.2, height: 0.6, confidence: 0.9 },
            { timeSeconds: 8, x: 0.78, y: 0.2, width: 0.18, height: 0.6, confidence: 0.45 },
            { timeSeconds: 16, x: 0.41, y: 0.2, width: 0.2, height: 0.6, confidence: 0.88 },
          ],
        },
      ],
    });

    expect(result.qualityWarnings).toContain("SMART_CROP_UNSTABLE");
    expect(result.qualityWarnings).toContain("CROP_JUMP_DETECTED");
    expect(result.qualityWarnings).toContain("SMART_CROP_REVIEW_RECOMMENDED");
    expect(result.qualityWarnings).toContain("MANUAL_CROP_RECOMMENDED");
    expect(result.majorCropJumpCount).toBeGreaterThan(0);
    expect(result.manualCropRecommended).toBe(true);
    expect(result.recommendedAction).toBe("NEEDS_REVIEW");
  });

  it("does not over-warn stable high-confidence smart crop tracking", () => {
    const result = __clipVisualQualityTestUtils.computeVisualQualityRefresh({
      ...baseInput,
      tracking: [
        {
          kind: "BODY",
          source: "MODEL",
          confidenceScore: 0.9,
          sampleCount: 3,
          boxesJson: [
            { timeSeconds: 0, x: 0.4, y: 0.2, width: 0.2, height: 0.6, confidence: 0.91 },
            { timeSeconds: 8, x: 0.42, y: 0.2, width: 0.2, height: 0.6, confidence: 0.9 },
            { timeSeconds: 16, x: 0.44, y: 0.2, width: 0.2, height: 0.6, confidence: 0.89 },
          ],
        },
      ],
      renderQc: goodRenderQc,
    });

    expect(result.qualityWarnings).not.toContain("SMART_CROP_UNSTABLE");
    expect(result.qualityWarnings).not.toContain("SMART_CROP_REVIEW_RECOMMENDED");
    expect(result.recommendedAction).toBe("KEEP");
  });

  it("marks missing tracking rows", () => {
    const result = __clipVisualQualityTestUtils.computeVisualQualityRefresh({
      ...baseInput,
      tracking: [],
    });

    expect(result.qualityWarnings).toContain("MISSING_BODY_TRACK");
    expect(result.qualityWarnings).toContain("LOW_SAMPLE_COUNT");
    expect(result.recommendedAction).toBe("NEEDS_REVIEW");
  });

  it("accepts successful render QC", () => {
    const result = __clipVisualQualityTestUtils.computeVisualQualityRefresh({
      ...baseInput,
      renderQc: goodRenderQc,
    });

    expect(result.qualityWarnings).not.toContain("RENDER_MISSING");
    expect(result.qualityWarnings).not.toContain("AUDIO_MISSING");
    expect(result.visualReadinessScore).toBeGreaterThan(8);
  });

  it("marks missing output file", () => {
    const result = __clipVisualQualityTestUtils.computeVisualQualityRefresh({
      ...baseInput,
      renderQc: {
        outputExists: false,
        renderStatus: "COMPLETED",
        fileSizeBytes: null,
        durationSeconds: null,
        width: null,
        height: null,
        hasAudio: null,
      },
    });

    expect(result.qualityWarnings).toContain("RENDER_MISSING");
    expect(result.recommendedAction).toBe("NEEDS_REVIEW");
  });

  it("marks duration mismatch", () => {
    const result = __clipVisualQualityTestUtils.computeVisualQualityRefresh({
      ...baseInput,
      renderQc: {
        ...goodRenderQc,
        durationSeconds: 52,
      },
    });

    expect(result.qualityWarnings).toContain("OUTPUT_DURATION_MISMATCH");
    expect(result.visualReadinessScore).toBeLessThan(8.5);
  });

  it("marks dimension mismatch", () => {
    const result = __clipVisualQualityTestUtils.computeVisualQualityRefresh({
      ...baseInput,
      renderQc: {
        ...goodRenderQc,
        width: 1920,
        height: 1080,
      },
    });

    expect(result.qualityWarnings).toContain("OUTPUT_DIMENSION_MISMATCH");
    expect(result.recommendedAction).toBe("NEEDS_REVIEW");
  });

  it("marks missing audio", () => {
    const result = __clipVisualQualityTestUtils.computeVisualQualityRefresh({
      ...baseInput,
      renderQc: {
        ...goodRenderQc,
        hasAudio: false,
      },
    });

    expect(result.qualityWarnings).toContain("AUDIO_MISSING");
    expect(result.recommendedAction).toBe("NEEDS_REVIEW");
  });

  it("adjusts overall post score after visual refresh", () => {
    const strong = __clipVisualQualityTestUtils.computeVisualQualityRefresh({
      ...baseInput,
      renderQc: goodRenderQc,
    });
    const weak = __clipVisualQualityTestUtils.computeVisualQualityRefresh({
      ...baseInput,
      tracking: [],
      renderQc: {
        outputExists: false,
        renderStatus: "COMPLETED",
        fileSizeBytes: null,
        durationSeconds: null,
        width: null,
        height: null,
        hasAudio: null,
      },
    });

    expect(weak.visualReadinessScore).toBeLessThan(strong.visualReadinessScore);
    expect(weak.overallPostScore).toBeLessThan(strong.overallPostScore);
  });

  it("caps final quality score to match post-ready status after technical QC", () => {
    expect(adjustFinalQualityScoreAfterPostQc({
      refreshedOverallPostScore: 8.2,
      postReadyStatus: "POST_READY",
    })).toBe(8.2);

    expect(adjustFinalQualityScoreAfterPostQc({
      refreshedOverallPostScore: 8.2,
      postReadyStatus: "GOOD_NEEDS_REVIEW",
    })).toBe(7.9);

    expect(adjustFinalQualityScoreAfterPostQc({
      refreshedOverallPostScore: 8,
      postReadyStatus: "NEEDS_EDITING",
    })).toBe(6.9);

    expect(adjustFinalQualityScoreAfterPostQc({
      refreshedOverallPostScore: 8,
      postReadyStatus: "REJECT",
    })).toBe(4.7);
  });

  it("resolves quality label from the latest post-ready QC status", () => {
    expect(resolveQualityLabelAfterPostQc({ postReadyStatus: "POST_READY" })).toBe("POST_READY");
    expect(resolveQualityLabelAfterPostQc({ postReadyStatus: "GOOD_NEEDS_REVIEW" })).toBe("GOOD_NEEDS_REVIEW");
    expect(resolveQualityLabelAfterPostQc({ postReadyStatus: "NEEDS_EDITING" })).toBe("NEEDS_EDITING");
    expect(resolveQualityLabelAfterPostQc({ postReadyStatus: "REJECT" })).toBe("REJECT");
  });

  it("does not let an old high final score hide a weak refreshed post score", () => {
    expect(adjustFinalQualityScoreAfterPostQc({
      refreshedOverallPostScore: 6.4,
      postReadyStatus: "NEEDS_EDITING",
    })).toBe(6.4);
  });

  it("allows a repaired clip to promote from an old weak score after successful QC", () => {
    expect(adjustFinalQualityScoreAfterPostQc({
      refreshedOverallPostScore: 8.4,
      postReadyStatus: "POST_READY",
    })).toBe(8.4);
    expect(resolveQualityLabelAfterPostQc({ postReadyStatus: "POST_READY" })).toBe("POST_READY");
  });

  it("checks missing render output without throwing", async () => {
    const result = await __clipVisualQualityTestUtils.runRenderQc({
      outputPath: "/tmp/sermon-clip-file-that-does-not-exist.mp4",
      renderStatus: "COMPLETED",
      expectedDurationSeconds: 60,
    });

    expect(result.outputExists).toBe(false);
  });
});
