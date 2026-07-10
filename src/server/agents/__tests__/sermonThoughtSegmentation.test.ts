import { describe, expect, it } from "vitest";

import {
  assessTranscriptGap,
  classifySermonSegment,
  deriveLikelyThoughtStartAnchors,
  deriveSermonThoughtSpans,
  findSafeScriptureLeadInIndex,
  isLikelyContinuationChunk,
  tokenizeSermonText,
  transcriptGapsInRange,
} from "../sermonThoughtSegmentation";

describe("sermon thought segmentation", () => {
  it("tokenizes multilingual sermon wording without stripping Unicode letters", () => {
    expect(tokenizeSermonText("uNkulunkulu uyathembeka — Moya oNgcwele, l’amour.")).toEqual([
      "unkulunkulu",
      "uyathembeka",
      "moya",
      "ongcwele",
      "l’amour",
    ]);
  });

  it("keeps adjacent lower-case ASR chunks inside the same likely thought", () => {
    const segments = [
      { startTimeSeconds: 0, endTimeSeconds: 4.2, text: "God gives every believer a gift to serve" },
      { startTimeSeconds: 4.25, endTimeSeconds: 8.4, text: "the church with courage and faithful obedience" },
      { startTimeSeconds: 8.45, endTimeSeconds: 12.6, text: "so this week choose one faithful act." },
      { startTimeSeconds: 12.8, endTimeSeconds: 17, text: "Prayer strengthens the heart." },
    ];

    expect(isLikelyContinuationChunk(segments[1], segments[0])).toBe(true);
    const spans = deriveSermonThoughtSpans(segments);

    expect(spans[0]).toMatchObject({ startIndex: 0, endIndex: 2 });
    expect(spans[1]).toMatchObject({ startIndex: 3, endIndex: 3, startStrength: "STRONG" });
  });

  it("derives thought anchors from punctuation, pauses, and structural markers", () => {
    const segments = [
      { startTimeSeconds: 0, endTimeSeconds: 5, text: "Grace gives courage." },
      { startTimeSeconds: 5.2, endTimeSeconds: 10, text: "Faith keeps walking." },
      { startTimeSeconds: 14, endTimeSeconds: 18, text: "The next thought follows a pause" },
      { startTimeSeconds: 30, endTimeSeconds: 34, text: "Finally, remember the main point." },
    ];

    const anchors = deriveLikelyThoughtStartAnchors(segments);

    expect(anchors.map((anchor) => [anchor.segmentIndex, anchor.strength])).toEqual([
      [0, "STRONG"],
      [1, "STRONG"],
      [2, "LIKELY"],
      [3, "STRONG"],
    ]);
    expect(anchors[2]?.reasons.join(" ")).toContain("Moderate");
    expect(anchors[3]?.reasons.join(" ")).toContain("Long");
  });

  it("classifies conservative scripture, prayer, story, and response signals without producing translations", () => {
    expect(classifySermonSegment("John chapter three verse sixteen says this.").signals).toContain("SCRIPTURE_REFERENCE");
    expect(classifySermonSegment("Masithandaze, Nkosi yethu.").signals).toContain("PRAYER");
    expect(classifySermonSegment("Ngikhumbula ngesikhathi siqala ibandla.").signals).toContain("STORY");
    expect(classifySermonSegment("Yebo!").signals).toContain("AUDIENCE_RESPONSE");
    expect(classifySermonSegment("Paul reminds Timothy that courage matters.").signals).not.toContain("SCRIPTURE_REFERENCE");
    expect(classifySermonSegment("Father Abraham continued his journey.").signals).not.toContain("PRAYER");
  });

  it("keeps a short audience response separate from the preacher's next thought", () => {
    const anchors = deriveLikelyThoughtStartAnchors([
      { startTimeSeconds: 0, endTimeSeconds: 4, text: "Can I get an amen?" },
      { startTimeSeconds: 4.1, endTimeSeconds: 5, text: "Amen" },
      { startTimeSeconds: 5.1, endTimeSeconds: 10, text: "God remains faithful in every season." },
    ]);

    expect(anchors.map((anchor) => anchor.segmentIndex)).toEqual([0, 1, 2]);
  });

  it("distinguishes moderate gaps from long unexplained gaps", () => {
    const segments = [
      { startTimeSeconds: 0, endTimeSeconds: 5, text: "First thought." },
      { startTimeSeconds: 8, endTimeSeconds: 12, text: "After a moderate pause." },
      { startTimeSeconds: 21, endTimeSeconds: 25, text: "After a long gap." },
    ];

    expect(assessTranscriptGap(segments[0], segments[1]).severity).toBe("MODERATE");
    expect(assessTranscriptGap(segments[1], segments[2]).severity).toBe("LONG");
    expect(transcriptGapsInRange(segments, 0, 2).map((gap) => gap.severity)).toEqual(["MODERATE", "LONG"]);
  });

  it("finds a nearby scripture-reference lead-in but does not cross a long gap", () => {
    const adjacent = [
      { startTimeSeconds: 0, endTimeSeconds: 5, text: "John chapter three verse sixteen says:" },
      { startTimeSeconds: 5.2, endTimeSeconds: 12, text: "For God so loved the world that he gave his Son." },
    ];
    const separated = [
      { startTimeSeconds: 0, endTimeSeconds: 5, text: "John chapter three verse sixteen says:" },
      { startTimeSeconds: 15, endTimeSeconds: 22, text: "For God so loved the world that he gave his Son." },
    ];

    expect(findSafeScriptureLeadInIndex(adjacent, 1, 20)).toBe(0);
    expect(findSafeScriptureLeadInIndex(separated, 1, 20)).toBeNull();
  });
});
