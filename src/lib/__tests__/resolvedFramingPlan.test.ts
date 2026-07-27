import { describe, expect, it } from "vitest";

import {
  buildResolvedFramingPlanDocument,
  calculateResolvedFramingSafeBounds,
  MAX_RESOLVED_FRAMING_TIMELINE_POINTS,
  resolveResolvedFramingPlanConsumption,
  resolvedFramingPlanToSmartCropOptions,
  smoothResolvedFramingTimeline,
} from "@/lib/resolvedFramingPlan";

function baseInput() {
  return {
    clipCandidateId: "clip-1",
    editPlanId: "edit-plan-3",
    editPlanHash: "plan-hash-3",
    requestedLayout: "SMART_CROP" as const,
    requestedPersonality: "AUTO_INTELLIGENT" as const,
    sourceGeometry: {
      width: 1920,
      height: 1080,
      role: "ORIGINAL_SOURCE" as const,
    },
    moment: {
      title: "Run your race",
      transcriptText: "Keep running the race God has placed before you.",
      durationSeconds: 120,
    },
  };
}

function longMovingSpeakerFixture() {
  return Array.from({ length: 81 }, (_, index) => {
    const timeSeconds = index * 1.5;
    const sceneTwo = index >= 42;
    const progress = sceneTwo ? (index - 42) / 38 : index / 41;
    return {
      timeSeconds,
      centerX: sceneTwo
        ? 0.72 - progress * 0.35
        : 0.24 + progress * 0.48,
      centerY: sceneTwo
        ? 0.38 + Math.sin(index / 6) * 0.05
        : 0.47 + Math.sin(index / 7) * 0.06,
      confidence: 0.88,
      sceneId: sceneTwo ? "camera-b" : "camera-a",
    };
  });
}

