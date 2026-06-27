import { describe, expect, it } from "vitest";

import {
  buildPresetManualCropKeyframes,
  hasManualCropKeyframes,
  nudgeManualCropKeyframes,
  normalizeManualCropKeyframes,
} from "@/lib/manualCrop";

describe("manual crop helpers", () => {
  it("normalizes and clamps manual crop keyframes", () => {
    expect(normalizeManualCropKeyframes([
      { timeSeconds: 12.345, centerX: 1.4, centerY: -0.2, zoom: 3 },
      { timeSeconds: -4, centerX: -0.5 },
      { timeSeconds: 12.345, centerX: 0.2 },
      null,
    ])).toEqual([
      { timeSeconds: 0, centerX: 0 },
      { timeSeconds: 12.35, centerX: 1, centerY: 0, zoom: 2 },
    ]);
  });

  it("builds stable left center right presets", () => {
    expect(buildPresetManualCropKeyframes({ direction: "left", durationSeconds: 45 })).toEqual([
      { timeSeconds: 0, centerX: 0.38 },
      { timeSeconds: 45, centerX: 0.38 },
    ]);
    expect(buildPresetManualCropKeyframes({ direction: "center", durationSeconds: 45 })[0]?.centerX).toBe(0.5);
    expect(buildPresetManualCropKeyframes({ direction: "right", durationSeconds: 45 })[0]?.centerX).toBe(0.62);
  });

  it("nudges existing or default keyframes without leaving the safe range", () => {
    expect(nudgeManualCropKeyframes({
      keyframes: [{ timeSeconds: 0, centerX: 0.99 }],
      direction: "right",
      durationSeconds: 30,
    })).toEqual([{ timeSeconds: 0, centerX: 1 }]);

    expect(nudgeManualCropKeyframes({ keyframes: null, direction: "left", durationSeconds: 30 })).toEqual([
      { timeSeconds: 0, centerX: 0.44 },
      { timeSeconds: 30, centerX: 0.44 },
    ]);
  });

  it("detects whether a clip has usable manual crop keyframes", () => {
    expect(hasManualCropKeyframes([{ timeSeconds: 0, centerX: 0.5 }])).toBe(true);
    expect(hasManualCropKeyframes([])).toBe(false);
    expect(hasManualCropKeyframes(null)).toBe(false);
  });
});
