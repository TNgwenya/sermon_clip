import { describe, expect, it } from "vitest";

import {
  DEFAULT_FRAMING_PRESET,
  FRAMING_PRESET_LABELS,
  SELECTABLE_FRAMING_PRESETS,
  __clipFramingTestUtils,
  buildVerticalFramingFilter,
  evaluateSmartCropSafety,
  getSmartCropFilterRiskReason,
  isFfmpegCropFilterFailure,
  isValidFramingPreset,
  resolveEffectiveFramingPreset,
  resolveFramingPreset,
  type FramingPreset,
} from "@/lib/clipFraming";

describe("isValidFramingPreset", () => {
  it("accepts all known preset values", () => {
    const allPresets: FramingPreset[] = [
      "CENTER_CROP",
      "LEFT_FOCUS",
      "RIGHT_FOCUS",
      "FIT_BLURRED_BACKGROUND",
      "SMART_CROP",
    ];

    for (const preset of allPresets) {
      expect(isValidFramingPreset(preset)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isValidFramingPreset("UNKNOWN")).toBe(false);
    expect(isValidFramingPreset("center_crop")).toBe(false);
    expect(isValidFramingPreset("")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidFramingPreset(null)).toBe(false);
    expect(isValidFramingPreset(undefined)).toBe(false);
    expect(isValidFramingPreset(42)).toBe(false);
  });
});

describe("resolveFramingPreset — default framing behavior", () => {
  it("returns SMART_CROP as the default when value is null", () => {
    expect(resolveFramingPreset(null)).toBe("SMART_CROP");
  });

  it("returns SMART_CROP as the default when value is undefined", () => {
    expect(resolveFramingPreset(undefined)).toBe("SMART_CROP");
  });

  it("returns SMART_CROP as the default when value is an unrecognized string", () => {
    expect(resolveFramingPreset("INVALID")).toBe("SMART_CROP");
  });

  it("returns the stored preset when value is a valid preset", () => {
    expect(resolveFramingPreset("LEFT_FOCUS")).toBe("LEFT_FOCUS");
    expect(resolveFramingPreset("RIGHT_FOCUS")).toBe("RIGHT_FOCUS");
    expect(resolveFramingPreset("FIT_BLURRED_BACKGROUND")).toBe("FIT_BLURRED_BACKGROUND");
    expect(resolveFramingPreset("CENTER_CROP")).toBe("CENTER_CROP");
  });

  it("default preset constant equals SMART_CROP", () => {
    expect(DEFAULT_FRAMING_PRESET).toBe("SMART_CROP");
  });
});

describe("evaluateSmartCropSafety", () => {
  it("marks missing tracking as unsafe", () => {
    const result = evaluateSmartCropSafety([]);

    expect(result.unsafe).toBe(true);
    expect(result.reason).toBe("NO_TRACKING");
  });

  it("marks tracking that starts late as unsafe", () => {
    const result = evaluateSmartCropSafety([
      { timeSeconds: 18, centerX: 0.65, confidence: 0.72 },
      { timeSeconds: 20, centerX: 0.66, confidence: 0.7 },
    ]);

    expect(result.unsafe).toBe(true);
    expect(result.reason).toBe("LATE_TRACKING_START");
  });

  it("marks mostly frozen tracking as unsafe", () => {
    const result = evaluateSmartCropSafety([
      { timeSeconds: 0, centerX: 0.5, confidence: 0.7 },
      { timeSeconds: 2, centerX: 0.5, confidence: 0.6, frozen: true },
      { timeSeconds: 4, centerX: 0.5, confidence: 0.6, frozen: true },
    ]);

    expect(result.unsafe).toBe(true);
    expect(result.reason).toBe("UNSTABLE_TRACKING");
  });

  it("allows confident early tracking", () => {
    const result = evaluateSmartCropSafety([
      { timeSeconds: 0, centerX: 0.45, confidence: 0.82 },
      { timeSeconds: 2, centerX: 0.48, confidence: 0.8 },
    ]);

    expect(result.unsafe).toBe(false);
    expect(result.reason).toBeNull();
  });
});

describe("resolveEffectiveFramingPreset", () => {
  it("falls back to blurred full-stage framing when smart crop tracking is unsafe", () => {
    const result = resolveEffectiveFramingPreset({
      requestedPreset: "SMART_CROP",
      smartCropPoints: [],
    });

    expect(result.fallbackApplied).toBe(true);
    expect(result.effectivePreset).toBe("FIT_BLURRED_BACKGROUND");
    expect(result.reason).toContain("full-stage blurred framing");
  });

  it("keeps smart crop when manual crop keyframes are present", () => {
    const result = resolveEffectiveFramingPreset({
      requestedPreset: "SMART_CROP",
      smartCropPoints: [],
      hasManualCrop: true,
    });

    expect(result.fallbackApplied).toBe(false);
    expect(result.effectivePreset).toBe("SMART_CROP");
  });
});

describe("isFfmpegCropFilterFailure", () => {
  it("recognizes FFmpeg crop filter initialization failures", () => {
    expect(isFfmpegCropFilterFailure(
      "[Parsed_crop_2 @ 0xae303e640] Failed to configure input pad on Parsed_crop_2 Error reinitializing filters!",
    )).toBe(true);
  });

  it("does not treat unrelated FFmpeg failures as safe smart-crop fallbacks", () => {
    expect(isFfmpegCropFilterFailure("Failed to start FFmpeg: permission denied")).toBe(false);
    expect(isFfmpegCropFilterFailure("Rendered clip is not a valid video input. moov atom not found")).toBe(false);
  });
});

describe("SELECTABLE_FRAMING_PRESETS", () => {
  it("includes CENTER_CROP, LEFT_FOCUS, RIGHT_FOCUS, FIT_BLURRED_BACKGROUND", () => {
    expect(SELECTABLE_FRAMING_PRESETS).toContain("CENTER_CROP");
    expect(SELECTABLE_FRAMING_PRESETS).toContain("LEFT_FOCUS");
    expect(SELECTABLE_FRAMING_PRESETS).toContain("RIGHT_FOCUS");
    expect(SELECTABLE_FRAMING_PRESETS).toContain("FIT_BLURRED_BACKGROUND");
  });

  it("includes SMART_CROP once video subject tracking is available", () => {
    expect(SELECTABLE_FRAMING_PRESETS).toContain("SMART_CROP");
  });

  it("all selectable presets have labels", () => {
    for (const preset of SELECTABLE_FRAMING_PRESETS) {
      expect(FRAMING_PRESET_LABELS[preset]).toBeTruthy();
    }
  });
});

describe("buildVerticalFramingFilter — export framing applied correctly", () => {
  it("CENTER_CROP produces a center-crop filter", () => {
    const filter = buildVerticalFramingFilter("CENTER_CROP");

    expect(filter).toContain("scale=1080:1920");
    expect(filter).toContain("crop=1080:1920");
    expect(filter).not.toContain("boxblur");
    // Default FFmpeg crop is centered; no x/y offset needed.
    expect(filter).not.toMatch(/crop=1080:1920:0/);
    expect(filter).not.toMatch(/crop=1080:1920:iw/);
  });

  it("LEFT_FOCUS produces a left-biased crop filter", () => {
    const filter = buildVerticalFramingFilter("LEFT_FOCUS");

    expect(filter).toContain("scale=1080:1920");
    expect(filter).toContain("crop=1080:1920:0:0");
    expect(filter).not.toContain("boxblur");
  });

  it("RIGHT_FOCUS produces a right-biased crop filter", () => {
    const filter = buildVerticalFramingFilter("RIGHT_FOCUS");

    expect(filter).toContain("scale=1080:1920");
    expect(filter).toContain("crop=1080:1920:iw-ow");
    expect(filter).not.toContain("boxblur");
  });

  it("FIT_BLURRED_BACKGROUND produces a blur-and-overlay filter", () => {
    const filter = buildVerticalFramingFilter("FIT_BLURRED_BACKGROUND");

    expect(filter).toContain("boxblur");
    expect(filter).toContain("overlay");
    expect(filter).toContain("[bg]");
    expect(filter).toContain("[fg]");
    expect(filter).toContain("(W-w)/2");
  });

  it("SMART_CROP falls back to the CENTER_CROP filter when tracking data is missing", () => {
    const smartFilter = buildVerticalFramingFilter("SMART_CROP");
    const centerFilter = buildVerticalFramingFilter("CENTER_CROP");

    expect(smartFilter).toBe(centerFilter);
  });

  it("SMART_CROP uses subject center data when available", () => {
    const filter = buildVerticalFramingFilter("SMART_CROP", {
      sourceWidth: 1920,
      sourceHeight: 1080,
      subjectCenterX: 0.25,
    });

    expect(filter).toContain("crop=1080:1920:");
    expect(filter).not.toBe(buildVerticalFramingFilter("CENTER_CROP"));
  });

  it("SMART_CROP applies zoom for premium speaker crops", () => {
    const filter = buildVerticalFramingFilter("SMART_CROP", {
      sourceWidth: 1920,
      sourceHeight: 1080,
      subjectCenterX: 0.5,
      zoom: 1.22,
    });

    expect(filter).toContain("scale=4164:2342");
    expect(filter).toContain("crop=1080:1920:");
  });

  it("SMART_CROP builds a time-varying crop from subject tracking points", () => {
    const filter = buildVerticalFramingFilter("SMART_CROP", {
      sourceWidth: 1920,
      sourceHeight: 1080,
      subjectCenterX: 0.5,
      subjectCenters: [
        { timeSeconds: 0, centerX: 0.2 },
        { timeSeconds: 4, centerX: 0.8 },
      ],
    });

    expect(filter).toContain("if(lte(t\\,0)");
    expect(filter).toContain("pow(min(max((t-0)/4\\,0)\\,1)\\,2)");
    expect(filter).toContain("crop=1080:1920:");
  });

  it("SMART_CROP clamps the dynamic crop expression inside legal bounds", () => {
    const filter = buildVerticalFramingFilter("SMART_CROP", {
      sourceWidth: 1920,
      sourceHeight: 1080,
      subjectCenterX: 0.5,
      subjectCenters: [
        { timeSeconds: 0, centerX: -0.4 },
        { timeSeconds: 3, centerX: 1.4 },
      ],
    });

    expect(filter).toContain("min(max(");
    expect(filter).toContain("\\,0)\\,");
    expect(filter).toContain("crop=1080:1920:");
  });

  it("SMART_CROP simplifies dense tracking before building the FFmpeg crop expression", () => {
    const subjectCenters = Array.from({ length: 180 }, (_, index) => ({
      timeSeconds: index * 0.75,
      centerX: index % 2 === 0 ? 0.15 : 0.85,
      confidence: 0.92,
    }));

    const filter = buildVerticalFramingFilter("SMART_CROP", {
      sourceWidth: 1920,
      sourceHeight: 1080,
      subjectCenterX: 0.5,
      subjectCenters,
    });

    expect(filter.length).toBeLessThan(1900);
    expect((filter.match(/if\(lte/g) ?? []).length).toBeLessThanOrEqual(6);
    expect(filter).toContain("crop=1080:1920:");
  });

  it("all filters output a [v] stream for -map [v]", () => {
    const presets: FramingPreset[] = [
      "CENTER_CROP",
      "LEFT_FOCUS",
      "RIGHT_FOCUS",
      "FIT_BLURRED_BACKGROUND",
      "SMART_CROP",
    ];

    for (const preset of presets) {
      const filter = buildVerticalFramingFilter(preset);
      expect(filter).toContain("[v]");
    }
  });

  it("all filters produce 1080x1920 vertical output", () => {
    const presets: FramingPreset[] = [
      "CENTER_CROP",
      "LEFT_FOCUS",
      "RIGHT_FOCUS",
      "FIT_BLURRED_BACKGROUND",
      "SMART_CROP",
    ];

    for (const preset of presets) {
      const filter = buildVerticalFramingFilter(preset);
      expect(filter).toContain("1080");
      expect(filter).toContain("1920");
    }
  });
});

describe("smart crop point simplification", () => {
  it("caps dynamic crop points while preserving first and last points", () => {
    const points = Array.from({ length: 80 }, (_, index) => ({
      timeSeconds: index,
      cropX: index * 20,
    }));

    const simplified = __clipFramingTestUtils.simplifyCropPoints(points);

    expect(simplified.length).toBeLessThanOrEqual(6);
    expect(simplified[0]).toEqual(points[0]);
    expect(simplified[simplified.length - 1]).toEqual(points[points.length - 1]);
  });

  it("flags overly complex smart-crop filters before FFmpeg sees them", () => {
    const riskyFilter = `crop=1080:1920:${"if(lte(t,1),".repeat(7)}0${")".repeat(7)}:0,format=yuv420p[v]`;

    expect(getSmartCropFilterRiskReason(riskyFilter)).toContain("too many moving crop points");
  });
});