describe("resolved framing plan", () => {
  it("builds a bounded smoothed X/Y timeline while preserving long-clip scene boundaries", () => {
    const plan = buildResolvedFramingPlanDocument({
      ...baseInput(),
      trackingSource: "MODEL",
      trackingPoints: longMovingSpeakerFixture(),
    });

    expect(plan.resolution.status).toBe("READY");
    expect(plan.effective.layout).toBe("SMART_CROP");
    expect(plan.tracking.sampleCount).toBe(81);
    expect(plan.tracking.timeline.length).toBeLessThanOrEqual(MAX_RESOLVED_FRAMING_TIMELINE_POINTS);
    expect(new Set(plan.tracking.timeline.map((point) => point.sceneId))).toEqual(
      new Set(["camera-a", "camera-b"]),
    );
    expect(plan.tracking.timeline.every((point) => (
      point.centerX >= plan.geometry.safeBounds.minCenterX
      && point.centerX <= plan.geometry.safeBounds.maxCenterX
      && point.centerY >= plan.geometry.safeBounds.minCenterY
      && point.centerY <= plan.geometry.safeBounds.maxCenterY
    ))).toBe(true);
    expect(plan.tracking.timeline.some((point) => point.stabilized)).toBe(true);
  });

  it("does not smooth a camera scene cut across the previous scene", () => {
    const bounds = calculateResolvedFramingSafeBounds({
      sourceWidth: 1920,
      sourceHeight: 1080,
      zoom: 1.08,
    });
    const timeline = smoothResolvedFramingTimeline({
      points: [
        { timeSeconds: 0, centerX: 0.28, centerY: 0.42, confidence: 0.9, sceneId: "wide" },
        { timeSeconds: 2, centerX: 0.34, centerY: 0.45, confidence: 0.9, sceneId: "wide" },
        { timeSeconds: 2.1, centerX: 0.72, centerY: 0.32, confidence: 0.92, sceneId: "close" },
      ],
      safeBounds: bounds,
      defaultZoom: 1.08,
      motionSmoothing: "DYNAMIC",
    });

    expect(timeline[2].sceneId).toBe("close");
    expect(timeline[2].centerX).toBeCloseTo(0.72, 2);
    expect(timeline[2].centerY).toBe(bounds.minCenterY);
  });

  it("uses an explicit safe fallback when Auto Intelligent has no model tracking", () => {
    const plan = buildResolvedFramingPlanDocument({
      ...baseInput(),
      trackingSource: "HEURISTIC_CENTER",
      trackingPoints: [
        { timeSeconds: 0, centerX: 0.5, centerY: 0.45, confidence: 0.64 },
        { timeSeconds: 120, centerX: 0.5, centerY: 0.45, confidence: 0.64 },
      ],
    });

    expect(plan.tracking.status).toBe("HEURISTIC");
    expect(plan.resolution.status).toBe("FALLBACK");
    expect(plan.resolution.fallbackCode).toBe("MODEL_TRACKING_UNAVAILABLE");
    expect(plan.effective.layout).toBe("FIT_BLURRED_BACKGROUND");
    expect(plan.tracking.timeline).toEqual([]);
  });

  it("keeps Speaker Focus speaker-first and falls back instead of trusting center heuristics", () => {
    const fallback = buildResolvedFramingPlanDocument({
      ...baseInput(),
      requestedPersonality: "SPEAKER_FOCUS",
      trackingSource: "HEURISTIC_CENTER",
      trackingPoints: [
        { timeSeconds: 0, centerX: 0.5, centerY: 0.45, confidence: 0.64 },
      ],
    });
    const tracked = buildResolvedFramingPlanDocument({
      ...baseInput(),
      requestedPersonality: "SPEAKER_FOCUS",
      trackingSource: "MODEL",
      trackingPoints: [
        { timeSeconds: 0, centerX: 0.32, centerY: 0.44, confidence: 0.91 },
        { timeSeconds: 5, centerX: 0.38, centerY: 0.41, confidence: 0.9 },
      ],
    });

    expect(fallback.effective.layout).toBe("FIT_BLURRED_BACKGROUND");
    expect(fallback.resolution.fallbackCode).toBe("MODEL_TRACKING_UNAVAILABLE");
    expect(tracked.effective.layout).toBe("SMART_CROP");
    expect(tracked.effective.personality).toBe("SPEAKER_FOCUS");
    expect(tracked.effective.resolvedPersonality).toBe("SPEAKER_FOCUS");
    expect(tracked.effective.treatment).toBe("SPEAKER_FOCUS");
    expect(tracked.tracking.status).toBe("MODEL");
  });

  it("keeps Auto contextual framing distinct from explicit Speaker Focus with shared tracking", () => {
    const trackingPoints = longMovingSpeakerFixture();
    const automatic = buildResolvedFramingPlanDocument({
      ...baseInput(),
      requestedPersonality: "AUTO_INTELLIGENT",
      trackingSource: "MODEL",
      trackingPoints,
    });
    const speaker = buildResolvedFramingPlanDocument({
      ...baseInput(),
      requestedPersonality: "SPEAKER_FOCUS",
      trackingSource: "MODEL",
      trackingPoints,
    });

    expect(automatic.effective.personality).toBe("AUTO_INTELLIGENT");
    expect(automatic.effective.treatment).toBe("AUTO_CONTEXTUAL");
    expect(speaker.effective.treatment).toBe("SPEAKER_FOCUS");
    expect(automatic.effective.zoom).not.toBe(speaker.effective.zoom);
    expect(resolvedFramingPlanToSmartCropOptions(automatic)?.treatment).toBe("AUTO_CONTEXTUAL");
    expect(resolvedFramingPlanToSmartCropOptions(speaker)?.treatment).toBe("SPEAKER_FOCUS");
  });

  it("persists distinct wide, all-edge-safe, and blurred fit treatments", () => {
    const worship = buildResolvedFramingPlanDocument({
      ...baseInput(),
      requestedPersonality: "WORSHIP_WIDE",
      trackingSource: "MODEL",
      trackingPoints: longMovingSpeakerFixture(),
    });
    const fullStage = buildResolvedFramingPlanDocument({
      ...baseInput(),
      requestedPersonality: "SAFE_FULL_STAGE",
      trackingSource: "MODEL",
      trackingPoints: longMovingSpeakerFixture(),
    });
    const blurred = buildResolvedFramingPlanDocument({
      ...baseInput(),
      requestedLayout: "FIT_BLURRED_BACKGROUND",
      requestedPersonality: "SPEAKER_FOCUS",
    });

    expect(worship.effective.layout).toBe("FIT_BLURRED_BACKGROUND");
    expect(worship.effective.treatment).toBe("WORSHIP_WIDE");
    expect(fullStage.effective.layout).toBe("FIT_BLURRED_BACKGROUND");
    expect(fullStage.effective.treatment).toBe("FULL_STAGE");
    expect(blurred.effective.treatment).toBe("BLURRED_BACKGROUND");
  });

  it("keeps explicit presets distinct instead of resolving every option to center crop", () => {
    const presets = [
      "CENTER_CROP",
      "LEFT_FOCUS",
      "RIGHT_FOCUS",
      "FIT_BLURRED_BACKGROUND",
    ] as const;
    const decisions = presets.map((requestedLayout) => buildResolvedFramingPlanDocument({
      ...baseInput(),
      requestedLayout,
      requestedPersonality: "SPEAKER_FOCUS",
    }));

    expect(decisions.map((plan) => plan.effective.layout)).toEqual(presets);
    expect(decisions.every((plan) => plan.resolution.status === "READY")).toBe(true);
  });

  it("passes through an already portrait or prepared master so framing cannot be applied twice", () => {
    const portrait = buildResolvedFramingPlanDocument({
      ...baseInput(),
      sourceGeometry: {
        width: 1080,
        height: 1920,
        role: "CANONICAL_PORTRAIT_MASTER",
        alreadyFramed: true,
      },
      trackingSource: "MODEL",
      trackingPoints: longMovingSpeakerFixture(),
    });

    expect(portrait.resolution.status).toBe("PASSTHROUGH");
    expect(portrait.resolution.fallbackCode).toBe("ALREADY_FRAMED_MASTER");
    expect(portrait.application.mode).toBe("PASSTHROUGH_EXISTING_MASTER");
    expect(portrait.application.preventDoubleApplication).toBe(true);
    expect(portrait.tracking.timeline).toEqual([]);
    expect(resolvedFramingPlanToSmartCropOptions(portrait)).toBeNull();
  });

  it("still applies the requested plan to a native portrait original that is not a prepared master", () => {
    const nativePortrait = buildResolvedFramingPlanDocument({
      ...baseInput(),
      requestedLayout: "CENTER_CROP",
      sourceGeometry: {
        width: 1080,
        height: 1920,
        role: "ORIGINAL_SOURCE",
        alreadyFramed: false,
      },
    });

    expect(nativePortrait.geometry.source.alreadyPortrait).toBe(true);
    expect(nativePortrait.geometry.source.alreadyFramed).toBe(false);
    expect(nativePortrait.application.mode).toBe("APPLY_AT_BASE_RENDER");
    expect(nativePortrait.resolution.status).toBe("READY");
    expect(nativePortrait.effective.treatment).toBe("CENTER_CROP");
  });

  it("consumes the same plan without recropping prepared masters", () => {
    const plan = buildResolvedFramingPlanDocument({
      ...baseInput(),
      trackingSource: "MODEL",
      trackingPoints: longMovingSpeakerFixture(),
    });
    const vertical = resolveResolvedFramingPlanConsumption({
      plan,
      sourceRole: "PREPARED_DERIVATIVE",
      outputWidth: 1080,
      outputHeight: 1920,
    });
    const square = resolveResolvedFramingPlanConsumption({
      plan,
      sourceRole: "PREPARED_DERIVATIVE",
      outputWidth: 1080,
      outputHeight: 1080,
    });

    expect(vertical.shouldApplyFraming).toBe(false);
    expect(vertical.layout).toBe("CENTER_CROP");
    expect(vertical.smartCrop).toBeNull();
    expect(square.shouldApplyFraming).toBe(false);
    expect(square.layout).toBe("FIT_BLURRED_BACKGROUND");
    expect(square.preserveWithSafeFit).toBe(true);
  });

  it("manual crop remains authoritative even without generated tracking", () => {
    const plan = buildResolvedFramingPlanDocument({
      ...baseInput(),
      requestedPersonality: "SPEAKER_FOCUS",
      manualCropKeyframes: [
        { timeSeconds: 0, centerX: 0.3, centerY: 0.4, zoom: 1.12 },
        { timeSeconds: 60, centerX: 0.68, centerY: 0.36, zoom: 1.08 },
      ],
    });
    const smartCrop = resolvedFramingPlanToSmartCropOptions(plan);

    expect(plan.tracking.status).toBe("MANUAL");
    expect(plan.resolution.status).toBe("READY");
    expect(plan.effective.layout).toBe("SMART_CROP");
    expect(smartCrop?.subjectCenters).toHaveLength(2);
    expect(smartCrop?.subjectCenters[1].centerY).toBeGreaterThan(0.3);
  });
});
