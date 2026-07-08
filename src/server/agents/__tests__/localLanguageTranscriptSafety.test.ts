import { describe, expect, it } from "vitest";

import {
  decideClipTranscriptSafety,
  mergeTranscriptSafetyBlocker,
  removeTranscriptSafetyBlocker,
  TRANSCRIPT_SAFETY_REVIEW_BLOCKER,
  usesLocalSouthernAfricanLanguage,
  validateTranscriptSafetyForPublishing,
} from "../localLanguageTranscriptSafety";

describe("local-language transcript safety", () => {
  it("detects Zulu, Sotho, Xhosa, and Tswana language hints", () => {
    expect(usesLocalSouthernAfricanLanguage("Zulu and English")).toBe(true);
    expect(usesLocalSouthernAfricanLanguage("isiXhosa")).toBe(true);
    expect(usesLocalSouthernAfricanLanguage("Sesotho")).toBe(true);
    expect(usesLocalSouthernAfricanLanguage("Setswana")).toBe(true);
    expect(usesLocalSouthernAfricanLanguage("English")).toBe(false);
  });

  it("requires review for local-language low-transcript rescue candidates", () => {
    const decision = decideClipTranscriptSafety({
      sermonLanguage: "Zulu / English",
      transcriptQualityMode: "LOW_RESCUE",
      candidate: {
        contextWarning: true,
        reasonSelected: "This transcript-rescue timed option needs pastor review.",
        canonicalizationWarnings: ["LOW_TRANSCRIPT_TIMED_FALLBACK"],
      },
    });

    expect(decision.status).toBe("REVIEW_REQUIRED");
    expect(decision.reasons).toContain("LOCAL_LANGUAGE_TRANSCRIPT_UNCERTAIN");
    expect(decision.reasons).toContain("LOW_TRANSCRIPT_TIMED_FALLBACK");
    expect(decision.blocker).toBe(TRANSCRIPT_SAFETY_REVIEW_BLOCKER);
  });

  it("does not block a ready transcript without rescue signals", () => {
    const decision = decideClipTranscriptSafety({
      sermonLanguage: "Zulu",
      transcriptQualityMode: "READY",
      candidate: {
        contextWarning: false,
        reasonSelected: "A normal grounded sermon moment.",
      },
    });

    expect(decision).toEqual({
      status: "TRUSTED",
      reasons: [],
      blocker: null,
    });
  });

  it("blocks publishing until transcript review is cleared", () => {
    expect(validateTranscriptSafetyForPublishing({ transcriptSafetyStatus: "REVIEW_REQUIRED" })).toMatchObject({
      ok: false,
    });
    expect(validateTranscriptSafetyForPublishing({ transcriptSafetyStatus: "REVIEWED" })).toEqual({ ok: true });
    expect(validateTranscriptSafetyForPublishing({ transcriptSafetyStatus: "TRUSTED" })).toEqual({ ok: true });
  });

  it("merges and removes the pastor-facing blocker without duplicating it", () => {
    expect(mergeTranscriptSafetyBlocker(["Fix captions", TRANSCRIPT_SAFETY_REVIEW_BLOCKER])).toEqual([
      "Fix captions",
      TRANSCRIPT_SAFETY_REVIEW_BLOCKER,
    ]);
    expect(removeTranscriptSafetyBlocker(["Fix captions", TRANSCRIPT_SAFETY_REVIEW_BLOCKER])).toEqual([
      "Fix captions",
    ]);
  });
});
