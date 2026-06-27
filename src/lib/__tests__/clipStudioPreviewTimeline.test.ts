import { describe, expect, it } from "vitest";

import { resolveActiveCaptionCueText, shouldShowHookOverlay } from "@/lib/clipStudioPreviewTimeline";

const baseHook = {
  enabled: true,
  text: "Stay with this word",
  position: "center" as const,
  startSeconds: 1,
  durationSeconds: 6,
  animation: "fade" as const,
  size: "medium" as const,
  bold: true,
};

describe("shouldShowHookOverlay", () => {
  it("shows the hook only inside its configured duration", () => {
    expect(shouldShowHookOverlay(baseHook, 0.9)).toBe(false);
    expect(shouldShowHookOverlay(baseHook, 1)).toBe(true);
    expect(shouldShowHookOverlay(baseHook, 4)).toBe(true);
    expect(shouldShowHookOverlay(baseHook, 7)).toBe(true);
    expect(shouldShowHookOverlay(baseHook, 7.1)).toBe(false);
  });

  it("hides disabled or empty hooks", () => {
    expect(shouldShowHookOverlay({ ...baseHook, enabled: false }, 2)).toBe(false);
    expect(shouldShowHookOverlay({ ...baseHook, text: "  " }, 2)).toBe(false);
  });
});

describe("resolveActiveCaptionCueText", () => {
  const cues = [
    { index: 1, startSeconds: 0.2, endSeconds: 2, text: "First caption" },
    { index: 2, startSeconds: 2.1, endSeconds: 4, text: "Second caption" },
  ];

  it("returns only the active caption cue for the current preview time", () => {
    expect(
      resolveActiveCaptionCueText({
        applyCaptionsToClip: true,
        captionCues: cues,
        fallbackText: "Fallback",
        previewSeconds: 0,
      }),
    ).toBe("");
    expect(
      resolveActiveCaptionCueText({
        applyCaptionsToClip: true,
        captionCues: cues,
        fallbackText: "Fallback",
        previewSeconds: 1,
      }),
    ).toBe("First caption");
    expect(
      resolveActiveCaptionCueText({
        applyCaptionsToClip: true,
        captionCues: cues,
        fallbackText: "Fallback",
        previewSeconds: 3,
      }),
    ).toBe("Second caption");
    expect(
      resolveActiveCaptionCueText({
        applyCaptionsToClip: true,
        captionCues: cues,
        fallbackText: "Fallback",
        previewSeconds: 5,
      }),
    ).toBe("");
  });

  it("hides captions when burn-in is disabled", () => {
    expect(
      resolveActiveCaptionCueText({
        applyCaptionsToClip: false,
        captionCues: cues,
        fallbackText: "Fallback",
        previewSeconds: 1,
      }),
    ).toBe("");
  });

  it("falls back to combined text only when no cues exist", () => {
    expect(
      resolveActiveCaptionCueText({
        applyCaptionsToClip: true,
        captionCues: [],
        fallbackText: "Fallback caption",
        previewSeconds: 1,
      }),
    ).toBe("Fallback caption");
  });
});
