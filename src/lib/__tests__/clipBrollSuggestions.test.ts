import { beforeEach, describe, expect, it } from "vitest";

import {
  buildClipBrollSuggestions,
  clearClipBrollSuggestionCacheForTests,
  getCachedClipBrollSuggestions,
  resolveAddedBrollSuggestionLabel,
  type ClipBrollSuggestionInput,
} from "@/lib/clipBrollSuggestions";

function input(
  overrides: Partial<ClipBrollSuggestionInput> = {},
): ClipBrollSuggestionInput {
  return {
    clipId: "clip-1",
    clipStartSeconds: 100,
    clipEndSeconds: 145,
    clipTranscriptText:
      "You must run the race God has put before you. Paul says in Hebrews chapter 12 verse 1 that we should run with perseverance.",
    transcriptSafetyStatus: "TRUSTED",
    transcriptSegments: [
      {
        id: "segment-1",
        startTimeSeconds: 102,
        endTimeSeconds: 108,
        text: "You must run the race God has put before you.",
        confidence: 0.96,
      },
      {
        id: "segment-2",
        startTimeSeconds: 112,
        endTimeSeconds: 120,
        text: "Paul says in Hebrews chapter 12 verse 1 that we should run with perseverance.",
        confidence: 0.94,
      },
    ],
    intelligence: {
      centralTheme: "Faithfully run your God-given race",
      keyTakeaways: ["Run with perseverance instead of comparing your calling."],
      reasonSelected: "A memorable application about running your own race.",
    },
    scriptureReferences: [
      {
        reference: "Hebrews 12:1",
        transcriptEvidence:
          "Paul says in Hebrews chapter 12 verse 1 that we should run with perseverance.",
        confidenceScore: 0.98,
      },
    ],
    ...overrides,
  };
}

describe("clip B-roll suggestions", () => {
  beforeEach(() => {
    clearClipBrollSuggestionCacheForTests();
  });

  it("keeps the meaningful suggestion label instead of injecting an uneditable edited-highlight title", () => {
    expect(resolveAddedBrollSuggestionLabel({ label: "Key quote" })).toBe("Key quote");
    expect(resolveAddedBrollSuggestionLabel({ label: "  Takeaway  " })).toBe("Takeaway");
    expect(resolveAddedBrollSuggestionLabel({ label: "" })).toBe("Highlight");
    expect(resolveAddedBrollSuggestionLabel({ label: "Key quote" })).not.toBe("Edited highlight");
  });

  it("returns at most two transcript-grounded suggestions with clip-relative timing", () => {
    const suggestions = buildClipBrollSuggestions(input());

    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((suggestion) => suggestion.type)).toContain("quote");
    expect(suggestions.map((suggestion) => suggestion.type)).toContain("scripture");
    expect(suggestions.every((suggestion) => suggestion.startSeconds >= 0)).toBe(true);
    expect(suggestions.every((suggestion) => suggestion.startSeconds < 45)).toBe(true);

    const quote = suggestions.find((suggestion) => suggestion.type === "quote");
    expect(input().clipTranscriptText).toContain(quote?.text ?? "missing");
    expect(quote?.sourceLabel).toBe("Spoken transcript · exact wording");
  });

  it("does not suggest a scripture reference without explicit evidence in this clip", () => {
    const suggestions = buildClipBrollSuggestions(input({
      scriptureReferences: [{
        reference: "Romans 8:28",
        transcriptEvidence: "All things work together for good.",
        confidenceScore: 0.99,
      }],
    }));

    expect(suggestions.some((suggestion) => suggestion.type === "scripture")).toBe(false);
  });

  it("uses an exact spoken application as a takeaway instead of outputting an intelligence paraphrase", () => {
    const clipInput = input({
      clipTranscriptText:
        "Grace gives us courage for today. Choose hope when fear begins to speak.",
      transcriptSegments: [
        {
          id: "segment-a",
          startTimeSeconds: 101,
          endTimeSeconds: 106,
          text: "Grace gives us courage for today.",
        },
        {
          id: "segment-b",
          startTimeSeconds: 108,
          endTimeSeconds: 114,
          text: "Choose hope when fear begins to speak.",
        },
      ],
      intelligence: {
        keyTakeaways: ["Christians should maintain a positive attitude."],
      },
      scriptureReferences: [],
    });

    const suggestions = buildClipBrollSuggestions(clipInput);
    const takeaway = suggestions.find((suggestion) => suggestion.type === "takeaway");

    expect(takeaway?.text).toBe("Choose hope when fear begins to speak.");
    expect(clipInput.clipTranscriptText).toContain(takeaway?.text ?? "missing");
    expect(suggestions.some((suggestion) => suggestion.text.includes("positive attitude"))).toBe(false);
  });

  it("suppresses suggestions while the transcript still requires human review", () => {
    expect(buildClipBrollSuggestions(input({
      transcriptSafetyStatus: "REVIEW_REQUIRED",
    }))).toEqual([]);
  });

  it("reuses the cached result for the same relevant revision and invalidates on transcript change", () => {
    const first = getCachedClipBrollSuggestions(input());
    const second = getCachedClipBrollSuggestions(input());
    const changed = getCachedClipBrollSuggestions(input({
      clipTranscriptText:
        "You must finish the race God has put before you. Paul says in Hebrews chapter 12 verse 1 that we should run with perseverance.",
      transcriptSegments: [
        {
          id: "segment-1",
          startTimeSeconds: 102,
          endTimeSeconds: 108,
          text: "You must finish the race God has put before you.",
        },
      ],
      scriptureReferences: [],
    }));

    expect(second).toBe(first);
    expect(changed).not.toBe(first);
    expect(changed[0]?.revisionKey).not.toBe(first[0]?.revisionKey);
  });

  it("does not invalidate the active clip revision for an adjacent out-of-clip segment", () => {
    const withAdjacentSegment = input({
      transcriptSegments: [
        ...input().transcriptSegments,
        {
          id: "adjacent-segment",
          startTimeSeconds: 150,
          endTimeSeconds: 156,
          text: "This line belongs to the next clip and must not affect this revision.",
        },
      ],
    });
    const first = getCachedClipBrollSuggestions(withAdjacentSegment);
    const second = getCachedClipBrollSuggestions({
      ...withAdjacentSegment,
      transcriptSegments: withAdjacentSegment.transcriptSegments.map((segment) => (
        segment.id === "adjacent-segment"
          ? { ...segment, text: "An edited line still outside this clip." }
          : segment
      )),
    });

    expect(second).toBe(first);
  });
});
