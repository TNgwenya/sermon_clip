import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

import type {
  ClipCandidate,
  ClipExportFormat,
  ClipExportLayoutStrategy,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  appendJobLog,
  createProcessingJob,
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
} from "@/server/agents/processing";
import {
  appendPipelineLog,
  ensureSermonFolders,
  getClipExportFolderPath,
  getClipFormatExportPath,
  getClipFormatExportPathVersioned,
} from "@/server/agents/storage";
import { buildClipExportBaseName, buildSermonExportDirectoryName } from "@/lib/exportNaming";
import { checkFfmpegInstalled, getMediaDimensions } from "@/server/media/ffmpeg";
import {
  buildVerticalFramingFilter,
  getSmartCropFilterRiskReason,
  isFfmpegCropFilterFailure,
} from "@/lib/clipFraming";
import { normalizeManualCropKeyframes } from "@/lib/manualCrop";
import { resolveExportSettings } from "@/lib/clipExportSettings";
import { resolveIntelligentFramingDecision } from "@/lib/clipFramingIntelligence";
import {
  markExportAssetCompleted,
  markExportAssetFailed,
} from "@/server/regeneration/dependencies";
import { type ClipBrandingConfig, type WatermarkPosition } from "@/lib/clipBranding";
import { getBrandingOverlayDimensions, renderBrandingOverlayPng } from "@/server/agents/brandingOverlay";
import { ensureClipThumbnail } from "@/server/agents/clipThumbnailService";
import { resolveSmartCropCenter, resolveSmartCropTimeline } from "@/server/agents/videoSubjectTrackingService";

export type ExportPreset = "VERTICAL_9_16" | "HORIZONTAL_16_9" | "SQUARE_1_1";
export type ExportLayoutStrategy =
  | "CENTER_CROP"
  | "LEFT_FOCUS"
  | "RIGHT_FOCUS"
  | "FIT_BLURRED_BACKGROUND"
  | "SMART_CROP";

export type ClipExportOptions = {
  format?: ExportPreset;
  layoutStrategy?: ExportLayoutStrategy;
  allowReexport?: boolean;
  force?: boolean;
  ffmpegPath?: string;
  versionTag?: string;
  brandingOverlay?: {
    config: ClipBrandingConfig;
    sermonTitle: string;
    preacherName: string;
    churchName: string;
    watermarkPosition: WatermarkPosition;
  } | null;
};

type ClipForExport = Pick<
  ClipCandidate,
  | "id"
  | "title"
  | "hook"
  | "caption"
  | "transcriptText"
  | "smartClipCategory"
  | "ministryValue"
  | "emotionalImpactScore"
  | "hookStrengthScore"
  | "shareabilityScore"
  | "manualCropKeyframes"
  | "captionData"
  | "sermonId"
  | "status"
  | "startTimeSeconds"
  | "endTimeSeconds"
  | "adjustedStartTimeSeconds"
  | "adjustedEndTimeSeconds"
  | "renderStatus"
  | "renderedFilePath"
  | "captionBurnStatus"
  | "captionedVideoPath"
  | "overlayStatus"
  | "overlayVideoPath"
  | "exportStatus"
  | "exportFormat"
> & {
  sermon?: {
    title: string;
    speakerName: string;
    sermonDate: Date | null;
  } | null;
};

type ExportSpec = {
  width: number;
  height: number;
  format: ExportPreset;
};

const EXPORT_SPECS: Record<ExportPreset, ExportSpec> = {
  VERTICAL_9_16: {
    format: "VERTICAL_9_16",
    width: 1080,
    height: 1920,
  },
  HORIZONTAL_16_9: {
    format: "HORIZONTAL_16_9",
    width: 1920,
    height: 1080,
  },
  SQUARE_1_1: {
    format: "SQUARE_1_1",
    width: 1080,
    height: 1080,
  },
};

const FALLBACK_VIDEO_ENCODER = "libx264";
const HARDWARE_VIDEO_ENCODER = "h264_videotoolbox";

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

