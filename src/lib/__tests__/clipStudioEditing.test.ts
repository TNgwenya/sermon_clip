import { describe, expect, it } from "vitest";

import {
  breakCaptionTextIntoSemanticLines,
  buildEditableCaptionCuesFromTranscriptSegments,
  buildSrtFromEditableCues,
  buildTimedCaptionCuesFromTranscriptSegments,
  buildTimedCaptionCuesFromTranscriptWords,
  clampEditableCaptionCueTimeline,
  hashtagsToEditorInput,
  mergeAdjacentEditableCaptionCues,
  mergeCaptionCueTextOverrides,
  parseCaptionSourceWords,
  parseHashtagEditorInput,
  resolveClipStudioCaptionCuesForSave,
  resolveClipStudioInitialCaptionCues,
  splitEditableCaptionCue,
  updateEditableCaptionCueTiming,
  validateCaptionCuesFromTranscript,
  validateEditableCaptionCues,
  validateClipStudioTiming,
} from "@/lib/clipStudioEditing";

describe("validateClipStudioTiming", () => {
  it("parses 42:10", () => {
    const result = validateClipStudioTiming({
      startTimestamp: "42:10",
      endTimestamp: "42:40",
      knownDurationSeconds: null,
    });

    expect(result.isValid).toBe(true);
    expect(result.startSeconds).toBe(2530);
    expect(result.endSeconds).toBe(2560);
    expect(result.durationSeconds).toBe(30);
  });

  it("parses 01:12", () => {
    const result = validateClipStudioTiming({
      startTimestamp: "01:12",
      endTimestamp: "01:52",
      knownDurationSeconds: null,
    });

    expect(result.isValid).toBe(true);
    expect(result.startSeconds).toBe(72);
    expect(result.endSeconds).toBe(112);
  });

  it("parses 1:02:35", () => {
    const result = validateClipStudioTiming({
      startTimestamp: "1:02:35",
      endTimestamp: "1:03:05",
      knownDurationSeconds: null,
    });

    expect(result.isValid).toBe(true);
    expect(result.startSeconds).toBe(3755);
    expect(result.endSeconds).toBe(3785);
  });

  it("parses 00:42:10", () => {
    const result = validateClipStudioTiming({
      startTimestamp: "00:42:10",
      endTimestamp: "00:42:40",
      knownDurationSeconds: null,
    });

    expect(result.isValid).toBe(true);
    expect(result.startSeconds).toBe(2530);
    expect(result.endSeconds).toBe(2560);
  });

  it("preserves decimal seconds from clip studio timestamp inputs", () => {
    const result = validateClipStudioTiming({
      startTimestamp: "15:09.72",
      endTimestamp: "16:06.1",
      knownDurationSeconds: null,
    });

    expect(result.isValid).toBe(true);
    expect(result.startSeconds).toBe(909.72);
    expect(result.endSeconds).toBe(966.1);
    expect(result.durationSeconds).toBeCloseTo(56.38);
  });

  it("rejects invalid input", () => {
    const result = validateClipStudioTiming({
      startTimestamp: "bad-value",
      endTimestamp: "42:40",
      knownDurationSeconds: null,
    });

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors.startTimestamp).toBe(
      "Clip start time is not valid. Use a format like 42:10.",
    );
  });

  it("rejects negative values", () => {
    const result = validateClipStudioTiming({
      startTimestamp: "-1:20",
      endTimestamp: "2:20",
      knownDurationSeconds: null,
    });

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors.startTimestamp).toContain("cannot be negative");
  });

  it("rejects end before start", () => {
    const result = validateClipStudioTiming({
      startTimestamp: "10:00",
      endTimestamp: "09:59",
      knownDurationSeconds: null,
    });

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors.endTimestamp).toBe(
      "Clip end time must be after the start time.",
    );
  });

  it("rejects end time after known duration", () => {
    const result = validateClipStudioTiming({
      startTimestamp: "00:30",
      endTimestamp: "01:40",
      knownDurationSeconds: 90,
    });

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors.endTimestamp).toBe(
      "Clip end time is longer than the sermon video duration.",
    );
  });

  it("rejects clips shorter than the renderable minimum", () => {
    const result = validateClipStudioTiming({
      startTimestamp: "00:10",
      endTimestamp: "00:20",
      knownDurationSeconds: null,
    });

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors.endTimestamp).toContain("at least 24 seconds");
  });

  it("allows longer complete ministry clips with a guidance warning", () => {
    const result = validateClipStudioTiming({
      startTimestamp: "00:10",
      endTimestamp: "02:20",
      knownDurationSeconds: null,
    });

    expect(result.isValid).toBe(true);
    expect(result.warnings).toContain(
      "Long clips work best for testimony, scripture explanation, prayer, or emotional ministry moments.",
    );
  });

  it("rejects clips longer than the hard duration limit", () => {
    const result = validateClipStudioTiming({
      startTimestamp: "00:10",
      endTimestamp: "03:10",
      knownDurationSeconds: null,
    });

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors.endTimestamp).toContain("150 seconds or less");
  });
});

