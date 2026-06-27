import { describe, expect, it } from "vitest";

import {
  buildClipTimingDisplay,
  clipStatusTone,
  extractApplyCaptionsToClip,
  extractCaptionStyleOverride,
  extractCaptionGuidance,
  extractHookOverlayConfig,
  extractCaptionPackage,
  extractLanguageHints,
  extractSpeechCleanupSettings,
  extractOnVideoCaptionCues,
  formatClipDuration,
  formatClipStatusLabel,
  formatMinistryScore,
  formatSocialScore,
  formatTranscriptExcerpt,
  hasCaptionPackage,
  renderStatusLabel,
} from "@/lib/clipStudio";

// ─── Caption Package ────────────────────────────────────────────────────────

describe("extractCaptionPackage", () => {
  it("returns fallback caption when captionData is null", () => {
    const pkg = extractCaptionPackage(null, "Fallback caption", ["#faith"]);
    expect(pkg.primaryCaption).toBe("Fallback caption");
    expect(pkg.hashtags).toEqual(["#faith"]);
  });

  it("returns fallback caption when captionData is not an object", () => {
    const pkg = extractCaptionPackage("not-an-object", "Fallback", []);
    expect(pkg.primaryCaption).toBe("Fallback");
  });

  it("extracts primaryCaption from captionData", () => {
    const data = { primaryCaption: "Main caption text" };
    const pkg = extractCaptionPackage(data, "Fallback", []);
    expect(pkg.primaryCaption).toBe("Main caption text");
  });

  it("falls back to caption key when primaryCaption is missing", () => {
    const data = { caption: "Caption from caption key" };
    const pkg = extractCaptionPackage(data, "Fallback", []);
    expect(pkg.primaryCaption).toBe("Caption from caption key");
  });

  it("extracts shortCaption and platformCaption", () => {
    const data = { shortCaption: "Short", platformCaption: "Platform" };
    const pkg = extractCaptionPackage(data, null, []);
    expect(pkg.shortCaption).toBe("Short");
    expect(pkg.platformCaption).toBe("Platform");
  });

  it("extracts platformFriendlyCaption as platformCaption fallback", () => {
    const data = { platformFriendlyCaption: "Platform friendly" };
    const pkg = extractCaptionPackage(data, null, []);
    expect(pkg.platformCaption).toBe("Platform friendly");
  });

  it("extracts hashtags from captionData", () => {
    const data = { hashtags: ["#church", "#faith", "#sermon"] };
    const pkg = extractCaptionPackage(data, null, []);
    expect(pkg.hashtags).toEqual(["#church", "#faith", "#sermon"]);
  });

  it("uses fallback hashtags when captionData has no hashtags", () => {
    const data = { primaryCaption: "Caption" };
    const pkg = extractCaptionPackage(data, null, ["#faith"]);
    expect(pkg.hashtags).toEqual(["#faith"]);
  });

  it("filters non-string values from hashtags array", () => {
    const data = { hashtags: ["#faith", 123, null, "#hope"] };
    const pkg = extractCaptionPackage(data, null, []);
    expect(pkg.hashtags).toEqual(["#faith", "#hope"]);
  });

  it("extracts qualityScore and qualityReason", () => {
    const data = { qualityScore: 0.9, qualityReason: "Well written" };
    const pkg = extractCaptionPackage(data, null, []);
    expect(pkg.qualityScore).toBe(0.9);
    expect(pkg.qualityReason).toBe("Well written");
  });

  it("extracts captionPackage fallback fields", () => {
    const data = {
      captionPackage: {
        primaryCaption: "Primary from package",
        shortCaption: "Short from package",
        platformCaption: "Platform from package",
        optionalHashtags: ["#Faith"],
        captionQualityScore: 8.5,
        captionReason: "Strong call to action",
      },
    };

    const pkg = extractCaptionPackage(data, null, []);
    expect(pkg.primaryCaption).toBe("Primary from package");
    expect(pkg.shortCaption).toBe("Short from package");
    expect(pkg.platformCaption).toBe("Platform from package");
    expect(pkg.hashtags).toEqual(["#Faith"]);
    expect(pkg.qualityScore).toBe(0.85);
    expect(pkg.qualityReason).toBe("Strong call to action");
  });

  it("extracts warnings array", () => {
    const data = { warnings: ["Too long", "Missing hashtags"] };
    const pkg = extractCaptionPackage(data, null, []);
    expect(pkg.warnings).toEqual(["Too long", "Missing hashtags"]);
  });

  it("returns empty warnings when captionData has no warnings", () => {
    const data = { primaryCaption: "Caption" };
    const pkg = extractCaptionPackage(data, null, []);
    expect(pkg.warnings).toEqual([]);
  });
});