function resolvePreferredVideoEncoder(): string {
  const override = process.env.CLIP_EXPORT_VIDEO_ENCODER?.trim() || process.env.CLIP_RENDER_VIDEO_ENCODER?.trim();
  if (override) {
    return override;
  }

  return process.platform === "darwin" ? HARDWARE_VIDEO_ENCODER : FALLBACK_VIDEO_ENCODER;
}

function isHardwareVideoEncoder(encoder: string): boolean {
  return encoder !== FALLBACK_VIDEO_ENCODER;
}

function buildVideoEncoderArgs(encoder: string): string[] {
  if (encoder === HARDWARE_VIDEO_ENCODER) {
    return [
      "-c:v",
      HARDWARE_VIDEO_ENCODER,
      "-b:v",
      process.env.CLIP_EXPORT_VIDEO_BITRATE?.trim() || process.env.CLIP_RENDER_VIDEO_BITRATE?.trim() || "5000k",
      "-allow_sw",
      "1",
    ];
  }

  if (encoder !== FALLBACK_VIDEO_ENCODER) {
    return ["-c:v", encoder];
  }

  return [
    "-c:v",
    FALLBACK_VIDEO_ENCODER,
    "-preset",
    "veryfast",
    "-crf",
    "20",
  ];
}

async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.size > 0;
  } catch {
    return false;
  }
}

function buildVideoFilter(
  spec: ExportSpec,
  layout: ExportLayoutStrategy,
  smartCrop?: {
    sourceWidth: number;
    sourceHeight: number;
    subjectCenterX: number;
    zoom?: number;
    subjectCenters?: Array<{ timeSeconds: number; centerX: number; confidence?: number; stabilized?: boolean; rejected?: boolean; frozen?: boolean }>;
  } | null,
): string {
  if (spec.format === "VERTICAL_9_16") {
    return buildVerticalFramingFilter(layout, smartCrop ?? undefined);
  }

  if (layout === "FIT_BLURRED_BACKGROUND") {
    return [
      `[0:v]scale=${spec.width}:${spec.height}:force_original_aspect_ratio=increase,boxblur=20:1[bg]`,
      `[0:v]scale=${spec.width}:${spec.height}:force_original_aspect_ratio=decrease[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`,
    ].join(";");
  }

  if (layout === "LEFT_FOCUS") {
    return `[0:v]scale=${spec.width}:${spec.height}:force_original_aspect_ratio=increase,crop=${spec.width}:${spec.height}:0:0,format=yuv420p[v]`;
  }

  if (layout === "RIGHT_FOCUS") {
    return `[0:v]scale=${spec.width}:${spec.height}:force_original_aspect_ratio=increase,crop=${spec.width}:${spec.height}:iw-ow:0,format=yuv420p[v]`;
  }

  return `[0:v]scale=${spec.width}:${spec.height}:force_original_aspect_ratio=increase,crop=${spec.width}:${spec.height},format=yuv420p[v]`;
}

function getTempPath(outputPath: string): string {
  return outputPath.replace(/\.mp4$/i, ".partial.mp4");
}

function formatSuffix(format: ExportPreset): string {
  const suffixByFormat: Record<ExportPreset, string> = {
    VERTICAL_9_16: "vertical-9x16",
    HORIZONTAL_16_9: "horizontal-16x9",
    SQUARE_1_1: "square-1x1",
  };

  return suffixByFormat[format];
}

function buildReadableExportFileStem(input: { clipTitle: string; clipDescription?: string | null; clipId: string }): string {
  const readableTitle = buildClipExportBaseName({
    title: input.clipTitle,
    description: input.clipDescription,
  });
  const shortId = input.clipId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 8);
  return shortId ? `${readableTitle}_${shortId}` : readableTitle;
}

