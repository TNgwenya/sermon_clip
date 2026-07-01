import { describe, expect, it } from "vitest";

import {
  buildSrtFromEditableCues,
  hashtagsToEditorInput,
  parseHashtagEditorInput,
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