describe("parseHashtagEditorInput", () => {
  it("parses hashtag text with spaces and commas", () => {
    expect(parseHashtagEditorInput("Faith, Prayer #SermonClip")).toEqual([
      "#Faith",
      "#Prayer",
      "#SermonClip",
    ]);
  });

  it("deduplicates hashtags case-insensitively", () => {
    expect(parseHashtagEditorInput("#Faith faith FAITH")).toEqual(["#Faith"]);
  });

  it("returns empty list when input is blank", () => {
    expect(parseHashtagEditorInput("   ")).toEqual([]);
  });
});

describe("hashtagsToEditorInput", () => {
  it("renders hashtags for editor display", () => {
    expect(hashtagsToEditorInput(["#Faith", "#Prayer"])).toBe("#Faith #Prayer");
  });
});

describe("parseCaptionSourceWords", () => {
  it("normalizes persisted provider words and skips malformed timings", () => {
    expect(parseCaptionSourceWords([
      { text: "  Grace ", startTimeSeconds: 10.1, endTimeSeconds: 10.5 },
      { text: "wins", startTimeSeconds: 10.8, endTimeSeconds: 11.2 },
      { text: "Bad", startTimeSeconds: "11.3", endTimeSeconds: 11.7 },
      { text: "Backwards", startTimeSeconds: 12, endTimeSeconds: 11.9 },
    ])).toEqual([
      { text: "Grace", startTimeSeconds: 10.1, endTimeSeconds: 10.5 },
      { text: "wins", startTimeSeconds: 10.8, endTimeSeconds: 11.2 },
    ]);
  });
});

describe("validateEditableCaptionCues", () => {
  it("normalizes valid editable caption cues", () => {
    const result = validateEditableCaptionCues([
      { index: 9, startSeconds: 0, endSeconds: 2.5, text: "  God   is faithful  " },
    ], 10);

    expect(result.isValid).toBe(true);
    expect(result.cues).toEqual([
      { index: 1, startSeconds: 0, endSeconds: 2.5, text: "God is faithful" },
    ]);
  });

  it("normalizes valid exact word timings with their parent cue", () => {
    const result = validateEditableCaptionCues([
      {
        index: 4,
        startSeconds: 0,
        endSeconds: 2.5,
        text: "  God   is faithful  ",
        wordTimings: [
          { text: " God ", startSeconds: 0, endSeconds: 0.5556 },
          { text: "is", startSeconds: 0.62, endSeconds: 0.9 },
          { text: "faithful", startSeconds: 1, endSeconds: 2.5 },
        ],
      },
    ], 10);

    expect(result.isValid).toBe(true);
    expect(result.cues[0]?.wordTimings).toEqual([
      { text: "God", startSeconds: 0, endSeconds: 0.556 },
      { text: "is", startSeconds: 0.62, endSeconds: 0.9 },
      { text: "faithful", startSeconds: 1, endSeconds: 2.5 },
    ]);
  });

  it("drops the complete word timing payload when one timing is invalid", () => {
    const result = validateEditableCaptionCues([
      {
        index: 1,
        startSeconds: 0,
        endSeconds: 5,
        text: "God is faithful",
        wordTimings: [
          { text: "God", startSeconds: 0, endSeconds: 1 },
          { text: "is", startSeconds: 1, endSeconds: 2 },
          { text: "faithful", startSeconds: 2, endSeconds: 6 },
        ],
      },
    ], 10);

    expect(result.isValid).toBe(true);
    expect(result.cues).toEqual([
      { index: 1, startSeconds: 0, endSeconds: 5, text: "God is faithful" },
    ]);
  });

  it("rejects empty caption cues", () => {
    const result = validateEditableCaptionCues([], 10);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Add at least one on-video caption line before saving.");
  });

  it("rejects cues outside the clip duration", () => {
    const result = validateEditableCaptionCues([
      { index: 1, startSeconds: 0, endSeconds: 12, text: "Too long" },
    ], 10);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Caption 1 ends after the clip duration.");
  });

  it("rejects overlapping caption cues before they can diverge between preview and export", () => {
    const result = validateEditableCaptionCues([
      { index: 1, startSeconds: 0, endSeconds: 4, text: "First thought" },
      { index: 2, startSeconds: 3.5, endSeconds: 6, text: "Second thought" },
    ], 8);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Caption 2 overlaps the previous caption.");
  });

  it("rejects editable captions with very low clip coverage", () => {
    const result = validateEditableCaptionCues([
      { index: 1, startSeconds: 0, endSeconds: 2, text: "Too sparse" },
    ], 60);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("On-video captions cover too little of the clip. Add more caption lines or turn off burned-in captions.");
    expect(result.coverageRatio).toBeCloseTo(0.033);
  });

  it("warns when editable captions have noticeable coverage gaps", () => {
    const result = validateEditableCaptionCues([
      { index: 1, startSeconds: 0, endSeconds: 18, text: "Opening caption" },
      { index: 2, startSeconds: 49, endSeconds: 60, text: "Closing caption" },
    ], 60);

    expect(result.isValid).toBe(true);
    expect(result.warnings).toContain("On-video captions have a noticeable timing gap.");
    expect(result.maxGapSeconds).toBe(31);
  });
});