describe("hasCaptionPackage", () => {
  it("returns false when package has no content", () => {
    const pkg = extractCaptionPackage(null, null, []);
    expect(hasCaptionPackage(pkg)).toBe(false);
  });

  it("returns true when primaryCaption is present", () => {
    const pkg = extractCaptionPackage(null, "Some caption", []);
    expect(hasCaptionPackage(pkg)).toBe(true);
  });

  it("returns true when hashtags are present", () => {
    const pkg = extractCaptionPackage(null, null, ["#faith"]);
    expect(hasCaptionPackage(pkg)).toBe(true);
  });
});

// ─── Social Score ───────────────────────────────────────────────────────────

describe("formatSocialScore", () => {
  it("returns neutral tone when value is null", () => {
    const result = formatSocialScore(null);
    expect(result.tone).toBe("neutral");
    expect(result.value).toBe("Not assessed");
  });

  it("returns success tone for high social potential", () => {
    const result = formatSocialScore("High engagement expected");
    expect(result.tone).toBe("success");
  });

  it("returns warning tone for low social potential", () => {
    const result = formatSocialScore("Low shareability");
    expect(result.tone).toBe("warning");
  });

  it("returns accent tone for moderate social potential", () => {
    const result = formatSocialScore("Moderate reach expected");
    expect(result.tone).toBe("accent");
  });
});

// ─── Ministry Score ─────────────────────────────────────────────────────────

describe("formatMinistryScore", () => {
  it("returns neutral tone when value is null", () => {
    const result = formatMinistryScore(null);
    expect(result.tone).toBe("neutral");
    expect(result.value).toBe("Not assessed");
  });

  it("returns success tone for high ministry value", () => {
    const result = formatMinistryScore("High ministry impact");
    expect(result.tone).toBe("success");
  });

  it("returns warning tone for low ministry value", () => {
    const result = formatMinistryScore("Low ministry relevance");
    expect(result.tone).toBe("warning");
  });

  it("returns accent tone for moderate ministry value", () => {
    const result = formatMinistryScore("Good for devotional use");
    expect(result.tone).toBe("accent");
  });
});

// ─── Status Labels ──────────────────────────────────────────────────────────

describe("formatClipStatusLabel", () => {
  it("returns pastor-friendly label for SUGGESTED", () => {
    expect(formatClipStatusLabel("SUGGESTED")).toBe("Needs Review");
  });

  it("returns Approved for APPROVED", () => {
    expect(formatClipStatusLabel("APPROVED")).toBe("Approved");
  });

  it("returns Rejected for REJECTED", () => {
    expect(formatClipStatusLabel("REJECTED")).toBe("Rejected");
  });

  it("returns Ready to post for EXPORTED", () => {
    expect(formatClipStatusLabel("EXPORTED")).toBe("Ready to post");
  });

  it("returns Edited when manually edited suggested clip", () => {
    expect(formatClipStatusLabel("SUGGESTED", { isManuallyEdited: true })).toBe("Edited");
  });

  it("returns Video ready when video preparation is completed", () => {
    expect(formatClipStatusLabel("APPROVED", { renderStatus: "COMPLETED" })).toBe("Video ready");
  });
});

describe("extractCaptionGuidance", () => {
  it("returns defaults for null captionData", () => {
    const guidance = extractCaptionGuidance(null);
    expect(guidance.qualityScore).toBeNull();
    expect(guidance.warnings).toEqual([]);
  });

  it("extracts quality metadata and warnings from nested package", () => {
    const guidance = extractCaptionGuidance({
      captionPackage: {
        captionQualityScore: 9.2,
        captionReason: "Clear and pastoral",
        captionWarnings: ["TOO_LONG"],
      },
      improvementSuggestions: ["Shorten the first sentence"],
      languageHints: {
        translationUncertaintyNote: "Minor translation ambiguity",
      },
    });

    expect(guidance.qualityScore).toBeCloseTo(0.92, 5);
    expect(guidance.qualityReason).toBe("Clear and pastoral");
    expect(guidance.warnings).toEqual(["TOO_LONG"]);
    expect(guidance.translationUncertainty).toBe("Minor translation ambiguity");
    expect(guidance.improvementSuggestions).toEqual(["Shorten the first sentence"]);
  });
});

