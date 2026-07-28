import { copyFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

import type {
  ClipArtifactKind,
  ClipCandidate,
  ClipExportFormat,
  ClipExportLayoutStrategy,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  appendJobLog,
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
  resolveOperationProcessingJob,
} from "@/server/agents/processing";
import {
  appendPipelineLog,
  ensureSermonFolders,
  getClipExportFolderPath,
  getClipFormatExportPath,
  getClipFormatExportPathVersioned,
  getSourceVideoPath,
} from "@/server/agents/storage";
import { buildClipExportBaseName, buildSermonExportDirectoryName } from "@/lib/exportNaming";
import {
  checkFfmpegInstalled,
  probeMediaFile,
  type MediaProbe,
} from "@/server/media/ffmpeg";
import {
  SOFTWARE_VIDEO_ENCODER,
  buildVideoEncoderArgs as buildSharedVideoEncoderArgs,
  resolveAudioBitrate,
  resolvePreferredVideoEncoder as resolveSharedPreferredVideoEncoder,
  shouldRetryWithSoftwareEncoder,
} from "@/server/media/videoEncoding";
import {
  buildVerticalFramingFilter,
  getSmartCropFilterRiskReason,
  isFfmpegCropFilterFailure,
  type FramingTreatment,
} from "@/lib/clipFraming";
import {
  markInProgressClipStudioExportsFailed,
  markLatestClipStudioExportCompleted,
} from "@/lib/clipExportSettings";
import { type ClipBrandingConfig, type WatermarkPosition } from "@/lib/clipBranding";
import { getBrandingOverlayDimensions, renderBrandingOverlayPng } from "@/server/agents/brandingOverlay";
import { ensureClipThumbnail } from "@/server/agents/clipThumbnailService";
import {
  assertClipEditPlanStillActive,
  isStaleClipCompositionError,
  preferStaleClipCompositionError,
  recordClipArtifact,
  tryUpdateClipCandidateForActiveEditPlan,
  updateClipCandidateForActiveEditPlan,
  upsertActiveClipEditPlanForClip,
  type ClipEditPlanGuard,
} from "@/server/agents/clipEditPlanService";
import { validateTranscriptSafetyForPublishing } from "@/server/agents/localLanguageTranscriptSafety";
import { extractSpeechCleanupCutPlan } from "@/lib/speechCleanupPlan";
import {
  extractBrollLayerConfig,
  extractHookOverlayConfig,
} from "@/lib/clipStudio";
import { resolveBrandingConfig } from "@/lib/clipBranding";
import {
  capturePromotedMediaIdentity,
  discardPromotedMediaIfUnchanged,
  type PromotedMediaIdentity,
} from "@/server/agents/mediaPromotionGuard";
import {
  ensureResolvedFramingPlanForActiveRevision,
} from "@/server/agents/resolvedFramingPlanService";
import {
  resolveResolvedFramingPlanConsumption,
  type ResolvedFramingPlanConsumption,
  type ResolvedFramingSourceRole,
} from "@/lib/resolvedFramingPlan";

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
  processingJobId?: string;
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
  | "renderFreshness"
  | "renderedFilePath"
  | "captionBurnStatus"
  | "captionBurnFreshness"
  | "captionedVideoPath"
  | "overlayStatus"
  | "overlayFreshness"
  | "overlayVideoPath"
  | "exportStatus"
  | "exportFreshness"
  | "exportFormat"
  | "transcriptSafetyStatus"
> & {
  sermon?: {
    title: string;
    speakerName: string;
    sermonDate: Date | null;
    sourceVideoPath: string | null;
  } | null;
};

type ExportSpec = {
  width: number;
  height: number;
  format: ExportPreset;
};

type ExportSourceKind =
  | "ORIGINAL_SERMON"
  | "PREPARED_OVERLAY"
  | "PREPARED_CAPTIONED"
  | "PREPARED_RENDERED";

type ExportSourceSelection = {
  sourcePath: string | null;
  kind: ExportSourceKind;
  reason: string;
  trim?: {
    startTimeSeconds: number;
    endTimeSeconds: number;
  };
};

type ExportSmartCrop = {
  sourceWidth: number;
  sourceHeight: number;
  subjectCenterX: number;
  subjectCenterY?: number;
  zoom?: number;
  subjectCenters?: Array<{
    timeSeconds: number;
    centerX: number;
    centerY?: number;
    zoom?: number;
    confidence?: number;
    stabilized?: boolean;
    rejected?: boolean;
    frozen?: boolean;
  }>;
  treatment?: FramingTreatment | null;
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

const FALLBACK_VIDEO_ENCODER = SOFTWARE_VIDEO_ENCODER;

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

function resolvePreferredVideoEncoder(): string {
  return resolveSharedPreferredVideoEncoder("export");
}

function isHardwareVideoEncoder(encoder: string): boolean {
  return shouldRetryWithSoftwareEncoder(encoder);
}

function buildVideoEncoderArgs(encoder: string): string[] {
  return buildSharedVideoEncoderArgs(encoder, "export");
}

async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.size > 0;
  } catch {
    return false;
  }
}

function artifactMatchesResolvedFramingPlan(
  metadata: unknown,
  resolvedFramingPlanHash: string,
): boolean {
  return Boolean(
    metadata
    && typeof metadata === "object"
    && !Array.isArray(metadata)
    && (metadata as Record<string, unknown>)["resolvedFramingPlanHash"]
      === resolvedFramingPlanHash,
  );
}

type PreparedExportProvenance = {
  verified: boolean;
  reason: string;
  expectedDurationSeconds: number | null;
};

type PreparedExportPassthroughDecision = {
  eligible: boolean;
  unsafeSource: boolean;
  reason: string;
};