describe("caption cue timing edit primitives", () => {
  it("sorts and clamps overlapping cues into a chronological timeline", () => {
    const result = clampEditableCaptionCueTimeline({
      cues: [
        { index: 8, startSeconds: 4, endSeconds: 7, text: "Second thought" },
        { index: 3, startSeconds: -1, endSeconds: 5, text: "First thought" },
      ],
      clipDurationSeconds: 8,
    });

    expect(result.isValid).toBe(true);
    expect(result.wasClamped).toBe(true);
    expect(result.cues).toEqual([
      { index: 1, startSeconds: 0, endSeconds: 4.5, text: "First thought", wordTimings: undefined },
      { index: 2, startSeconds: 4.5, endSeconds: 7, text: "Second thought", wordTimings: undefined },
    ]);
  });

  it("clamps a timing edit between adjacent cues and preserves chronology", () => {
    const result = updateEditableCaptionCueTiming({
      cues: [
        { index: 1, startSeconds: 0, endSeconds: 2, text: "Opening" },
        { index: 2, startSeconds: 3, endSeconds: 5, text: "Middle" },
        { index: 3, startSeconds: 6, endSeconds: 8, text: "Closing" },
      ],
      cueIndex: 1,
      startSeconds: 1,
      endSeconds: 7,
      clipDurationSeconds: 8,
    });

    expect(result.error).toBeNull();
    expect(result.changed).toBe(true);
    expect(result.wasClamped).toBe(true);
    expect(result.cues[1]).toMatchObject({ startSeconds: 2, endSeconds: 6 });
  });

  it("splits at a sensible boundary without separating a Bible reference", () => {
    const result = splitEditableCaptionCue({
      cues: [{
        index: 1,
        startSeconds: 0,
        endSeconds: 6,
        text: "Read John 3:16 and remember grace",
      }],
      cueIndex: 0,
      splitWordIndex: 2,
      clipDurationSeconds: 6,
    });

    expect(result.error).toBeNull();
    expect(result.cues).toHaveLength(2);
    expect(result.cues[0]?.text).toBe("Read John 3:16");
    expect(result.cues[1]?.text).toBe("and remember grace");
    expect(result.cues[0]?.endSeconds).toBe(result.cues[1]?.startSeconds);
  });

  it("retains exact word timings on both sides of a split", () => {
    const result = splitEditableCaptionCue({
      cues: [{
        index: 1,
        startSeconds: 0,
        endSeconds: 4,
        text: "Grace will carry you",
        wordTimings: [
          { text: "Grace", startSeconds: 0, endSeconds: 0.8 },
          { text: "will", startSeconds: 0.9, endSeconds: 1.5 },
          { text: "carry", startSeconds: 1.8, endSeconds: 2.8 },
          { text: "you", startSeconds: 3, endSeconds: 4 },
        ],
      }],
      cueIndex: 0,
      splitWordIndex: 2,
      clipDurationSeconds: 4,
    });

    expect(result.error).toBeNull();
    expect(result.cues[0]?.wordTimings?.map((word) => word.text)).toEqual(["Grace", "will"]);
    expect(result.cues[1]?.wordTimings?.map((word) => word.text)).toEqual(["carry", "you"]);
    expect(result.cues[0]?.endSeconds).toBe(1.65);
    expect(result.cues[1]?.startSeconds).toBe(1.65);
  });

  it("merges adjacent cues and combines complete word timing evidence", () => {
    const result = mergeAdjacentEditableCaptionCues({
      cues: [
        {
          index: 1,
          startSeconds: 0,
          endSeconds: 1,
          text: "Grace wins",
          wordTimings: [
            { text: "Grace", startSeconds: 0, endSeconds: 0.5 },
            { text: "wins", startSeconds: 0.5, endSeconds: 1 },
          ],
        },
        {
          index: 2,
          startSeconds: 1.2,
          endSeconds: 2.5,
          text: "every time",
          wordTimings: [
            { text: "every", startSeconds: 1.2, endSeconds: 1.8 },
            { text: "time", startSeconds: 1.8, endSeconds: 2.5 },
          ],
        },
      ],
      cueIndex: 0,
      clipDurationSeconds: 3,
    });

    expect(result.error).toBeNull();
    expect(result.cues).toEqual([{
      index: 1,
      startSeconds: 0,
      endSeconds: 2.5,
      text: "Grace wins every time",
      wordTimings: [
        { text: "Grace", startSeconds: 0, endSeconds: 0.5 },
        { text: "wins", startSeconds: 0.5, endSeconds: 1 },
        { text: "every", startSeconds: 1.2, endSeconds: 1.8 },
        { text: "time", startSeconds: 1.8, endSeconds: 2.5 },
      ],
    }]);
  });
});

