import { describe, expect, it } from "vitest";

import {
  remapBrollLayerForClipBoundaryChange,
  remapCaptionCueOverridesForClipBoundaryChange,
  remapCaptionCueTextEditsForClipBoundaryChange,
  remapSpeechCleanupEditsForClipBoundaryChange,
  STUDIO_BOUNDARY_CONTEXT_SECONDS,
} from "@/lib/clipStudioBoundaryTiming";

const extendedEarlierWindow = {
  previousStartSeconds: 100,
  nextStartSeconds: 90,
  nextEndSeconds: 160,
};

describe("Clip Studio outer-boundary timing", () => {
  it("loads enough nearby sermon context to finish an interrupted thought", () => {
    expect(STUDIO_BOUNDARY_CONTEXT_SECONDS).toBe(90);
  });

  it("keeps B-roll anchored to the same spoken source moment when the clip starts earlier", () => {
    const remapped = remapBrollLayerForClipBoundaryChange({
      enabled: true,
      cards: [{
        id: "quote-card",
        enabled: true,
        text: "Run the race set before you",
        label: "Key quote",
        startSeconds: 8,
        durationSeconds: 5,
        tone: "quote",
        position: "full",
      }],
    }, extendedEarlierWindow);

    expect(remapped.cards[0]).toMatchObject({
      id: "quote-card",
      enabled: true,
      startSeconds: 18,
      durationSeconds: 5,
    });
    expect(extendedEarlierWindow.nextStartSeconds + remapped.cards[0].startSeconds).toBe(108);
  });

  it("keeps manual pacing cuts with their source pause and discards cuts outside a shortened clip", () => {
    const remapped = remapSpeechCleanupEditsForClipBoundaryChange({
      version: 1,
      cuts: [
        {
          id: "kept-source-pause",
          enabled: true,
          startSeconds: 12,
          endSeconds: 13.2,
          removedSeconds: 1.2,
          kind: "internal",
          source: "manual",
          confidence: "confirmed",
          rawGapSeconds: 1.2,
          beforeText: "before",
          afterText: "after",
        },
        {
          id: "outside-new-range",
          enabled: true,
          startSeconds: 68,
          endSeconds: 69,
          removedSeconds: 1,
          kind: "internal",
          source: "manual",
          confidence: "confirmed",
          rawGapSeconds: 1,
          beforeText: null,
          afterText: null,
        },
      ],
    }, {
      previousStartSeconds: 100,
      nextStartSeconds: 90,
      nextEndSeconds: 150,
    });

    expect(remapped?.cuts).toHaveLength(1);
    expect(remapped?.cuts[0]).toMatchObject({
      id: "kept-source-pause",
      startSeconds: 22,
      endSeconds: 23.2,
      removedSeconds: 1.2,
    });
  });

  it("remaps edited caption cues, word timings, and wording keys without changing their source moment", () => {
    const cues = remapCaptionCueOverridesForClipBoundaryChange([{
      index: 1,
      startSeconds: 4,
      endSeconds: 6,
      text: "Approved wording",
      wordTimings: [{
        text: "Approved",
        startSeconds: 4,
        endSeconds: 5,
      }],
    }], extendedEarlierWindow);
    const edits = remapCaptionCueTextEditsForClipBoundaryChange({
      "4.000-6.000": "Approved wording",
    }, extendedEarlierWindow);

    expect(cues?.[0]).toMatchObject({
      startSeconds: 14,
      endSeconds: 16,
      text: "Approved wording",
      wordTimings: [{
        text: "Approved",
        startSeconds: 14,
        endSeconds: 15,
      }],
    });
    expect(edits).toEqual({
      "14.000-16.000": "Approved wording",
    });
  });
});