type PreparedArtifactProvenanceRecord = {
  kind: ClipArtifactKind;
  filePath: string | null;
  durationSeconds: number | null;
  metadataJson: unknown;
};

function preparedArtifactKindForSource(
  sourceKind: ExportSourceKind,
): ClipArtifactKind | null {
  if (sourceKind === "PREPARED_OVERLAY") return "OVERLAY";
  if (sourceKind === "PREPARED_CAPTIONED") return "CAPTIONED";
  if (sourceKind === "PREPARED_RENDERED") return "RENDERED_SOURCE";
  return null;
}

async function verifyPreparedExportProvenance(input: {
  clipCandidateId: string;
  editPlan: ClipEditPlanGuard;
  sourceKind: ExportSourceKind;
  sourcePath: string;
  resolvedFramingPlanHash: string;
}): Promise<PreparedExportProvenance> {
  const sourceArtifactKind = preparedArtifactKindForSource(input.sourceKind);
  if (!sourceArtifactKind) {
    return {
      verified: false,
      reason: "Original sermon media must be rendered into the requested export.",
      expectedDurationSeconds: null,
    };
  }

  const artifacts = await prisma.clipArtifact.findMany({
    where: {
      clipCandidateId: input.clipCandidateId,
      editPlanId: input.editPlan.editPlanId,
      planHash: input.editPlan.planHash,
      status: "READY",
      freshness: "UP_TO_DATE",
      kind: {
        in: Array.from(new Set<ClipArtifactKind>([
          sourceArtifactKind,
          "RENDERED_SOURCE",
        ])),
      },
    },
    orderBy: { generatedAt: "desc" },
    select: {
      kind: true,
      filePath: true,
      durationSeconds: true,
      metadataJson: true,
    },
  });
  return decidePreparedExportProvenance({
    sourceArtifactKind,
    sourcePath: input.sourcePath,
    resolvedFramingPlanHash: input.resolvedFramingPlanHash,
    artifacts,
  });
}

function decidePreparedExportProvenance(input: {
  sourceArtifactKind: ClipArtifactKind;
  sourcePath: string;
  resolvedFramingPlanHash: string;
  artifacts: PreparedArtifactProvenanceRecord[];
}): PreparedExportProvenance {
  const sourceArtifact = input.artifacts.find(
    (artifact) => artifact.kind === input.sourceArtifactKind && artifact.filePath === input.sourcePath,
  );
  if (!sourceArtifact) {
    return {
      verified: false,
      reason: "The selected prepared file has no READY artifact for the active Studio revision.",
      expectedDurationSeconds: null,
    };
  }

  const renderedArtifact = input.artifacts.find(
    (artifact) => artifact.kind === "RENDERED_SOURCE"
      && artifactMatchesResolvedFramingPlan(
        artifact.metadataJson,
        input.resolvedFramingPlanHash,
      ),
  );
  if (!renderedArtifact) {
    return {
      verified: false,
      reason: "The active revision has no prepared base artifact with the exact framing identity.",
      expectedDurationSeconds: null,
    };
  }

  if (
    input.sourceArtifactKind !== "CAPTIONED"
    && !artifactMatchesResolvedFramingPlan(
      sourceArtifact.metadataJson,
      input.resolvedFramingPlanHash,
    )
  ) {
    return {
      verified: false,
      reason: "The selected prepared file does not carry the active framing identity.",
      expectedDurationSeconds: renderedArtifact.durationSeconds,
    };
  }

  return {
    verified: true,
    reason: "The selected prepared file belongs to the active Studio revision and canonical framing plan.",
    expectedDurationSeconds: renderedArtifact.durationSeconds,
  };
}

function isNearZero(value: number | null): boolean {
  return value === null || Math.abs(value) <= 0.05;
}