describe("breakCaptionTextIntoSemanticLines", () => {
  it("keeps Bible references and titled names together", () => {
    const scriptureLines = breakCaptionTextIntoSemanticLines(
      "Pastor Thabang Ngwenya teaches why John 3:16 still matters today",
      { maxCharactersPerLine: 24, maxLines: 3 },
    );

    expect(scriptureLines.join(" ")).toBe(
      "Pastor Thabang Ngwenya teaches why John 3:16 still matters today",
    );
    expect(scriptureLines.some((line) => line.includes("Pastor Thabang Ngwenya"))).toBe(true);
    expect(scriptureLines.some((line) => line.includes("John 3:16"))).toBe(true);
  });

  it("avoids a one-word orphan when a balanced break is available", () => {
    const lines = breakCaptionTextIntoSemanticLines(
      "Faith keeps moving through every difficult season",
      { maxCharactersPerLine: 22, maxLines: 2 },
    );

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.split(" ").length >= 2)).toBe(true);
  });
});

describe("buildEditableCaptionCuesFromTranscriptSegments", () => {
  it("builds clip-relative caption cues from overlapping transcript segments", () => {
    const cues = buildEditableCaptionCuesFromTranscriptSegments({
      startTimeSeconds: 100,
      endTimeSeconds: 112,
      segments: [
        { startTimeSeconds: 96, endTimeSeconds: 101.5, text: "Opening context" },
        { startTimeSeconds: 103, endTimeSeconds: 107, text: "The selected sermon words" },
        { startTimeSeconds: 111, endTimeSeconds: 116, text: "Closing phrase" },
      ],
    });

    expect(cues).toEqual([
      { index: 1, startSeconds: 0, endSeconds: 1.5, text: "Opening context" },
      { index: 2, startSeconds: 3, endSeconds: 7, text: "The selected sermon words" },
      { index: 3, startSeconds: 11, endSeconds: 12, text: "Closing phrase" },
    ]);
  });

  it("skips empty or non-overlapping transcript segments", () => {
    const cues = buildEditableCaptionCuesFromTranscriptSegments({
      startTimeSeconds: 10,
      endTimeSeconds: 20,
      segments: [
        { startTimeSeconds: 0, endTimeSeconds: 5, text: "Before clip" },
        { startTimeSeconds: 12, endTimeSeconds: 13, text: "   " },
        { startTimeSeconds: 14, endTimeSeconds: 16, text: "  Inside   clip  " },
      ],
    });

    expect(cues).toEqual([
      { index: 1, startSeconds: 4, endSeconds: 6, text: "Inside clip" },
    ]);
  });
});