describe("Studio on-video caption settings", () => {
  it("extracts generated caption cues", () => {
    expect(
      extractOnVideoCaptionCues({
        cues: [
          { index: 4, startSeconds: 0, endSeconds: 2, text: "First line" },
          { index: 5, startSeconds: 2, endSeconds: 5, text: "Second line" },
        ],
      }, null, 12),
    ).toEqual([
      { index: 1, startSeconds: 0, endSeconds: 2, text: "First line" },
      { index: 2, startSeconds: 2, endSeconds: 5, text: "Second line" },
    ]);
  });

  it("falls back to one cue from the clip caption", () => {
    expect(extractOnVideoCaptionCues(null, "Fallback caption", 30)).toEqual([
      { index: 1, startSeconds: 0, endSeconds: 6, text: "Fallback caption" },
    ]);
  });

  it("extracts per-clip caption style overrides", () => {
    expect(extractCaptionStyleOverride({ captionStylePresetId: "scripture-focus" })).toBe("scripture-focus");
    expect(extractCaptionStyleOverride({ captionStylePresetId: "unknown" })).toBe("");
  });

  it("defaults captions to applied unless explicitly disabled", () => {
    expect(extractApplyCaptionsToClip(null)).toBe(true);
    expect(extractApplyCaptionsToClip({ applyCaptionsToClip: false })).toBe(false);
  });

  it("extracts hook overlay settings with defaults", () => {
    expect(extractHookOverlayConfig({
      hookOverlay: {
        enabled: true,
        text: "Pause here",
        position: "center",
        startSeconds: 1,
        durationSeconds: 6,
        animation: "pop",
        size: "large",
        bold: false,
      },
    }, "Fallback hook")).toEqual({
      enabled: true,
      text: "Pause here",
      position: "center",
      startSeconds: 1,
      durationSeconds: 6,
      animation: "pop",
      size: "large",
      bold: false,
    });
  });

  it("defaults speech cleanup to detection-only and does not auto-remove silence", () => {
    expect(extractSpeechCleanupSettings(null)).toEqual({
      removeDeadAir: false,
      tightenLongPauses: false,
      flagFillerWords: true,
    });
  });

  it("extracts saved speech cleanup opt-in settings", () => {
    expect(extractSpeechCleanupSettings({
      speechCleanup: {
        removeDeadAir: true,
        tightenLongPauses: true,
        flagFillerWords: false,
      },
    })).toEqual({
      removeDeadAir: true,
      tightenLongPauses: true,
      flagFillerWords: false,
    });
  });
});

describe("clipStatusTone", () => {
  it("returns warning for SUGGESTED", () => {
    expect(clipStatusTone("SUGGESTED")).toBe("warning");
  });

  it("returns success for APPROVED", () => {
    expect(clipStatusTone("APPROVED")).toBe("success");
  });

  it("returns danger for REJECTED", () => {
    expect(clipStatusTone("REJECTED")).toBe("danger");
  });

  it("returns accent for EXPORTED", () => {
    expect(clipStatusTone("EXPORTED")).toBe("accent");
  });
});

describe("renderStatusLabel", () => {
  it("returns pastor-facing labels for each video preparation status", () => {
    expect(renderStatusLabel("NOT_RENDERED")).toBe("Not prepared");
    expect(renderStatusLabel("QUEUED")).toBe("Waiting to prepare");
    expect(renderStatusLabel("RENDERING")).toBe("Preparing video…");
    expect(renderStatusLabel("COMPLETED")).toBe("Video ready");
    expect(renderStatusLabel("FAILED")).toBe("Video needs attention");
  });
});

// ─── Duration Formatting ────────────────────────────────────────────────────