function decidePreparedExportPassthrough(input: {
  format: ExportPreset;
  sourceKind: ExportSourceKind;
  sourcePath: string;
  outputPath: string;
  trim?: ExportSourceSelection["trim"];
  hasAdditionalBrandingOverlay: boolean;
  framing: Pick<
    ResolvedFramingPlanConsumption,
    "shouldApplyFraming" | "framingAlreadyApplied" | "preserveWithSafeFit"
  >;
  provenance: PreparedExportProvenance;
  probe: MediaProbe;
}): PreparedExportPassthroughDecision {
  if (!preparedArtifactKindForSource(input.sourceKind)) {
    return { eligible: false, unsafeSource: false, reason: "The original sermon source requires rendering." };
  }
  if (input.format !== "VERTICAL_9_16") {
    return { eligible: false, unsafeSource: false, reason: "Only the canonical vertical master can be copied without reframing." };
  }
  if (input.trim) {
    return { eligible: false, unsafeSource: false, reason: "The requested export still requires source trimming." };
  }
  if (input.hasAdditionalBrandingOverlay) {
    return { eligible: false, unsafeSource: false, reason: "An additional branding layer still needs to be rendered." };
  }
  if (
    input.framing.shouldApplyFraming
    || !input.framing.framingAlreadyApplied
    || input.framing.preserveWithSafeFit
  ) {
    return { eligible: false, unsafeSource: false, reason: "The requested export still requires a framing transform." };
  }
  if (path.resolve(input.sourcePath) === path.resolve(input.outputPath)) {
    return { eligible: false, unsafeSource: false, reason: "The immutable export path must differ from its prepared source." };
  }
  if (!input.provenance.verified) {
    return { eligible: false, unsafeSource: false, reason: input.provenance.reason };
  }
  if (!input.probe.formatNames.some((name) => name === "mp4" || name === "mov")) {
    return { eligible: false, unsafeSource: false, reason: "The prepared source is not an MP4-compatible container." };
  }
  if (!isNearZero(input.probe.startTimeSeconds)) {
    return { eligible: false, unsafeSource: false, reason: "The prepared source has a non-zero container start time." };
  }

  const videoStreams = input.probe.streams.filter((stream) => stream.codecType === "video");
  const audioStreams = input.probe.streams.filter((stream) => stream.codecType === "audio");
  if (
    videoStreams.length !== 1
    || audioStreams.length > 1
    || input.probe.streams.length !== videoStreams.length + audioStreams.length
  ) {
    return { eligible: false, unsafeSource: false, reason: "The prepared source has an unsupported stream layout." };
  }

  const video = videoStreams[0];
  if (
    video.codecName !== "h264"
    || video.width !== EXPORT_SPECS.VERTICAL_9_16.width
    || video.height !== EXPORT_SPECS.VERTICAL_9_16.height
    || video.pixelFormat !== "yuv420p"
    || video.sampleAspectRatio !== "1:1"
    || !isNearZero(video.startTimeSeconds)
    || Math.abs(video.rotationDegrees % 360) > 0.01
  ) {
    return {
      eligible: false,
      unsafeSource: false,
      reason: "The prepared video needs compatibility normalization before publishing.",
    };
  }

  const audio = audioStreams[0];
  if (audio && (audio.codecName !== "aac" || !isNearZero(audio.startTimeSeconds))) {
    return {
      eligible: false,
      unsafeSource: false,
      reason: "The prepared audio needs compatibility normalization before publishing.",
    };
  }

  if (input.probe.durationSeconds === null) {
    return {
      eligible: false,
      unsafeSource: true,
      reason: "The prepared source duration could not be verified.",
    };
  }
  if (
    input.provenance.expectedDurationSeconds !== null
    && Math.abs(input.probe.durationSeconds - input.provenance.expectedDurationSeconds)
      > Math.max(0.75, input.provenance.expectedDurationSeconds * 0.01)
  ) {
    return {
      eligible: false,
      unsafeSource: true,
      reason: "The prepared source duration does not match the active rendered artifact.",
    };
  }

  return {
    eligible: true,
    unsafeSource: false,
    reason: "The active prepared portrait master is already platform-compatible; preserve its exact video and audio bytes.",
  };
}

async function copyPreparedExportSource(input: {
  sourcePath: string;
  tempPath: string;
}): Promise<void> {
  const sourceStats = await stat(input.sourcePath);
  if (sourceStats.size <= 0) {
    throw new Error("Prepared export source is empty.");
  }

  await copyFile(input.sourcePath, input.tempPath);
  const copiedStats = await stat(input.tempPath);
  if (copiedStats.size !== sourceStats.size || copiedStats.size <= 0) {
    await unlink(input.tempPath).catch(() => undefined);
    throw new Error("Lossless export copy did not preserve the complete prepared file.");
  }
}

function buildVideoFilter(
  spec: ExportSpec,
  layout: ExportLayoutStrategy,
  smartCrop?: ExportSmartCrop | null,
  treatment?: FramingTreatment | null,
): string {
  if (spec.format === "VERTICAL_9_16") {
    return buildVerticalFramingFilter(layout, {
      ...(smartCrop ?? {}),
      treatment: treatment ?? smartCrop?.treatment,
    });
  }

  if (layout === "FIT_BLURRED_BACKGROUND") {
    if (treatment === "WORSHIP_WIDE" || treatment === "FULL_STAGE") {
      const insetRatio = treatment === "WORSHIP_WIDE" ? 0.963 : 0.85;
      const insetWidth = Math.round(spec.width * insetRatio);
      const insetHeight = Math.round(spec.height * insetRatio);
      const backgroundColor = treatment === "WORSHIP_WIDE" ? "0x111318" : "0x08090b";
      return `[0:v]scale=${insetWidth}:${insetHeight}:force_original_aspect_ratio=decrease,pad=${spec.width}:${spec.height}:(ow-iw)/2:(oh-ih)/2:color=${backgroundColor},format=yuv420p[v]`;
    }

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

function shouldPreservePreparedManualFraming(input: {
  format: ExportPreset;
  sourceKind: ExportSourceKind;
  hasManualCrop: boolean;
}): boolean {
  return input.hasManualCrop
    && input.format === "VERTICAL_9_16"
    && input.sourceKind !== "ORIGINAL_SERMON";
}

function shouldUseSafePreparedVisualFit(input: {
  format: ExportPreset;
  sourceKind: ExportSourceKind;
}): boolean {
  return input.format !== "VERTICAL_9_16"
    && (input.sourceKind === "PREPARED_OVERLAY" || input.sourceKind === "PREPARED_CAPTIONED");
}

function getTempPath(outputPath: string, editPlanId: string): string {
  const planSuffix = editPlanId.replace(/[^a-zA-Z0-9_-]/g, "");
  return outputPath.replace(/\.mp4$/i, `.plan-${planSuffix}.partial.mp4`);
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
  trim?: {
    startTimeSeconds: number;
    endTimeSeconds: number;
  };
}): Promise<void> {
  const command = commandFor(input.ffmpegPath);
  const videoEncoder = input.videoEncoder ?? resolvePreferredVideoEncoder();
  const args = ["-y"];
  if (input.trim) {
    const durationSeconds = Math.max(0.01, input.trim.endTimeSeconds - input.trim.startTimeSeconds);
    args.push(
      "-ss",
      String(input.trim.startTimeSeconds),
      "-t",
      String(Number(durationSeconds.toFixed(3))),
    );
  }
  args.push("-i", input.sourcePath);

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
    resolveAudioBitrate("export"),
    "-movflags",
    "+faststart",
    input.outputPath,
  );

  const trimSummary = input.trim
    ? ` range ${input.trim.startTimeSeconds.toFixed(2)}-${input.trim.endTimeSeconds.toFixed(2)}s`
    : "";
  await appendPipelineLog(input.sermonId, `Clip export started from ${input.sourcePath}${trimSummary} with encoder: ${videoEncoder}.`);

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

async function validateVideoInput(
  inputPath: string,
  ffmpegPath?: string,
  trim?: { startTimeSeconds: number; endTimeSeconds: number },
): Promise<void> {
  const command = commandFor(ffmpegPath);
  const args = ["-v", "error"];
  if (trim) {
    args.push("-ss", String(trim.startTimeSeconds));
  }
  args.push("-i", inputPath, "-t", "2", "-f", "null", "-");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(new Error(`Unable to validate source video: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Video source is not a valid export input. ${stderr.trim().slice(-800)}`.trim()));
    });
  });
}