function resolveExportOutputPath(input: {
  sermonId: string;
  clipId: string;
  clipTitle?: string | null;
  clipDescription?: string | null;
  sermonTitle?: string | null;
  speakerName?: string | null;
  sermonDate?: Date | string | null;
  format: ExportPreset;
  allowReexport: boolean;
  force: boolean;
  versionTag?: string;
}): string {
  const versionTag =
    input.versionTag?.trim() ||
    (input.allowReexport || input.force
      ? new Date().toISOString().replace(/[-:.TZ]/g, "")
      : "");

  if (!input.clipTitle?.trim()) {
    return versionTag
      ? getClipFormatExportPathVersioned(input.sermonId, input.clipId, input.format, versionTag)
      : getClipFormatExportPath(input.sermonId, input.clipId, input.format);
  }

  const fileStem = buildReadableExportFileStem({
    clipTitle: input.clipTitle,
    clipDescription: input.clipDescription,
    clipId: input.clipId,
  });
  const versionSuffix = versionTag ? `-${versionTag.replace(/[^A-Za-z0-9_-]/g, "")}` : "";
  const exportFolderPath = input.sermonTitle?.trim()
    ? path.join(
        getClipExportFolderPath(input.sermonId),
        buildSermonExportDirectoryName({
          title: input.sermonTitle,
          speakerName: input.speakerName,
          sermonDate: input.sermonDate,
        }),
      )
    : getClipExportFolderPath(input.sermonId);

  return path.join(
    exportFolderPath,
    `${fileStem}-${formatSuffix(input.format)}${versionSuffix}.mp4`,
  );
}

async function runFfmpeg(input: {
  sourcePath: string;
  outputPath: string;
  ffmpegPath?: string;
  filter: string;
  brandingOverlayPath?: string;
  sermonId: string;
  jobId: string;
  videoEncoder?: string;
}): Promise<void> {
  const command = commandFor(input.ffmpegPath);
  const videoEncoder = input.videoEncoder ?? resolvePreferredVideoEncoder();
  const args = [
    "-y",
    "-i",
    input.sourcePath,
  ];

  if (input.brandingOverlayPath) {
    args.push("-loop", "1", "-i", input.brandingOverlayPath);
  }

  args.push(
    "-filter_complex",
    input.filter,
    "-map",
    "[v]",
    "-map",
    "0:a?",
    ...buildVideoEncoderArgs(videoEncoder),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    input.outputPath,
  );

  await appendPipelineLog(input.sermonId, `Clip export started from ${input.sourcePath} with encoder: ${videoEncoder}.`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text.length > 0) {
        void appendJobLog(input.jobId, `[ffmpeg stdout] ${text}`);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        void appendJobLog(input.jobId, `[ffmpeg stderr] ${trimmed}`);
      }
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to start FFmpeg export: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`FFmpeg export failed with code ${code ?? "unknown"}. ${stderr.trim().slice(-1200)}`.trim()));
    });
  });
}

function appendBrandingOverlayFilter(baseFilter: string): string {
  return `${baseFilter}; [1:v]format=rgba[branding]; [v][branding]overlay=0:0:shortest=1,format=yuv420p[v]`;
}

async function validateVideoInput(inputPath: string, ffmpegPath?: string): Promise<void> {
  const command = commandFor(ffmpegPath);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, ["-v", "error", "-i", inputPath, "-f", "null", "-"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(new Error(`Unable to validate source clip: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Rendered clip is not a valid video input. ${stderr.trim().slice(-800)}`.trim()));
    });
  });
}

async function failExport(clipId: string, message: string): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      exportStatus: "FAILED",
      exportError: message,
    },
  });
  await markExportAssetFailed(clipId);
}