describe("formatClipDuration", () => {
  it("formats duration in mm:ss", () => {
    expect(formatClipDuration(90)).toBe("1:30");
  });

  it("formats duration in hh:mm:ss for long clips", () => {
    expect(formatClipDuration(3725)).toBe("1:02:05");
  });

  it("returns Unknown for negative seconds", () => {
    expect(formatClipDuration(-1)).toBe("Unknown");
  });

  it("returns Unknown for non-finite values", () => {
    expect(formatClipDuration(Number.NaN)).toBe("Unknown");
  });
});

// ─── Language Hints ─────────────────────────────────────────────────────────

describe("extractLanguageHints", () => {
  it("returns null when data is null", () => {
    expect(extractLanguageHints(null)).toBeNull();
  });

  it("returns null when data is not an object", () => {
    expect(extractLanguageHints("string")).toBeNull();
  });

  it("returns null when data has no meaningful language fields", () => {
    expect(extractLanguageHints({ unrelated: "field" })).toBeNull();
  });

  it("extracts detectedLanguage", () => {
    const result = extractLanguageHints({ detectedLanguage: "Zulu" });
    expect(result?.detectedLanguage).toBe("Zulu");
  });

  it("extracts isMixed flag", () => {
    const result = extractLanguageHints({ detectedLanguage: "English", isMixed: true });
    expect(result?.isMixed).toBe(true);
  });

  it("extracts mixedLanguage flag as isMixed", () => {
    const result = extractLanguageHints({ detectedLanguage: "English", mixedLanguage: true });
    expect(result?.isMixed).toBe(true);
  });

  it("extracts translation fields", () => {
    const result = extractLanguageHints({
      detectedLanguage: "Zulu",
      translatedFrom: "Zulu",
      originalPhrase: "Siyabonga",
      englishMeaning: "We are grateful",
      translationConfidence: "high",
      uncertaintyNote: "Informal dialect",
    });
    expect(result?.translatedFrom).toBe("Zulu");
    expect(result?.originalPhrase).toBe("Siyabonga");
    expect(result?.englishMeaning).toBe("We are grateful");
    expect(result?.translationConfidence).toBe("high");
    expect(result?.uncertaintyNote).toBe("Informal dialect");
  });

  it("converts numeric translationConfidence to string", () => {
    const result = extractLanguageHints({ detectedLanguage: "Zulu", translationConfidence: 0.95 });
    expect(result?.translationConfidence).toBe("0.95");
  });

  it("extracts nested languageHints metadata", () => {
    const result = extractLanguageHints({
      languageHints: {
        detectedLanguage: "Xhosa",
        mixedLanguage: true,
        translationUncertaintyNote: "Possible idiom mismatch",
      },
    });

    expect(result?.detectedLanguage).toBe("Xhosa");
    expect(result?.isMixed).toBe(true);
    expect(result?.uncertaintyNote).toBe("Possible idiom mismatch");
  });
});

// ─── Transcript Excerpt ─────────────────────────────────────────────────────

describe("formatTranscriptExcerpt", () => {
  it("returns null for null input", () => {
    expect(formatTranscriptExcerpt(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(formatTranscriptExcerpt("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(formatTranscriptExcerpt("   ")).toBeNull();
  });

  it("returns full text when under the character limit", () => {
    const short = "This is a short excerpt.";
    expect(formatTranscriptExcerpt(short)).toBe(short);
  });

  it("truncates long text and appends ellipsis", () => {
    const long = "word ".repeat(200); // 1000 chars
    const result = formatTranscriptExcerpt(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThan(long.length);
    expect(result!.endsWith("…")).toBe(true);
  });

  it("trims leading and trailing whitespace", () => {
    const result = formatTranscriptExcerpt("  trimmed text  ");
    expect(result).toBe("trimmed text");
  });
});

// ─── Timing Display ─────────────────────────────────────────────────────────

describe("buildClipTimingDisplay", () => {
  it("formats start, end, and duration", () => {
    const display = buildClipTimingDisplay(90, 150, 60);
    expect(display.startLabel).toBe("1:30");
    expect(display.endLabel).toBe("2:30");
    expect(display.durationLabel).toBe("1:00");
  });

  it("formats longer timestamps with hours", () => {
    const display = buildClipTimingDisplay(3600, 3720, 120);
    expect(display.startLabel).toBe("1:00:00");
    expect(display.endLabel).toBe("1:02:00");
  });
});