async function failExport(guard: ClipEditPlanGuard, message: string): Promise<void> {
  await tryUpdateClipCandidateForActiveEditPlan({
    guard,
    data: {
      exportStatus: "FAILED",
      exportError: message,
      exportFreshness: "FAILED",
    },
  });
}

function validateExportEligibility(input: {
  clip: Pick<ClipForExport, "renderStatus" | "exportStatus" | "exportFormat" | "exportFreshness"> &
    { transcriptSafetyStatus?: ClipForExport["transcriptSafetyStatus"] } &
    Record<string, unknown>;
  sourcePath: string | null;
  sourceExists: boolean;
  format: ExportPreset;
  allowReexport: boolean;
}): { ok: boolean; reason?: string; shouldMarkFailed?: boolean } {
  const transcriptSafety = validateTranscriptSafetyForPublishing({
    transcriptSafetyStatus: input.clip.transcriptSafetyStatus ?? "TRUSTED",
  });
  if (!transcriptSafety.ok) {
    return { ok: false, reason: transcriptSafety.reason, shouldMarkFailed: false };
  }

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
    input.clip.exportFreshness === "UP_TO_DATE" &&
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
      renderFreshness: true,
      renderedFilePath: true,
      captionBurnStatus: true,
      captionBurnFreshness: true,
      captionedVideoPath: true,
      overlayStatus: true,
      overlayFreshness: true,
      overlayVideoPath: true,
      exportStatus: true,
      exportFreshness: true,
      exportFormat: true,
      transcriptSafetyStatus: true,
      sermon: {
        select: {
          title: true,
          speakerName: true,
          sermonDate: true,
          sourceVideoPath: true,
        },
      },
    },
  });

  if (!clip) {
    throw new Error(`Clip candidate ${clipId} was not found.`);
  }

  return clip;
}

function resolveRenderBoundaries(clip: Pick<ClipForExport, "startTimeSeconds" | "endTimeSeconds" | "adjustedStartTimeSeconds" | "adjustedEndTimeSeconds">): {
  startTimeSeconds: number;
  endTimeSeconds: number;
} {
  return {
    startTimeSeconds: clip.adjustedStartTimeSeconds ?? clip.startTimeSeconds,
    endTimeSeconds: clip.adjustedEndTimeSeconds ?? clip.endTimeSeconds,
  };
}

function resolvePreparedExportSourceSelection(
  clip: Pick<
    ClipForExport,
    | "captionData"
    | "renderStatus"
    | "renderFreshness"
    | "renderedFilePath"
    | "captionBurnStatus"
    | "captionBurnFreshness"
    | "captionedVideoPath"
    | "overlayStatus"
    | "overlayFreshness"
    | "overlayVideoPath"
  >,
): ExportSourceSelection {
  const hookOverlay = extractHookOverlayConfig(clip.captionData, null);
  const brollLayer = extractBrollLayerConfig(clip.captionData);
  const branding = resolveBrandingConfig(clip.captionData);
  const requiresPreparedOverlay = Boolean(
    (hookOverlay.enabled && hookOverlay.text.trim())
    || (brollLayer.enabled && brollLayer.cards.length > 0)
    || (
      branding.enabled
      && branding.preset !== "NO_BRANDING"
      && (
        branding.watermarkEnabled
        || branding.lowerThirdEnabled
        || branding.introEnabled
        || branding.outroEnabled
      )
    ),
  );

  if (clip.overlayStatus === "COMPLETED" || clip.overlayVideoPath) {
    if (clip.overlayStatus !== "COMPLETED" || clip.overlayFreshness !== "UP_TO_DATE" || !clip.overlayVideoPath) {
      throw new Error("The prepared overlay is stale or incomplete. Rebuild branding before exporting this clip.");
    }
    return {
      sourcePath: clip.overlayVideoPath,
      kind: "PREPARED_OVERLAY",
      reason: "Prepared overlay output preserves approved captions and branding overlays.",
    };
  }

  if (requiresPreparedOverlay) {
    throw new Error(
      "This clip has approved hook, B-roll, or branding layers, but its prepared overlay is missing. Rebuild branding before exporting.",
    );
  }

  if (clip.captionBurnStatus === "COMPLETED" || clip.captionedVideoPath) {
    if (clip.captionBurnStatus !== "COMPLETED" || clip.captionBurnFreshness !== "UP_TO_DATE" || !clip.captionedVideoPath) {
      throw new Error("The prepared captioned video is stale or incomplete. Rebuild burned captions before exporting this clip.");
    }
    return {
      sourcePath: clip.captionedVideoPath,
      kind: "PREPARED_CAPTIONED",
      reason: "Prepared captioned output preserves approved burned-in captions.",
    };
  }

  const captionData = clip.captionData && typeof clip.captionData === "object" && !Array.isArray(clip.captionData)
    ? clip.captionData as Record<string, unknown>
    : {};
  if (captionData["applyCaptionsToClip"] !== false) {
    throw new Error("Captions are enabled, but the captioned video is stale or incomplete. Rebuild burned captions before exporting this clip.");
  }

  if (clip.renderStatus !== "COMPLETED" || clip.renderFreshness !== "UP_TO_DATE" || !clip.renderedFilePath) {
    throw new Error("The prepared render is stale or incomplete. Rebuild the clip before exporting it.");
  }

  return {
    sourcePath: clip.renderedFilePath,
    kind: "PREPARED_RENDERED",
    reason: "Prepared rendered clip is the safest available export source.",
  };
}

