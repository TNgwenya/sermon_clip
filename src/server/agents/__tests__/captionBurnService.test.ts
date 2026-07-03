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
      captionStylePresetId: "clean-lower",
      captionPosition: "lower",
    });
  });

  it("prefers hardware-friendly video encoder args when available", () => {
    const hardwareArgs = __captionBurnTestUtils.buildVideoEncoderArgs("h264_videotoolbox");
    expect(hardwareArgs).toContain("h264_videotoolbox");
    expect(hardwareArgs).toContain("-allow_sw");
    expect(__captionBurnTestUtils.buildVideoEncoderArgs("libx264")).toContain("veryfast");
  });

  it("builds distinct caption force styles from presets", () => {
    expect(__captionBurnTestUtils.buildCaptionForceStyle("kinetic-pop")).toContain("FontSize=29");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("creator-highlight")).toContain("BackColour=&H8822D3EE");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("soft-bubble")).toContain("BackColour=&HEEFFFFFF");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("high-contrast")).toContain("PrimaryColour=&H0000FFFF");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("minimal-church")).toContain("FontSize=17");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("scripture-focus")).toContain("FontName=Georgia");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("cinematic-testimony")).toContain("Shadow=2");
  });

  it("applies caption appearance to burn styles", () => {
    expect(
      __captionBurnTestUtils.buildCaptionForceStyle("clean-lower", "STANDARD", "lower", {
        fontScale: "large",
        maxLines: 4,
        uppercase: false,
        verticalOffset: 16,
      }),
    ).toContain("FontSize=24");
    expect(
      __captionBurnTestUtils.buildCaptionForceStyle("clean-lower", "STANDARD", "lower", {
        fontScale: "compact",
        maxLines: 4,
        uppercase: false,
        verticalOffset: -16,
      }),
    ).toContain("MarginV=42");
  });

  it("maps saved caption positions to subtitle and overlay placement", () => {
    expect(__captionBurnTestUtils.resolveCaptionPosition({ captionPosition: "top" })).toBe("top");
    expect(__captionBurnTestUtils.resolveCaptionPosition({ captionPosition: "middle" })).toBe("middle");
    expect(__captionBurnTestUtils.resolveCaptionPosition({ captionPosition: "sideways" })).toBe("lower");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("clean-lower", "STANDARD", "top")).toContain("Alignment=8");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("clean-lower", "STANDARD", "middle")).toContain("Alignment=5");
    expect(__captionBurnTestUtils.captionOverlayYExpression("top")).toBe("132");
    expect(__captionBurnTestUtils.captionOverlayYExpression("middle")).toBe("(H-h)/2");
    expect(__captionBurnTestUtils.captionOverlayYExpression("lower")).toBe("H-h-132");
    expect(
      __captionBurnTestUtils.captionOverlayYExpression("lower", {
        fontScale: "regular",
        maxLines: 4,
        uppercase: false,
        verticalOffset: 24,
      }),
    ).toBe("H-h-156");
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

  it("detects active-word overlay caption mode", () => {
    expect(__captionBurnTestUtils.shouldUseWordHighlightOverlay({ wordHighlightEnabled: true })).toBe(true);
    expect(__captionBurnTestUtils.shouldUseWordHighlightOverlay({ wordHighlightEnabled: false })).toBe(false);
    expect(__captionBurnTestUtils.shouldUseWordHighlightOverlay({})).toBe(false);
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

  it("remaps caption cues onto the speech-cleaned render timeline", () => {
    const cues = __captionBurnTestUtils.remapCaptionCueOverlaysForSpeechCleanup([
      { index: 1, startSeconds: 1, endSeconds: 3, text: "First words" },
      { index: 2, startSeconds: 7, endSeconds: 9, text: "Second words" },
    ], {
      enabled: true,
      sourceStartSeconds: 1,
      sourceEndSeconds: 10,
      cleanedDurationSeconds: 6,
      cuts: [{ startSeconds: 4, endSeconds: 7, removedSeconds: 3 }],
      removedRanges: [],
      candidateRanges: [],
      reviewItems: [],
      hasAudioAnalysis: true,
    });

    expect(cues).toEqual([
      { index: 1, startSeconds: 0, endSeconds: 2, text: "First words" },
      { index: 2, startSeconds: 3, endSeconds: 5, text: "Second words" },
    ]);
    expect(__captionBurnTestUtils.buildSrtFromCaptionCueOverlays(cues)).toContain("00:00:03,000 --> 00:00:05,000");
  });

  it("expands full caption lines into active-word overlay intervals", () => {
    const overlays = __captionBurnTestUtils.expandCaptionCueWordHighlightOverlays([
      {
        index: 1,
        startSeconds: 0,
        endSeconds: 8,
        text: "aa bb cc dd",
      },
    ]);

    expect(overlays).toHaveLength(4);
    expect(overlays.map((overlay) => overlay.text)).toEqual([
      "aa bb cc dd",
      "aa bb cc dd",
      "aa bb cc dd",
      "aa bb cc dd",
    ]);
    expect(overlays.map((overlay) => overlay.activeWordIndex)).toEqual([0, 1, 2, 3]);
    expect(overlays[1]).toMatchObject({
      startSeconds: 2,
      endSeconds: 4,
      activeWordIndex: 1,
    });
  });

  it("renders active words in the overlay SVG", () => {
    const svg = __captionBurnTestUtils.buildCaptionOverlaySvg({
      index: 1,
      startSeconds: 0,
      endSeconds: 2,
      text: "AND SO LIKE",
      activeWordIndex: 2,
    });

    expect(svg).toContain("#22C55E");
    expect(svg).toContain("LIKE");
  });

  it("renders caption appearance in overlay SVG", () => {
    const svg = __captionBurnTestUtils.buildCaptionOverlaySvg(
      {
        index: 1,
        startSeconds: 0,
        endSeconds: 2,
        text: "bring hope again",
        activeWordIndex: 0,
      },
      {
        fontScale: "large",
        maxLines: 2,
        uppercase: true,
        verticalOffset: 0,
      },
    );

    expect(svg).toContain("font-size=\"42\"");
    expect(svg).toContain("BRING");
  });
});
