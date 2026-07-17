import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  __clipRenderTestUtils,
  validateRenderEligibility,
} from "../clipRenderService";

describe("clip render service validation", () => {
  it("allows an approved clip with valid boundaries", () => {
    const result = validateRenderEligibility({
      status: "APPROVED",
      renderStatus: "NOT_RENDERED",
      startTimeSeconds: 12,
      endTimeSeconds: 56,
      sermonDurationSeconds: 600,
      transcriptText: "A complete sermon thought.",
      sourceVideoExists: true,
      allowRerender: false,
    });

    expect(result.ok).toBe(true);
  });

  it("allows a suggested clip with valid boundaries for review preview rendering", () => {
    const result = validateRenderEligibility({
      status: "SUGGESTED",
      renderStatus: "NOT_RENDERED",
      startTimeSeconds: 12,
      endTimeSeconds: 56,
      sermonDurationSeconds: 600,
      transcriptText: "A complete sermon thought.",
      sourceVideoExists: true,
      allowRerender: false,
    });

    expect(result.ok).toBe(true);
  });

  it("blocks rejected clips", () => {
    const result = validateRenderEligibility({
      status: "REJECTED",
      renderStatus: "NOT_RENDERED",
      startTimeSeconds: 12,
      endTimeSeconds: 56,
      sermonDurationSeconds: 600,
      transcriptText: "A complete sermon thought.",
      sourceVideoExists: true,
      allowRerender: false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("suggested or approved");
  });

  it("fails invalid boundaries", () => {
    const result = validateRenderEligibility({
      status: "APPROVED",
      renderStatus: "NOT_RENDERED",
      startTimeSeconds: 80,
      endTimeSeconds: 20,
      sermonDurationSeconds: 600,
      transcriptText: "A complete sermon thought.",
      sourceVideoExists: true,
      allowRerender: false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("End time must be greater than start time");
  });

  it("fails when source video is missing", () => {
    const result = validateRenderEligibility({
      status: "APPROVED",
      renderStatus: "NOT_RENDERED",
      startTimeSeconds: 12,
      endTimeSeconds: 56,
      sermonDurationSeconds: 600,
      transcriptText: "A complete sermon thought.",
      sourceVideoExists: false,
      allowRerender: false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Source video file does not exist");
  });

  it("blocks duplicate render requests while rendering", () => {
    const result = validateRenderEligibility({
      status: "APPROVED",
      renderStatus: "RENDERING",
      startTimeSeconds: 12,
      endTimeSeconds: 56,
      sermonDurationSeconds: 600,
      transcriptText: "A complete sermon thought.",
      sourceVideoExists: true,
      allowRerender: false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("already rendering");
    expect(result.shouldMarkFailed).toBe(false);
  });

  it("marks true render blockers as failed", () => {
    const result = validateRenderEligibility({
      status: "APPROVED",
      renderStatus: "NOT_RENDERED",
      startTimeSeconds: 12,
      endTimeSeconds: 56,
      sermonDurationSeconds: 600,
      transcriptText: "A complete sermon thought.",
      sourceVideoExists: false,
      allowRerender: false,
    });

    expect(result.ok).toBe(false);
    expect(result.shouldMarkFailed).toBe(true);
  });

  it("builds render metadata payload", () => {
    const metadata = __clipRenderTestUtils.buildRenderMetadata({
      outputPath: "/tmp/clip.mp4",
      durationSeconds: 42.1,
      fileSizeBytes: 1024,
    });

    expect(metadata.renderedFilePath).toBe("/tmp/clip.mp4");
    expect(metadata.renderedDurationSeconds).toBe(42.1);
    expect(metadata.renderedSizeBytes).toBe(1024);
    expect(metadata.renderStatus).toBe("COMPLETED");
    expect(metadata.renderedAt).toBeInstanceOf(Date);
  });

  it("falls back to known source duration when transcript segments are unavailable", () => {
    expect(__clipRenderTestUtils.resolveSermonDurationFallback({
      sourceDurationSeconds: 70,
      mediaDurationSeconds: null,
      clipEndTimeSeconds: 55,
    })).toBe(70);
  });

  it("uses the clip end as a final duration fallback for transcript-text-only fixtures", () => {
    expect(__clipRenderTestUtils.resolveSermonDurationFallback({
      sourceDurationSeconds: null,
      mediaDurationSeconds: null,
      clipEndTimeSeconds: 55,
    })).toBe(55);
  });

  it("uses Apple hardware encoder arguments when requested", () => {
    expect(__clipRenderTestUtils.buildVideoEncoderArgs("h264_videotoolbox")).toContain("h264_videotoolbox");
    expect(__clipRenderTestUtils.buildVideoEncoderArgs("h264_videotoolbox")).toContain("-allow_sw");
  });

  it("caps batch render concurrency for local MacBook safety", () => {
    expect(__clipRenderTestUtils.resolveRenderConcurrency()).toBe(2);
    expect(__clipRenderTestUtils.resolveRenderConcurrency(0)).toBe(1);
    expect(__clipRenderTestUtils.resolveRenderConcurrency(9)).toBe(3);
  });

  it("rerenders completed clips when the render asset is stale", () => {
    expect(__clipRenderTestUtils.getBatchRenderDecision({
      renderStatus: "COMPLETED",
      renderFreshness: "OUTDATED",
    })).toEqual({
      shouldRender: true,
      forceRender: true,
    });
  });

  it("skips completed clips only when the render asset is fresh", () => {
    expect(__clipRenderTestUtils.getBatchRenderDecision({
      renderStatus: "COMPLETED",
      renderFreshness: "UP_TO_DATE",
    })).toEqual({
      shouldRender: false,
      forceRender: false,
    });
  });

  it("trims clear edge silence while leaving a small speech pad", () => {
    const cleanup = __clipRenderTestUtils.buildEdgeSilenceCleanup({
      startTimeSeconds: 100,
      endTimeSeconds: 160,
      silenceAtBeginningSeconds: 1.2,
      silenceAtEndSeconds: 1.8,
    });

    expect(cleanup).toMatchObject({
      applied: true,
      startTimeSeconds: 101.08,
      endTimeSeconds: 158.32,
      startTrimSeconds: 1.08,
      endTrimSeconds: 1.68,
    });
  });

  it("ignores tiny edge pauses so clips do not feel chopped", () => {
    const cleanup = __clipRenderTestUtils.buildEdgeSilenceCleanup({
      startTimeSeconds: 100,
      endTimeSeconds: 160,
      silenceAtBeginningSeconds: 0.25,
      silenceAtEndSeconds: 0.35,
    });

    expect(cleanup).toMatchObject({
      applied: false,
      startTimeSeconds: 100,
      endTimeSeconds: 160,
      startTrimSeconds: 0,
      endTrimSeconds: 0,
    });
  });

  it("does not trim a clip below the hard minimum duration", () => {
    const cleanup = __clipRenderTestUtils.buildEdgeSilenceCleanup({
      startTimeSeconds: 10,
      endTimeSeconds: 34,
      silenceAtBeginningSeconds: 4,
      silenceAtEndSeconds: 4,
    });

    expect(cleanup.applied).toBe(false);
    expect(cleanup.startTimeSeconds).toBe(10);
    expect(cleanup.endTimeSeconds).toBe(34);
  });

  it("reads Studio speech cleanup settings from caption data", () => {
    expect(__clipRenderTestUtils.resolveRenderSpeechCleanupSettings({
      speechCleanup: {
        removeDeadAir: true,
        tightenLongPauses: true,
        intensity: "maximum",
      },
    })).toEqual({
      removeDeadAir: true,
      tightenLongPauses: true,
      intensity: "maximum",
    });

    expect(__clipRenderTestUtils.resolveRenderSpeechCleanupSettings(null)).toEqual({
      removeDeadAir: false,
      tightenLongPauses: false,
      intensity: "normal",
    });
  });

  it("parses detected silence into edge and internal cleanup inputs", () => {
    const events = __clipRenderTestUtils.parseSilenceDetectEvents(`
      [silencedetect @ abc] silence_start: 0
      [silencedetect @ abc] silence_end: 1.4 | silence_duration: 1.4
      [silencedetect @ abc] silence_start: 14
      [silencedetect @ abc] silence_end: 16.1 | silence_duration: 2.1
      [silencedetect @ abc] silence_start: 58.5
      [silencedetect @ abc] silence_end: 60 | silence_duration: 1.5
    `, 60);

    expect(__clipRenderTestUtils.resolveDetectedEdgeSilence(events, 60)).toEqual({
      silenceAtBeginningSeconds: 1.4,
      silenceAtEndSeconds: 1.5,
    });

    expect(__clipRenderTestUtils.mapInternalSilenceEvents({
      events,
      originalStartTimeSeconds: 100,
      effectiveStartTimeSeconds: 101.28,
      effectiveEndTimeSeconds: 158.62,
    })).toEqual([
      { start: 12.72, end: 14.82, duration: 2.1 },
    ]);
  });

  it("collapses long internal silence while leaving a natural breath", () => {
    const cleanup = __clipRenderTestUtils.buildInternalSilenceCleanup({
      startTimeSeconds: 100,
      endTimeSeconds: 160,
      silenceEvents: [
        { start: 10, end: 12, duration: 2 },
        { start: 28, end: 28.7, duration: 0.7 },
      ],
    });

    expect(cleanup.applied).toBe(true);
    expect(cleanup.cuts).toHaveLength(1);
    expect(cleanup.cuts[0]).toMatchObject({
      startTimeSeconds: 110.18,
      endTimeSeconds: 111.82,
      trimSeconds: 1.64,
    });
    expect(cleanup.renderedDurationSeconds).toBe(58.36);
  });

  it("collapses shorter internal silence at stronger intensity", () => {
    const cleanup = __clipRenderTestUtils.buildInternalSilenceCleanup({
      startTimeSeconds: 100,
      endTimeSeconds: 160,
      silenceEvents: [
        { start: 10, end: 10.7, duration: 0.7 },
      ],
      profile: {
        intensity: "strong",
        edgeSpeechPadSeconds: 0.08,
        internalSpeechPadSeconds: 0.1,
        minEdgeSilenceSeconds: 0.25,
        minInternalSilenceSeconds: 0.55,
        silenceDetectNoiseDb: -31,
        silenceDetectDurationSeconds: 0.18,
      },
    });

    expect(cleanup.applied).toBe(true);
    expect(cleanup.cuts).toEqual([
      {
        startTimeSeconds: 110.1,
        endTimeSeconds: 110.6,
        trimSeconds: 0.5,
        originalSilenceStartSeconds: 110,
        originalSilenceEndSeconds: 110.7,
        originalSilenceDurationSeconds: 0.7,
      },
    ]);
  });

  it("does not collapse internal silence when it would make the clip too short", () => {
    const cleanup = __clipRenderTestUtils.buildInternalSilenceCleanup({
      startTimeSeconds: 10,
      endTimeSeconds: 34,
      silenceEvents: [
        { start: 6, end: 9, duration: 3 },
      ],
    });

    expect(cleanup.applied).toBe(false);
    expect(cleanup.cuts).toHaveLength(0);
    expect(cleanup.renderedDurationSeconds).toBe(24);
  });

  it("builds a synced audio and video silence-removal render filter", () => {
    const filter = __clipRenderTestUtils.buildRenderFilter({
      framingPreset: "CENTER_CROP",
      startTimeSeconds: 100,
      internalSilenceCleanup: {
        applied: true,
        originalStartTimeSeconds: 100,
        originalEndTimeSeconds: 160,
        renderedDurationSeconds: 58.35,
        totalTrimSeconds: 1.65,
        detectedInternalSilenceCount: 1,
        longestInternalSilenceSeconds: 2,
        cuts: [
          {
            startTimeSeconds: 110.17,
            endTimeSeconds: 111.82,
            trimSeconds: 1.65,
            originalSilenceStartSeconds: 110,
            originalSilenceEndSeconds: 112,
            originalSilenceDurationSeconds: 2,
          },
        ],
      },
    });

    expect(filter.audioMap).toBe("[a]");
    expect(filter.filterComplex).toContain("[0:v]select=not(between(t\\,10.17\\,11.82))");
    expect(filter.filterComplex).toContain("[0:a]aselect=not(between(t\\,10.17\\,11.82))");
    expect(filter.filterComplex).toContain("[silence_v]setpts=PTS-STARTPTS[trimmed_v]");
    expect(filter.filterComplex).toContain("[trimmed_v]setpts=PTS-STARTPTS,scale=1080:1920");
  });

  it("resolves persisted manual crop axes and zoom for the first render", () => {
    expect(__clipRenderTestUtils.resolveManualRenderSmartCrop([
      { timeSeconds: 0, centerX: 0.38, centerY: 0.42, zoom: 1.08 },
      { timeSeconds: 8, centerX: 0.62, centerY: 0.42, zoom: 1.08 },
    ])).toEqual({
      subjectCenterX: 0.38,
      subjectCenterY: 0.42,
      zoom: 1.08,
      subjectCenters: [
        { timeSeconds: 0, centerX: 0.38, centerY: 0.42, zoom: 1.08 },
        { timeSeconds: 8, centerX: 0.62, centerY: 0.42, zoom: 1.08 },
      ],
    });
  });

  it("uses manual vertical framing in the render filter", () => {
    const manualCrop = __clipRenderTestUtils.resolveManualRenderSmartCrop([
      { timeSeconds: 0, centerX: 0.5, centerY: 0.58, zoom: 1.08 },
    ]);
    const filter = __clipRenderTestUtils.buildRenderFilter({
      framingPreset: "SMART_CROP",
      startTimeSeconds: 0,
      smartCrop: manualCrop
        ? { sourceWidth: 1920, sourceHeight: 1080, ...manualCrop }
        : null,
    });

    expect(filter.filterComplex).toContain("scale=3686:2074");
    expect(filter.filterComplex).toContain(":154,setsar=1");
  });

  it("does not treat empty rendered video files as reusable media", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "render-empty-"));
    try {
      const renderedPath = path.join(directory, "clip.mp4");
      await writeFile(renderedPath, "");

      await expect(__clipRenderTestUtils.fileHasBytes(renderedPath)).resolves.toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts non-empty rendered video files for reuse", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "render-ready-"));
    try {
      const renderedPath = path.join(directory, "clip.mp4");
      await writeFile(renderedPath, "video-bytes");

      await expect(__clipRenderTestUtils.fileHasBytes(renderedPath)).resolves.toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
