import { describe, expect, it } from "vitest";

import {
  buildSpeechCleanupPreviewPlan,
  mapCleanedPreviewSecondsToSourceSeconds,
  mapSourceSecondsToCleanedPreviewSeconds,
  resolveActiveCaptionCueText,
  resolveActiveCaptionWordIndex,
  resolveCompositionPreviewDuration,
  resolveSpeechCleanupJumpTarget,
  shouldShowHookOverlay,
  synchronizePreviewBackdropMedia,
} from "@/lib/clipStudioPreviewTimeline";
import { createSpeechCleanupEditsFromPlan } from "@/lib/speechCleanupPlan";

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

describe("resolveCompositionPreviewDuration", () => {
  it("uses cleaned duration for timed branding when speech cleanup is active", () => {
    const plan = buildSpeechCleanupPreviewPlan({
      captionCues: [
        { index: 1, startSeconds: 0, endSeconds: 2, text: "Opening" },
        { index: 2, startSeconds: 5, endSeconds: 8, text: "Closing" },
      ],
      durationSeconds: 10,
      speechCleanup: {
        removeDeadAir: false,
        tightenLongPauses: true,
        flagFillerWords: true,
        intensity: "normal",
      },
    });

    expect(plan.enabled).toBe(true);
    expect(resolveCompositionPreviewDuration({
      draftDurationSeconds: 10,
      mediaDurationSeconds: 10,
      speechCleanupPlan: plan,
    })).toBe(plan.cleanedDurationSeconds);
  });

  it("uses draft duration when cleanup is inactive", () => {
    expect(resolveCompositionPreviewDuration({
      draftDurationSeconds: 10,
      mediaDurationSeconds: 12,
      speechCleanupPlan: null,
    })).toBe(10);
  });
});

describe("synchronizePreviewBackdropMedia", () => {
  it("matches foreground time and playback when the blurred backdrop is ready", () => {
    let playCount = 0;
    const foreground = {
      currentTime: 14.2,
      duration: 30,
      readyState: 4,
      playbackRate: 1.25,
      paused: false,
      ended: false,
      play: async () => undefined,
      pause: () => undefined,
    };
    const backdrop = {
      currentTime: 2,
      duration: 30,
      readyState: 4,
      playbackRate: 1,
      paused: true,
      ended: false,
      play: async () => {
        playCount += 1;
      },
      pause: () => undefined,
    };

    synchronizePreviewBackdropMedia(foreground, backdrop);

    expect(backdrop.currentTime).toBe(14.2);
    expect(backdrop.playbackRate).toBe(1.25);
    expect(playCount).toBe(1);
  });

  it("pauses the backdrop with the foreground", () => {
    let pauseCount = 0;
    const foreground = {
      currentTime: 8,
      duration: 30,
      readyState: 4,
      playbackRate: 1,
      paused: true,
      ended: false,
      play: async () => undefined,
      pause: () => undefined,
    };
    const backdrop = {
      currentTime: 8,
      duration: 30,
      readyState: 4,
      playbackRate: 1,
      paused: false,
      ended: false,
      play: async () => undefined,
      pause: () => {
        pauseCount += 1;
      },
    };

    synchronizePreviewBackdropMedia(foreground, backdrop);

    expect(pauseCount).toBe(1);
  });
});

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

  it("uses the next cue at an exact caption boundary", () => {
    expect(
      resolveActiveCaptionCueText({
        applyCaptionsToClip: true,
        captionCues: [
          { index: 1, startSeconds: 0, endSeconds: 2, text: "First caption" },
          { index: 2, startSeconds: 2, endSeconds: 4, text: "Second caption" },
        ],
        fallbackText: "Fallback",
        previewSeconds: 2,
      }),
    ).toBe("Second caption");
  });
});

