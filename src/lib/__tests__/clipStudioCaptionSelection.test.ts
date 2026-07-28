import { describe, expect, it } from "vitest";

import {
  hideSelectedCaptionCues,
  isCaptionCueSelected,
  replaceSelectedCaptionCueText,
  resolveCaptionCueSelection,
} from "@/lib/clipStudioCaptionSelection";

const cues = [
  { index: 1, startSeconds: 0, endSeconds: 1, text: "Run your" },
  { index: 2, startSeconds: 1, endSeconds: 2, text: "own race" },
  { index: 3, startSeconds: 2, endSeconds: 3, text: "with faith" },
];

describe("clip studio caption range selection", () => {
  it("resolves a backwards shift-selection into one contiguous timed range", () => {
    const selection = resolveCaptionCueSelection(cues, { anchorIndex: 2, focusIndex: 0 });

    expect(selection).toEqual({
      startIndex: 0,
      endIndex: 2,
      startSeconds: 0,
      endSeconds: 3,
      text: "Run your own race with faith",
      cueCount: 3,
    });
    expect(isCaptionCueSelected(1, selection)).toBe(true);
    expect(isCaptionCueSelected(3, selection)).toBe(false);
  });

  it("replaces selected wording while preserving cue timing and surrounding captions", () => {
    const result = replaceSelectedCaptionCueText({
      cues,
      selection: { anchorIndex: 0, focusIndex: 1 },
      replacementText: "Run the race faithfully",
    });

    expect(result.map((cue) => cue.text)).toEqual(["Run the", "race faithfully", "with faith"]);
    expect(result.map(({ startSeconds, endSeconds }) => ({ startSeconds, endSeconds }))).toEqual([
      { startSeconds: 0, endSeconds: 1 },
      { startSeconds: 1, endSeconds: 2 },
      { startSeconds: 2, endSeconds: 3 },
    ]);
  });

  it("places a shorter correction in the first selected cue and hides unused cue text", () => {
    const result = replaceSelectedCaptionCueText({
      cues,
      selection: { anchorIndex: 0, focusIndex: 1 },
      replacementText: "Run",
    });

    expect(result.map((cue) => cue.text)).toEqual(["Run", "", "with faith"]);
  });

  it("hides only the selected overlay cues without deleting their timing", () => {
    const result = hideSelectedCaptionCues({
      cues,
      selection: { anchorIndex: 1, focusIndex: 2 },
    });

    expect(result.map((cue) => cue.text)).toEqual(["Run your", "", ""]);
    expect(result[1]).toMatchObject({ startSeconds: 1, endSeconds: 2 });
    expect(result[2]).toMatchObject({ startSeconds: 2, endSeconds: 3 });
  });
});
