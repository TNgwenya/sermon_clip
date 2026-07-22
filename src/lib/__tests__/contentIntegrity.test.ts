import { describe, expect, it } from "vitest";

import {
  deriveTranslationReviewState,
  detectProductionCopyIssues,
  extractQuoteTextFromContent,
  findQuoteTranscriptSegmentSpan,
  normalizeIntegrityText,
  validateScriptureReference,
  verifyQuoteTextAgainstTranscript,
} from "@/lib/contentIntegrity";

describe("content integrity quote verification", () => {
  it("normalizes punctuation and Unicode without paraphrasing words", () => {
    expect(normalizeIntegrityText("  God’s—faithfulness… remains! "))
      .toBe("god's faithfulness remains");
  });

  it("verifies exact quote wording against its source excerpt", () => {
    const result = verifyQuoteTextAgainstTranscript({
      quoteText: "“Faith keeps walking when pressure comes.”",
      sourceTranscriptExcerpt: "Faith keeps walking when pressure comes.",
    });

    expect(result).toMatchObject({
      verified: true,
      status: "VERIFIED",
      matchedSource: "SOURCE_EXCERPT",
    });
  });

  it("allows at most two ordered, bounded transcript omissions", () => {
    const result = verifyQuoteTextAgainstTranscript({
      quoteText: "Faith keeps walking … when pressure comes … because God is faithful.",
      transcriptSegments: [
        { text: "Faith keeps walking one faithful step at a time when pressure comes" },
        { text: "and the road feels difficult because God is faithful." },
      ],
    });

    expect(result).toMatchObject({
      verified: true,
      omissionCount: 2,
      matchedSource: "TRANSCRIPT_SEGMENTS",
    });
  });

  it("rejects paraphrased, reordered, or over-ellipsized pastor quotes", () => {
    expect(verifyQuoteTextAgainstTranscript({
      quoteText: "Pressure makes our faith grow stronger.",
      sourceTranscriptExcerpt: "Faith keeps walking when pressure comes.",
    })).toMatchObject({ verified: false, status: "MISMATCH" });

    expect(verifyQuoteTextAgainstTranscript({
      quoteText: "Pressure comes … faith keeps walking.",
      sourceTranscriptExcerpt: "Faith keeps walking when pressure comes.",
    })).toMatchObject({ verified: false, status: "MISMATCH" });

    expect(verifyQuoteTextAgainstTranscript({
      quoteText: "Faith keeps … walking with … courage when … pressure comes.",
      sourceTranscriptExcerpt: "Faith keeps walking with courage when pressure comes.",
    })).toMatchObject({ verified: false, status: "TOO_MANY_OMISSIONS" });
  });

  it("does not stitch quote fragments across an unbounded transcript gap", () => {
    const longGap = Array.from({ length: 81 }, (_, index) => `word${index}`).join(" ");
    expect(verifyQuoteTextAgainstTranscript({
      quoteText: "Faith keeps walking … because God is faithful.",
      sourceTranscriptExcerpt: `Faith keeps walking ${longGap} because God is faithful.`,
    })).toMatchObject({ verified: false, status: "MISMATCH" });
  });

  it("extracts quoted artwork copy without treating its supporting caption as the quote", () => {
    expect(extractQuoteTextFromContent(
      "“God is faithful in the waiting.” with supporting caption copy for Sunday.",
    )).toBe("God is faithful in the waiting.");
  });

  it("locates the smallest real transcript span and preserves segment identity and timecodes", () => {
    const result = findQuoteTranscriptSegmentSpan({
      quoteText: "Faith keeps walking when pressure comes.",
      transcriptSegments: [
        {
          id: "segment-3",
          transcriptId: "transcript-1",
          text: "comes, because God is faithful.",
          startTimeSeconds: 18,
          endTimeSeconds: 24,
        },
        {
          id: "segment-1",
          transcriptId: "transcript-1",
          text: "Before this thought, remember:",
          startTimeSeconds: 8,
          endTimeSeconds: 12,
        },
        {
          id: "segment-2",
          transcriptId: "transcript-1",
          text: "faith keeps walking when pressure",
          startTimeSeconds: 12,
          endTimeSeconds: 18,
        },
      ],
    });

    expect(result).toMatchObject({
      segmentIds: ["segment-2", "segment-3"],
      transcriptId: "transcript-1",
      startTimeSeconds: 12,
      endTimeSeconds: 24,
      verification: { verified: true, matchedSource: "TRANSCRIPT_SEGMENTS" },
    });
  });

  it("tries later occurrences when an earlier repeated phrase cannot complete the quote", () => {
    expect(findQuoteTranscriptSegmentSpan({
      quoteText: "Faith keeps walking … because God is faithful.",
      transcriptSegments: [
        {
          id: "segment-1",
          text: `Faith keeps walking ${Array.from({ length: 81 }, (_, index) => `gap${index}`).join(" ")}`,
          startTimeSeconds: 0,
          endTimeSeconds: 20,
        },
        {
          id: "segment-2",
          text: "Faith keeps walking one step at a time because God is faithful.",
          startTimeSeconds: 20,
          endTimeSeconds: 30,
        },
      ],
    })?.segmentIds).toEqual(["segment-2"]);
  });
});

