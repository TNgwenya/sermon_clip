import { describe, expect, it } from "vitest";

import {
  clampCaptionOverlayOffset,
  clampOverlayRatio,
  resolveBrollPositionFromOverlayRatio,
  resolveCaptionPositionFromOverlayRatio,
  resolveHookPositionFromOverlayRatio,
} from "@/lib/clipStudioOverlayEvents";

describe("clip studio overlay positioning", () => {
  it("clamps preview drag ratios to the visible frame", () => {
    expect(clampOverlayRatio(-0.5)).toBe(0);
    expect(clampOverlayRatio(0.42)).toBe(0.42);
    expect(clampOverlayRatio(1.4)).toBe(1);
  });

  it("maps vertical drag zones to caption and hook positions", () => {
    expect(resolveCaptionPositionFromOverlayRatio(0.1)).toBe("top");
    expect(resolveCaptionPositionFromOverlayRatio(0.5)).toBe("middle");
    expect(resolveCaptionPositionFromOverlayRatio(0.9)).toBe("lower");

    expect(resolveHookPositionFromOverlayRatio(0.1)).toBe("top");
    expect(resolveHookPositionFromOverlayRatio(0.5)).toBe("center");
    expect(resolveHookPositionFromOverlayRatio(0.9)).toBe("lower");
  });

  it("maps visual card drag zones to upper, full, and lower placements", () => {
    expect(resolveBrollPositionFromOverlayRatio(0.1)).toBe("upper");
    expect(resolveBrollPositionFromOverlayRatio(0.5)).toBe("full");
    expect(resolveBrollPositionFromOverlayRatio(0.9)).toBe("lower");
  });

  it("keeps caption fine offsets inside the render-safe range", () => {
    expect(clampCaptionOverlayOffset(-80.2)).toBe(-48);
    expect(clampCaptionOverlayOffset(11.6)).toBe(12);
    expect(clampCaptionOverlayOffset(99)).toBe(48);
  });
});
