import { describe, expect, it } from "vitest";

import {
  remapBrollLayerForClipBoundaryChange,
  remapCaptionCueOverridesForClipBoundaryChange,
  remapCaptionCueTextEditsForClipBoundaryChange,
  remapSpeechCleanupEditsForClipBoundaryChange,
  STUDIO_BOUNDARY_CONTEXT_SECONDS,
  preserveCaptionCuesForClipBoundaryChange,
} from "@/lib/clipStudioBoundaryTiming";

const extendedEarlierWindow = {
  previousStartSeconds: 100,
  nextStartSeconds: 90,
  nextEndSeconds: 160,
};

describe("Clip Studio outer-boundary timing", () => {
  it("preserves edited and hidden cues while adding only newly included speech", () => {
    const result = preserveCaptionCuesForClipBoundaryChange({
      previousStartSeconds: 100, previousEndSeconds: 110,
      nextStartSeconds: 98, nextEndSeconds: 112,
      cues: [
        { index: 1, startSeconds: 0, endSeconds: 4, text: "Corrected pastor name" },
        { index: 2, startSeconds: 4, endSeconds: 10, text: "" },
      ],
      words: [
        { text: "Before", startTimeSeconds: 98, endTimeSeconds: 99 },
        { text: "Already preserved", startTimeSeconds: 99.5, endTimeSeconds: 100.5 },
        { text: "Wrong", startTimeSeconds: 100, endTimeSeconds: 104 },
        { text: "Hidden", startTimeSeconds: 104, endTimeSeconds: 109 },
        { text: "Also preserved", startTimeSeconds: 109.5, endTimeSeconds: 110.5 },
        { text: "After", startTimeSeconds: 110, endTimeSeconds: 112 },
      ],
      segments: [], singleWord: false,
    });
    expect(result.map((cue) => cue.text)).toEqual(["Before", "Corrected pastor name", "", "After"]);
    expect(result[1]).toMatchObject({ startSeconds: 2, endSeconds: 6 });
    expect(result[3]).toMatchObject({ startSeconds: 12, endSeconds: 14 });
  });

  it("keeps corrected wording through repeated trims without matching regenerated timing keys", () => {
    const initial = { index: 1, startSeconds: 0, endSeconds: 8, text: "My corrected wording" };
    const result = preserveCaptionCuesForClipBoundaryChange({
      previousStartSeconds: 100, previousEndSeconds: 110,
      nextStartSeconds: 102, nextEndSeconds: 109,
      cues: [initial], words: [], segments: [], singleWord: false,
    });
    expect(result).toEqual([{ ...initial, startSeconds: 0, endSeconds: 6 }]);
  });

  it("fills expanded speech from segment timing when individual source words are unavailable", () => {
    const result = preserveCaptionCuesForClipBoundaryChange({
      previousStartSeconds: 100, previousEndSeconds: 110,
      nextStartSeconds: 98, nextEndSeconds: 112,
      cues: [{ index: 1, startSeconds: 0, endSeconds: 10, text: "Corrected" }],
      words: [],
      segments: [
        { text: "Before", startTimeSeconds: 98, endTimeSeconds: 100 },
        { text: "Original", startTimeSeconds: 100, endTimeSeconds: 110 },
        { text: "After", startTimeSeconds: 110, endTimeSeconds: 112 },
      ],
      singleWord: false,
    });
    expect(result.map((cue) => cue.text)).toEqual(["Before", "Corrected", "After"]);
  });
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
