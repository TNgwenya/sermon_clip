import { describe, expect, it } from "vitest";

import {
  clampCaptionOverlayOffset,
  clampOverlayRatio,
  nudgeCaptionOverlayOffset,
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
    expect(clampCaptionOverlayOffset(-180.2)).toBe(-160);
    expect(clampCaptionOverlayOffset(11.6)).toBe(12);
    expect(clampCaptionOverlayOffset(199)).toBe(160);
  });

  it("supports accessible arrow-key caption nudging with bounded normal and large steps", () => {
    expect(nudgeCaptionOverlayOffset({
      horizontalOffset: 0,
      verticalOffset: 0,
      key: "ArrowLeft",
    })).toEqual({ horizontalOffset: -8, verticalOffset: 0 });
    expect(nudgeCaptionOverlayOffset({
      horizontalOffset: 155,
      verticalOffset: -150,
      key: "ArrowRight",
      largeStep: true,
    })).toEqual({ horizontalOffset: 160, verticalOffset: -150 });
    expect(nudgeCaptionOverlayOffset({
      horizontalOffset: 12,
      verticalOffset: 155,
      key: "ArrowUp",
    })).toEqual({ horizontalOffset: 12, verticalOffset: 160 });
    expect(nudgeCaptionOverlayOffset({
      horizontalOffset: 0,
      verticalOffset: 0,
      key: "Enter",
    })).toBeNull();
  });
});