describe("resolveClipStudioInitialCaptionCues", () => {
  const transcriptCues = [
    { index: 1, startSeconds: 0, endSeconds: 15, text: "Transcript wording" },
    { index: 2, startSeconds: 15, endSeconds: 30, text: "Transcript ending" },
  ];

  it("preserves valid saved manual caption cues instead of rebuilding their text", () => {
    const result = resolveClipStudioInitialCaptionCues({
      savedCues: [
        { index: 9, startSeconds: 0, endSeconds: 15, text: "  Human-reviewed wording  " },
        { index: 10, startSeconds: 15, endSeconds: 30, text: "Human-reviewed ending" },
      ],
      transcriptCues,
      clipDurationSeconds: 30,
      savedCuesManuallyEdited: true,
    });

    expect(result).toEqual([
      { index: 1, startSeconds: 0, endSeconds: 15, text: "Human-reviewed wording" },
      { index: 2, startSeconds: 15, endSeconds: 30, text: "Human-reviewed ending" },
    ]);
  });

  it("falls back to transcript cues when saved manual cues are invalid", () => {
    const result = resolveClipStudioInitialCaptionCues({
      savedCues: [
        { index: 1, startSeconds: 0, endSeconds: 40, text: "Out of range" },
      ],
      transcriptCues,
      clipDurationSeconds: 30,
      savedCuesManuallyEdited: true,
    });

    expect(result).toEqual(transcriptCues);
  });

  it("keeps valid saved generated cues so hydration matches the approved preview", () => {
    const result = resolveClipStudioInitialCaptionCues({
      savedCues: [
        { index: 1, startSeconds: 0, endSeconds: 30, text: "Older generated caption" },
      ],
      transcriptCues,
      clipDurationSeconds: 30,
      savedCuesManuallyEdited: false,
    });

    expect(result).toEqual([
      { index: 1, startSeconds: 0, endSeconds: 30, text: "Older generated caption" },
    ]);
  });
});

describe("resolveClipStudioCaptionCuesForSave", () => {
  it("preserves the exact manual timing, wording, splits, and merges submitted by Studio", () => {
    const submittedCues = [
      { index: 1, startSeconds: 0, endSeconds: 4.2, text: "Human reviewed opening" },
      { index: 2, startSeconds: 4.2, endSeconds: 9, text: "and a manual split" },
    ];
    const regeneratedTranscriptCues = [
      { index: 1, startSeconds: 0, endSeconds: 9, text: "Server regenerated wording" },
    ];

    expect(resolveClipStudioCaptionCuesForSave({
      submittedCues,
      transcriptCues: regeneratedTranscriptCues,
    })).toEqual(submittedCues);
  });

  it("uses transcript-derived cues only when Studio submitted no cues", () => {
    const transcriptCues = [
      { index: 1, startSeconds: 0, endSeconds: 3, text: "Transcript fallback" },
    ];

    expect(resolveClipStudioCaptionCuesForSave({
      submittedCues: [],
      transcriptCues,
    })).toEqual(transcriptCues);
  });
});

