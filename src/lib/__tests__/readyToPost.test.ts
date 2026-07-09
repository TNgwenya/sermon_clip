import { describe, expect, it } from "vitest";

import {
  buildPlatformCaptionVariants,
  buildPlatformUploadHandoffs,
  buildReadyQueueStatus,
  buildReadyToPostPackage,
  formatRecommendedNextAction,
  formatPackageSize,
  normalizeStringArray,
  sanitizePastorFacingQualityText,
} from "@/lib/readyToPost";

describe("ready-to-post package", () => {
  it("normalizes hashtags by trimming, prefixing, dropping blanks, and removing duplicates", () => {
    expect(normalizeStringArray([" Prayer ", "#Prayer", "", "Encouragement", 12])).toEqual([
      "#Prayer",
      "#Encouragement",
    ]);
  });

  it("builds platform-specific caption variants", () => {
    const variants = buildPlatformCaptionVariants({
      title: "Jesus Meets Us In The Storm",
      hook: "You are not alone in the storm.",
      caption: "God is near when life feels loud.",
      hashtags: ["#Faith", "#Hope"],
      intendedAudience: "Young adults",
    });

    expect(variants).toHaveLength(4);
    expect(variants.find((variant) => variant.platform === "TikTok")?.text).toContain(
      "You are not alone in the storm.",
    );
    expect(variants.find((variant) => variant.platform === "Instagram")?.text).toContain(
      "For young adults.",
    );
    expect(variants.find((variant) => variant.platform === "Facebook")?.text).toContain(
      "Jesus Meets Us In The Storm",
    );
    expect(variants.find((variant) => variant.platform === "Facebook")?.text).not.toContain(
      "share with someone who needs encouragement",
    );
  });

  it("keeps YouTube Shorts titles within the platform-friendly limit", () => {
    const variants = buildPlatformCaptionVariants({
      title: "A".repeat(120),
      hook: "",
      caption: "Short caption",
      hashtags: [],
    });

    expect(variants.find((variant) => variant.platform === "YouTube Shorts")?.text).toHaveLength(80);
  });

  it("uses the title as a TikTok hook fallback", () => {
    const variants = buildPlatformCaptionVariants({
      title: "A faithful reminder",
      hook: "   ",
      caption: "God is faithful.",
      hashtags: [],
    });

    expect(variants.find((variant) => variant.platform === "TikTok")?.text).toContain("A faithful reminder");
  });

  it("builds platform upload handoffs with distinct YouTube title and caption copy", () => {
    const handoffs = buildPlatformUploadHandoffs({
      title: "Jesus Meets Us In The Storm",
      hook: "You are not alone in the storm.",
      caption: "God is near when life feels loud.",
      hashtags: ["#Faith", "#Hope"],
    });

    const youtube = handoffs.find((handoff) => handoff.platform === "YouTube Shorts");
    const tiktok = handoffs.find((handoff) => handoff.platform === "TikTok");

    expect(tiktok?.uploadUrl).toBe("https://www.tiktok.com/upload");
    expect(tiktok?.primaryCopyLabel).toBe("Copy caption");
    expect(youtube?.primaryCopyLabel).toBe("Copy title");
    expect(youtube?.titleText).toBe("Jesus Meets Us In The Storm");
    expect(youtube?.captionText).toContain("God is near when life feels loud.");
    expect(youtube?.checklistText).toContain("Confirm thumbnail, cover frame, crop, captions, and audio.");
  });

  it("formats package sizes for pastor-facing download context", () => {
    expect(formatPackageSize(null)).toBeNull();
    expect(formatPackageSize(0)).toBeNull();
    expect(formatPackageSize(512)).toBe("512 B");
    expect(formatPackageSize(1536)).toBe("1.5 KB");
    expect(formatPackageSize(12 * 1024 * 1024)).toBe("12 MB");
  });

  it("summarizes the ready queue for pastor-facing empty and live states", () => {
    expect(buildReadyQueueStatus({ readyCount: 0, preparingCount: 2, approvedWaitingCount: 0 })).toMatchObject({
      headline: "2 clips are being prepared",
      liveRefreshEnabled: true,
    });

    expect(buildReadyQueueStatus({ readyCount: 0, preparingCount: 0, approvedWaitingCount: 1 })).toMatchObject({
      headline: "1 approved clip waiting",
      liveRefreshEnabled: false,
    });

    expect(buildReadyQueueStatus({ readyCount: 3, preparingCount: 1, approvedWaitingCount: 0 })).toMatchObject({
      headline: "3 clips prepared for posting",
      liveRefreshEnabled: true,
    });
  });

  it("builds a complete ready-to-post bundle for the queue UI", () => {
    const readyPackage = buildReadyToPostPackage({
      clipId: "clip-123",
      title: "Prayer changes the room",
      hook: "Pause and pray.",
      caption: "Bring the room before God.",
      hashtags: ["Prayer", "Faith"],
      estimatedBytes: 2_621_440,
      smartClipCategory: "Prayer moment",
      intendedAudience: "New believers",
    });

    expect(readyPackage.previewHref).toBe("/api/clips/clip-123/preview?variant=best");
    expect(readyPackage.downloadHref).toBe("/api/clips/clip-123/download?variant=best");
    expect(readyPackage.badges).toEqual([
      "Posting package",
      "TikTok",
      "Instagram",
      "YouTube Shorts",
      "Facebook",
      "Prayer moment",
      "New believers",
    ]);
    expect(readyPackage.hashtags).toEqual(["#Prayer", "#Faith"]);
    expect(readyPackage.platformCount).toBe(4);
    expect(readyPackage.captionFileCount).toBe(5);
    expect(readyPackage.contentsLabel).toBe("Video + 5 caption files");
    expect(readyPackage.sizeLabel).toBe("2.5 MB");
    expect(readyPackage.variants.map((variant) => variant.platform)).toEqual([
      "TikTok",
      "Instagram",
      "YouTube Shorts",
      "Facebook",
    ]);
    expect(readyPackage.handoffs.map((handoff) => handoff.platform)).toEqual([
      "TikTok",
      "Instagram",
      "YouTube Shorts",
      "Facebook",
    ]);
    expect(readyPackage.platformPayloads.find((payload) => payload.platform === "TikTok")?.caption).toBe(
      readyPackage.handoffs.find((handoff) => handoff.platform === "TikTok")?.captionText,
    );
  });

  it("keeps pastor-facing quality summaries unchanged", () => {
    expect(sanitizePastorFacingQualityText("Strong church-ready clip with a clear ending.")).toBe(
      "Strong church-ready clip with a clear ending.",
    );
  });

  it("removes technical AI validation details from quality summaries", () => {
    const sanitized = sanitizePastorFacingQualityText(
      "Strong church-ready clip with an overall post score of 8.1. AI review fallback used: reviews.1.qualityWarnings.0: Invalid option: expected one of WEAK_HOOK.",
    );

    expect(sanitized).toBe("Strong church-ready clip with an overall post score of 8.1.");
  });

  it("uses a safe fallback when the whole quality summary is technical", () => {
    expect(sanitizePastorFacingQualityText("reviews.1.qualityWarnings.0: Invalid option: expected one of WEAK_HOOK.")).toBe(
      "This clip passed the backup quality review. Please do a quick pastor review before publishing.",
    );
  });

  it("formats post-ready action codes for pastors", () => {
    expect(formatRecommendedNextAction("REVIEW_OPENING")).toBe("Review the opening");
    expect(formatRecommendedNextAction("POST_NOW")).toBe("Ready to post");
    expect(formatRecommendedNextAction("CUSTOM_ACTION")).toBe("CUSTOM ACTION");
  });
});
