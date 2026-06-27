import { describe, expect, it } from "vitest";

import { resolveIntelligentFramingDecision } from "@/lib/clipFramingIntelligence";

const confidentTracking = [
  { timeSeconds: 0, centerX: 0.48, confidence: 0.9 },
  { timeSeconds: 4, centerX: 0.5, confidence: 0.88 },
  { timeSeconds: 8, centerX: 0.52, confidence: 0.86 },
];

describe("resolveIntelligentFramingDecision", () => {
  it("chooses a tight social crop for strong short hook clips", () => {
    const result = resolveIntelligentFramingDecision({
      requestedLayout: "SMART_CROP",
      requestedPersonality: "AUTO_INTELLIGENT",
      smartCropPoints: confidentTracking,
      moment: {
        hookStrengthScore: 9,
        shareabilityScore: 8.4,
        durationSeconds: 52,
        transcriptText: "Leadership is influence and service.",
      },
    });

    expect(result.effectiveLayout).toBe("SMART_CROP");
    expect(result.resolvedPersonality).toBe("SOCIAL_PUNCHY");
    expect(result.shotStyle).toBe("HOOK_TIGHT");
    expect(result.zoom).toBeGreaterThan(1.1);
    expect(result.captionSafeArea).toBe("RAISED");
  });

  it("keeps worship moments wide", () => {
    const result = resolveIntelligentFramingDecision({
      requestedLayout: "SMART_CROP",
      requestedPersonality: "AUTO_INTELLIGENT",
      smartCropPoints: confidentTracking,
      moment: {
        transcriptText: "The worship team leads praise and prayer at the altar.",
        durationSeconds: 80,
      },
    });

    expect(result.effectiveLayout).toBe("FIT_BLURRED_BACKGROUND");
    expect(result.resolvedPersonality).toBe("WORSHIP_WIDE");
    expect(result.shotStyle).toBe("WORSHIP_WIDE");
    expect(result.reasonCodes).toContain("WORSHIP_STAGE_CONTEXT");
  });

  it("falls back safely when smart crop has no tracking", () => {
    const result = resolveIntelligentFramingDecision({
      requestedLayout: "SMART_CROP",
      requestedPersonality: "SPEAKER_FOCUS",
      smartCropPoints: [],
    });

    expect(result.effectiveLayout).toBe("FIT_BLURRED_BACKGROUND");
    expect(result.fallbackApplied).toBe(true);
    expect(result.manualCropRecommended).toBe(true);
    expect(result.frameQualitySummary).toContain("Manual crop recommended");
  });

  it("widens the crop when the speaker moves across the stage", () => {
    const movingTracking = [
      { timeSeconds: 0, centerX: 0.25, confidence: 0.88 },
      { timeSeconds: 3, centerX: 0.62, confidence: 0.85 },
      { timeSeconds: 7, centerX: 0.72, confidence: 0.83 },
    ];

    const result = resolveIntelligentFramingDecision({
      requestedLayout: "SMART_CROP",
      requestedPersonality: "SPEAKER_FOCUS",
      smartCropPoints: movingTracking,
      moment: {
        transcriptText: "The pastor walks across the stage while teaching.",
        durationSeconds: 80,
      },
    });

    expect(result.effectiveLayout).toBe("SMART_CROP");
    expect(result.shotStyle).toBe("MOVING_SPEAKER_MEDIUM");
    expect(result.zoom).toBeLessThan(1.1);
    expect(result.motionSmoothing).toBe("DYNAMIC");
  });

  it("keeps emotional moments medium-close without exceeding safe zoom", () => {
    const result = resolveIntelligentFramingDecision({
      requestedLayout: "SMART_CROP",
      requestedPersonality: "AUTO_INTELLIGENT",
      smartCropPoints: confidentTracking,
      moment: {
        emotionalImpactScore: 9,
        transcriptText: "This testimony shows God's mercy and restoration.",
        durationSeconds: 70,
      },
    });

    expect(result.resolvedPersonality).toBe("CINEMATIC_CLOSE");
    expect(result.shotStyle).toBe("EMOTIONAL_MEDIUM_CLOSE");
    expect(result.zoom).toBeGreaterThan(1.15);
    expect(result.zoom).toBeLessThanOrEqual(1.22);
    expect(result.captionSafeArea).toBe("RAISED");
  });

  it("uses group framing when people join the stage", () => {
    const result = resolveIntelligentFramingDecision({
      requestedLayout: "SMART_CROP",
      requestedPersonality: "AUTO_INTELLIGENT",
      smartCropPoints: confidentTracking,
      moment: {
        transcriptText: "The prayer team and congregation join the stage for ministry.",
        durationSeconds: 90,
      },
    });

    expect(result.effectiveLayout).toBe("FIT_BLURRED_BACKGROUND");
    expect(result.shotStyle).toBe("WORSHIP_WIDE");
    expect(result.captionSafeArea).toBe("LOWER_MINIMAL");
  });
});
