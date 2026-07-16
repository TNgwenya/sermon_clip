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