describe("mergeCaptionCueTextOverrides", () => {
  const fullTranscriptCues = [
    { index: 1, startSeconds: 0, endSeconds: 10, text: "Opening source words" },
    { index: 2, startSeconds: 10, endSeconds: 20, text: "Middle source words" },
    { index: 3, startSeconds: 20, endSeconds: 30, text: "Newly expanded source words" },
  ];

  it("keeps the full server cue range while applying matching client text overrides", () => {
    const result = mergeCaptionCueTextOverrides({
      baseCues: fullTranscriptCues,
      textOverrideCues: [
        { index: 1, startSeconds: 0, endSeconds: 10, text: "Human-reviewed opening" },
        { index: 2, startSeconds: 10, endSeconds: 20, text: "Middle source words" },
      ],
    });

    expect(result).toEqual([
      { index: 1, startSeconds: 0, endSeconds: 10, text: "Human-reviewed opening" },
      { index: 2, startSeconds: 10, endSeconds: 20, text: "Middle source words" },
      { index: 3, startSeconds: 20, endSeconds: 30, text: "Newly expanded source words" },
    ]);
  });

  it("treats a matching blank override as an intentional caption-line removal", () => {
    const result = mergeCaptionCueTextOverrides({
      baseCues: fullTranscriptCues,
      textOverrideCues: [
        { index: 1, startSeconds: 10.02, endSeconds: 20.02, text: "   " },
      ],
    });

    expect(result).toEqual([
      { index: 1, startSeconds: 0, endSeconds: 10, text: "Opening source words" },
      { index: 2, startSeconds: 20, endSeconds: 30, text: "Newly expanded source words" },
    ]);
  });

  it("ignores unmatched client cues so they cannot replace expanded server captions", () => {
    const result = mergeCaptionCueTextOverrides({
      baseCues: fullTranscriptCues,
      textOverrideCues: [
        { index: 1, startSeconds: 40, endSeconds: 45, text: "Unrelated old cue" },
      ],
    });

    expect(result).toEqual(fullTranscriptCues);
  });
});

describe("buildTimedCaptionCuesFromTranscriptSegments", () => {
  it("builds word-timed cues so later transcript words do not appear at the segment start", () => {
    const cues = buildTimedCaptionCuesFromTranscriptSegments({
      startTimeSeconds: 100,
      endTimeSeconds: 104,
      segments: [
        { startTimeSeconds: 100, endTimeSeconds: 104, text: "Faith grows when we trust God" },
      ],
    });

    expect(cues.map((cue) => cue.text)).toEqual(["Faith", "grows", "when", "we", "trust", "God"]);
    expect(cues[0]).toMatchObject({ index: 1, startSeconds: 0, text: "Faith" });
    expect(cues[1]?.startSeconds).toBeGreaterThan(0);
    expect(cues[4]?.startSeconds).toBeGreaterThan(cues[1]?.startSeconds ?? 0);
    expect(cues.at(-1)?.endSeconds).toBe(4);
  });

  it("can group transcript words into short timed phrases when requested", () => {
    const cues = buildTimedCaptionCuesFromTranscriptSegments({
      startTimeSeconds: 10,
      endTimeSeconds: 16,
      segments: [
        { startTimeSeconds: 10, endTimeSeconds: 16, text: "God is faithful through every season" },
      ],
      maxWordsPerCue: 3,
      maxCueDurationSeconds: 10,
    });

    expect(cues.map((cue) => cue.text)).toEqual(["God is faithful", "through every season"]);
    expect(cues[0]?.wordTimings?.map((timing) => timing.text)).toEqual(["God", "is", "faithful"]);
    expect(cues[1]?.wordTimings?.map((timing) => timing.text)).toEqual(["through", "every", "season"]);
    expect(cues[1]?.startSeconds).toBeGreaterThan(cues[0]?.startSeconds ?? 0);
    expect(cues[1]?.endSeconds).toBe(6);
  });

  it("clips estimated word cues to the selected clip range", () => {
    const cues = buildTimedCaptionCuesFromTranscriptSegments({
      startTimeSeconds: 102,
      endTimeSeconds: 106,
      segments: [
        { startTimeSeconds: 100, endTimeSeconds: 108, text: "aa bb cc dd" },
      ],
    });

    expect(cues.map((cue) => cue.text)).toEqual(["bb", "cc"]);
    expect(cues[0]).toMatchObject({ index: 1, startSeconds: 0, endSeconds: 2, text: "bb" });
    expect(cues[1]).toMatchObject({ index: 2, startSeconds: 2, endSeconds: 4, text: "cc" });
  });
});

