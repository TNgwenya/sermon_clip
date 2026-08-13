import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { __clipExportTestUtils } from "../clipExportService";

type PassthroughInput = Parameters<
  typeof __clipExportTestUtils.decidePreparedExportPassthrough
>[0];

function compatiblePassthroughInput(
  overrides: Partial<PassthroughInput> = {},
): PassthroughInput {
  return {
    format: "VERTICAL_9_16",
    sourceKind: "PREPARED_OVERLAY",
    sourcePath: "/tmp/overlay.mp4",
    outputPath: "/tmp/final-export.mp4",
    trim: undefined,
    hasAdditionalBrandingOverlay: false,
    framing: {
      shouldApplyFraming: false,
      framingAlreadyApplied: true,
      preserveWithSafeFit: false,
    },
    provenance: {
      verified: true,
      reason: "Exact active-plan artifact.",
      expectedDurationSeconds: 71.351,
    },
    probe: {
      formatNames: ["mov", "mp4"],
      durationSeconds: 71.351,
      startTimeSeconds: 0,
      streams: [
        {
          index: 0,
          codecType: "video",
          codecName: "h264",
          width: 1080,
          height: 1920,
          pixelFormat: "yuv420p",
          sampleAspectRatio: "1:1",
          startTimeSeconds: 0,
          rotationDegrees: 0,
        },
        {
          index: 1,
          codecType: "audio",
          codecName: "aac",
          width: null,
          height: null,
          pixelFormat: null,
          sampleAspectRatio: null,
          startTimeSeconds: 0,
          rotationDegrees: 0,
        },
      ],
    },
    ...overrides,
  };
}

