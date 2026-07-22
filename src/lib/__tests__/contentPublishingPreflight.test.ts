import { describe, expect, it } from "vitest";

import { runContentPublishingPreflight } from "@/lib/contentPublishingPreflight";

describe("content publishing preflight", () => {
  it("allows a prepared grounded Instagram quote to publish automatically with connected public media", () => {
    const result = runContentPublishingPreflight({
      assetType: "QUOTE_GRAPHIC",
      status: "READY",
      platform: "Instagram",
      caption: "Faithful steps matter.",
      automationMode: "AUTOMATIC",
      metaConnectionReady: true,
      sourceTranscriptExcerpt: "Faithful steps matter.",
      files: [{
        mimeType: "image/jpeg",
        publicUrl: "https://media.example.com/faithful-steps.jpg",
        width: 1080,
        height: 1350,
        sizeBytes: 42_000,
      }],
    });

    expect(result.canSchedule).toBe(true);
    expect(result.canPublishAutomatically).toBe(true);
  });

  it("keeps manual scheduling available but blocks automatic mode without Meta credentials and public media", () => {
    const manual = runContentPublishingPreflight({
      assetType: "QUOTE_GRAPHIC",
      status: "READY",
      platform: "Instagram",
      caption: "Faithful steps matter.",
      sourceTranscriptExcerpt: "Faithful steps matter.",
      files: [{ mimeType: "image/png", width: 1080, height: 1350 }],
    });
    const automatic = runContentPublishingPreflight({
      assetType: "QUOTE_GRAPHIC",
      status: "READY",
      platform: "Instagram",
      caption: "Faithful steps matter.",
      automationMode: "AUTOMATIC",
      metaConnectionReady: false,
      sourceTranscriptExcerpt: "Faithful steps matter.",
      files: [{ mimeType: "image/png", width: 1080, height: 1350 }],
    });

    expect(manual.canSchedule).toBe(true);
    expect(manual.canPublishAutomatically).toBe(false);
    expect(automatic.canSchedule).toBe(false);
    expect(automatic.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "meta-connection", status: "BLOCKED" }),
      expect.objectContaining({ id: "public-media", status: "BLOCKED" }),
    ]));
  });

  it("blocks an ungrounded quote and graphic overflow", () => {
    const result = runContentPublishingPreflight({
      assetType: "QUOTE_GRAPHIC",
      status: "PREPARED",
      platform: "Facebook",
      caption: "Draft",
      files: [{ mimeType: "image/png", overflowDetected: true }],
    });

    expect(result.canSchedule).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "approval", status: "BLOCKED" }),
      expect.objectContaining({ id: "quote-evidence", status: "BLOCKED" }),
      expect.objectContaining({ id: "overflow", status: "BLOCKED" }),
    ]));
  });

  it("blocks quote artwork that changes the pastor's transcript wording", () => {
    const result = runContentPublishingPreflight({
      assetType: "QUOTE_GRAPHIC",
      status: "READY",
      platform: "Instagram",
      artworkText: "Pressure always makes your faith stronger.",
      caption: "A message about faith.",
      sourceTranscriptExcerpt: "Faith keeps walking when pressure comes.",
      files: [{ mimeType: "image/png", width: 1080, height: 1350 }],
    });

    expect(result.canSchedule).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "quote-integrity",
      status: "BLOCKED",
    }));
  });

  it("can verify quote artwork against stored transcript segments", () => {
    const result = runContentPublishingPreflight({
      assetType: "QUOTE_GRAPHIC",
      status: "READY",
      platform: "Instagram",
      artworkText: "Faith keeps walking when pressure comes.",
      caption: "A message about faith.",
      sourceTranscriptSegments: [
        { text: "Faith keeps walking" },
        { text: "when pressure comes." },
      ],
      files: [{ mimeType: "image/png", width: 1080, height: 1350 }],
    });

    expect(result.canSchedule).toBe(true);
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "quote-integrity",
      status: "READY",
    }));
  });

  it("blocks Scripture graphics until a valid reference and recognized version are present", () => {
    const valid = runContentPublishingPreflight({
      assetType: "SCRIPTURE_GRAPHIC",
      status: "READY",
      platform: "Facebook",
      artworkText: "The Lord is my shepherd.",
      caption: "A word for the week.",
      relatedScripture: "Psalm 23:1",
      files: [{ mimeType: "image/png", width: 1080, height: 1350 }],
    });
    const invalid = runContentPublishingPreflight({
      assetType: "SCRIPTURE_GRAPHIC",
      status: "READY",
      platform: "Facebook",
      artworkText: "The Lord is my shepherd.",
      caption: "A word for the week.",
      relatedScripture: "Psalm ninety-one",
      files: [{ mimeType: "image/png", width: 1080, height: 1350 }],
    });

    expect(valid.canSchedule).toBe(false);
    expect(valid.checks).toContainEqual(expect.objectContaining({
      id: "scripture-reference",
      status: "BLOCKED",
    }));
    expect(invalid.canSchedule).toBe(false);
    expect(invalid.checks).toContainEqual(expect.objectContaining({
      id: "scripture-reference",
      status: "BLOCKED",
    }));
  });

  it("blocks production notes and explicit translation review states", () => {
    const result = runContentPublishingPreflight({
      assetType: "SCRIPTURE_GRAPHIC",
      status: "READY",
      platform: "Facebook",
      artworkText: "God is with us. Add a small footer with the church logo.",
      caption: "Nkulunkulu unathi.",
      relatedScripture: "Matthew 1:23 (NIV)",
      translationReview: {
        translatedFromLanguage: "isiZulu",
        originalLanguageText: "Nkulunkulu unathi",
        translatedText: "God is with us",
        translationConfidence: 0.95,
      },
      files: [{ mimeType: "image/png", width: 1080, height: 1350 }],
    });

    expect(result.canSchedule).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "production-copy", status: "BLOCKED" }),
      expect.objectContaining({ id: "translation", status: "BLOCKED" }),
    ]));
  });

  it("does not treat a non-image attachment as prepared graphic media", () => {
    const result = runContentPublishingPreflight({
      assetType: "SCRIPTURE_GRAPHIC",
      status: "READY",
      platform: "Facebook",
      caption: "Psalm 23",
      automationMode: "MANUAL",
      files: [{ mimeType: "application/pdf" }],
    });

    expect(result.canSchedule).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "media", status: "BLOCKED" }));
  });

  it.each(["TEXT_POST", "DEVOTIONAL", "PRAYER", "DISCUSSION", "SERMON_RECAP", "GUIDE", "EMAIL", "NEWSLETTER", "BLOG"])(
    "supports scheduling approved %s content as a manual handoff without an image",
    (assetType) => {
      const result = runContentPublishingPreflight({
        assetType,
        status: "READY",
        platform: "Facebook",
        caption: "A sermon-grounded reflection.",
        automationMode: "MANUAL",
        files: [],
      });

      expect(result.canSchedule).toBe(true);
      expect(result.canPublishAutomatically).toBe(false);
      expect(result.checks).toContainEqual(expect.objectContaining({ id: "manual-handoff", status: "READY" }));
    },
  );

  it("still requires a rendered public image when document content uses automatic Meta publishing", () => {
    const result = runContentPublishingPreflight({
      assetType: "GUIDE",
      status: "READY",
      platform: "Facebook",
      caption: "A sermon-grounded guide.",
      automationMode: "AUTOMATIC",
      metaConnectionReady: true,
      files: [],
    });

    expect(result.canSchedule).toBe(false);
    expect(result.canPublishAutomatically).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "media", status: "BLOCKED" }),
      expect.objectContaining({ id: "public-media", status: "BLOCKED" }),
    ]));
  });
});