export function resolvePreparedExportSource(
  clip: Pick<
    ClipForExport,
    | "captionData"
    | "renderStatus"
    | "renderFreshness"
    | "renderedFilePath"
    | "captionBurnStatus"
    | "captionBurnFreshness"
    | "captionedVideoPath"
    | "overlayStatus"
    | "overlayFreshness"
    | "overlayVideoPath"
  >,
): string | null {
  return resolvePreparedExportSourceSelection(clip).sourcePath;
}

function hasPreparedVisualLayers(
  clip: Pick<ClipForExport, "captionBurnStatus" | "captionedVideoPath" | "overlayStatus" | "overlayVideoPath">,
): boolean {
  return Boolean(
    (clip.overlayStatus === "COMPLETED" && clip.overlayVideoPath)
    || (clip.captionBurnStatus === "COMPLETED" && clip.captionedVideoPath),
  );
}

function hasSpeechCleanupCutPlan(clip: Pick<ClipForExport, "captionData">): boolean {
  return Boolean(extractSpeechCleanupCutPlan(clip.captionData));
}

function uniquePaths(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of paths) {
    const value = item?.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}

async function resolveOriginalSermonSourcePath(clip: Pick<ClipForExport, "sermonId" | "sermon">): Promise<string | null> {
  const candidates = uniquePaths([
    getSourceVideoPath(clip.sermonId),
    clip.sermon?.sourceVideoPath,
  ]);

  for (const candidate of candidates) {
    if (await fileHasBytes(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function resolveBestExportSource(clip: ClipForExport): Promise<ExportSourceSelection> {
  const prepared = resolvePreparedExportSourceSelection(clip);

  if (hasPreparedVisualLayers(clip)) {
    return prepared;
  }

  if (hasSpeechCleanupCutPlan(clip)) {
    return {
      ...prepared,
      reason: "Prepared rendered clip preserves the approved speech cleanup cut plan.",
    };
  }

  const originalSourcePath = await resolveOriginalSermonSourcePath(clip);
  if (!originalSourcePath) {
    return {
      ...prepared,
      reason: "Original sermon source was unavailable, so the prepared rendered clip is used.",
    };
  }

  const boundaries = resolveRenderBoundaries(clip);
  return {
    sourcePath: originalSourcePath,
    kind: "ORIGINAL_SERMON",
    reason: "Original sermon source avoids an extra generation of video compression.",
    trim: boundaries,
  };
}

export async function exportClipWithPreset(
  clipCandidateId: string,
  options?: ClipExportOptions,
): Promise<{ clipId: string; format: ExportPreset; exportPath: string }> {
  const clipId = clipCandidateId.trim();
  if (!clipId) {
    throw new Error("Clip id is required for export.");
  }

  const { plan: startedEditPlan } = await upsertActiveClipEditPlanForClip({
    clipCandidateId: clipId,
    createdBy: "export",
    createdReason: "export_input_snapshot",
  });
  const editPlanGuard = {
    clipCandidateId: clipId,
    editPlanId: startedEditPlan.id,
    planHash: startedEditPlan.planHash,
  };

  const format = options?.format ?? "VERTICAL_9_16";
  const layoutStrategy = options?.layoutStrategy ?? "CENTER_CROP";
  const spec = EXPORT_SPECS[format];

  const clip = await loadClip(clipId);
  await assertClipEditPlanStillActive(editPlanGuard);
  await ensureSermonFolders(clip.sermonId);

  const transcriptSafety = validateTranscriptSafetyForPublishing(clip);
  if (!transcriptSafety.ok) {
    throw new Error(transcriptSafety.reason);
  }

  const exportSource = await resolveBestExportSource(clip);
  const sourcePath = exportSource.sourcePath;
  const sourceExists = sourcePath ? await fileHasBytes(sourcePath) : false;
  const originalSourcePath = await resolveOriginalSermonSourcePath(clip);
  let resolvedFramingRecord = sourcePath
    ? await ensureResolvedFramingPlanForActiveRevision({
        guard: editPlanGuard,
        sourceVideoPath: originalSourcePath ?? sourcePath,
        ffmpegPath: options?.ffmpegPath,
        applicationMode: "APPLY_TO_ORIGINAL_EXPORT",
      })
    : null;
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
  const reusableArtifact = resolvedFramingRecord
    ? await prisma.clipArtifact.findFirst({
        where: {
          clipCandidateId: clip.id,
          editPlanId: editPlanGuard.editPlanId,
          planHash: editPlanGuard.planHash,
          kind: "EXPORT",
          status: "READY",
          freshness: "UP_TO_DATE",
          format,
          filePath: outputPath,
        },
        orderBy: { createdAt: "desc" },
        select: { metadataJson: true },
      })
    : null;
  const framingIdentityMatches = Boolean(
    resolvedFramingRecord
    && artifactMatchesResolvedFramingPlan(
      reusableArtifact?.metadataJson,
      resolvedFramingRecord.planHash,
    ),
  );

  if (
    outputExists
    && clip.exportFreshness === "UP_TO_DATE"
    && framingIdentityMatches
    && !options?.allowReexport
    && !options?.force
  ) {
    const outputStats = await stat(outputPath).catch(() => null);
    await updateClipCandidateForActiveEditPlan({
      guard: editPlanGuard,
      data: {
        exportStatus: "COMPLETED",
        exportFormat: format,
        exportLayoutStrategy: layoutStrategy,
        exportedFilePath: outputPath,
        exportPath: outputPath,
        exportedAt: new Date(),
        exportError: null,
        captionData: markLatestClipStudioExportCompleted(clip.captionData, {
          format,
          outputPath,
          outputFilename: path.basename(outputPath),
          fileSizeBytes: outputStats?.size ?? null,
          captionBurnStatus: clip.captionBurnStatus,
        }) as Prisma.InputJsonObject,
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
    await recordClipArtifact({
      clipCandidateId: clip.id,
      kind: "EXPORT",
      format,
      filePath: outputPath,
      sizeBytes: outputStats?.size ?? null,
      metadata: {
        reusedExistingFile: true,
        layoutStrategy,
        sourceKind: exportSource.kind,
        resolvedFramingPlanHash: resolvedFramingRecord?.planHash ?? null,
        resolvedFramingPlanStatus: resolvedFramingRecord?.status ?? null,
      },
      editPlan: {
        editPlanId: editPlanGuard.editPlanId,
        planHash: editPlanGuard.planHash,
      },
    });

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
      await failExport(editPlanGuard, eligibility.reason ?? "Clip is not eligible for export.");
    }
    throw new Error(eligibility.reason ?? "Clip is not eligible for export.");
  }

  const ffmpegInstalled = await checkFfmpegInstalled(options?.ffmpegPath);
  if (!ffmpegInstalled) {
    const message = "FFmpeg is not installed or not executable.";
    await failExport(editPlanGuard, message);
    throw new Error(message);
  }

  const exportSourcePath = sourcePath;
  if (!exportSourcePath) {
    throw new Error("Prepared video source is missing.");
  }

  await validateVideoInput(exportSourcePath, options?.ffmpegPath, exportSource.trim);

  const processingJob = await resolveOperationProcessingJob(
    clip.sermonId,
    "EXPORT_CLIPS",
    options?.processingJobId,
    ["EXPORT_CLIPS", "RENDER_OVERLAY"],
  );
  const { job, ownsLifecycle } = processingJob;

  const queued = await prisma.clipCandidate.updateMany({
    where: {
      id: clip.id,
      editPlans: {
        some: {
          id: editPlanGuard.editPlanId,
          planHash: editPlanGuard.planHash,
          status: "ACTIVE",
        },
      },
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
    if (ownsLifecycle) {
      await markJobFailed(
        job.id,
        "Clip export is already in progress. Duplicate request blocked.",
        "Clip export was not started.",
      ).catch(() => undefined);
    }
    await assertClipEditPlanStillActive(editPlanGuard);
    throw new Error("Clip export is already in progress. Duplicate request blocked.");
  }

  const startedAt = Date.now();
  let promotedOutputIdentity: PromotedMediaIdentity | null = null;

  try {
    await assertClipEditPlanStillActive(editPlanGuard);
    if (ownsLifecycle) {
      await markJobRunning(job.id);
    }
    await appendJobLog(job.id, `Export requested for clip ${clip.id} with format ${format}.`);
    await appendJobLog(job.id, `Export source selected: ${exportSource.kind}. ${exportSource.reason}`);
    await appendPipelineLog(clip.sermonId, `Export source selected for clip ${clip.id}: ${exportSource.kind}. ${exportSource.reason}`);

    await updateClipCandidateForActiveEditPlan({
      guard: editPlanGuard,
      data: {
        exportStatus: "EXPORTING",
        exportError: null,
      },
    });

    resolvedFramingRecord ??= await ensureResolvedFramingPlanForActiveRevision({
      guard: editPlanGuard,
      sourceVideoPath: originalSourcePath ?? exportSourcePath,
      ffmpegPath: options?.ffmpegPath,
      applicationMode: "APPLY_TO_ORIGINAL_EXPORT",
    });
    const sourceRole: ResolvedFramingSourceRole = exportSource.kind === "ORIGINAL_SERMON"
      ? "ORIGINAL_SOURCE"
      : "PREPARED_DERIVATIVE";
    const framingConsumption = resolveResolvedFramingPlanConsumption({
      plan: resolvedFramingRecord.plan,
      sourceRole,
      outputWidth: spec.width,
      outputHeight: spec.height,
    });
    const effectiveLayoutStrategy: ExportLayoutStrategy = framingConsumption.layout;
    const framingTreatment = framingConsumption.treatment;
    const effectiveSmartCrop: ExportSmartCrop | null = framingConsumption.smartCrop;
    const filter = buildVideoFilter(
      spec,
      effectiveLayoutStrategy,
      effectiveSmartCrop,
      framingTreatment,
    );
    if (effectiveLayoutStrategy === "SMART_CROP") {
      const filterRiskReason = getSmartCropFilterRiskReason(filter);
      if (filterRiskReason) {
        throw new Error(
          `The active framing plan cannot be exported safely (${filterRiskReason}). Rebuild the base video so one canonical fallback can be resolved before export.`,
        );
      }
    }
    await appendPipelineLog(
      clip.sermonId,
      `Canonical framing plan ${resolvedFramingRecord.planHash} selected ${framingTreatment} for clip ${clip.id}. ${framingConsumption.reason}`,
    );
    const tempPath = getTempPath(outputPath, editPlanGuard.editPlanId);
    const overlayDimensions = getBrandingOverlayDimensions(format);
    const brandingOverlayPath = tempPath.replace(/\.mp4$/i, ".branding.png");
    let fullFilter = filter;
    let overlayEnabled = false;

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
    let completedVideoEncoder = preferredVideoEncoder;
    let completedAudioBitrate = resolveAudioBitrate("export");
    let exportMethod: "TRANSCODE" | "LOSSLESS_SOURCE_COPY" = "TRANSCODE";
    let sourceProbe: MediaProbe | null = null;
    const exportWithEncoder = async (videoEncoder: string) => {
      await runFfmpeg({
        sourcePath: exportSourcePath,
        outputPath: tempPath,
        ffmpegPath: options?.ffmpegPath,
        filter: fullFilter,
        brandingOverlayPath: overlayEnabled ? brandingOverlayPath : undefined,
        sermonId: clip.sermonId,
        jobId: job.id,
        videoEncoder,
        trim: exportSource.trim,
      });
      completedVideoEncoder = videoEncoder;
    };

    const provenance = await verifyPreparedExportProvenance({
      clipCandidateId: clip.id,
      editPlan: editPlanGuard,
      sourceKind: exportSource.kind,
      sourcePath: exportSourcePath,
      resolvedFramingPlanHash: resolvedFramingRecord.planHash,
    });
    const canProbeForPassthrough = Boolean(
      preparedArtifactKindForSource(exportSource.kind)
      && format === "VERTICAL_9_16"
      && !exportSource.trim
      && !options?.brandingOverlay
      && !framingConsumption.shouldApplyFraming
      && framingConsumption.framingAlreadyApplied
      && !framingConsumption.preserveWithSafeFit
      && path.resolve(exportSourcePath) !== path.resolve(outputPath),
    );
    if (canProbeForPassthrough) {
      try {
        sourceProbe = await probeMediaFile(exportSourcePath, options?.ffmpegPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown media probe error.";
        await appendJobLog(job.id, `Lossless export probe was unavailable; using the compatibility encoder. ${message}`);
      }
    }

    const passthroughDecision = sourceProbe
      ? decidePreparedExportPassthrough({
          format,
          sourceKind: exportSource.kind,
          sourcePath: exportSourcePath,
          outputPath,
          trim: exportSource.trim,
          hasAdditionalBrandingOverlay: Boolean(options?.brandingOverlay),
          framing: framingConsumption,
          provenance,
          probe: sourceProbe,
        })
      : {
          eligible: false,
          unsafeSource: false,
          reason: canProbeForPassthrough
            ? provenance.reason
            : "The export still requires a media transform.",
        };
    if (passthroughDecision.unsafeSource) {
      throw new Error(`The prepared video failed final integrity checks. ${passthroughDecision.reason}`);
    }

    let copiedPreparedSource = false;
    if (passthroughDecision.eligible) {
      try {
        await copyPreparedExportSource({
          sourcePath: exportSourcePath,
          tempPath,
        });
        copiedPreparedSource = true;
        exportMethod = "LOSSLESS_SOURCE_COPY";
        completedVideoEncoder = "copy";
        completedAudioBitrate = "source";
        await appendJobLog(job.id, `Lossless final export used for ${clip.id}. ${passthroughDecision.reason}`);
        await appendPipelineLog(
          clip.sermonId,
          `Lossless final export preserved the active prepared video for clip ${clip.id}; no additional video or audio encode was needed.`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown lossless export copy error.";
        await unlink(tempPath).catch(() => undefined);
        await appendJobLog(job.id, `Lossless export copy failed; using the compatibility encoder. ${message}`);
      }
    } else if (canProbeForPassthrough) {
      await appendJobLog(job.id, `Lossless export was not eligible; using the compatibility encoder. ${passthroughDecision.reason}`);
    }

    if (!copiedPreparedSource) {
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
        if (effectiveLayoutStrategy === "SMART_CROP" && isFfmpegCropFilterFailure(message)) {
          throw new Error(
            `The canonical tracked framing failed during export. Rebuild the base video to resolve one shared fallback before exporting. Original error: ${message}`,
            { cause: error },
          );
        }
        throw error;
      }
    }

    await assertClipEditPlanStillActive(editPlanGuard);
    await rename(tempPath, outputPath);
    promotedOutputIdentity = await capturePromotedMediaIdentity(outputPath);

    if (overlayEnabled) {
      await unlink(brandingOverlayPath).catch(() => undefined);
    }

    const outputStats = await stat(outputPath);
    if (outputStats.size <= 0) {
      await unlink(outputPath).catch(() => undefined);
      throw new Error("Export produced an empty output file.");
    }
    await appendJobLog(job.id, `Exported file size for ${clip.id}: ${outputStats.size} bytes.`);
    await updateClipCandidateForActiveEditPlan({
      guard: editPlanGuard,
      data: {
        ...buildExportMetadata({
          format,
          layout: layoutStrategy,
          outputPath,
        }),
        captionData: {
          ...markLatestClipStudioExportCompleted(clip.captionData, {
            format,
            outputPath,
            outputFilename: path.basename(outputPath),
            fileSizeBytes: outputStats.size,
            captionBurnStatus: clip.captionBurnStatus,
          }),
          framingDecision: {
            requestedPersonality: resolvedFramingRecord.plan.requested.personality,
            resolvedPersonality: resolvedFramingRecord.plan.effective.resolvedPersonality,
            shotStyle: resolvedFramingRecord.plan.effective.shotStyle,
            effectiveLayout: resolvedFramingRecord.plan.effective.layout,
            treatment: resolvedFramingRecord.plan.effective.treatment,
            zoom: resolvedFramingRecord.plan.effective.zoom,
            motionSmoothing: resolvedFramingRecord.plan.effective.motionSmoothing,
            captionSafeArea: resolvedFramingRecord.plan.effective.captionSafeArea,
            visualQualityScore: resolvedFramingRecord.plan.quality.visualQualityScore,
            speakerVisiblePercentage: resolvedFramingRecord.plan.quality.speakerVisiblePercentage,
            frameQualityLabel: resolvedFramingRecord.plan.quality.frameQualityLabel,
            manualCropRecommended: resolvedFramingRecord.plan.quality.manualCropRecommended,
            reasonCodes: resolvedFramingRecord.plan.resolution.reasonCodes,
            summary: resolvedFramingRecord.plan.resolution.summary,
            frameQualitySummary: resolvedFramingRecord.plan.quality.frameQualitySummary,
            resolvedFramingPlanHash: resolvedFramingRecord.planHash,
            updatedAt: new Date().toISOString(),
          },
          exportSource: {
            kind: exportSource.kind,
            reason: exportSource.reason,
            trim: exportSource.trim ?? null,
            updatedAt: new Date().toISOString(),
          },
          exportQualityProfile: {
            videoEncoder: completedVideoEncoder,
            audioBitrate: completedAudioBitrate,
            exportMethod,
            targetWidth: spec.width,
            targetHeight: spec.height,
            format,
            updatedAt: new Date().toISOString(),
          },
        },
        visualQualityScore: resolvedFramingRecord.plan.quality.visualQualityScore,
        visualReadinessScore: resolvedFramingRecord.plan.quality.visualQualityScore,
        speakerVisiblePercentage: resolvedFramingRecord.plan.quality.speakerVisiblePercentage,
        averageTrackingConfidence: resolvedFramingRecord.plan.quality.averageTrackingConfidence,
        cropStabilityScore: resolvedFramingRecord.plan.quality.cropStabilityScore,
        assetInvalidationReason: null,
        exportFreshness: "UP_TO_DATE",
        exportAssetVersion: { increment: 1 },
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
    await recordClipArtifact({
      clipCandidateId: clip.id,
      kind: "EXPORT",
      format,
      filePath: outputPath,
      sizeBytes: outputStats.size,
      metadata: {
        reusedExistingFile: false,
        requestedLayoutStrategy: layoutStrategy,
        effectiveLayoutStrategy,
        framingTreatment,
        framingDecision: resolvedFramingRecord.plan.resolution.reasonCodes,
        resolvedFramingPlanHash: resolvedFramingRecord.planHash,
        resolvedFramingPlanStatus: resolvedFramingRecord.status,
        brandingOverlayApplied: overlayEnabled,
        sourceKind: exportSource.kind,
        sourceReason: exportSource.reason,
        sourceTrim: exportSource.trim ?? null,
        videoEncoder: completedVideoEncoder,
        audioBitrate: completedAudioBitrate,
        exportMethod,
        sourceVideoCodec: sourceProbe?.streams.find((stream) => stream.codecType === "video")?.codecName ?? null,
        sourcePixelFormat: sourceProbe?.streams.find((stream) => stream.codecType === "video")?.pixelFormat ?? null,
        sourceAudioCodec: sourceProbe?.streams.find((stream) => stream.codecType === "audio")?.codecName ?? null,
      },
      editPlan: {
        editPlanId: editPlanGuard.editPlanId,
        planHash: editPlanGuard.planHash,
      },
    });

    const elapsedMs = Date.now() - startedAt;
    await appendPipelineLog(clip.sermonId, `Clip ${clip.id} export ${format} completed in ${elapsedMs}ms.`);
    if (ownsLifecycle) {
      await markJobSucceeded(job.id, `Clip ${clip.id} export ${format} completed in ${elapsedMs}ms.`);
    }

    return {
      clipId: clip.id,
      format,
      exportPath: outputPath,
    };
  } catch (error) {
    const completionError = await preferStaleClipCompositionError(editPlanGuard, error);
    const message = completionError instanceof Error ? completionError.message : "Unknown clip export error.";
    await unlink(getTempPath(outputPath, editPlanGuard.editPlanId)).catch(() => undefined);

    if (isStaleClipCompositionError(completionError)) {
      if (promotedOutputIdentity) {
        await discardPromotedMediaIfUnchanged(outputPath, promotedOutputIdentity);
      }
      if (ownsLifecycle) {
        await markJobFailed(job.id, message, `Stale export for clip ${clip.id} discarded after newer Clip Studio changes.`).catch(() => undefined);
      }
      await appendPipelineLog(clip.sermonId, `Discarded stale export for clip ${clip.id}: ${message}`).catch(() => undefined);
      throw completionError;
    }

    const failureRecorded = await tryUpdateClipCandidateForActiveEditPlan({
      guard: editPlanGuard,
      data: {
        exportStatus: "FAILED",
        exportError: message,
        exportFreshness: "FAILED",
        captionData: markInProgressClipStudioExportsFailed(
          clip.captionData,
          `Final video export failed: ${message}`,
        ) as Prisma.InputJsonObject,
      },
    });
    if (failureRecorded) {
      await recordClipArtifact({
        clipCandidateId: clip.id,
        kind: "EXPORT",
        status: "FAILED",
        format,
        filePath: outputPath,
        errorMessage: message,
        metadata: {
          layoutStrategy,
        },
        editPlan: {
          editPlanId: editPlanGuard.editPlanId,
          planHash: editPlanGuard.planHash,
        },
      }).catch(() => undefined);
    }
    if (ownsLifecycle) {
      await markJobFailed(job.id, message, `Clip ${clip.id} export failed.`);
    } else {
      await appendJobLog(job.id, `Clip ${clip.id} export ${format} failed: ${message}`).catch(() => undefined);
    }
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
  artifactMatchesResolvedFramingPlan,
  buildVideoEncoderArgs,
  buildVideoFilter,
  copyPreparedExportSource,
  decidePreparedExportProvenance,
  decidePreparedExportPassthrough,
  validateExportEligibility,
  buildExportMetadata,
  getSmartCropFilterRiskReason,
  fileHasBytes,
  resolvePreparedExportSource,
  resolveBestExportSource,
  shouldPreservePreparedManualFraming,
  shouldUseSafePreparedVisualFit,
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