describe("clip export service", () => {
  it("rejects export before render is completed", () => {
    const result = __clipExportTestUtils.validateExportEligibility({
      clip: {
        id: "clip-1",
        sermonId: "sermon-1",
        status: "APPROVED",
        startTimeSeconds: 10,
        endTimeSeconds: 70,
        adjustedStartTimeSeconds: null,
        adjustedEndTimeSeconds: null,
        renderStatus: "NOT_RENDERED",
        renderedFilePath: null,
        captionBurnStatus: "NOT_BURNED",
        captionedVideoPath: null,
        overlayStatus: "NOT_RENDERED",
        overlayVideoPath: null,
        exportStatus: "NOT_EXPORTED",
        exportFreshness: "NEEDS_REGENERATION",
        exportFormat: null,
      },
      sourcePath: null,
      sourceExists: false,
      format: "VERTICAL_9_16",
      allowReexport: false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("rendered before export");
  });

  it("accepts vertical export when rendered clip is valid", () => {
    const result = __clipExportTestUtils.validateExportEligibility({
      clip: {
        id: "clip-1",
        sermonId: "sermon-1",
        status: "EXPORTED",
        startTimeSeconds: 10,
        endTimeSeconds: 70,
        adjustedStartTimeSeconds: null,
        adjustedEndTimeSeconds: null,
        renderStatus: "COMPLETED",
        renderedFilePath: "/tmp/rendered.mp4",
        captionBurnStatus: "NOT_BURNED",
        captionedVideoPath: null,
        overlayStatus: "NOT_RENDERED",
        overlayVideoPath: null,
        exportStatus: "NOT_EXPORTED",
        exportFreshness: "NEEDS_REGENERATION",
        exportFormat: null,
      },
      sourcePath: "/tmp/rendered.mp4",
      sourceExists: true,
      format: "VERTICAL_9_16",
      allowReexport: false,
    });

    expect(result.ok).toBe(true);
  });

  it("blocks export while transcript review is still required", () => {
    const result = __clipExportTestUtils.validateExportEligibility({
      clip: {
        id: "clip-1",
        sermonId: "sermon-1",
        status: "APPROVED",
        startTimeSeconds: 10,
        endTimeSeconds: 70,
        adjustedStartTimeSeconds: null,
        adjustedEndTimeSeconds: null,
        renderStatus: "COMPLETED",
        renderedFilePath: "/tmp/rendered.mp4",
        captionBurnStatus: "NOT_BURNED",
        captionedVideoPath: null,
        overlayStatus: "NOT_RENDERED",
        overlayVideoPath: null,
        exportStatus: "NOT_EXPORTED",
        exportFreshness: "NEEDS_REGENERATION",
        exportFormat: null,
        transcriptSafetyStatus: "REVIEW_REQUIRED",
      },
      sourcePath: "/tmp/rendered.mp4",
      sourceExists: true,
      format: "VERTICAL_9_16",
      allowReexport: false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("confirm the transcript wording");
    expect(result.shouldMarkFailed).toBe(false);
  });

  it("rejects missing rendered clip source", () => {
    const result = __clipExportTestUtils.validateExportEligibility({
      clip: {
        id: "clip-1",
        sermonId: "sermon-1",
        status: "EXPORTED",
        startTimeSeconds: 10,
        endTimeSeconds: 70,
        adjustedStartTimeSeconds: null,
        adjustedEndTimeSeconds: null,
        renderStatus: "COMPLETED",
        renderedFilePath: null,
        captionBurnStatus: "NOT_BURNED",
        captionedVideoPath: null,
        overlayStatus: "NOT_RENDERED",
        overlayVideoPath: null,
        exportStatus: "NOT_EXPORTED",
        exportFreshness: "NEEDS_REGENERATION",
        exportFormat: null,
      },
      sourcePath: null,
      sourceExists: false,
      format: "VERTICAL_9_16",
      allowReexport: false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Rendered clip file does not exist");
  });

  it("blocks duplicate export while export is in progress", () => {
    const result = __clipExportTestUtils.validateExportEligibility({
      clip: {
        id: "clip-1",
        sermonId: "sermon-1",
        status: "EXPORTED",
        startTimeSeconds: 10,
        endTimeSeconds: 70,
        adjustedStartTimeSeconds: null,
        adjustedEndTimeSeconds: null,
        renderStatus: "COMPLETED",
        renderedFilePath: "/tmp/rendered.mp4",
        captionBurnStatus: "NOT_BURNED",
        captionedVideoPath: null,
        overlayStatus: "NOT_RENDERED",
        overlayVideoPath: null,
        exportStatus: "EXPORTING",
        exportFreshness: "NEEDS_REGENERATION",
        exportFormat: "VERTICAL_9_16",
      },
      sourcePath: "/tmp/rendered.mp4",
      sourceExists: true,
      format: "VERTICAL_9_16",
      allowReexport: false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("already in progress");
    expect(result.shouldMarkFailed).toBe(false);
  });

  it("allows a completed export to be rebuilt after its freshness is invalidated", () => {
    const result = __clipExportTestUtils.validateExportEligibility({
      clip: {
        renderStatus: "COMPLETED",
        exportStatus: "COMPLETED",
        exportFreshness: "OUTDATED",
        exportFormat: "VERTICAL_9_16",
      },
      sourcePath: "/tmp/rendered.mp4",
      sourceExists: true,
      format: "VERTICAL_9_16",
      allowReexport: false,
    });

    expect(result.ok).toBe(true);
  });

  it("marks missing prepared export source as a real failure", () => {
    const result = __clipExportTestUtils.validateExportEligibility({
      clip: {
        id: "clip-1",
        sermonId: "sermon-1",
        status: "EXPORTED",
        startTimeSeconds: 10,
        endTimeSeconds: 70,
        adjustedStartTimeSeconds: null,
        adjustedEndTimeSeconds: null,
        renderStatus: "COMPLETED",
        renderedFilePath: "/tmp/rendered.mp4",
        captionBurnStatus: "NOT_BURNED",
        captionedVideoPath: null,
        overlayStatus: "NOT_RENDERED",
        overlayVideoPath: null,
        exportStatus: "NOT_EXPORTED",
        exportFreshness: "NEEDS_REGENERATION",
        exportFormat: null,
      },
      sourcePath: "/tmp/rendered.mp4",
      sourceExists: false,
      format: "VERTICAL_9_16",
      allowReexport: false,
    });

    expect(result.ok).toBe(false);
    expect(result.shouldMarkFailed).toBe(true);
  });

  it("uses Apple hardware encoder arguments for export when requested", () => {
    const args = __clipExportTestUtils.buildVideoEncoderArgs("h264_videotoolbox");

    expect(args).toContain("h264_videotoolbox");
    expect(args).toContain("-allow_sw");
  });

  it("creates export metadata with expected fields", () => {
    const metadata = __clipExportTestUtils.buildExportMetadata({
      format: "VERTICAL_9_16",
      layout: "CENTER_CROP",
      outputPath: "/tmp/clip-vertical.mp4",
    });

    expect(metadata.exportStatus).toBe("COMPLETED");
    expect(metadata.exportFormat).toBe("VERTICAL_9_16");
    expect(metadata.exportLayoutStrategy).toBe("CENTER_CROP");
    expect(metadata.exportedFilePath).toBe("/tmp/clip-vertical.mp4");
    expect(metadata.exportPath).toBe("/tmp/clip-vertical.mp4");
    expect(metadata.exportedAt).toBeInstanceOf(Date);
  });

  it("prefers overlay prepared output as final export source", () => {
    const source = __clipExportTestUtils.resolvePreparedExportSource({
      renderStatus: "COMPLETED",
      renderFreshness: "UP_TO_DATE",
      renderedFilePath: "/tmp/rendered.mp4",
      captionBurnStatus: "COMPLETED",
      captionBurnFreshness: "UP_TO_DATE",
      captionedVideoPath: "/tmp/captioned.mp4",
      overlayStatus: "COMPLETED",
      overlayFreshness: "UP_TO_DATE",
      overlayVideoPath: "/tmp/overlay.mp4",
      captionData: { applyCaptionsToClip: true },
    });

    expect(source).toBe("/tmp/overlay.mp4");
  });

  it.each([
    ["the default caption setting", null],
    ["captions explicitly enabled", { applyCaptionsToClip: true }],
  ])("rejects raw export when using %s without a current captioned source", async (_label, captionData) => {
    await expect(__clipExportTestUtils.resolveBestExportSource({
      renderStatus: "COMPLETED",
      renderFreshness: "UP_TO_DATE",
      renderedFilePath: "/tmp/rendered.mp4",
      captionBurnStatus: "NOT_BURNED",
      captionBurnFreshness: "NEEDS_REGENERATION",
      captionedVideoPath: null,
      overlayStatus: "NOT_RENDERED",
      overlayFreshness: "NEEDS_REGENERATION",
      overlayVideoPath: null,
      captionData,
      sermonId: "sermon-1",
      sermon: null,
      startTimeSeconds: 10,
      endTimeSeconds: 70,
      adjustedStartTimeSeconds: null,
      adjustedEndTimeSeconds: null,
    } as unknown as Parameters<typeof __clipExportTestUtils.resolveBestExportSource>[0])).rejects.toThrow(
      "Captions are enabled",
    );
  });

  it("rejects a stale raw render instead of treating it as an export source", async () => {
    await expect(__clipExportTestUtils.resolveBestExportSource({
      renderStatus: "COMPLETED",
      renderFreshness: "OUTDATED",
      renderedFilePath: "/tmp/stale-render.mp4",
      captionBurnStatus: "NOT_BURNED",
      captionBurnFreshness: "UP_TO_DATE",
      captionedVideoPath: null,
      overlayStatus: "NOT_RENDERED",
      overlayFreshness: "NEEDS_REGENERATION",
      overlayVideoPath: null,
      captionData: { applyCaptionsToClip: false },
      sermonId: "sermon-1",
      sermon: null,
      startTimeSeconds: 10,
      endTimeSeconds: 70,
      adjustedStartTimeSeconds: null,
      adjustedEndTimeSeconds: null,
    } as unknown as Parameters<typeof __clipExportTestUtils.resolveBestExportSource>[0])).rejects.toThrow(
      "prepared render is stale or incomplete",
    );
  });

  it("rejects a stale completed overlay instead of exporting it or silently dropping branding", async () => {
    await expect(__clipExportTestUtils.resolveBestExportSource({
      renderedFilePath: "/tmp/rendered.mp4",
      captionBurnStatus: "COMPLETED",
      captionBurnFreshness: "UP_TO_DATE",
      captionedVideoPath: "/tmp/captioned.mp4",
      overlayStatus: "COMPLETED",
      overlayFreshness: "OUTDATED",
      overlayVideoPath: "/tmp/stale-overlay.mp4",
      captionData: null,
      sermonId: "sermon-1",
      sermon: null,
      startTimeSeconds: 10,
      endTimeSeconds: 70,
      adjustedStartTimeSeconds: null,
      adjustedEndTimeSeconds: null,
    } as unknown as Parameters<typeof __clipExportTestUtils.resolveBestExportSource>[0])).rejects.toThrow(
      "prepared overlay is stale or incomplete",
    );
  });

  it("fails closed when approved hook, B-roll, or branding layers have no prepared overlay", async () => {
    await expect(__clipExportTestUtils.resolveBestExportSource({
      renderedFilePath: "/tmp/rendered.mp4",
      renderStatus: "COMPLETED",
      renderFreshness: "UP_TO_DATE",
      captionBurnStatus: "COMPLETED",
      captionBurnFreshness: "UP_TO_DATE",
      captionedVideoPath: "/tmp/captioned.mp4",
      overlayStatus: "NOT_RENDERED",
      overlayFreshness: "NEEDS_REGENERATION",
      overlayVideoPath: null,
      captionData: {
        applyCaptionsToClip: true,
        hookOverlay: {
          enabled: true,
          text: "Run your race",
        },
      },
      sermonId: "sermon-1",
      sermon: null,
      startTimeSeconds: 10,
      endTimeSeconds: 70,
      adjustedStartTimeSeconds: null,
      adjustedEndTimeSeconds: null,
    } as unknown as Parameters<typeof __clipExportTestUtils.resolveBestExportSource>[0])).rejects.toThrow(
      "approved hook, B-roll, or branding layers",
    );
  });

  it("rejects a stale captioned source instead of exporting it or silently dropping captions", async () => {
    await expect(__clipExportTestUtils.resolveBestExportSource({
      renderedFilePath: "/tmp/rendered.mp4",
      captionBurnStatus: "COMPLETED",
      captionBurnFreshness: "OUTDATED",
      captionedVideoPath: "/tmp/stale-captioned.mp4",
      overlayStatus: "NOT_RENDERED",
      overlayFreshness: "NEEDS_REGENERATION",
      overlayVideoPath: null,
      captionData: null,
      sermonId: "sermon-1",
      sermon: null,
      startTimeSeconds: 10,
      endTimeSeconds: 70,
      adjustedStartTimeSeconds: null,
      adjustedEndTimeSeconds: null,
    } as unknown as Parameters<typeof __clipExportTestUtils.resolveBestExportSource>[0])).rejects.toThrow(
      "prepared captioned video is stale or incomplete",
    );
  });

  it("prefers the original sermon source for final export when no prepared visual layers or cleanup would be lost", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "clip-export-source-"));
    try {
      const originalSourcePath = path.join(tempDir, "source.mp4");
      const sermonId = `sermon-${path.basename(tempDir)}`;
      await writeFile(originalSourcePath, "source-video");

      const selection = await __clipExportTestUtils.resolveBestExportSource({
        id: "clip-1",
        title: "Clip",
        hook: null,
        caption: null,
        transcriptText: "Transcript",
        smartClipCategory: null,
        ministryValue: null,
        emotionalImpactScore: 8,
        hookStrengthScore: 8,
        shareabilityScore: 8,
        manualCropKeyframes: null,
        captionData: { applyCaptionsToClip: false },
        sermonId,
        status: "APPROVED",
        startTimeSeconds: 10,
        endTimeSeconds: 70,
        adjustedStartTimeSeconds: 12,
        adjustedEndTimeSeconds: 68,
        renderStatus: "COMPLETED",
        renderFreshness: "UP_TO_DATE",
        renderedFilePath: path.join(tempDir, "rendered.mp4"),
        captionBurnStatus: "NOT_BURNED",
        captionBurnFreshness: "UP_TO_DATE",
        captionedVideoPath: null,
        overlayStatus: "NOT_RENDERED",
        overlayFreshness: "NEEDS_REGENERATION",
        overlayVideoPath: null,
        exportStatus: "NOT_EXPORTED",
        exportFreshness: "NEEDS_REGENERATION",
        exportFormat: null,
        transcriptSafetyStatus: "TRUSTED",
        sermon: {
          title: "Sermon",
          speakerName: "Pastor",
          sermonDate: null,
          sourceVideoPath: originalSourcePath,
        },
      } as unknown as Parameters<typeof __clipExportTestUtils.resolveBestExportSource>[0]);

      expect(selection.kind).toBe("ORIGINAL_SERMON");
      expect(selection.sourcePath).toBe(originalSourcePath);
      expect(selection.trim).toEqual({ startTimeSeconds: 12, endTimeSeconds: 68 });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps prepared captioned output so final export does not lose approved captions", async () => {
    const selection = await __clipExportTestUtils.resolveBestExportSource({
      renderStatus: "COMPLETED",
      renderFreshness: "UP_TO_DATE",
      renderedFilePath: "/tmp/rendered.mp4",
      captionBurnStatus: "COMPLETED",
      captionBurnFreshness: "UP_TO_DATE",
      captionedVideoPath: "/tmp/captioned.mp4",
      overlayStatus: "NOT_RENDERED",
      overlayFreshness: "NEEDS_REGENERATION",
      overlayVideoPath: null,
      captionData: { applyCaptionsToClip: true },
      sermonId: "sermon-1",
      sermon: { sourceVideoPath: "/tmp/source.mp4", title: "Sermon", speakerName: "Pastor", sermonDate: null },
      startTimeSeconds: 10,
      endTimeSeconds: 70,
      adjustedStartTimeSeconds: null,
      adjustedEndTimeSeconds: null,
    } as unknown as Parameters<typeof __clipExportTestUtils.resolveBestExportSource>[0]);

    expect(selection.kind).toBe("PREPARED_CAPTIONED");
    expect(selection.sourcePath).toBe("/tmp/captioned.mp4");
    expect(selection.trim).toBeUndefined();
  });

  it("keeps prepared rendered output when speech cleanup changed the approved cut plan", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "clip-export-cleanup-"));
    try {
      const originalSourcePath = path.join(tempDir, "source.mp4");
      const sermonId = `sermon-${path.basename(tempDir)}`;
      await writeFile(originalSourcePath, "source-video");

      const selection = await __clipExportTestUtils.resolveBestExportSource({
        renderStatus: "COMPLETED",
        renderFreshness: "UP_TO_DATE",
        renderedFilePath: "/tmp/rendered.mp4",
        captionBurnStatus: "NOT_BURNED",
        captionBurnFreshness: "UP_TO_DATE",
        captionedVideoPath: null,
        overlayStatus: "NOT_RENDERED",
        overlayFreshness: "NEEDS_REGENERATION",
        overlayVideoPath: null,
        captionData: {
          applyCaptionsToClip: false,
          speechCleanupPlan: {
            enabled: true,
            sourceStartSeconds: 1,
            sourceEndSeconds: 30,
            cleanedDurationSeconds: 28,
            cuts: [{ startSeconds: 12, endSeconds: 14, removedSeconds: 2 }],
          },
        },
        sermonId,
        sermon: { sourceVideoPath: originalSourcePath, title: "Sermon", speakerName: "Pastor", sermonDate: null },
        startTimeSeconds: 10,
        endTimeSeconds: 70,
        adjustedStartTimeSeconds: null,
        adjustedEndTimeSeconds: null,
      } as unknown as Parameters<typeof __clipExportTestUtils.resolveBestExportSource>[0]);

      expect(selection.kind).toBe("PREPARED_RENDERED");
      expect(selection.sourcePath).toBe("/tmp/rendered.mp4");
      expect(selection.reason).toContain("speech cleanup");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("builds center-crop filter for vertical 9:16", () => {
    const filter = __clipExportTestUtils.buildVideoFilter(
      { format: "VERTICAL_9_16", width: 1080, height: 1920 },
      "CENTER_CROP",
    );

    expect(filter).toContain("crop=1080:1920");
    expect(filter).toContain("format=yuv420p");
  });

  it("preserves manual framing already baked into a prepared vertical master", () => {
    expect(__clipExportTestUtils.shouldPreservePreparedManualFraming({
      format: "VERTICAL_9_16",
      sourceKind: "PREPARED_OVERLAY",
      hasManualCrop: true,
    })).toBe(true);

    expect(__clipExportTestUtils.shouldPreservePreparedManualFraming({
      format: "VERTICAL_9_16",
      sourceKind: "ORIGINAL_SERMON",
      hasManualCrop: true,
    })).toBe(false);

    expect(__clipExportTestUtils.shouldPreservePreparedManualFraming({
      format: "SQUARE_1_1",
      sourceKind: "PREPARED_RENDERED",
      hasManualCrop: true,
    })).toBe(false);
  });

  it("uses safe full-frame fit for non-vertical exports with prepared captions or artwork", () => {
    expect(__clipExportTestUtils.shouldUseSafePreparedVisualFit({
      format: "HORIZONTAL_16_9",
      sourceKind: "PREPARED_CAPTIONED",
    })).toBe(true);
    expect(__clipExportTestUtils.shouldUseSafePreparedVisualFit({
      format: "SQUARE_1_1",
      sourceKind: "PREPARED_OVERLAY",
    })).toBe(true);
    expect(__clipExportTestUtils.shouldUseSafePreparedVisualFit({
      format: "VERTICAL_9_16",
      sourceKind: "PREPARED_OVERLAY",
    })).toBe(false);
    expect(__clipExportTestUtils.shouldUseSafePreparedVisualFit({
      format: "HORIZONTAL_16_9",
      sourceKind: "ORIGINAL_SERMON",
    })).toBe(false);
  });

  it("passes persisted vertical center and zoom into direct smart-crop exports", () => {
    const filter = __clipExportTestUtils.buildVideoFilter(
      { format: "VERTICAL_9_16", width: 1080, height: 1920 },
      "SMART_CROP",
      {
        sourceWidth: 1920,
        sourceHeight: 1080,
        subjectCenterX: 0.5,
        subjectCenterY: 0.58,
        zoom: 1.08,
      },
    );

    expect(filter).toContain("scale=3686:2074");
    expect(filter).toContain(":154,setsar=1");
  });

  it("builds left-focus filter for horizontal output", () => {
    const filter = __clipExportTestUtils.buildVideoFilter(
      { format: "HORIZONTAL_16_9", width: 1920, height: 1080 },
      "LEFT_FOCUS",
    );

    expect(filter).toContain("crop=1920:1080:0:0");
  });

  it("builds right-focus filter for horizontal output", () => {
    const filter = __clipExportTestUtils.buildVideoFilter(
      { format: "HORIZONTAL_16_9", width: 1920, height: 1080 },
      "RIGHT_FOCUS",
    );

    expect(filter).toContain("crop=1920:1080:iw-ow:0");
  });

  it("constrains blurred backgrounds to the exact horizontal export frame", () => {
    const filter = __clipExportTestUtils.buildVideoFilter(
      { format: "HORIZONTAL_16_9", width: 1920, height: 1080 },
      "FIT_BLURRED_BACKGROUND",
    );

    expect(filter).toContain("force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,boxblur=20:1[bg]");
    expect(filter).toContain("overlay=(W-w)/2:(H-h)/2,scale=1920:1080,setsar=1,format=yuv420p[v]");
    expect(filter).not.toContain("boxblur=20:1[bg];[0:v]scale=1920:1080:force_original_aspect_ratio=decrease[fg]");
  });

  it("flags risky smart-crop filters before FFmpeg export", () => {
    const riskyFilter = `crop=1080:1920:${"if(lte(t,1),".repeat(11)}0${")".repeat(11)}:0,format=yuv420p[v]`;

    expect(__clipExportTestUtils.getSmartCropFilterRiskReason(riskyFilter)).toContain("too many moving crop points");
  });

  it("accepts compact smart-crop filters for FFmpeg export", () => {
    const compactFilter = __clipExportTestUtils.buildVideoFilter(
      { format: "VERTICAL_9_16", width: 1080, height: 1920 },
      "SMART_CROP",
      {
        sourceWidth: 1920,
        sourceHeight: 1080,
        subjectCenterX: 0.5,
        subjectCenters: [
          { timeSeconds: 0, centerX: 0.45, confidence: 0.9 },
          { timeSeconds: 3, centerX: 0.55, confidence: 0.9 },
        ],
      },
    );

    expect(__clipExportTestUtils.getSmartCropFilterRiskReason(compactFilter)).toBeNull();
  });

  it("resolves versioned output path when reexporting", () => {
    const outputPath = __clipExportTestUtils.resolveOutputPath({
      sermonId: "sermon-1",
      clipId: "clip-1",
      clipTitle: "Stirring Up Your Gift",
      format: "VERTICAL_9_16",
      allowReexport: true,
      force: true,
      versionTag: "v2-20260618",
    });

    expect(outputPath).toContain("stirring-up-your-gift_clip-1-vertical-9x16-v2-20260618.mp4");
  });

  it("uses readable clip titles plus a short id for final export filenames", () => {
    const outputPath = __clipExportTestUtils.resolveOutputPath({
      sermonId: "sermon-1",
      clipId: "cmqocinhi02748oqo6ku2gj88",
      clipTitle: "God Meets You There",
      format: "SQUARE_1_1",
      allowReexport: false,
      force: false,
    });

    expect(outputPath).toContain("god-meets-you-there_cmqocinh-square-1x1.mp4");
  });

  it("places new exports inside a pastor-facing sermon folder when sermon metadata is available", () => {
    const outputPath = __clipExportTestUtils.resolveOutputPath({
      sermonId: "sermon-1",
      clipId: "cmqocinhi02748oqo6ku2gj88",
      clipTitle: "Use What God Placed In Your Hand",
      clipDescription: "A calling and gift stewardship moment",
      sermonTitle: "Stirring Up Your Gift",
      speakerName: "Pastor Melusi",
      sermonDate: "2026-06-21",
      format: "VERTICAL_9_16",
      allowReexport: false,
      force: false,
    });

    expect(outputPath).toContain(
      path.join(
        "exports",
        "stirring-up-your-gift_pastor-melusi_2026-06-21",
        "use-what-god-placed-in-your-hand_cmqocinh-vertical-9x16.mp4",
      ),
    );
  });

  it("does not treat empty exported video files as reusable media", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "export-empty-"));
    try {
      const exportPath = path.join(directory, "clip-export.mp4");
      await writeFile(exportPath, "");

      await expect(__clipExportTestUtils.fileHasBytes(exportPath)).resolves.toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts non-empty exported video files for reuse", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "export-ready-"));
    try {
      const exportPath = path.join(directory, "clip-export.mp4");
      await writeFile(exportPath, "video-bytes");

      await expect(__clipExportTestUtils.fileHasBytes(exportPath)).resolves.toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reuses an export only when its artifact carries the exact resolved framing identity", () => {
    expect(__clipExportTestUtils.artifactMatchesResolvedFramingPlan(
      { resolvedFramingPlanHash: "framing-v3" },
      "framing-v3",
    )).toBe(true);
    expect(__clipExportTestUtils.artifactMatchesResolvedFramingPlan(
      { resolvedFramingPlanHash: "framing-v2" },
      "framing-v3",
    )).toBe(false);
    expect(__clipExportTestUtils.artifactMatchesResolvedFramingPlan(
      null,
      "framing-v3",
    )).toBe(false);
  });

  it("uses a lossless final copy only for an exact compatible prepared portrait master", () => {
    const decision = __clipExportTestUtils.decidePreparedExportPassthrough(
      compatiblePassthroughInput(),
    );

    expect(decision).toMatchObject({
      eligible: true,
      unsafeSource: false,
    });
  });

  it("verifies prepared overlay provenance against both the active source and framing artifact", () => {
    const provenance = __clipExportTestUtils.decidePreparedExportProvenance({
      sourceArtifactKind: "OVERLAY",
      sourcePath: "/tmp/overlay.mp4",
      resolvedFramingPlanHash: "framing-v3",
      artifacts: [
        {
          kind: "OVERLAY",
          filePath: "/tmp/overlay.mp4",
          durationSeconds: null,
          metadataJson: { resolvedFramingPlanHash: "framing-v3" },
        },
        {
          kind: "RENDERED_SOURCE",
          filePath: "/tmp/rendered.mp4",
          durationSeconds: 71.351,
          metadataJson: { resolvedFramingPlanHash: "framing-v3" },
        },
      ],
    });

    expect(provenance).toEqual({
      verified: true,
      reason: expect.stringContaining("active Studio revision"),
      expectedDurationSeconds: 71.351,
    });
  });

  it("lets captioned provenance inherit exact framing identity only from the same-plan base artifact", () => {
    const valid = __clipExportTestUtils.decidePreparedExportProvenance({
      sourceArtifactKind: "CAPTIONED",
      sourcePath: "/tmp/captioned.mp4",
      resolvedFramingPlanHash: "framing-v3",
      artifacts: [
        {
          kind: "CAPTIONED",
          filePath: "/tmp/captioned.mp4",
          durationSeconds: null,
          metadataJson: { captionStylePresetId: "clean-lower" },
        },
        {
          kind: "RENDERED_SOURCE",
          filePath: "/tmp/rendered.mp4",
          durationSeconds: 71.351,
          metadataJson: { resolvedFramingPlanHash: "framing-v3" },
        },
      ],
    });
    const staleFraming = __clipExportTestUtils.decidePreparedExportProvenance({
      sourceArtifactKind: "CAPTIONED",
      sourcePath: "/tmp/captioned.mp4",
      resolvedFramingPlanHash: "framing-v3",
      artifacts: [
        {
          kind: "CAPTIONED",
          filePath: "/tmp/captioned.mp4",
          durationSeconds: null,
          metadataJson: {},
        },
        {
          kind: "RENDERED_SOURCE",
          filePath: "/tmp/rendered.mp4",
          durationSeconds: 71.351,
          metadataJson: { resolvedFramingPlanHash: "framing-v2" },
        },
      ],
    });

    expect(valid.verified).toBe(true);
    expect(staleFraming.verified).toBe(false);
  });

  it.each([
    ["original sermon source", { sourceKind: "ORIGINAL_SERMON" as const }],
    ["non-vertical output", { format: "SQUARE_1_1" as const }],
    ["remaining trim", { trim: { startTimeSeconds: 10, endTimeSeconds: 70 } }],
    ["additional branding", { hasAdditionalBrandingOverlay: true }],
    ["remaining framing", {
      framing: {
        shouldApplyFraming: true,
        framingAlreadyApplied: false,
        preserveWithSafeFit: false,
      },
    }],
    ["unverified provenance", {
      provenance: {
        verified: false,
        reason: "No exact active-plan artifact.",
        expectedDurationSeconds: 71.351,
      },
    }],
  ])("falls back to the encoder for %s", (_label, overrides) => {
    const decision = __clipExportTestUtils.decidePreparedExportPassthrough(
      compatiblePassthroughInput(overrides),
    );

    expect(decision.eligible).toBe(false);
    expect(decision.unsafeSource).toBe(false);
  });

  it.each([
    ["HEVC video", (input: PassthroughInput) => {
      input.probe.streams[0].codecName = "hevc";
    }],
    ["non-yuv420p video", (input: PassthroughInput) => {
      input.probe.streams[0].pixelFormat = "yuv444p";
    }],
    ["wrong dimensions", (input: PassthroughInput) => {
      input.probe.streams[0].width = 720;
    }],
    ["non-square pixels", (input: PassthroughInput) => {
      input.probe.streams[0].sampleAspectRatio = "4:3";
    }],
    ["rotation metadata", (input: PassthroughInput) => {
      input.probe.streams[0].rotationDegrees = 90;
    }],
    ["non-AAC audio", (input: PassthroughInput) => {
      input.probe.streams[1].codecName = "mp3";
    }],
    ["an extra subtitle stream", (input: PassthroughInput) => {
      input.probe.streams.push({
        index: 2,
        codecType: "subtitle",
        codecName: "mov_text",
        width: null,
        height: null,
        pixelFormat: null,
        sampleAspectRatio: null,
        startTimeSeconds: 0,
        rotationDegrees: 0,
      });
    }],
  ])("falls back to compatibility encoding for %s", (_label, mutate) => {
    const input = compatiblePassthroughInput();
    mutate(input);

    const decision = __clipExportTestUtils.decidePreparedExportPassthrough(input);

    expect(decision.eligible).toBe(false);
    expect(decision.unsafeSource).toBe(false);
  });

  it.each([
    ["container", (input: PassthroughInput) => {
      input.probe.startTimeSeconds = null;
    }],
    ["video", (input: PassthroughInput) => {
      input.probe.streams[0].startTimeSeconds = null;
    }],
    ["audio", (input: PassthroughInput) => {
      input.probe.streams[1].startTimeSeconds = null;
    }],
  ])("rejects lossless passthrough when the %s start timestamp is unknown", (_label, mutate) => {
    const input = compatiblePassthroughInput();
    mutate(input);

    expect(
      __clipExportTestUtils.decidePreparedExportPassthrough(input),
    ).toMatchObject({
      eligible: false,
      unsafeSource: false,
    });
  });

  it("fails closed when the prepared duration differs from the active rendered artifact", () => {
    const input = compatiblePassthroughInput();
    input.probe.durationSeconds = 65;

    expect(
      __clipExportTestUtils.decidePreparedExportPassthrough(input),
    ).toMatchObject({
      eligible: false,
      unsafeSource: true,
      reason: expect.stringContaining("duration"),
    });
  });

  it("copies prepared media into a distinct immutable file without changing its bytes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "lossless-export-copy-"));
    try {
      const sourcePath = path.join(directory, "prepared.mp4");
      const tempPath = path.join(directory, "export.partial.mp4");
      const approvedBytes = Buffer.from("approved-video-and-audio-bytes");
      await writeFile(sourcePath, approvedBytes);
      const expectedSourceIdentity =
        await __clipExportTestUtils.capturePreparedExportSourceIdentity(sourcePath);

      await __clipExportTestUtils.copyPreparedExportSource({
        sourcePath,
        tempPath,
        expectedSourceIdentity,
      });

      expect(await readFile(tempPath)).toEqual(approvedBytes);
      expect((await stat(tempPath)).ino).not.toBe((await stat(sourcePath)).ino);

      await writeFile(sourcePath, "later-source-replacement");
      expect(await readFile(tempPath)).toEqual(approvedBytes);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an atomic same-size source replacement made after identity capture", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "lossless-export-identity-"));
    try {
      const sourcePath = path.join(directory, "prepared.mp4");
      const replacementPath = path.join(directory, "replacement.mp4");
      const tempPath = path.join(directory, "export.partial.mp4");
      const approvedBytes = Buffer.from("approved-master-bytes");
      const replacementBytes = Buffer.from("replaced-master-bytes");
      expect(replacementBytes.byteLength).toBe(approvedBytes.byteLength);
      await writeFile(sourcePath, approvedBytes);
      const expectedSourceIdentity =
        await __clipExportTestUtils.capturePreparedExportSourceIdentity(sourcePath);
      await writeFile(replacementPath, replacementBytes);
      await rename(replacementPath, sourcePath);

      await expect(
        __clipExportTestUtils.copyPreparedExportSource({
          sourcePath,
          tempPath,
          expectedSourceIdentity,
        }),
      ).rejects.toThrow("prepared export source changed");
      await expect(stat(tempPath)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