function validateExportEligibility(input: {
  clip: Pick<ClipForExport, "renderStatus" | "exportStatus" | "exportFormat"> & Record<string, unknown>;
  sourcePath: string | null;
  sourceExists: boolean;
  format: ExportPreset;
  allowReexport: boolean;
}): { ok: boolean; reason?: string; shouldMarkFailed?: boolean } {
  if (input.clip.renderStatus !== "COMPLETED") {
    return { ok: false, reason: "Clip must be rendered before export.", shouldMarkFailed: false };
  }

  if (!input.sourcePath || !input.sourceExists) {
    return { ok: false, reason: "Rendered clip file does not exist.", shouldMarkFailed: true };
  }

  if (input.clip.exportStatus === "EXPORTING") {
    return { ok: false, reason: "Clip export is already in progress.", shouldMarkFailed: false };
  }

  if (
    input.clip.exportStatus === "COMPLETED" &&
    input.clip.exportFormat === input.format &&
    !input.allowReexport
  ) {
    return { ok: false, reason: "Clip already exported in this format. Use re-export to run again.", shouldMarkFailed: false };
  }

  return { ok: true };
}

function buildExportMetadata(input: {
  format: ClipExportFormat;
  layout: ClipExportLayoutStrategy;
  outputPath: string;
}): Pick<
  Prisma.ClipCandidateUpdateInput,
  | "exportStatus"
  | "exportFormat"
  | "exportLayoutStrategy"
  | "exportedAt"
  | "exportError"
  | "exportedFilePath"
  | "exportPath"
> {
  return {
    exportStatus: "COMPLETED",
    exportFormat: input.format,
    exportLayoutStrategy: input.layout,
    exportedAt: new Date(),
    exportError: null,
    exportedFilePath: input.outputPath,
    exportPath: input.outputPath,
  };
}

async function loadClip(clipId: string): Promise<ClipForExport> {
  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      title: true,
      hook: true,
      caption: true,
      transcriptText: true,
      smartClipCategory: true,
      ministryValue: true,
      emotionalImpactScore: true,
      hookStrengthScore: true,
      shareabilityScore: true,
      manualCropKeyframes: true,
      captionData: true,
      sermonId: true,
      status: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      adjustedStartTimeSeconds: true,
      adjustedEndTimeSeconds: true,
      renderStatus: true,
      renderedFilePath: true,
      captionBurnStatus: true,
      captionedVideoPath: true,
      overlayStatus: true,
      overlayVideoPath: true,
      exportStatus: true,
      exportFormat: true,
      sermon: {
        select: {
          title: true,
          speakerName: true,
          sermonDate: true,
        },
      },
    },
  });

  if (!clip) {
    throw new Error(`Clip candidate ${clipId} was not found.`);
  }

  return clip;
}

export function resolvePreparedExportSource(
  clip: Pick<
    ClipForExport,
    | "renderedFilePath"
    | "captionBurnStatus"
    | "captionedVideoPath"
    | "overlayStatus"
    | "overlayVideoPath"
  >,
): string | null {
  if (clip.captionBurnStatus === "COMPLETED" && clip.captionedVideoPath) {
    return clip.captionedVideoPath;
  }

  if (clip.overlayStatus === "COMPLETED" && clip.overlayVideoPath) {
    return clip.overlayVideoPath;
  }

  return clip.renderedFilePath;
}

