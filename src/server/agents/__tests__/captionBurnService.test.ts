import { describe, expect, it } from "vitest";

import { __captionBurnTestUtils } from "../captionBurnService";

describe("caption burn service validation", () => {
  it("allows eligible caption burn", () => {
    const result = __captionBurnTestUtils.validateCaptionBurnEligibility({
      status: "APPROVED",
      renderStatus: "COMPLETED",
      captionStatus: "GENERATED",
      captionBurnStatus: "NOT_BURNED",
      renderedClipExists: true,
      subtitleExists: true,
      allowReburn: false,
    });

    expect(result.ok).toBe(true);
  });

  it("fails when subtitle file is missing", () => {
    const result = __captionBurnTestUtils.validateCaptionBurnEligibility({
      status: "APPROVED",
      renderStatus: "COMPLETED",
      captionStatus: "GENERATED",
      captionBurnStatus: "NOT_BURNED",
      renderedClipExists: true,
      subtitleExists: false,
      allowReburn: false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Subtitle SRT file");
  });

  it("fails when caption generation has not completed", () => {
    const result = __captionBurnTestUtils.validateCaptionBurnEligibility({
      status: "APPROVED",
      renderStatus: "COMPLETED",
      captionStatus: "NOT_GENERATED",
      captionBurnStatus: "NOT_BURNED",
      renderedClipExists: true,
      subtitleExists: false,
      allowReburn: false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not generated yet");
  });

  it("fails when rendered clip is missing", () => {
    const result = __captionBurnTestUtils.validateCaptionBurnEligibility({
      status: "APPROVED",
      renderStatus: "COMPLETED",
      captionStatus: "GENERATED",
      captionBurnStatus: "NOT_BURNED",
      renderedClipExists: false,
      subtitleExists: true,
      allowReburn: false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Rendered clip file");
  });

  it("prevents duplicate caption burn while running", () => {
    const result = __captionBurnTestUtils.validateCaptionBurnEligibility({
      status: "APPROVED",
      renderStatus: "COMPLETED",
      captionStatus: "GENERATED",
      captionBurnStatus: "BURNING",
      renderedClipExists: true,
      subtitleExists: true,
      allowReburn: false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("already running");
  });

  it("builds caption burn metadata payload", () => {
    const burnedAt = new Date("2026-06-17T23:59:00.000Z");
    const metadata = __captionBurnTestUtils.buildCaptionBurnMetadata({
      outputPath: "/tmp/clip.captioned.mp4",
      burnedAt,
    });

    expect(metadata.captionBurnStatus).toBe("COMPLETED");
    expect(metadata.captionedVideoPath).toBe("/tmp/clip.captioned.mp4");
    expect(metadata.captionBurnedAt).toEqual(burnedAt);
    expect(metadata.captionBurnError).toBeNull();
    expect(metadata.subtitlesBurned).toBe(true);
    expect(metadata.captionData).toMatchObject({
      captionStylePresetId: "bold-sermon",
    });
  });

  it("builds distinct caption force styles from presets", () => {
    expect(__captionBurnTestUtils.buildCaptionForceStyle("high-contrast")).toContain("PrimaryColour=&H0000FFFF");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("minimal-church")).toContain("FontSize=16");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("scripture-focus")).toContain("FontName=Georgia");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("cinematic-testimony")).toContain("Shadow=1");
  });

  it("uses per-clip caption style overrides", () => {
    expect(
      __captionBurnTestUtils.resolveClipCaptionStylePresetId(
        { captionStylePresetId: "cinematic-testimony" },
        "bold-sermon",
      ),
    ).toBe("cinematic-testimony");
    expect(
      __captionBurnTestUtils.resolveClipCaptionStylePresetId(
        { captionStylePresetId: "unknown" },
        "bold-sermon",
      ),
    ).toBe("bold-sermon");
  });

  it("detects when captions are disabled for a clip", () => {
    expect(__captionBurnTestUtils.shouldApplyCaptionsToClip({ applyCaptionsToClip: false })).toBe(false);
    expect(__captionBurnTestUtils.shouldApplyCaptionsToClip({})).toBe(true);
  });

  it("detects when FFmpeg needs the image overlay caption fallback", () => {
    expect(__captionBurnTestUtils.shouldUseCaptionOverlayFallback(new Error("No such filter: 'subtitles'"))).toBe(true);
    expect(__captionBurnTestUtils.shouldUseCaptionOverlayFallback(new Error("Some other FFmpeg failure"))).toBe(false);
  });

  it("extracts valid caption cues for the image overlay fallback", () => {
    expect(
      __captionBurnTestUtils.extractCaptionCueOverlays({
        cues: [
          { index: 1, startSeconds: 0, endSeconds: 2.5, text: "Bring your pain to Jesus." },
          { index: 2, startSeconds: 2.5, endSeconds: 5, text: "   " },
          { index: 3, startSeconds: 5, endSeconds: 4, text: "Invalid timing" },
        ],
      }),
    ).toEqual([
      {
        index: 1,
        startSeconds: 0,
        endSeconds: 2.5,
        text: "Bring your pain to Jesus.",
      },
    ]);
  });
});
