import { describe, expect, it } from "vitest";

import { normalizeCaptionDesignSettings } from "@/lib/clipStudio";
import { __captionBurnTestUtils } from "../captionBurnService";
import { getSharp } from "../sharpClient";

function extractFirstSvgTextElement(svg: string): { openingTag: string; element: string } {
  const element = svg.match(/<text\b[^>]*>[\s\S]*?<\/text>/)?.[0];
  const openingTag = element?.match(/^<text\b[^>]*>/)?.[0];

  if (!element || !openingTag) {
    throw new Error("Caption SVG did not contain a text element.");
  }

  return { openingTag, element };
}

async function rasterizedSvgTextWidth(element: string): Promise<number> {
  const sharp = await getSharp();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="240" viewBox="0 0 960 240">${element}</svg>`;
  const { info } = await sharp(Buffer.from(svg))
    .png()
    .trim()
    .toBuffer({ resolveWithObject: true });

  return info.width;
}

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

  it("blocks caption burn while transcript review is still required", () => {
    const result = __captionBurnTestUtils.validateCaptionBurnEligibility({
      status: "APPROVED",
      renderStatus: "COMPLETED",
      captionStatus: "GENERATED",
      captionBurnStatus: "NOT_BURNED",
      renderedClipExists: true,
      subtitleExists: true,
      allowReburn: false,
      transcriptSafetyStatus: "REVIEW_REQUIRED",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("confirm the transcript wording");
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
      captionDesign: {
        version: 1,
        presetId: "clean-lower",
        highlighting: {
          reducedMotion: false,
        },
      },
      captionRendererVersion: 5,
    });
    expect(__captionBurnTestUtils.CAPTION_RENDERER_VERSION).toBe(5);
  });

  it("prefers hardware-friendly video encoder args when available", () => {
    const hardwareArgs = __captionBurnTestUtils.buildVideoEncoderArgs("h264_videotoolbox");
    expect(hardwareArgs).toContain("h264_videotoolbox");
    expect(hardwareArgs).toContain("-allow_sw");
    expect(__captionBurnTestUtils.buildVideoEncoderArgs("libx264")).toContain("veryfast");
  });

  it("builds distinct caption force styles from presets", () => {
    expect(__captionBurnTestUtils.buildCaptionForceStyle("kinetic-pop")).toContain("FontSize=27");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("creator-highlight")).toContain("BackColour=&H3D170602");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("soft-bubble")).toContain("BackColour=&H14FFFFFF");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("high-contrast")).toContain("PrimaryColour=&H0015CCFA");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("minimal-church")).toContain("FontSize=19");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("scripture-focus")).toContain("FontName=DejaVu Serif");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("cinematic-testimony")).toContain("Shadow=1");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("golden-hour")).toContain("FontSize=24");
    expect(__captionBurnTestUtils.buildCaptionForceStyle("editorial-serif")).toContain("FontName=DejaVu Serif");
  });

  it("applies caption appearance to burn styles", () => {
    expect(
      __captionBurnTestUtils.buildCaptionForceStyle("clean-lower", "STANDARD", "lower", {
        fontScale: "large",
        maxLines: 4,
        uppercase: false,
        verticalOffset: 16,
      }),
    ).toContain("FontSize=26");
    expect(
      __captionBurnTestUtils.buildCaptionForceStyle("clean-lower", "STANDARD", "lower", {
        fontScale: "compact",
        maxLines: 4,
        uppercase: false,
        verticalOffset: -16,
      }),
    ).toContain("MarginV=48");
    expect(
      __captionBurnTestUtils.buildCaptionForceStyle("clean-lower", "STANDARD", "top", {
        fontScale: "regular",
        maxLines: 4,
        uppercase: false,
        verticalOffset: 16,
      }),
    ).toContain("MarginV=66");
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
    expect(
      __captionBurnTestUtils.resolveClipCaptionStylePresetId(
        {
          captionStyleSource: "brand-kit",
          captionStylePresetId: "cinematic-testimony",
        },
        "golden-hour",
      ),
    ).toBe("golden-hour");
  });

  it("detects when captions are disabled for a clip", () => {
    expect(__captionBurnTestUtils.shouldApplyCaptionsToClip({ applyCaptionsToClip: false })).toBe(false);
    expect(__captionBurnTestUtils.shouldApplyCaptionsToClip({})).toBe(true);
  });

  it("detects active-word overlay caption mode", () => {
    expect(__captionBurnTestUtils.shouldUseWordHighlightOverlay({ wordHighlightEnabled: true })).toBe(true);
    expect(__captionBurnTestUtils.shouldUseWordHighlightOverlay({ wordHighlightEnabled: false })).toBe(false);
    expect(__captionBurnTestUtils.shouldUseWordHighlightOverlay({ captionRevealMode: "phrase", wordHighlightEnabled: true })).toBe(false);
    expect(__captionBurnTestUtils.shouldUseWordHighlightOverlay({ captionRevealMode: "single-word" })).toBe(false);
    expect(__captionBurnTestUtils.shouldUseWordHighlightOverlay({ captionRevealMode: "active-word" })).toBe(true);
    expect(__captionBurnTestUtils.shouldUseWordHighlightOverlay({})).toBe(true);
    expect(__captionBurnTestUtils.MAX_WORD_HIGHLIGHT_OVERLAY_CUES).toBeGreaterThanOrEqual(300);
  });

  it("detects when FFmpeg needs the image overlay caption fallback", () => {
    expect(__captionBurnTestUtils.shouldUseCaptionOverlayFallback(new Error("No such filter: 'subtitles'"))).toBe(true);
    expect(__captionBurnTestUtils.shouldUseCaptionOverlayFallback(new Error("Some other FFmpeg failure"))).toBe(false);
  });

  it("keeps polished stock designs on the exact SVG path and simple designs on ASS", () => {
    const baseline = normalizeCaptionDesignSettings(undefined, { presetId: "clean-lower" });
    expect(
      __captionBurnTestUtils.requiresCaptionImageOverlayForDesign(
        { captionDesign: baseline },
        baseline,
      ),
    ).toBe(true);

    const assCompatible = normalizeCaptionDesignSettings({
      ...baseline,
      typography: {
        ...baseline.typography,
        fontSizePx: 46,
        fontWeight: 700,
        italic: true,
        letterSpacingPx: 1.6,
        lineHeight: 1.2,
        wordSpacingPx: 0,
      },
      colors: {
        ...baseline.colors,
        textColor: "#F8FAFC",
      },
      background: {
        ...baseline.background,
        treatment: "none",
        color: "#101827",
        opacity: 0,
        borderOpacity: 0,
        borderWidthPx: 0,
      },
      readability: {
        ...baseline.readability,
        outlineColor: "#000000",
        outlineWidthPx: 4,
        shadowOpacity: 0,
        shadowBlurPx: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
      },
      layout: {
        ...baseline.layout,
        verticalPosition: "top",
        horizontalPosition: "center",
        horizontalOffset: 36,
        verticalOffset: 20,
        safeWidth: "wide",
      },
    });

    expect(
      __captionBurnTestUtils.requiresCaptionImageOverlayForDesign(
        { captionDesign: assCompatible },
        assCompatible,
      ),
    ).toBe(false);
    expect(
      __captionBurnTestUtils.requiresCaptionImageOverlayForDesign(
        { captionStylePresetId: "clean-lower" },
        baseline,
      ),
    ).toBe(false);
  });

  it("uses exact SVG rendering only for user edits ASS cannot represent", () => {
    const baseline = normalizeCaptionDesignSettings(undefined, { presetId: "clean-lower" });
    const customLineLayout = normalizeCaptionDesignSettings({
      ...baseline,
      typography: {
        ...baseline.typography,
        lineHeight: baseline.typography.lineHeight + 0.12,
      },
    });
    const customFineWeight = normalizeCaptionDesignSettings({
      ...baseline,
      typography: {
        ...baseline.typography,
        fontWeight: 600,
      },
    });
    const customPanel = normalizeCaptionDesignSettings({
      ...baseline,
      background: {
        ...baseline.background,
        paddingX: baseline.background.paddingX + 12,
      },
    });

    expect(
      __captionBurnTestUtils.requiresCaptionImageOverlayForDesign(
        { captionDesign: customLineLayout },
        customLineLayout,
      ),
    ).toBe(true);
    expect(
      __captionBurnTestUtils.requiresCaptionImageOverlayForDesign(
        { captionDesign: customFineWeight },
        customFineWeight,
      ),
    ).toBe(true);
    expect(
      __captionBurnTestUtils.requiresCaptionImageOverlayForDesign(
        { captionDesign: customPanel },
        customPanel,
      ),
    ).toBe(true);
  });

  it("bounds static exact-design overlays and gracefully selects ASS above the cap", () => {
    const limit = __captionBurnTestUtils.MAX_STATIC_CAPTION_IMAGE_OVERLAY_CUES;
    expect(limit).toBeGreaterThanOrEqual(120);
    expect(limit).toBeLessThan(__captionBurnTestUtils.MAX_WORD_HIGHLIGHT_OVERLAY_CUES);
    expect(
      __captionBurnTestUtils.shouldUseStaticCaptionImageOverlay(true, limit),
    ).toBe(true);
    expect(
      __captionBurnTestUtils.shouldUseStaticCaptionImageOverlay(true, limit + 1),
    ).toBe(false);
    expect(
      __captionBurnTestUtils.shouldUseStaticCaptionImageOverlay(false, 12),
    ).toBe(false);
  });

  it("uses one-frame-per-second image inputs except for animated one-word pop", () => {
    const staticArgs = __captionBurnTestUtils.buildCaptionOverlayImageInputArgs(
      ["/tmp/one.png", "/tmp/two.png"],
    );
    expect(staticArgs).toEqual([
      "-loop", "1", "-framerate", "1", "-i", "/tmp/one.png",
      "-loop", "1", "-framerate", "1", "-i", "/tmp/two.png",
    ]);
    expect(
      __captionBurnTestUtils.buildCaptionOverlayImageInputArgs(
        ["/tmp/pop.png"],
        true,
        false,
      ),
    ).toEqual(["-loop", "1", "-framerate", "30", "-i", "/tmp/pop.png"]);
    expect(
      __captionBurnTestUtils.buildCaptionOverlayImageInputArgs(
        ["/tmp/reduced.png"],
        true,
        true,
      ),
    ).toEqual(["-loop", "1", "-framerate", "1", "-i", "/tmp/reduced.png"]);
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

  it("retains structurally valid exact word timings from saved Studio cues", () => {
    const [cue] = __captionBurnTestUtils.extractCaptionCueOverlays({
      cues: [{
        index: 1,
        startSeconds: 0.2,
        endSeconds: 1.8,
        text: "Grace wins",
        wordTimings: [
          { text: "Grace", startSeconds: 0.2, endSeconds: 0.75 },
          { text: "wins", startSeconds: 1.05, endSeconds: 1.8 },
        ],
      }],
    });

    expect(cue?.wordTimings).toEqual([
      { text: "Grace", startSeconds: 0.2, endSeconds: 0.75 },
      { text: "wins", startSeconds: 1.05, endSeconds: 1.8 },
    ]);
    expect(__captionBurnTestUtils.resolveMatchingCaptionWordTimings(cue!)).toHaveLength(2);
  });

  it("shifts every final caption cue by the saved Studio sync offset", () => {
    expect(__captionBurnTestUtils.shiftCaptionCueOverlays([
      { index: 1, startSeconds: 0.1, endSeconds: 0.8, text: "Early" },
      { index: 2, startSeconds: 1, endSeconds: 2, text: "On time" },
    ], -0.25)).toEqual([
      { index: 1, startSeconds: 0, endSeconds: 0.55, text: "Early" },
      { index: 2, startSeconds: 0.75, endSeconds: 1.75, text: "On time" },
    ]);

    expect(__captionBurnTestUtils.shiftCaptionCueOverlays([
      {
        index: 1,
        startSeconds: 1,
        endSeconds: 2,
        text: "Later",
        wordTimings: [{ text: "Later", startSeconds: 1.1, endSeconds: 1.9 }],
      },
    ], 0.2)).toEqual([
      {
        index: 1,
        startSeconds: 1.2,
        endSeconds: 2.2,
        text: "Later",
        wordTimings: [{ text: "Later", startSeconds: 1.3, endSeconds: 2.1 }],
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

  it("uses exact saved speech ranges for active-word overlays", () => {
    const overlays = __captionBurnTestUtils.expandCaptionCueWordHighlightOverlays([{
      index: 1,
      startSeconds: 0,
      endSeconds: 2,
      text: "Grace wins",
      wordTimings: [
        { text: "Grace", startSeconds: 0.1, endSeconds: 0.55 },
        { text: "wins", startSeconds: 1.15, endSeconds: 1.9 },
      ],
    }]);

    expect(overlays.map((overlay) => [overlay.startSeconds, overlay.endSeconds])).toEqual([
      [0.1, 0.55],
      [1.15, 1.9],
    ]);
  });

  it("expands multi-word cues into true one-word reveal overlays", () => {
    const overlays = __captionBurnTestUtils.expandCaptionCueSingleWordOverlays([{
      index: 1,
      startSeconds: 0,
      endSeconds: 3,
      text: "Grace wins today",
      wordTimings: [
        { text: "Grace", startSeconds: 0.1, endSeconds: 0.7 },
        { text: "wins", startSeconds: 1.1, endSeconds: 1.6 },
        { text: "today", startSeconds: 2.2, endSeconds: 2.9 },
      ],
    }]);

    expect(overlays.map((overlay) => overlay.text)).toEqual(["Grace", "wins", "today"]);
    expect(overlays.map((overlay) => [overlay.startSeconds, overlay.endSeconds])).toEqual([
      [0.1, 0.7],
      [1.1, 1.6],
      [2.2, 2.9],
    ]);
    expect(overlays.every((overlay) => overlay.activeWordIndex === undefined)).toBe(true);
  });

  it("builds an animated scale-and-fade graph for one-word pop exports", () => {
    const graph = __captionBurnTestUtils.buildCaptionOverlayFilterGraph(
      [{ index: 1, startSeconds: 1, endSeconds: 1.8, text: "Grace" }],
      "H-h-132",
      true,
    );

    expect(graph).toContain("scale=w=");
    expect(graph).toContain("fade=t=in");
    expect(graph).toContain("setpts=PTS+1.000/TB");
  });

  it("renders active words in the overlay SVG", () => {
    const svg = __captionBurnTestUtils.buildCaptionOverlaySvg({
      index: 1,
      startSeconds: 0,
      endSeconds: 2,
      text: "AND SO LIKE",
      activeWordIndex: 2,
    });

    expect(svg).toContain("#0F766E");
    expect(svg).toContain("LIKE");
  });

  it("renders active-word emphasis as a real padded box while preserving text outline", () => {
    const svg = __captionBurnTestUtils.buildCaptionOverlaySvg(
      {
        index: 1,
        startSeconds: 0,
        endSeconds: 2,
        text: "Faith moves mountains",
        activeWordIndex: 1,
      },
      undefined,
      "kinetic-pop",
    );
    const activeBox = svg.match(/<rect data-caption-active-word="true"[^>]*>/)?.[0];
    const activeTspan = svg.match(/<tspan[^>]*>[^<]*MOVES<\/tspan>/)?.[0];

    expect(activeBox).toBeDefined();
    expect(activeBox).toContain('fill="#FACC15"');
    expect(activeBox).toContain('fill-opacity="0.24"');
    expect(Number(activeBox?.match(/\bwidth="([0-9.]+)"/)?.[1])).toBeGreaterThan(20);
    expect(Number(activeBox?.match(/\bheight="([0-9.]+)"/)?.[1])).toBeGreaterThan(20);
    expect(Number(activeBox?.match(/\brx="([0-9.]+)"/)?.[1])).toBeGreaterThanOrEqual(4);
    expect(svg).toContain('stroke="#020617"');
    expect(activeTspan).not.toContain("stroke=");
  });

  it("fits the caption panel to its content inside the safe-width canvas", () => {
    const svg = __captionBurnTestUtils.buildCaptionOverlaySvg({
      index: 1,
      startSeconds: 0,
      endSeconds: 2,
      text: "Grace wins",
    });
    const canvasWidth = Number(svg.match(/<svg[^>]*\bwidth="([0-9.]+)"/)?.[1]);
    const canvasHeight = Number(svg.match(/<svg[^>]*\bheight="([0-9.]+)"/)?.[1]);
    const panel = svg.match(/<rect data-caption-panel="true"[^>]*>/)?.[0];
    const panelX = Number(panel?.match(/\bx="([0-9.]+)"/)?.[1]);
    const panelWidth = Number(panel?.match(/\bwidth="([0-9.]+)"/)?.[1]);

    expect(panel).toBeDefined();
    expect(panelX).toBeGreaterThan(0);
    expect(panelWidth).toBeGreaterThan(100);
    expect(panelWidth).toBeLessThan(canvasWidth);
    expect(panelX * 2 + panelWidth).toBeCloseTo(canvasWidth, 1);
    expect(canvasHeight).toBeGreaterThan(70);
    expect(canvasHeight).toBeLessThan(190);
  });

  it("preserves visible spacing between separately highlighted words", async () => {
    const svg = __captionBurnTestUtils.buildCaptionOverlaySvg({
      index: 1,
      startSeconds: 0,
      endSeconds: 2,
      text: "AND SO LIKE",
      activeWordIndex: 2,
    });
    const { element, openingTag } = extractFirstSvgTextElement(svg);
    const renderedWidth = await rasterizedSvgTextWidth(element);
    const referenceWidth = await rasterizedSvgTextWidth(`${openingTag}AND SO LIKE</text>`);

    // Ordinary leading spaces inside separate SVG tspans are collapsible. The
    // highlighted rendering must retain essentially the same phrase width as
    // one normal text run so words cannot appear jammed together in the video.
    expect(renderedWidth).toBeGreaterThanOrEqual(referenceWidth * 0.97);
  });

  it("splits oversized cues into readable windows without losing any spoken words", () => {
    const originalText = [
      "Grace", "meets", "us", "in", "the", "middle", "of", "our", "fear", "and",
      "reminds", "us", "that", "God", "is", "still", "present", "still", "working", "and",
      "still", "calling", "us", "forward", "with", "faith", "hope", "and", "courage",
    ].join(" ");
    const splitCues = __captionBurnTestUtils.splitCaptionCueOverlaysForLayout(
      [{ index: 1, startSeconds: 2, endSeconds: 16, text: originalText }],
      {
        fontScale: "large",
        maxLines: 2,
        uppercase: false,
        verticalOffset: 0,
      },
    );

    expect(splitCues.length).toBeGreaterThan(1);
    expect(splitCues.map((cue) => cue.text).join(" ")).toBe(originalText);
    expect(splitCues[0]?.startSeconds).toBe(2);
    expect(splitCues.at(-1)?.endSeconds).toBe(16);
    expect(splitCues.every((cue, index) => (
      cue.endSeconds > cue.startSeconds
      && (index === 0 || Math.abs(cue.startSeconds - splitCues[index - 1].endSeconds) < 0.002)
    ))).toBe(true);
  });

  it("never drops the spoken tail when a cue needs more than twenty semantic chunks", () => {
    const words = Array.from({ length: 220 }, (_, index) => `word${index + 1}`);
    const originalText = words.join(" ");
    const splitCues = __captionBurnTestUtils.splitCaptionCueOverlaysForLayout(
      [{ index: 1, startSeconds: 0, endSeconds: 110, text: originalText }],
      {
        fontScale: "large",
        maxLines: 2,
        uppercase: false,
        verticalOffset: 0,
      },
    );

    expect(splitCues.length).toBeGreaterThan(20);
    expect(splitCues.map((cue) => cue.text).join(" ")).toBe(originalText);
    expect(splitCues.at(-1)?.text).toContain("word220");
    expect(splitCues[0]?.startSeconds).toBe(0);
    expect(splitCues.at(-1)?.endSeconds).toBe(110);
  });

  it("raises lower captions when the saved safe area requires extra platform clearance", () => {
    const appearance = {
      fontScale: "regular" as const,
      maxLines: 3 as const,
      uppercase: false,
      verticalOffset: 0,
    };
    const marginFromExpression = (value: string) => Number(value.match(/H-h-(\d+)/)?.[1] ?? Number.NaN);
    const minimalMargin = marginFromExpression(
      __captionBurnTestUtils.captionOverlayYExpression("lower", appearance, "LOWER_MINIMAL"),
    );
    const standardMargin = marginFromExpression(
      __captionBurnTestUtils.captionOverlayYExpression("lower", appearance, "STANDARD"),
    );
    const raisedMargin = marginFromExpression(
      __captionBurnTestUtils.captionOverlayYExpression("lower", appearance, "RAISED"),
    );

    expect(Number.isFinite(minimalMargin)).toBe(true);
    expect(minimalMargin).toBeLessThan(standardMargin);
    expect(raisedMargin).toBeGreaterThan(standardMargin);
  });

  it("gives multiline caption SVGs enough line height and card height", () => {
    const svg = __captionBurnTestUtils.buildCaptionOverlaySvg(
      {
        index: 1,
        startSeconds: 0,
        endSeconds: 4,
        text: "Grace meets us here and reminds every weary heart that God is still present today",
      },
      {
        fontScale: "regular",
        maxLines: 4,
        uppercase: false,
        verticalOffset: 0,
      },
    );
    const svgHeight = Number(svg.match(/<svg[^>]*\bheight="(\d+)"/)?.[1] ?? Number.NaN);
    const textElements = svg.match(/<text\b[^>]*>/g) ?? [];
    const yPositions = textElements.map((element) => Number(element.match(/\by="(\d+)"/)?.[1] ?? Number.NaN));
    const fontSize = Number(textElements[0]?.match(/\bfont-size="(\d+)"/)?.[1] ?? Number.NaN);

    expect(yPositions.length).toBeGreaterThan(1);
    expect(yPositions.every(Number.isFinite)).toBe(true);
    expect(yPositions.slice(1).every((value, index) => value - yPositions[index] >= fontSize * 1.18)).toBe(true);
    expect(svgHeight - ((yPositions.at(-1) ?? 0) + fontSize)).toBeGreaterThanOrEqual(20);
  });

  it("renders each saved preset through the active-word burn path", () => {
    const cue = {
      index: 1,
      startSeconds: 0,
      endSeconds: 2,
      text: "hope rises again",
      activeWordIndex: 1,
    };
    const golden = __captionBurnTestUtils.buildCaptionOverlaySvg(cue, undefined, "golden-hour");
    const royal = __captionBurnTestUtils.buildCaptionOverlaySvg(cue, undefined, "royal-focus");

    expect(golden).toContain('fill="#1C1408"');
    expect(golden).toContain('fill="#FCD34D"');
    expect(royal).toContain('fill="#1E1338"');
    expect(royal).toContain('fill="#C4B5FD"');
    expect(golden).not.toBe(royal);
  });

  it("honors preset uppercase in the rendered overlay", () => {
    const svg = __captionBurnTestUtils.buildCaptionOverlaySvg(
      { index: 1, startSeconds: 0, endSeconds: 2, text: "keep the faith", activeWordIndex: 0 },
      undefined,
      "kinetic-pop",
    );

    expect(svg).toContain("KEEP");
    expect(svg).not.toContain("keep the faith");
    expect(
      __captionBurnTestUtils.formatCaptionOverlayText(
        "keep the faith",
        { fontScale: "regular", maxLines: 3, uppercase: false, verticalOffset: 0 },
        "kinetic-pop",
      ),
    ).toBe("KEEP THE FAITH");
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

  it("keeps canonical design tokens in parity across ASS and SVG export paths", () => {
    const design = normalizeCaptionDesignSettings({
      version: 1,
      presetId: "clean-lower",
      typography: {
        fontFamilyId: "elegant-serif",
        fontSizePx: 48,
        fontWeight: 700,
        italic: true,
        textCase: "lowercase",
        letterSpacingPx: 2,
        lineHeight: 1.4,
        wordSpacingPx: 6,
        alignment: "left",
      },
      colors: {
        textColor: "#123456",
        activeTextColor: "#ABCDEF",
        highlightBackgroundColor: "#010203",
      },
      background: {
        treatment: "rounded",
        color: "#112233",
        opacity: 0.8,
        borderColor: "#445566",
        borderOpacity: 0.7,
        borderWidthPx: 4,
        borderRadiusPx: 28,
        paddingX: 40,
        paddingY: 20,
      },
      readability: {
        outlineColor: "#FEDCBA",
        outlineWidthPx: 3,
        shadowColor: "#0A0B0C",
        shadowOpacity: 0.5,
        shadowBlurPx: 16,
        shadowOffsetX: 2,
        shadowOffsetY: 4,
      },
      highlighting: {
        intensity: "energetic",
        scale: 1.1,
        backgroundOpacity: 0.2,
        fontWeightBoost: 100,
        reducedMotion: false,
      },
      layout: {
        verticalPosition: "top",
        horizontalPosition: "left",
        horizontalOffset: 32,
        verticalOffset: 18,
        safeWidth: "wide",
        maxLines: 2,
      },
    });
    const forceStyle = __captionBurnTestUtils.buildCaptionForceStyle(
      design.presetId,
      "STANDARD",
      "lower",
      undefined,
      design,
    );
    const svg = __captionBurnTestUtils.buildCaptionOverlaySvg(
      {
        index: 1,
        startSeconds: 0,
        endSeconds: 2,
        text: "Grace Leads",
        activeWordIndex: 0,
      },
      undefined,
      design.presetId,
      design,
    );

    expect(forceStyle).toContain("FontName=DejaVu Serif");
    expect(forceStyle).toContain("FontSize=30");
    expect(forceStyle).toContain("Italic=-1");
    expect(forceStyle).toContain("Spacing=2");
    expect(forceStyle).toContain("PrimaryColour=&H00563412");
    expect(forceStyle).toContain("BackColour=&H33332211");
    expect(forceStyle).toContain("OutlineColour=&H00BADCFE");
    expect(forceStyle).toContain("Alignment=7");
    expect(forceStyle).toContain("MarginL=86");
    expect(forceStyle).toContain("MarginR=22");
    expect(forceStyle).toContain("MarginV=64");

    expect(svg).toContain('width="972"');
    expect(svg).toContain('font-family="DejaVu Serif, DejaVu Serif"');
    expect(svg).toContain('font-size="48"');
    expect(svg).toContain('font-style="italic"');
    expect(svg).toContain('<rect data-caption-panel="true" x="0"');
    expect(svg).toContain('fill="#112233"');
    expect(svg).toContain('stroke="#445566"');
    expect(svg).toContain('fill="#ABCDEF"');
    expect(svg).toContain('text-anchor="start"');
    expect(svg).toContain("grace");
    expect(svg).not.toContain("Grace Leads");
    expect(__captionBurnTestUtils.captionOverlayXExpression(design)).toBe(
      "max(24\\,min(W-w-24\\,W*0.05+32))",
    );
    expect(__captionBurnTestUtils.captionOverlayXExpression({
      ...design,
      layout: {
        ...design.layout,
        horizontalPosition: "right",
        horizontalOffset: -20,
      },
    })).toBe("max(24\\,min(W-w-24\\,W-w-W*0.05-20))");
    expect(
      __captionBurnTestUtils.captionOverlayYExpression(
        undefined,
        undefined,
        "STANDARD",
        design,
      ),
    ).toBe("114");
  });

  it("preserves accessible emphasis while reduced motion suppresses pop animation", () => {
    const design = normalizeCaptionDesignSettings({
      version: 1,
      presetId: "kinetic-pop",
      highlighting: {
        intensity: "maximum",
        scale: 1.2,
        backgroundOpacity: 0.3,
        fontWeightBoost: 100,
        reducedMotion: true,
      },
    });
    const cue = {
      index: 1,
      startSeconds: 1,
      endSeconds: 1.8,
      text: "Grace wins",
      activeWordIndex: 0,
    };
    const svg = __captionBurnTestUtils.buildCaptionOverlaySvg(
      cue,
      undefined,
      design.presetId,
      design,
    );
    const graph = __captionBurnTestUtils.buildCaptionOverlayFilterGraph(
      [cue],
      "H-h-132",
      true,
      true,
    );

    expect(svg).toContain('fill="#FACC15"');
    expect(svg).toContain('font-size="44"');
    expect(svg).not.toContain('font-size="53"');
    expect(graph).not.toContain("scale=w=");
    expect(graph).not.toContain("fade=t=in");
    expect(graph).toContain("between(t,1.000,1.800)");
  });

  it("splits long export cues semantically without breaking references or speaker names", () => {
    const text = [
      "We", "remember", "the", "promise", "of", "John", "3:16", "because",
      "Pastor", "Thabang", "Ngwenya", "teaches", "that", "God", "still", "loves",
      "the", "world", "and", "calls", "every", "person", "toward", "hope",
    ].join(" ");
    const design = normalizeCaptionDesignSettings({
      version: 1,
      presetId: "high-contrast",
      typography: { fontSizePx: 64 },
      layout: { safeWidth: "narrow", maxLines: 2 },
    });
    const splitCues = __captionBurnTestUtils.splitCaptionCueOverlaysForLayout(
      [{ index: 1, startSeconds: 2, endSeconds: 14, text }],
      undefined,
      design,
    );

    expect(splitCues.length).toBeGreaterThan(1);
    expect(splitCues.map((cue) => cue.text).join(" ")).toBe(text);
    expect(splitCues.some((cue) => cue.text.endsWith("John"))).toBe(false);
    expect(splitCues.some((cue) => cue.text.startsWith("3:16"))).toBe(false);
    expect(splitCues.some((cue) => /(?:Pastor|Pastor Thabang)$/.test(cue.text))).toBe(false);
    expect(splitCues.some((cue) => /^(?:Thabang|Ngwenya)\b/.test(cue.text))).toBe(false);
    expect(splitCues[0]?.startSeconds).toBe(2);
    expect(splitCues.at(-1)?.endSeconds).toBe(14);
    expect(splitCues.every((cue, index) => (
      cue.endSeconds > cue.startSeconds
      && (index === 0 || cue.startSeconds === splitCues[index - 1]?.endSeconds)
    ))).toBe(true);
  });
});