describe("buildTimedCaptionCuesFromTranscriptWords", () => {
  it("uses exact provider word timestamps and excludes words outside the clip", () => {
    const cues = buildTimedCaptionCuesFromTranscriptWords({
      startTimeSeconds: 10,
      endTimeSeconds: 12,
      words: [
        { text: "Before", startTimeSeconds: 9.4, endTimeSeconds: 9.9 },
        { text: "Grace", startTimeSeconds: 10.15, endTimeSeconds: 10.62 },
        { text: "wins", startTimeSeconds: 10.74, endTimeSeconds: 11.18 },
        { text: "After", startTimeSeconds: 12.1, endTimeSeconds: 12.4 },
      ],
    });

    expect(cues).toEqual([
      {
        index: 1,
        startSeconds: 0.15,
        endSeconds: 0.62,
        text: "Grace",
        wordTimings: [{ text: "Grace", startSeconds: 0.15, endSeconds: 0.62 }],
      },
      {
        index: 2,
        startSeconds: 0.74,
        endSeconds: 1.18,
        text: "wins",
        wordTimings: [{ text: "wins", startSeconds: 0.74, endSeconds: 1.18 }],
      },
    ]);
  });

  it("keeps every exact word range when grouping words into a phrase", () => {
    const cues = buildTimedCaptionCuesFromTranscriptWords({
      startTimeSeconds: 10,
      endTimeSeconds: 13,
      words: [
        { text: "Grace", startTimeSeconds: 10.1, endTimeSeconds: 10.5 },
        { text: "still", startTimeSeconds: 10.8, endTimeSeconds: 11.2 },
        { text: "wins", startTimeSeconds: 11.7, endTimeSeconds: 12.3 },
      ],
      maxWordsPerCue: 5,
      maxCueDurationSeconds: 4,
    });

    expect(cues).toEqual([
      {
        index: 1,
        startSeconds: 0.1,
        endSeconds: 2.3,
        text: "Grace still wins",
        wordTimings: [
          { text: "Grace", startSeconds: 0.1, endSeconds: 0.5 },
          { text: "still", startSeconds: 0.8, endSeconds: 1.2 },
          { text: "wins", startSeconds: 1.7, endSeconds: 2.3 },
        ],
      },
    ]);
  });

  it("uses semantic grouping without splitting a Bible reference", () => {
    const cues = buildTimedCaptionCuesFromTranscriptWords({
      startTimeSeconds: 0,
      endTimeSeconds: 7,
      words: [
        { text: "We", startTimeSeconds: 0, endTimeSeconds: 0.7 },
        { text: "read", startTimeSeconds: 0.8, endTimeSeconds: 1.4 },
        { text: "John", startTimeSeconds: 1.5, endTimeSeconds: 2.2 },
        { text: "3:16", startTimeSeconds: 2.3, endTimeSeconds: 3 },
        { text: "and", startTimeSeconds: 3.1, endTimeSeconds: 3.7 },
        { text: "remember", startTimeSeconds: 3.8, endTimeSeconds: 5.2 },
        { text: "grace", startTimeSeconds: 5.3, endTimeSeconds: 6.5 },
      ],
      maxWordsPerCue: 3,
      maxCueDurationSeconds: 4,
      groupingStrategy: "semantic",
    });

    expect(cues.map((cue) => cue.text)).toEqual([
      "We read John 3:16",
      "and remember grace",
    ]);
  });
});

describe("validateCaptionCuesFromTranscript", () => {
  it("accepts caption text grounded in the sermon transcription", () => {
    const result = validateCaptionCuesFromTranscript([
      { index: 1, startSeconds: 0, endSeconds: 3, text: "God is faithful" },
      { index: 2, startSeconds: 3, endSeconds: 6, text: "through every season" },
    ], "Church, God is faithful through every season.");

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects caption text that is not from the transcription", () => {
    const result = validateCaptionCuesFromTranscript([
      { index: 1, startSeconds: 0, endSeconds: 3, text: "Follow us for more" },
    ], "God is faithful through every season.");

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Caption 1 must use words from the sermon transcription.");
  });

  it("rejects burned-in captions when transcription text is missing", () => {
    const result = validateCaptionCuesFromTranscript([
      { index: 1, startSeconds: 0, endSeconds: 3, text: "God is faithful" },
    ], "");

    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Caption source transcription is missing");
  });
});

describe("buildSrtFromEditableCues", () => {
  it("builds SRT content from edited cues", () => {
    const srt = buildSrtFromEditableCues([
      { index: 1, startSeconds: 0, endSeconds: 1.2, text: "One" },
      { index: 2, startSeconds: 1.2, endSeconds: 3, text: "Two" },
    ]);

    expect(srt).toContain("1\n00:00:00,000 --> 00:00:01,200\nOne");
    expect(srt).toContain("2\n00:00:01,200 --> 00:00:03,000\nTwo");
  });
});