describe("production-copy detection", () => {
  it("finds placeholders and internal production directions in publishable fields", () => {
    const issues = detectProductionCopyIssues({
      artworkText: "God is faithful. Add a small footer with the church logo.",
      caption: "Join us at [insert service time].",
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "ARTWORK", kind: "INSTRUCTION" }),
      expect.objectContaining({ field: "CAPTION", kind: "PLACEHOLDER" }),
    ]));
  });

  it("does not flag ordinary ministry calls to action", () => {
    expect(detectProductionCopyIssues({
      artworkText: "Keep walking by faith.",
      caption: "Share this with someone who needs hope. Join us this Sunday.",
    })).toEqual([]);
  });
});

describe("Scripture-reference validation", () => {
  it.each([
    ["John 3:16 (NIV)", "John 3:16", "NIV"],
    ["2 Tim. 1:7 NKJV", "2 Timothy 1:7", "NKJV"],
    ["Psalm 23", "Psalms 23", null],
    ["Jude 24", "Jude 1:24", null],
    ["Romans 8:28-30; James 1:2-4 (ESV)", "Romans 8:28-30; James 1:2-4", "ESV"],
  ])("accepts the canonical reference %s", (value, normalizedReference, version) => {
    expect(validateScriptureReference(value)).toMatchObject({
      valid: true,
      normalizedReference,
      version,
    });
  });

  it.each([
    null,
    "John",
    "John 99:1",
    "Wisdom 3:1",
    "John 3:16-2",
    "John three sixteen",
  ])("rejects missing or non-canonical syntax: %s", (value) => {
    expect(validateScriptureReference(value).valid).toBe(false);
  });

  it("records unrecognized translation/version labels without accepting them silently", () => {
    expect(validateScriptureReference("John 3:16 XYZ")).toMatchObject({
      valid: true,
      version: "XYZ",
      versionStatus: "UNRECOGNIZED",
    });
  });
});

describe("translation review state", () => {
  it("blocks translated wording until a human approves it", () => {
    expect(deriveTranslationReviewState({
      translatedFromLanguage: "isiZulu",
      originalLanguageText: "Nkulunkulu unathi",
      translatedText: "God is with us",
      translationConfidence: 0.96,
    })).toMatchObject({
      status: "BLOCKED",
      blocking: true,
      reasons: expect.arrayContaining(["HUMAN_TRANSLATION_APPROVAL_REQUIRED"]),
    });
  });

  it("clears approved translated wording but never ignores an explicit review flag", () => {
    expect(deriveTranslationReviewState({
      translatedFromLanguage: "isiZulu",
      humanTranslationApproved: true,
      translationConfidence: 0.7,
      translationUncertaintyNote: "Previously reviewed",
    })).toMatchObject({ status: "CLEAR", blocking: false });

    expect(deriveTranslationReviewState({
      translatedFromLanguage: "isiZulu",
      humanTranslationApproved: true,
      translationNeedsReview: true,
    })).toMatchObject({ status: "BLOCKED", blocking: true });
  });

  it("requires a recognized, explicitly approved Scripture version when requested", () => {
    expect(deriveTranslationReviewState({ scriptureVersionRequired: true })).toMatchObject({
      status: "BLOCKED",
      reasons: ["SCRIPTURE_VERSION_MISSING"],
    });
    expect(deriveTranslationReviewState({
      scriptureVersionRequired: true,
      scriptureVersion: "NIV",
      scriptureVersionApproved: true,
    })).toMatchObject({ status: "CLEAR", blocking: false });
  });
});