export async function exportClipWithPreset(
  clipCandidateId: string,
  options?: ClipExportOptions,
): Promise<{ clipId: string; format: ExportPreset; exportPath: string }> {
  const clipId = clipCandidateId.trim();
  if (!clipId) {
    throw new Error("Clip id is required for export.");
  }

  const format = options?.format ?? "VERTICAL_9_16";
  const layoutStrategy = options?.layoutStrategy ?? "CENTER_CROP";
  const spec = EXPORT_SPECS[format];

  const clip = await loadClip(clipId);
  await ensureSermonFolders(clip.sermonId);

  const sourcePath = resolvePreparedExportSource(clip);
  const sourceExists = sourcePath ? await fileHasBytes(sourcePath) : false;
  const outputPath = resolveExportOutputPath({
    sermonId: clip.sermonId,
    clipId: clip.id,
    clipTitle: clip.title,
    clipDescription: clip.hook || clip.caption,
    sermonTitle: clip.sermon?.title,
    speakerName: clip.sermon?.speakerName,
    sermonDate: clip.sermon?.sermonDate,
    format,
    allowReexport: Boolean(options?.allowReexport),
    force: Boolean(options?.force),
    versionTag: options?.versionTag,
  });
  await mkdir(/* turbopackIgnore: true */ path.dirname(outputPath), { recursive: true });
  const outputExists = await fileHasBytes(outputPath);

  if (outputExists && !options?.allowReexport && !options?.force) {
    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: {
        exportStatus: "COMPLETED",
        exportFormat: format,
        exportLayoutStrategy: layoutStrategy,
        exportedFilePath: outputPath,
        exportPath: outputPath,
        exportedAt: new Date(),
        exportError: null,
      },
    });
    await ensureClipThumbnail({
      id: clip.id,
      sermonId: clip.sermonId,
      renderedFilePath: clip.renderedFilePath,
      overlayVideoPath: clip.overlayVideoPath,
      captionedVideoPath: clip.captionedVideoPath,
      exportedFilePath: outputPath,
    }, { ffmpegPath: options?.ffmpegPath });
    await markExportAssetCompleted(clip.id, false);

    return {
      clipId: clip.id,
      format,
      exportPath: outputPath,
    };
  }

  const eligibility = validateExportEligibility({
    clip,
    sourcePath,
    sourceExists,
    format,
    allowReexport: Boolean(options?.allowReexport),
  });

  if (!eligibility.ok) {
    if (eligibility.shouldMarkFailed) {
      await failExport(clip.id, eligibility.reason ?? "Clip is not eligible for export.");
    }
    throw new Error(eligibility.reason ?? "Clip is not eligible for export.");
  }

  const ffmpegInstalled = await checkFfmpegInstalled(options?.ffmpegPath);
  if (!ffmpegInstalled) {
    const message = "FFmpeg is not installed or not executable.";
    await failExport(clip.id, message);
    throw new Error(message);
  }

  const exportSourcePath = sourcePath;
  if (!exportSourcePath) {
    throw new Error("Prepared video source is missing.");
  }

  await validateVideoInput(exportSourcePath, options?.ffmpegPath);

  const queued = await prisma.clipCandidate.updateMany({
    where: {
      id: clip.id,
      NOT: {
        exportStatus: "EXPORTING",
      },
    },
    data: {
      exportStatus: "QUEUED",
      exportError: null,
      exportFormat: format,
      exportLayoutStrategy: layoutStrategy,
    },
  });

  if (queued.count === 0) {
    throw new Error("Clip export is already in progress. Duplicate request blocked.");
  }

  const job = await createProcessingJob(clip.sermonId, "EXPORT_CLIPS");
  const startedAt = Date.now();

  try {
    await markJobRunning(job.id);
    await appendJobLog(job.id, `Export requested for clip ${clip.id} with format ${format}.`);

    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: {
        exportStatus: "EXPORTING",
        exportError: null,
      },
    });

    const exportSettings = resolveExportSettings({
      exportFormat: format,
      exportLayoutStrategy: layoutStrategy,
      captionData: clip.captionData,
    });
    const manualCropKeyframes = normalizeManualCropKeyframes(clip.manualCropKeyframes);
    const boundaries = {
      startTimeSeconds: clip.adjustedStartTimeSeconds ?? clip.startTimeSeconds,
      endTimeSeconds: clip.adjustedEndTimeSeconds ?? clip.endTimeSeconds,
    };
    const smartCrop =
      layoutStrategy === "SMART_CROP"
        ? await Promise.all([
            getMediaDimensions(exportSourcePath, options?.ffmpegPath).catch(() => null),
            resolveSmartCropCenter(clip.id),
            manualCropKeyframes.length > 0 ? Promise.resolve([]) : resolveSmartCropTimeline(clip.id, boundaries),
          ]).then(([dimensions, center, timeline]) => (
            dimensions && center
              ? {
                  sourceWidth: dimensions.width,
                  sourceHeight: dimensions.height,
                  subjectCenterX: center.centerX,
                  zoom: 1,
                  subjectCenters: manualCropKeyframes.length > 0
                    ? manualCropKeyframes.map((point) => ({
                        timeSeconds: point.timeSeconds,
                        centerX: point.centerX,
                        confidence: 1,
                        stabilized: false,
                        rejected: false,
                        frozen: false,
                      }))
                    : timeline.map((point) => ({
                        timeSeconds: point.timeSeconds,
                        centerX: point.centerX,
                        confidence: point.confidence,
                        stabilized: point.stabilized,
                        rejected: point.rejected,
                        frozen: point.frozen,
                      })),
                }
              : null
          ))
        : null;
    const framingDecision = resolveIntelligentFramingDecision({
      requestedLayout: layoutStrategy,
      requestedPersonality: exportSettings.framingPersonality,
      smartCropPoints: smartCrop?.subjectCenters,
      hasManualCrop: manualCropKeyframes.length > 0,
      moment: {
        title: clip.title,
        hook: clip.hook,
        transcriptText: clip.transcriptText,
        category: clip.smartClipCategory,
        ministryValue: clip.ministryValue,
        emotionalImpactScore: clip.emotionalImpactScore,
        hookStrengthScore: clip.hookStrengthScore,
        shareabilityScore: clip.shareabilityScore,
        durationSeconds: boundaries.endTimeSeconds - boundaries.startTimeSeconds,
      },
    });
    const smartCropSafety = framingDecision.safety;
    let effectiveLayoutStrategy: ExportLayoutStrategy = framingDecision.effectiveLayout;
    let effectiveSmartCrop = effectiveLayoutStrategy === "SMART_CROP" ? smartCrop : null;
    if (effectiveSmartCrop) {
      effectiveSmartCrop = {
        ...effectiveSmartCrop,
        zoom: framingDecision.zoom,
      };
    }

    if (framingDecision.fallbackApplied) {
      await appendPipelineLog(
        clip.sermonId,
        `Smart framing export chose ${framingDecision.effectiveLayout} for clip ${clip.id}: ${framingDecision.reasonCodes.join(", ")} (average confidence ${smartCropSafety.averageConfidence.toFixed(2)}, unstable ratio ${smartCropSafety.unstableRatio.toFixed(2)}).`,
      );
    } else {
      await appendPipelineLog(
        clip.sermonId,
        `Smart framing export selected for clip ${clip.id}: ${framingDecision.pastorSummary}`,
      );
    }

    let filter = buildVideoFilter(spec, effectiveLayoutStrategy, effectiveSmartCrop);
    if (effectiveLayoutStrategy === "SMART_CROP") {
      const filterRiskReason = getSmartCropFilterRiskReason(filter);
      if (filterRiskReason) {
        effectiveLayoutStrategy = "FIT_BLURRED_BACKGROUND";
        effectiveSmartCrop = null;
        filter = buildVideoFilter(spec, effectiveLayoutStrategy, effectiveSmartCrop);
        await appendPipelineLog(
          clip.sermonId,
          `Smart crop export fell back to full-stage framing for clip ${clip.id}: ${filterRiskReason}.`,
        );
      }
    }
    const tempPath = getTempPath(outputPath);
    const overlayDimensions = getBrandingOverlayDimensions(format);
    const brandingOverlayPath = tempPath.replace(/\.mp4$/i, ".branding.png");
    let fullFilter = filter;
    let overlayEnabled = false;
    let smartCropRuntimeFallbackReason: string | null = null;

    if (options?.brandingOverlay) {
      overlayEnabled = await renderBrandingOverlayPng(
        brandingOverlayPath,
        options.brandingOverlay.config,
        {
          format,
          sermonTitle: options.brandingOverlay.sermonTitle,
          preacherName: options.brandingOverlay.preacherName,
          churchName: options.brandingOverlay.churchName,
          themeColor: options.brandingOverlay.config.themeColor,
          watermarkPosition: options.brandingOverlay.watermarkPosition,
          width: overlayDimensions.width,
          height: overlayDimensions.height,
        },
      );

      if (overlayEnabled) {
        fullFilter = appendBrandingOverlayFilter(filter);
      }
    }
    try {
      await unlink(tempPath);
    } catch {
      // Ignore stale partial file cleanup issues.
    }

    const preferredVideoEncoder = resolvePreferredVideoEncoder();
    const exportWithEncoder = async (videoEncoder: string) => {
      await runFfmpeg({
        sourcePath: sourcePath!,
        outputPath: tempPath,
        ffmpegPath: options?.ffmpegPath,
        filter: fullFilter,
        brandingOverlayPath: overlayEnabled ? brandingOverlayPath : undefined,
        sermonId: clip.sermonId,
        jobId: job.id,
        videoEncoder,
      });
    };

    try {
      try {
        await exportWithEncoder(preferredVideoEncoder);
      } catch (error) {
        if (!isHardwareVideoEncoder(preferredVideoEncoder)) {
          throw error;
        }

        const message = error instanceof Error ? error.message : "Unknown clip export error.";
        await unlink(tempPath).catch(() => undefined);
        await appendJobLog(job.id, `Hardware export failed with ${preferredVideoEncoder}; retrying with ${FALLBACK_VIDEO_ENCODER}. Original error: ${message}`);
        await appendPipelineLog(clip.sermonId, `Hardware export fallback used for clip ${clip.id}: ${preferredVideoEncoder} failed.`);
        await exportWithEncoder(FALLBACK_VIDEO_ENCODER);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown clip export error.";
      if (effectiveLayoutStrategy !== "SMART_CROP" || !isFfmpegCropFilterFailure(message)) {
        throw error;
      }

      await unlink(tempPath).catch(() => undefined);
      smartCropRuntimeFallbackReason = "Smart crop failed inside FFmpeg export, so the app retried with safe full-stage framing.";
      effectiveLayoutStrategy = "FIT_BLURRED_BACKGROUND";
      effectiveSmartCrop = null;
      filter = buildVideoFilter(spec, effectiveLayoutStrategy, effectiveSmartCrop);
      fullFilter = overlayEnabled ? appendBrandingOverlayFilter(filter) : filter;
      await appendPipelineLog(clip.sermonId, `${smartCropRuntimeFallbackReason} Clip ${clip.id}.`);
      await appendJobLog(job.id, `${smartCropRuntimeFallbackReason} Original error: ${message}`);

      await runFfmpeg({
        sourcePath: sourcePath!,
        outputPath: tempPath,
        ffmpegPath: options?.ffmpegPath,
        filter: fullFilter,
        brandingOverlayPath: overlayEnabled ? brandingOverlayPath : undefined,
        sermonId: clip.sermonId,
        jobId: job.id,
        videoEncoder: isHardwareVideoEncoder(preferredVideoEncoder) ? FALLBACK_VIDEO_ENCODER : preferredVideoEncoder,
      });
    }

    await rename(tempPath, outputPath);

    if (overlayEnabled) {
      await unlink(brandingOverlayPath).catch(() => undefined);
    }

    const outputStats = await stat(outputPath);
    if (outputStats.size <= 0) {
      await unlink(outputPath).catch(() => undefined);
      throw new Error("Export produced an empty output file.");
    }
    await appendJobLog(job.id, `Exported file size for ${clip.id}: ${outputStats.size} bytes.`);
    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: {
        ...buildExportMetadata({
          format,
          layout: effectiveLayoutStrategy,
          outputPath,
        }),
        captionData: {
          ...(clip.captionData && typeof clip.captionData === "object" && !Array.isArray(clip.captionData)
            ? (clip.captionData as Record<string, unknown>)
            : {}),
          framingDecision: {
            requestedPersonality: framingDecision.requestedPersonality,
            resolvedPersonality: framingDecision.resolvedPersonality,
            shotStyle: framingDecision.shotStyle,
            effectiveLayout: framingDecision.effectiveLayout,
            zoom: framingDecision.zoom,
            motionSmoothing: framingDecision.motionSmoothing,
            captionSafeArea: framingDecision.captionSafeArea,
            visualQualityScore: framingDecision.visualQualityScore,
            speakerVisiblePercentage: framingDecision.speakerVisiblePercentage,
            frameQualityLabel: framingDecision.frameQualityLabel,
            manualCropRecommended: framingDecision.manualCropRecommended,
            reasonCodes: framingDecision.reasonCodes,
            summary: framingDecision.pastorSummary,
            frameQualitySummary: framingDecision.frameQualitySummary,
            updatedAt: new Date().toISOString(),
          },
        },
        visualQualityScore: framingDecision.visualQualityScore,
        visualReadinessScore: framingDecision.visualQualityScore,
        speakerVisiblePercentage: framingDecision.speakerVisiblePercentage,
        averageTrackingConfidence: framingDecision.averageTrackingConfidence,
        cropStabilityScore: framingDecision.cropStabilityScore,
        ...(smartCropRuntimeFallbackReason
          ? { assetInvalidationReason: smartCropRuntimeFallbackReason }
          : {}),
      },
    });
    const thumbnail = await ensureClipThumbnail({
      id: clip.id,
      sermonId: clip.sermonId,
      renderedFilePath: clip.renderedFilePath,
      overlayVideoPath: clip.overlayVideoPath,
      captionedVideoPath: clip.captionedVideoPath,
      exportedFilePath: outputPath,
    }, { ffmpegPath: options?.ffmpegPath });
    if (thumbnail.thumbnailPath) {
      await appendJobLog(job.id, `Prepared clip poster for ${clip.id}: ${thumbnail.thumbnailPath}.`);
    } else if (thumbnail.error) {
      await appendJobLog(job.id, `Clip poster is not ready yet for ${clip.id}: ${thumbnail.error}`);
    }
    await markExportAssetCompleted(clip.id, true);

    const elapsedMs = Date.now() - startedAt;
    await appendPipelineLog(clip.sermonId, `Clip ${clip.id} export ${format} completed in ${elapsedMs}ms.`);
    await markJobSucceeded(job.id, `Clip ${clip.id} export ${format} completed in ${elapsedMs}ms.`);

    return {
      clipId: clip.id,
      format,
      exportPath: outputPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown clip export error.";
    await unlink(getTempPath(outputPath)).catch(() => undefined);
    await failExport(clip.id, message);
    await markJobFailed(job.id, message, `Clip ${clip.id} export failed.`);
    await appendPipelineLog(clip.sermonId, `Clip ${clip.id} export failed: ${message}`);
    throw new Error(message);
  }
}

export async function exportVerticalClip(
  clipCandidateId: string,
  options?: Omit<ClipExportOptions, "format">,
): Promise<{ clipId: string; exportPath: string }> {
  const result = await exportClipWithPreset(clipCandidateId, {
    ...options,
    format: "VERTICAL_9_16",
  });

  return {
    clipId: result.clipId,
    exportPath: result.exportPath,
  };
}

export const __clipExportTestUtils = {
  buildVideoEncoderArgs,
  buildVideoFilter,
  validateExportEligibility,
  buildExportMetadata,
  getSmartCropFilterRiskReason,
  fileHasBytes,
  resolvePreparedExportSource,
  buildReadableExportFileStem,
  resolveOutputPath(input: {
    sermonId: string;
    clipId: string;
    clipTitle?: string | null;
    clipDescription?: string | null;
    sermonTitle?: string | null;
    speakerName?: string | null;
    sermonDate?: Date | string | null;
    format: ExportPreset;
    allowReexport: boolean;
    force: boolean;
    versionTag?: string;
  }): string {
    return resolveExportOutputPath(input);
  },
};