describe("resolveActiveCaptionWordIndex", () => {
  it("advances the active word inside a full visible caption line", () => {
    const cue = {
      index: 1,
      startSeconds: 0,
      endSeconds: 8,
      text: "aa bb cc dd",
    };
    const words = cue.text.split(" ");

    expect(resolveActiveCaptionWordIndex({ activeCue: cue, words, previewSeconds: 0 })).toBe(0);
    expect(resolveActiveCaptionWordIndex({ activeCue: cue, words, previewSeconds: 2 })).toBe(1);
    expect(resolveActiveCaptionWordIndex({ activeCue: cue, words, previewSeconds: 4 })).toBe(2);
    expect(resolveActiveCaptionWordIndex({ activeCue: cue, words, previewSeconds: 7.9 })).toBe(3);
  });

  it("uses word length weighting so short words do not take equal caption time", () => {
    const cue = {
      index: 1,
      startSeconds: 0,
      endSeconds: 22.5,
      text: "Faith grows when we trust God through every season.",
    };
    const words = cue.text.split(" ");

    expect(words[1]).toBe("grows");
    expect(resolveActiveCaptionWordIndex({ activeCue: cue, words, previewSeconds: 5.28 })).toBe(1);
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
        intensity: "normal",
      },
    });

    expect(plan.enabled).toBe(true);
    expect(plan.sourceStartSeconds).toBe(1.28);
    expect(plan.sourceEndSeconds).toBe(10.12);
    expect(plan.cuts).toEqual([
      { startSeconds: 4.18, endSeconds: 6.82, removedSeconds: 2.64 },
    ]);
    expect(plan.removedRanges).toMatchObject([
      { kind: "edge", source: "transcript", confidence: "candidate", startSeconds: 0, endSeconds: 1.28, removedSeconds: 1.28 },
      { kind: "internal", source: "transcript", confidence: "candidate", startSeconds: 4.18, endSeconds: 6.82, removedSeconds: 2.64 },
      { kind: "edge", source: "transcript", confidence: "candidate", startSeconds: 10.12, endSeconds: 12, removedSeconds: 1.88 },
    ]);
    expect(plan.candidateRanges).toEqual([]);
    expect(plan.reviewItems.map((item) => item.label)).toEqual(["Review 1", "Review 2", "Review 3"]);
    expect(plan.hasAudioAnalysis).toBe(false);
    expect(plan.cleanedDurationSeconds).toBe(6.2);
  });

  it("marks shorter caption gaps when intensity is stronger", () => {
    const normalPlan = buildSpeechCleanupPreviewPlan({
      captionCues: [
        { index: 1, startSeconds: 0, endSeconds: 2, text: "Opening words" },
        { index: 2, startSeconds: 2.7, endSeconds: 5, text: "Closing words" },
      ],
      durationSeconds: 5,
      speechCleanup: {
        removeDeadAir: true,
        tightenLongPauses: true,
        flagFillerWords: true,
        intensity: "normal",
      },
    });
    const strongPlan = buildSpeechCleanupPreviewPlan({
      captionCues: [
        { index: 1, startSeconds: 0, endSeconds: 2, text: "Opening words" },
        { index: 2, startSeconds: 2.7, endSeconds: 5, text: "Closing words" },
      ],
      durationSeconds: 5,
      speechCleanup: {
        removeDeadAir: true,
        tightenLongPauses: true,
        flagFillerWords: true,
        intensity: "strong",
      },
    });

    expect(normalPlan.cuts).toEqual([]);
    expect(strongPlan.cuts).toEqual([
      { startSeconds: 2.1, endSeconds: 2.6, removedSeconds: 0.5 },
    ]);
  });

  it("uses audio-confirmed silence for cuts and keeps transcript-only gaps as review candidates", () => {
    const plan = buildSpeechCleanupPreviewPlan({
      captionCues: [
        { index: 1, startSeconds: 0, endSeconds: 1, text: "Opening words" },
        { index: 2, startSeconds: 2, endSeconds: 3, text: "Middle words" },
        { index: 3, startSeconds: 7, endSeconds: 8, text: "Closing words" },
      ],
      durationSeconds: 10,
      speechCleanup: {
        removeDeadAir: true,
        tightenLongPauses: true,
        flagFillerWords: true,
        intensity: "maximum",
      },
      audioSilenceEvents: [
        { startSeconds: 1.05, endSeconds: 1.8, durationSeconds: 0.75 },
      ],
      audioSilenceAnalysisAvailable: true,
    });

    expect(plan.hasAudioAnalysis).toBe(true);
    expect(plan.cuts).toEqual([
      { startSeconds: 1.12, endSeconds: 1.73, removedSeconds: 0.61 },
    ]);
    expect(plan.removedRanges).toMatchObject([
      {
        source: "audio",
        confidence: "confirmed",
        startSeconds: 1.12,
        endSeconds: 1.73,
        beforeText: "Opening words",
        afterText: "Middle words",
      },
    ]);
    expect(plan.candidateRanges).toMatchObject([
      {
        source: "transcript",
        confidence: "candidate",
        startSeconds: 3.07,
        endSeconds: 6.93,
        beforeText: "Middle words",
        afterText: "Closing words",
      },
    ]);
    expect(plan.reviewItems.map((item) => item.label)).toEqual(["Cut 1", "Review 2"]);
    expect(plan.cleanedDurationSeconds).toBe(9.39);
  });

  it("keeps transcript gaps as candidates when audio analysis finds no silence events", () => {
    const plan = buildSpeechCleanupPreviewPlan({
      captionCues: [
        { index: 1, startSeconds: 0, endSeconds: 2, text: "Opening words" },
        { index: 2, startSeconds: 3, endSeconds: 5, text: "Closing words" },
      ],
      durationSeconds: 5,
      speechCleanup: {
        removeDeadAir: true,
        tightenLongPauses: true,
        flagFillerWords: true,
        intensity: "more",
      },
      audioSilenceEvents: [],
      audioSilenceAnalysisAvailable: true,
    });

    expect(plan.hasAudioAnalysis).toBe(true);
    expect(plan.cuts).toEqual([]);
    expect(plan.removedRanges).toEqual([]);
    expect(plan.candidateRanges).toMatchObject([
      { source: "transcript", confidence: "candidate", startSeconds: 2.14, endSeconds: 2.86 },
    ]);
    expect(plan.cleanedDurationSeconds).toBe(5);
  });

  it("applies manual cleanup edits to disable, delete, and resize cuts", () => {
    const basePlan = buildSpeechCleanupPreviewPlan({
      captionCues: [
        { index: 1, startSeconds: 0, endSeconds: 2, text: "Opening words" },
        { index: 2, startSeconds: 4, endSeconds: 5, text: "Middle words" },
        { index: 3, startSeconds: 8, endSeconds: 10, text: "Closing words" },
      ],
      durationSeconds: 10,
      speechCleanup: {
        removeDeadAir: false,
        tightenLongPauses: true,
        flagFillerWords: true,
        intensity: "normal",
      },
    });
    const edits = createSpeechCleanupEditsFromPlan(basePlan);

    expect(basePlan.cuts).toHaveLength(2);

    const disabledPlan = buildSpeechCleanupPreviewPlan({
      captionCues: [
        { index: 1, startSeconds: 0, endSeconds: 2, text: "Opening words" },
        { index: 2, startSeconds: 4, endSeconds: 5, text: "Middle words" },
        { index: 3, startSeconds: 8, endSeconds: 10, text: "Closing words" },
      ],
      durationSeconds: 10,
      speechCleanup: {
        removeDeadAir: false,
        tightenLongPauses: true,
        flagFillerWords: true,
        intensity: "normal",
      },
      speechCleanupEdits: {
        ...edits,
        cuts: edits.cuts.map((cut, index) => index === 0 ? { ...cut, enabled: false } : cut),
      },
    });

    expect(disabledPlan.cuts).toHaveLength(1);
    expect(disabledPlan.cuts[0]).toMatchObject({ startSeconds: 5.18, endSeconds: 7.82 });

    const resizedPlan = buildSpeechCleanupPreviewPlan({
      captionCues: [
        { index: 1, startSeconds: 0, endSeconds: 2, text: "Opening words" },
        { index: 2, startSeconds: 4, endSeconds: 5, text: "Middle words" },
        { index: 3, startSeconds: 8, endSeconds: 10, text: "Closing words" },
      ],
      durationSeconds: 10,
      speechCleanup: {
        removeDeadAir: false,
        tightenLongPauses: true,
        flagFillerWords: true,
        intensity: "normal",
      },
      speechCleanupEdits: {
        ...edits,
        cuts: [
          {
            ...edits.cuts[0],
            startSeconds: 2.5,
            endSeconds: 3.5,
            removedSeconds: 1,
            rawGapSeconds: 1,
          },
        ],
      },
    });

    expect(resizedPlan.cuts).toEqual([{ startSeconds: 2.5, endSeconds: 3.5, removedSeconds: 1 }]);
    expect(resizedPlan.cleanedDurationSeconds).toBe(9);
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
        intensity: "normal",
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
        intensity: "normal",
      },
    });

    expect(plan).toEqual({
      enabled: false,
      sourceStartSeconds: 0,
      sourceEndSeconds: 12,
      cleanedDurationSeconds: 12,
      cuts: [],
      removedRanges: [],
      candidateRanges: [],
      reviewItems: [],
      hasAudioAnalysis: false,
    });
  });
});
