import { describe, expect, it } from "vitest";

import {
  buildSpeechCleanupPreviewPlan,
  mapCleanedPreviewSecondsToSourceSeconds,
  mapSourceSecondsToCleanedPreviewSeconds,
  resolveActiveCaptionCueText,
  resolveSpeechCleanupJumpTarget,
  shouldShowHookOverlay,
} from "@/lib/clipStudioPreviewTimeline";

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

describe("speech cleanup preview timeline", () => {
  it("trims edge dead air and collapses long caption gaps", () => {
    const plan = buildSpeechCleanupPreviewPlan({
      captionCues: [
        { index: 1, startSeconds: 1.4, endSeconds: 4, text: "Opening words" },
        { index: 2, startSeconds: 7, endSeconds: 10, text: "Closing words" },
      ],
      durationSeconds: 12,
      speechCleanup: {
        removeDeadAir: true,
        tightenLongPauses: true,
        flagFillerWords: true,
      },
    });

    expect(plan.enabled).toBe(true);
    expect(plan.sourceStartSeconds).toBe(1.28);
    expect(plan.sourceEndSeconds).toBe(10.12);
    expect(plan.cuts).toEqual([
      { startSeconds: 4.18, endSeconds: 6.82, removedSeconds: 2.64 },
    ]);
    expect(plan.cleanedDurationSeconds).toBe(6.2);
  });

  it("maps between cleaned preview time and source video time", () => {
    const plan = buildSpeechCleanupPreviewPlan({
      captionCues: [
        { index: 1, startSeconds: 1.4, endSeconds: 4, text: "Opening words" },
        { index: 2, startSeconds: 7, endSeconds: 10, text: "Closing words" },
      ],
      durationSeconds: 12,
      speechCleanup: {
        removeDeadAir: true,
        tightenLongPauses: true,
        flagFillerWords: true,
      },
    });

    expect(mapSourceSecondsToCleanedPreviewSeconds(1.28, plan)).toBe(0);
    expect(mapCleanedPreviewSecondsToSourceSeconds(3, plan)).toBe(6.92);
    expect(resolveSpeechCleanupJumpTarget(5, plan)).toBe(6.82);
  });

  it("does not enable speech cleanup preview without transcript timing", () => {
    const plan = buildSpeechCleanupPreviewPlan({
      captionCues: [],
      durationSeconds: 12,
      speechCleanup: {
        removeDeadAir: true,
        tightenLongPauses: true,
        flagFillerWords: true,
      },
    });

    expect(plan).toEqual({
      enabled: false,
      sourceStartSeconds: 0,
      sourceEndSeconds: 12,
      cleanedDurationSeconds: 12,
      cuts: [],
    });
  });
});
