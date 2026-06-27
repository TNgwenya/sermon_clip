import { rename, stat, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";

import type { ClipCandidate, ClipRenderStatus, Prisma } from "@prisma/client";

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
  getClipOutputPath,
  getSourceVideoPath,
} from "@/server/agents/storage";
import {
  HARD_MAX_DURATION_SECONDS,
  HARD_MIN_DURATION_SECONDS,
  validateBoundaryTimes,
} from "@/server/agents/clipBoundaryRefinement";
import { checkFfmpegInstalled } from "@/server/media/ffmpeg";
import { getMediaDimensions } from "@/server/media/ffmpeg";
import { parseSilenceDetectEvents, parseSilenceDetectOutput } from "@/server/agents/audioQualityScoringService";
import { resolveSmartCropCenter, resolveSmartCropTimeline } from "@/server/agents/videoSubjectTrackingService";
import {
  buildVerticalFramingFilter,
  getSmartCropFilterRiskReason,
  isFfmpegCropFilterFailure,
  resolveFramingPreset,
  type FramingPreset,
} from "@/lib/clipFraming";
import { resolveExportSettings } from "@/lib/clipExportSettings";
import { resolveIntelligentFramingDecision } from "@/lib/clipFramingIntelligence";
import { normalizeManualCropKeyframes } from "@/lib/manualCrop";
import {
  invalidateAfterRenderCompleted,
  markRenderAssetCompleted,
  markRenderAssetFailed,
} from "@/server/regeneration/dependencies";
import { refreshClipVisualQuality } from "@/server/agents/clipVisualQualityService";
import { extractSpeechCleanupSettings } from "@/lib/clipStudio";

type RenderOptions = {
  ffmpegPath?: string;
  allowRerender?: boolean;
  force?: boolean;
  concurrency?: number;
  speechCleanup?: {
    removeDeadAir?: boolean;
    tightenLongPauses?: boolean;
  };
};

export type RenderSummary = {
  sermonId: string;
  attempted: number;
  completed: number;
  skipped: number;
  failed: number;
  errors: Array<{ clipId: string; reason: string }>;
};

type ClipWithSermon = Pick<
  ClipCandidate,
  | "id"
  | "sermonId"
  | "status"
  | "startTimeSeconds"
  | "endTimeSeconds"
  | "adjustedStartTimeSeconds"
  | "adjustedEndTimeSeconds"
  | "durationSeconds"
  | "transcriptText"
  | "title"
  | "hook"
  | "smartClipCategory"
  | "ministryValue"
  | "emotionalImpactScore"
  | "hookStrengthScore"
  | "shareabilityScore"
  | "renderStatus"
  | "renderedFilePath"
  | "exportLayoutStrategy"
  | "manualCropKeyframes"
  | "captionData"
> & {
  sermon: {
    id: string;
  };
};

type RenderEligibilityInput = {
  status: ClipCandidate["status"];
  renderStatus: ClipRenderStatus;
  startTimeSeconds: number;
  endTimeSeconds: number;
  sermonDurationSeconds: number;
  transcriptText: string;
  sourceVideoExists: boolean;
  allowRerender: boolean;
};

type RenderEligibility = {
  ok: boolean;
  reason?: string;
  shouldMarkFailed?: boolean;
};

const DEFAULT_BATCH_RENDER_CONCURRENCY = 2;
const MAX_BATCH_RENDER_CONCURRENCY = 3;
const FALLBACK_VIDEO_ENCODER = "libx264";
const HARDWARE_VIDEO_ENCODER = "h264_videotoolbox";
const EDGE_SILENCE_DETECT_FILTER = "silencedetect=noise=-35dB:d=0.25";
const MIN_EDGE_SILENCE_TO_TRIM_SECONDS = 0.45;
const EDGE_SILENCE_PAD_SECONDS = 0.12;
const MAX_START_SILENCE_TRIM_SECONDS = 2.5;
const MAX_END_SILENCE_TRIM_SECONDS = 3;
const MIN_INTERNAL_SILENCE_TO_COLLAPSE_SECONDS = 1.2;
const INTERNAL_SILENCE_KEEP_SECONDS = 0.35;
const MIN_INTERNAL_SILENCE_TRIM_SECONDS = 0.45;
const MAX_INTERNAL_SILENCE_CUTS = 4;
const MAX_TOTAL_INTERNAL_SILENCE_TRIM_SECONDS = 8;

type EdgeSilenceCleanup = {
  originalStartTimeSeconds: number;
  originalEndTimeSeconds: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  startTrimSeconds: number;
  endTrimSeconds: number;
  detectedStartSilenceSeconds: number;
  detectedEndSilenceSeconds: number;
  applied: boolean;
};

type SilenceEvent = {
  start: number;
  end: number | null;
  duration: number | null;
};

type InternalSilenceCut = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  trimSeconds: number;
  originalSilenceStartSeconds: number;
  originalSilenceEndSeconds: number;
  originalSilenceDurationSeconds: number;
};

type InternalSilenceCleanup = {
  originalStartTimeSeconds: number;
  originalEndTimeSeconds: number;
  renderedDurationSeconds: number;
  totalTrimSeconds: number;
  cuts: InternalSilenceCut[];
  detectedInternalSilenceCount: number;
  longestInternalSilenceSeconds: number;
  applied: boolean;
};

type ClipSilenceProfile = {
  edgeSilenceCleanup: EdgeSilenceCleanup;
  internalSilenceCleanup: InternalSilenceCleanup;
};

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

function resolvePreferredVideoEncoder(): string {
  const override = process.env.CLIP_RENDER_VIDEO_ENCODER?.trim();
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
      process.env.CLIP_RENDER_VIDEO_BITRATE?.trim() || "4500k",
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
    "23",
  ];
}

function resolveRenderConcurrency(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_BATCH_RENDER_CONCURRENCY;
  }

  return Math.min(MAX_BATCH_RENDER_CONCURRENCY, Math.max(1, Math.floor(value)));
}

async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.size > 0;
  } catch {
    return false;
  }
}

function getTempRenderPath(outputPath: string): string {
  return outputPath.replace(/\.mp4$/i, ".partial.mp4");
}

function resolveRenderBoundaries(clip: Pick<ClipWithSermon, "startTimeSeconds" | "endTimeSeconds" | "adjustedStartTimeSeconds" | "adjustedEndTimeSeconds">): {
  startTimeSeconds: number;
  endTimeSeconds: number;
} {
  const startTimeSeconds = clip.adjustedStartTimeSeconds ?? clip.startTimeSeconds;
  const endTimeSeconds = clip.adjustedEndTimeSeconds ?? clip.endTimeSeconds;
  return { startTimeSeconds, endTimeSeconds };
}

function buildEdgeSilenceCleanup(input: {
  startTimeSeconds: number;
  endTimeSeconds: number;
  silenceAtBeginningSeconds: number | null | undefined;
  silenceAtEndSeconds: number | null | undefined;
}): EdgeSilenceCleanup {
  const originalDuration = input.endTimeSeconds - input.startTimeSeconds;
  const detectedStartSilenceSeconds = Math.max(0, input.silenceAtBeginningSeconds ?? 0);
  const detectedEndSilenceSeconds = Math.max(0, input.silenceAtEndSeconds ?? 0);
  let startTrimSeconds = detectedStartSilenceSeconds >= MIN_EDGE_SILENCE_TO_TRIM_SECONDS
    ? Math.min(MAX_START_SILENCE_TRIM_SECONDS, Math.max(0, detectedStartSilenceSeconds - EDGE_SILENCE_PAD_SECONDS))
    : 0;
  let endTrimSeconds = detectedEndSilenceSeconds >= MIN_EDGE_SILENCE_TO_TRIM_SECONDS
    ? Math.min(MAX_END_SILENCE_TRIM_SECONDS, Math.max(0, detectedEndSilenceSeconds - EDGE_SILENCE_PAD_SECONDS))
    : 0;

  const maxTotalTrim = Math.max(0, originalDuration - HARD_MIN_DURATION_SECONDS);
  const requestedTotalTrim = startTrimSeconds + endTrimSeconds;
  if (requestedTotalTrim > maxTotalTrim) {
    const scale = maxTotalTrim > 0 && requestedTotalTrim > 0 ? maxTotalTrim / requestedTotalTrim : 0;
    startTrimSeconds *= scale;
    endTrimSeconds *= scale;
  }

  startTrimSeconds = Number(startTrimSeconds.toFixed(2));
  endTrimSeconds = Number(endTrimSeconds.toFixed(2));

  return {
    originalStartTimeSeconds: input.startTimeSeconds,
    originalEndTimeSeconds: input.endTimeSeconds,
    startTimeSeconds: Number((input.startTimeSeconds + startTrimSeconds).toFixed(2)),
    endTimeSeconds: Number((input.endTimeSeconds - endTrimSeconds).toFixed(2)),
    startTrimSeconds,
    endTrimSeconds,
    detectedStartSilenceSeconds,
    detectedEndSilenceSeconds,
    applied: startTrimSeconds > 0 || endTrimSeconds > 0,
  };
}

function buildInternalSilenceCleanup(input: {
  startTimeSeconds: number;
  endTimeSeconds: number;
  silenceEvents: SilenceEvent[];
}): InternalSilenceCleanup {
  const durationSeconds = Number((input.endTimeSeconds - input.startTimeSeconds).toFixed(2));
  const maxTotalTrim = Math.min(
    MAX_TOTAL_INTERNAL_SILENCE_TRIM_SECONDS,
    Math.max(0, durationSeconds - HARD_MIN_DURATION_SECONDS),
  );
  const internalEvents = input.silenceEvents
    .map((event) => {
      const eventEnd = event.end ?? durationSeconds;
      const eventDuration = event.duration ?? (eventEnd - event.start);
      return {
        start: Math.max(0, event.start),
        end: Math.min(durationSeconds, eventEnd),
        duration: eventDuration,
      };
    })
    .filter((event) => {
      if (!Number.isFinite(event.duration) || event.duration < MIN_INTERNAL_SILENCE_TO_COLLAPSE_SECONDS) {
        return false;
      }
      if (event.start <= 0.25 || durationSeconds - event.end <= 0.35) {
        return false;
      }
      return event.end > event.start;
    })
    .sort((left, right) => right.duration - left.duration)
    .slice(0, MAX_INTERNAL_SILENCE_CUTS)
    .sort((left, right) => left.start - right.start);

  const cuts: InternalSilenceCut[] = [];
  let totalTrimSeconds = 0;
  const padBefore = INTERNAL_SILENCE_KEEP_SECONDS / 2;
  const padAfter = INTERNAL_SILENCE_KEEP_SECONDS - padBefore;

  for (const event of internalEvents) {
    const remainingTrim = maxTotalTrim - totalTrimSeconds;
    if (remainingTrim < MIN_INTERNAL_SILENCE_TRIM_SECONDS) {
      break;
    }

    const relativeCutStart = Number((event.start + padBefore).toFixed(2));
    const rawRelativeCutEnd = Number((event.end - padAfter).toFixed(2));
    const desiredTrim = rawRelativeCutEnd - relativeCutStart;
    const trimSeconds = Number(Math.min(desiredTrim, remainingTrim).toFixed(2));
    if (trimSeconds < MIN_INTERNAL_SILENCE_TRIM_SECONDS) {
      continue;
    }

    const startTimeSeconds = Number((input.startTimeSeconds + relativeCutStart).toFixed(2));
    const endTimeSeconds = Number((startTimeSeconds + trimSeconds).toFixed(2));
    cuts.push({
      startTimeSeconds,
      endTimeSeconds,
      trimSeconds,
      originalSilenceStartSeconds: Number((input.startTimeSeconds + event.start).toFixed(2)),
      originalSilenceEndSeconds: Number((input.startTimeSeconds + event.end).toFixed(2)),
      originalSilenceDurationSeconds: Number(event.duration.toFixed(2)),
    });
    totalTrimSeconds = Number((totalTrimSeconds + trimSeconds).toFixed(2));
  }

  const longestInternalSilenceSeconds = internalEvents.length > 0
    ? Number(Math.max(...internalEvents.map((event) => event.duration)).toFixed(2))
    : 0;

  return {
    originalStartTimeSeconds: input.startTimeSeconds,
    originalEndTimeSeconds: input.endTimeSeconds,
    renderedDurationSeconds: Number((durationSeconds - totalTrimSeconds).toFixed(2)),
    totalTrimSeconds,
    cuts,
    detectedInternalSilenceCount: internalEvents.length,
    longestInternalSilenceSeconds,
    applied: cuts.length > 0,
  };
}

async function probeClipSilenceProfile(input: {
  sourceVideoPath: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  ffmpegPath?: string;
}): Promise<ClipSilenceProfile | null> {
  const durationSeconds = Number((input.endTimeSeconds - input.startTimeSeconds).toFixed(2));
  if (durationSeconds <= 0) {
    return null;
  }

  const args = [
    "-hide_banner",
    "-nostats",
    "-ss",
    String(input.startTimeSeconds),
    "-to",
    String(input.endTimeSeconds),
    "-i",
    input.sourceVideoPath,
    "-af",
    EDGE_SILENCE_DETECT_FILTER,
    "-f",
    "null",
    "-",
  ];

  const stderr = await new Promise<string>((resolve, reject) => {
    const child = spawn(commandFor(input.ffmpegPath), args, {
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });

    let output = "";
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", (error) => {
      reject(new Error(`FFmpeg silence probe failed: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
        return;
      }

      reject(new Error(output.trim() || `FFmpeg silence probe failed with exit code ${code ?? "unknown"}.`));
    });
  });

  const silence = parseSilenceDetectOutput(stderr, durationSeconds);
  const edgeSilenceCleanup = buildEdgeSilenceCleanup({
    startTimeSeconds: input.startTimeSeconds,
    endTimeSeconds: input.endTimeSeconds,
    silenceAtBeginningSeconds: silence.silenceAtBeginningSeconds,
    silenceAtEndSeconds: silence.silenceAtEndSeconds,
  });
  const silenceEvents = parseSilenceDetectEvents(stderr).map((event) => ({
    ...event,
    start: event.start - edgeSilenceCleanup.startTrimSeconds,
    end: event.end === null ? null : event.end - edgeSilenceCleanup.startTrimSeconds,
  }));
  const internalSilenceCleanup = buildInternalSilenceCleanup({
    startTimeSeconds: edgeSilenceCleanup.startTimeSeconds,
    endTimeSeconds: edgeSilenceCleanup.endTimeSeconds,
    silenceEvents,
  });

  return {
    edgeSilenceCleanup,
    internalSilenceCleanup,
  };
}

export function validateRenderEligibility(input: RenderEligibilityInput): RenderEligibility {
  if (!input.sourceVideoExists) {
    return { ok: false, reason: "Source video file does not exist.", shouldMarkFailed: true };
  }

  if (input.renderStatus === "RENDERING") {
    return { ok: false, reason: "Clip is already rendering.", shouldMarkFailed: false };
  }

  if (input.renderStatus === "COMPLETED" && !input.allowRerender) {
    return { ok: false, reason: "Clip already rendered. Use rerender action to run again.", shouldMarkFailed: false };
  }

  if (input.status !== "SUGGESTED" && input.status !== "APPROVED" && !(input.allowRerender && input.status === "EXPORTED")) {
    return { ok: false, reason: "Clip must be suggested or approved before rendering.", shouldMarkFailed: false };
  }

  const validation = validateBoundaryTimes({
    startTimeSeconds: input.startTimeSeconds,
    endTimeSeconds: input.endTimeSeconds,
    sermonDurationSeconds: input.sermonDurationSeconds,
    transcriptText: input.transcriptText,
  });

  if (!validation.isValid) {
    return { ok: false, reason: validation.reasons.join(" "), shouldMarkFailed: true };
  }

  if (validation.durationSeconds < HARD_MIN_DURATION_SECONDS || validation.durationSeconds > HARD_MAX_DURATION_SECONDS) {
    return { ok: false, reason: `Clip duration must be between ${HARD_MIN_DURATION_SECONDS} and ${HARD_MAX_DURATION_SECONDS} seconds.`, shouldMarkFailed: true };
  }

  return { ok: true };
}

function buildRenderMetadata(input: {
  outputPath: string;
  durationSeconds: number;
  fileSizeBytes: number;
}): Pick<Prisma.ClipCandidateUpdateInput, "renderedFilePath" | "renderedDurationSeconds" | "renderedSizeBytes" | "renderedAt" | "renderStatus" | "renderError"> {
  return {
    renderedFilePath: input.outputPath,
    renderedDurationSeconds: input.durationSeconds,
    renderedSizeBytes: input.fileSizeBytes,
    renderedAt: new Date(),
    renderStatus: "COMPLETED",
    renderError: null,
  };
}

function buildSilenceSelectExpression(cuts: InternalSilenceCut[], renderStartTimeSeconds: number): string {
  const ranges = cuts
    .map((cut) => {
      const start = Math.max(0, cut.startTimeSeconds - renderStartTimeSeconds);
      const end = Math.max(start, cut.endTimeSeconds - renderStartTimeSeconds);
      return `between(t\\,${Number(start.toFixed(2))}\\,${Number(end.toFixed(2))})`;
    })
    .filter(Boolean);

  return ranges.length > 0 ? `not(${ranges.join("+")})` : "1";
}

function buildRenderFilter(input: {
  framingPreset: FramingPreset;
  smartCrop?: {
    sourceWidth: number;
    sourceHeight: number;
    subjectCenterX: number;
    zoom?: number;
    subjectCenters?: Array<{ timeSeconds: number; centerX: number; confidence?: number; stabilized?: boolean; rejected?: boolean; frozen?: boolean }>;
  } | null;
  startTimeSeconds: number;
  internalSilenceCleanup?: InternalSilenceCleanup | null;
}): { filterComplex: string; audioMap: string } {
  const framingFilter = buildVerticalFramingFilter(input.framingPreset, input.smartCrop ?? undefined);
  if (!input.internalSilenceCleanup?.applied) {
    return {
      filterComplex: framingFilter,
      audioMap: "0:a?",
    };
  }

  const selectExpression = buildSilenceSelectExpression(input.internalSilenceCleanup.cuts, input.startTimeSeconds);
  return {
    filterComplex: (
      `[0:v]select=${selectExpression},setpts=N/FRAME_RATE/TB[silence_v];` +
      `[0:a]aselect=${selectExpression},asetpts=N/SR/TB[silence_a];` +
      framingFilter.replace("[0:v]", "[silence_v]")
    ),
    audioMap: "[silence_a]",
  };
}

async function runFfmpegRender(input: {
  sermonId: string;
  sourceVideoPath: string;
  outputPath: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  ffmpegPath?: string;
  jobId: string;
  framingPreset: FramingPreset;
	  smartCrop?: {
	    sourceWidth: number;
	    sourceHeight: number;
	    subjectCenterX: number;
      zoom?: number;
	    subjectCenters?: Array<{ timeSeconds: number; centerX: number; confidence?: number; stabilized?: boolean; rejected?: boolean; frozen?: boolean }>;
	  } | null;
	  videoEncoder?: string;
    internalSilenceCleanup?: InternalSilenceCleanup | null;
	}): Promise<void> {
	  const command = commandFor(input.ffmpegPath);
    const renderFilter = buildRenderFilter({
      framingPreset: input.framingPreset,
      smartCrop: input.smartCrop,
      startTimeSeconds: input.startTimeSeconds,
      internalSilenceCleanup: input.internalSilenceCleanup,
    });
	  const videoEncoder = input.videoEncoder ?? resolvePreferredVideoEncoder();
	  const args = [
	    "-y",
	    "-ss",
    String(input.startTimeSeconds),
    "-to",
    String(input.endTimeSeconds),
    "-i",
    input.sourceVideoPath,
    "-filter_complex",
    renderFilter.filterComplex,
    "-map",
    "[v]",
	    "-map",
	    renderFilter.audioMap,
	    ...buildVideoEncoderArgs(videoEncoder),
	    "-c:a",
	    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    input.outputPath,
  ];

	  await appendPipelineLog(
	    input.sermonId,
	    `Render started for range ${input.startTimeSeconds.toFixed(2)}-${input.endTimeSeconds.toFixed(2)}s with framing: ${input.framingPreset}, encoder: ${videoEncoder}${input.internalSilenceCleanup?.applied ? `, internal silence cuts: ${input.internalSilenceCleanup.cuts.length}` : ""}${input.smartCrop ? `, subject center ${input.smartCrop.subjectCenterX.toFixed(2)}` : ""}.`,
	  );

  if (input.smartCrop?.subjectCenters?.length) {
    const timeline = input.smartCrop.subjectCenters;
    const averageConfidence = timeline.reduce((sum, point) => sum + (point.confidence ?? 0), 0) / timeline.length;
    const stabilizedCount = timeline.filter((point) => point.stabilized).length;
    const rejectedCount = timeline.filter((point) => point.rejected).length;
    const frozenCount = timeline.filter((point) => point.frozen).length;
    await appendPipelineLog(
      input.sermonId,
      `Smart crop timeline prepared with ${timeline.length} point(s), average confidence ${averageConfidence.toFixed(2)}, ${stabilizedCount} stabilized, ${rejectedCount} rejected, ${frozenCount} frozen.`,
    );

    if (timeline.every((point) => point.confidence === 1 && !point.stabilized && !point.rejected && !point.frozen)) {
      await appendPipelineLog(input.sermonId, "Manual framing applied for this SMART_CROP render.");
    }
  }

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
      reject(new Error(`Failed to start FFmpeg: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`FFmpeg failed with code ${code ?? "unknown"}. ${stderr.trim().slice(-1200)}`.trim()));
    });
  });
}

async function loadClipForRender(clipCandidateId: string): Promise<ClipWithSermon> {
  const clip = await prisma.clipCandidate.findUnique({
    where: { id: clipCandidateId },
    select: {
      id: true,
      sermonId: true,
      status: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      adjustedStartTimeSeconds: true,
      adjustedEndTimeSeconds: true,
      durationSeconds: true,
      transcriptText: true,
      title: true,
      hook: true,
      smartClipCategory: true,
      ministryValue: true,
      emotionalImpactScore: true,
      hookStrengthScore: true,
      shareabilityScore: true,
      renderStatus: true,
      renderedFilePath: true,
      exportLayoutStrategy: true,
      manualCropKeyframes: true,
      captionData: true,
      sermon: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!clip) {
    throw new Error(`Clip candidate ${clipCandidateId} was not found.`);
  }

  return clip;
}

async function getSermonDurationSeconds(sermonId: string): Promise<number> {
  const segment = await prisma.transcriptSegment.findFirst({
    where: { sermonId },
    orderBy: { endTimeSeconds: "desc" },
    select: {
      endTimeSeconds: true,
    },
  });

  if (!segment) {
    throw new Error("Cannot determine sermon duration from transcript segments.");
  }

  return segment.endTimeSeconds;
}

async function failClipRender(clipId: string, message: string): Promise<void> {
  await prisma.clipCandidate.update({
    where: { id: clipId },
    data: {
      renderStatus: "FAILED",
      renderError: message,
    },
  });
  await markRenderAssetFailed(clipId);
}

async function refreshVisualQualityAfterRender(clipId: string, ffmpegPath?: string): Promise<void> {
  await refreshClipVisualQuality(clipId, { ffmpegPath }).catch(() => undefined);
}

export async function renderApprovedClip(
  clipCandidateId: string,
  options?: RenderOptions,
): Promise<{ clipId: string; renderedFilePath: string; durationSeconds: number }> {
  const clipId = clipCandidateId.trim();
  if (!clipId) {
    throw new Error("Clip id is required for rendering.");
  }

  const clip = await loadClipForRender(clipId);
  await ensureSermonFolders(clip.sermonId);

  const boundaries = resolveRenderBoundaries(clip);
  const outputPath = getClipOutputPath(clip.sermonId, clip.id);
  const outputExists = await fileHasBytes(outputPath);

  if (outputExists && !options?.allowRerender && !options?.force) {
    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: {
        renderStatus: "COMPLETED",
        renderedFilePath: outputPath,
        renderError: null,
      },
    });
    await markRenderAssetCompleted(clip.id, false);
    await refreshVisualQualityAfterRender(clip.id, options?.ffmpegPath);

    return {
      clipId: clip.id,
      renderedFilePath: outputPath,
      durationSeconds: Number((boundaries.endTimeSeconds - boundaries.startTimeSeconds).toFixed(2)),
    };
  }

  const sourceVideoPath = getSourceVideoPath(clip.sermonId);
  const sourceVideoExists = await fileHasBytes(sourceVideoPath);
  const sermonDurationSeconds = await getSermonDurationSeconds(clip.sermonId);

  const eligibility = validateRenderEligibility({
    status: clip.status,
    renderStatus: clip.renderStatus,
    startTimeSeconds: boundaries.startTimeSeconds,
    endTimeSeconds: boundaries.endTimeSeconds,
    sermonDurationSeconds,
    transcriptText: clip.transcriptText,
    sourceVideoExists,
    allowRerender: Boolean(options?.allowRerender),
  });

  if (!eligibility.ok) {
    if (eligibility.shouldMarkFailed) {
      await failClipRender(clip.id, eligibility.reason ?? "Clip is not eligible for rendering.");
    }
    throw new Error(eligibility.reason ?? "Clip is not eligible for rendering.");
  }

  const ffmpegInstalled = await checkFfmpegInstalled(options?.ffmpegPath);
  if (!ffmpegInstalled) {
    const message = "FFmpeg is not installed or not executable.";
    await failClipRender(clip.id, message);
    throw new Error(message);
  }

  const transitionResult = await prisma.clipCandidate.updateMany({
    where: {
      id: clip.id,
      NOT: {
        renderStatus: "RENDERING",
      },
    },
    data: {
      renderStatus: "QUEUED",
      renderError: null,
    },
  });

  if (transitionResult.count === 0) {
    throw new Error("Clip is already rendering. Duplicate render request blocked.");
  }

  const job = await createProcessingJob(clip.sermonId, "EXPORT_CLIPS");
  const renderStartedAt = Date.now();

  try {
    await markJobRunning(job.id);
    await appendJobLog(job.id, `Clip render requested for ${clip.id}.`);

    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: {
        renderStatus: "RENDERING",
        renderError: null,
      },
    });

    const tempOutputPath = getTempRenderPath(outputPath);
    try {
      await unlink(tempOutputPath);
    } catch {
      // Ignore stale partial file deletion errors.
    }

    let renderBoundaries = boundaries;
    const storedSpeechCleanup = extractSpeechCleanupSettings(clip.captionData);
    const speechCleanupSettings = {
      removeDeadAir: options?.speechCleanup?.removeDeadAir ?? storedSpeechCleanup.removeDeadAir,
      tightenLongPauses: options?.speechCleanup?.tightenLongPauses ?? storedSpeechCleanup.tightenLongPauses,
    };
    const shouldProbeSpeechCleanup = speechCleanupSettings.removeDeadAir || speechCleanupSettings.tightenLongPauses;
    const silenceProfile = shouldProbeSpeechCleanup
      ? await probeClipSilenceProfile({
          sourceVideoPath,
          startTimeSeconds: boundaries.startTimeSeconds,
          endTimeSeconds: boundaries.endTimeSeconds,
          ffmpegPath: options?.ffmpegPath,
        }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Unknown silence probe error.";
          void appendJobLog(job.id, `Speech cleanup skipped: ${message}`);
          void appendPipelineLog(clip.sermonId, `Speech cleanup skipped for clip ${clip.id}: ${message}`);
          return null;
        })
      : null;
    const edgeSilenceCleanup = speechCleanupSettings.removeDeadAir ? (silenceProfile?.edgeSilenceCleanup ?? null) : null;
    const internalSilenceCleanup = speechCleanupSettings.tightenLongPauses ? (silenceProfile?.internalSilenceCleanup ?? null) : null;

    if (edgeSilenceCleanup?.applied) {
      renderBoundaries = {
        startTimeSeconds: edgeSilenceCleanup.startTimeSeconds,
        endTimeSeconds: edgeSilenceCleanup.endTimeSeconds,
      };
      await appendPipelineLog(
        clip.sermonId,
        `Edge silence cleanup applied to clip ${clip.id}: start +${edgeSilenceCleanup.startTrimSeconds.toFixed(2)}s, end -${edgeSilenceCleanup.endTrimSeconds.toFixed(2)}s.`,
      );
      await appendJobLog(
        job.id,
        `Edge silence cleanup applied: ${edgeSilenceCleanup.originalStartTimeSeconds.toFixed(2)}-${edgeSilenceCleanup.originalEndTimeSeconds.toFixed(2)}s -> ${edgeSilenceCleanup.startTimeSeconds.toFixed(2)}-${edgeSilenceCleanup.endTimeSeconds.toFixed(2)}s.`,
      );
    }
    if (internalSilenceCleanup?.applied) {
      await appendPipelineLog(
        clip.sermonId,
        `Internal silence cleanup applied to clip ${clip.id}: ${internalSilenceCleanup.cuts.length} gap(s), ${internalSilenceCleanup.totalTrimSeconds.toFixed(2)}s removed.`,
      );
      await appendJobLog(
        job.id,
        `Internal silence cleanup applied: ${internalSilenceCleanup.cuts.length} gap(s), ${internalSilenceCleanup.totalTrimSeconds.toFixed(2)}s removed.`,
      );
    }

    const exportSettings = resolveExportSettings({
      exportFormat: null,
      exportLayoutStrategy: clip.exportLayoutStrategy,
      captionData: clip.captionData,
    });
    const framingPreset = resolveFramingPreset(clip.exportLayoutStrategy);
    const manualCropKeyframes = normalizeManualCropKeyframes(clip.manualCropKeyframes);
    const smartCrop =
      framingPreset === "SMART_CROP"
        ? await Promise.all([
            getMediaDimensions(sourceVideoPath, options?.ffmpegPath).catch(() => null),
            resolveSmartCropCenter(clip.id),
            manualCropKeyframes.length > 0 ? Promise.resolve([]) : resolveSmartCropTimeline(clip.id, renderBoundaries),
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
      requestedLayout: framingPreset,
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
        durationSeconds: renderBoundaries.endTimeSeconds - renderBoundaries.startTimeSeconds,
      },
    });
    const smartCropSafety = framingDecision.safety;
    let effectiveFramingPreset: FramingPreset = framingDecision.effectiveLayout;
    let effectiveSmartCrop = effectiveFramingPreset === "SMART_CROP" ? smartCrop : null;
    if (effectiveSmartCrop) {
      effectiveSmartCrop = {
        ...effectiveSmartCrop,
        zoom: framingDecision.zoom,
      };
    }
    let smartCropRuntimeFallbackReason: string | null = null;

    if (framingDecision.fallbackApplied) {
      await appendPipelineLog(
        clip.sermonId,
        `Smart framing chose ${framingDecision.effectiveLayout} for clip ${clip.id}: ${framingDecision.reasonCodes.join(", ")} (average confidence ${smartCropSafety.averageConfidence.toFixed(2)}, unstable ratio ${smartCropSafety.unstableRatio.toFixed(2)}).`,
      );
    } else {
      await appendPipelineLog(
        clip.sermonId,
        `Smart framing selected for clip ${clip.id}: ${framingDecision.pastorSummary}`,
      );
    }

    if (effectiveFramingPreset === "SMART_CROP") {
      const framingFilter = buildVerticalFramingFilter(effectiveFramingPreset, effectiveSmartCrop ?? undefined);
      const filterRiskReason = getSmartCropFilterRiskReason(framingFilter);
      if (filterRiskReason) {
        effectiveFramingPreset = "FIT_BLURRED_BACKGROUND";
        effectiveSmartCrop = null;
        await appendPipelineLog(
          clip.sermonId,
          `Smart crop render fell back to full-stage framing for clip ${clip.id}: ${filterRiskReason}.`,
        );
      }
    }

	    const preferredVideoEncoder = resolvePreferredVideoEncoder();
	    const renderWithEncoder = async (videoEncoder: string) => {
	      await runFfmpegRender({
	        sermonId: clip.sermonId,
	        sourceVideoPath,
	        outputPath: tempOutputPath,
	        startTimeSeconds: renderBoundaries.startTimeSeconds,
	        endTimeSeconds: renderBoundaries.endTimeSeconds,
	        ffmpegPath: options?.ffmpegPath,
	        jobId: job.id,
	        framingPreset: effectiveFramingPreset,
	        smartCrop: effectiveSmartCrop,
	        videoEncoder,
          internalSilenceCleanup,
	      });
	    };

	    try {
	      try {
	        await renderWithEncoder(preferredVideoEncoder);
	      } catch (error) {
	        if (!isHardwareVideoEncoder(preferredVideoEncoder)) {
	          throw error;
	        }

	        const message = error instanceof Error ? error.message : "Unknown render error.";
	        await unlink(tempOutputPath).catch(() => undefined);
	        await appendJobLog(job.id, `Hardware render failed with ${preferredVideoEncoder}; retrying with ${FALLBACK_VIDEO_ENCODER}. Original error: ${message}`);
	        await appendPipelineLog(clip.sermonId, `Hardware render fallback used for clip ${clip.id}: ${preferredVideoEncoder} failed.`);
	        await renderWithEncoder(FALLBACK_VIDEO_ENCODER);
	      }
	    } catch (error) {
	      const message = error instanceof Error ? error.message : "Unknown render error.";
	      if (effectiveFramingPreset !== "SMART_CROP" || !isFfmpegCropFilterFailure(message)) {
	        throw error;
	      }

      await unlink(tempOutputPath).catch(() => undefined);
      smartCropRuntimeFallbackReason = "Smart crop failed inside FFmpeg, so the app retried with safe full-stage framing.";
      effectiveFramingPreset = "FIT_BLURRED_BACKGROUND";
      effectiveSmartCrop = null;
      await appendPipelineLog(clip.sermonId, `${smartCropRuntimeFallbackReason} Clip ${clip.id}.`);
      await appendJobLog(job.id, `${smartCropRuntimeFallbackReason} Original error: ${message}`);

	      await runFfmpegRender({
	        sermonId: clip.sermonId,
	        sourceVideoPath,
	        outputPath: tempOutputPath,
	        startTimeSeconds: renderBoundaries.startTimeSeconds,
	        endTimeSeconds: renderBoundaries.endTimeSeconds,
	        ffmpegPath: options?.ffmpegPath,
	        jobId: job.id,
	        framingPreset: effectiveFramingPreset,
	        smartCrop: effectiveSmartCrop,
	        videoEncoder: isHardwareVideoEncoder(preferredVideoEncoder) ? FALLBACK_VIDEO_ENCODER : preferredVideoEncoder,
          internalSilenceCleanup,
	      });
	    }

    await rename(tempOutputPath, outputPath);

    const renderedDurationSeconds = internalSilenceCleanup?.applied
      ? internalSilenceCleanup.renderedDurationSeconds
      : Number((renderBoundaries.endTimeSeconds - renderBoundaries.startTimeSeconds).toFixed(2));
    const outputStats = await stat(outputPath);
    if (outputStats.size <= 0) {
      await unlink(outputPath).catch(() => undefined);
      throw new Error("Render produced an empty output file.");
    }
    const metadata = buildRenderMetadata({
      outputPath,
      durationSeconds: renderedDurationSeconds,
      fileSizeBytes: outputStats.size,
    });

    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: {
        ...metadata,
        exportPath: outputPath,
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
          edgeSilenceCleanup: edgeSilenceCleanup
            ? {
                applied: edgeSilenceCleanup.applied,
                originalStartTimeSeconds: edgeSilenceCleanup.originalStartTimeSeconds,
                originalEndTimeSeconds: edgeSilenceCleanup.originalEndTimeSeconds,
                renderedStartTimeSeconds: edgeSilenceCleanup.startTimeSeconds,
                renderedEndTimeSeconds: edgeSilenceCleanup.endTimeSeconds,
                startTrimSeconds: edgeSilenceCleanup.startTrimSeconds,
                endTrimSeconds: edgeSilenceCleanup.endTrimSeconds,
                detectedStartSilenceSeconds: edgeSilenceCleanup.detectedStartSilenceSeconds,
                detectedEndSilenceSeconds: edgeSilenceCleanup.detectedEndSilenceSeconds,
                updatedAt: new Date().toISOString(),
              }
            : {
                applied: false,
                originalStartTimeSeconds: boundaries.startTimeSeconds,
                originalEndTimeSeconds: boundaries.endTimeSeconds,
                renderedStartTimeSeconds: renderBoundaries.startTimeSeconds,
                renderedEndTimeSeconds: renderBoundaries.endTimeSeconds,
                startTrimSeconds: 0,
                endTrimSeconds: 0,
                updatedAt: new Date().toISOString(),
              },
          speechCleanup: {
            ...storedSpeechCleanup,
            removeDeadAir: speechCleanupSettings.removeDeadAir,
            tightenLongPauses: speechCleanupSettings.tightenLongPauses,
            flagFillerWords: storedSpeechCleanup.flagFillerWords,
            lastAppliedAt: shouldProbeSpeechCleanup ? new Date().toISOString() : null,
          },
          internalSilenceCleanup: internalSilenceCleanup
            ? {
                applied: internalSilenceCleanup.applied,
                originalStartTimeSeconds: internalSilenceCleanup.originalStartTimeSeconds,
                originalEndTimeSeconds: internalSilenceCleanup.originalEndTimeSeconds,
                renderedDurationSeconds: internalSilenceCleanup.renderedDurationSeconds,
                totalTrimSeconds: internalSilenceCleanup.totalTrimSeconds,
                detectedInternalSilenceCount: internalSilenceCleanup.detectedInternalSilenceCount,
                longestInternalSilenceSeconds: internalSilenceCleanup.longestInternalSilenceSeconds,
                cuts: internalSilenceCleanup.cuts,
                updatedAt: new Date().toISOString(),
              }
            : {
                applied: false,
                originalStartTimeSeconds: renderBoundaries.startTimeSeconds,
                originalEndTimeSeconds: renderBoundaries.endTimeSeconds,
                renderedDurationSeconds,
                totalTrimSeconds: 0,
                detectedInternalSilenceCount: 0,
                longestInternalSilenceSeconds: 0,
                cuts: [],
                updatedAt: new Date().toISOString(),
              },
        },
        visualQualityScore: framingDecision.visualQualityScore,
        visualReadinessScore: framingDecision.visualQualityScore,
        speakerVisiblePercentage: framingDecision.speakerVisiblePercentage,
        averageTrackingConfidence: framingDecision.averageTrackingConfidence,
        cropStabilityScore: framingDecision.cropStabilityScore,
        ...(smartCropRuntimeFallbackReason
          ? {
              exportLayoutStrategy: effectiveFramingPreset,
              assetInvalidationReason: smartCropRuntimeFallbackReason,
            }
          : {}),
      },
    });
    await markRenderAssetCompleted(clip.id, true);
    await refreshVisualQualityAfterRender(clip.id, options?.ffmpegPath);
    await invalidateAfterRenderCompleted(
      clip.id,
      "Render asset regenerated. Caption/burn/overlay/export assets now require regeneration.",
    );

    const renderMs = Date.now() - renderStartedAt;
    await appendPipelineLog(clip.sermonId, `Clip ${clip.id} render completed in ${renderMs}ms.`);
    await markJobSucceeded(job.id, `Clip ${clip.id} rendered successfully in ${renderMs}ms.`);

    return {
      clipId: clip.id,
      renderedFilePath: outputPath,
      durationSeconds: renderedDurationSeconds,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown render error.";
    await unlink(getTempRenderPath(outputPath)).catch(() => undefined);

    await failClipRender(clip.id, message);
    await refreshVisualQualityAfterRender(clip.id, options?.ffmpegPath);
    await markJobFailed(job.id, message, "Clip render failed.");
    await appendPipelineLog(clip.sermonId, `Clip ${clip.id} render failed: ${message}`);

    throw new Error(message);
  }
}

export async function renderApprovedClipsForSermon(
  sermonId: string,
  options?: Omit<RenderOptions, "allowRerender">,
): Promise<RenderSummary> {
  const normalizedSermonId = sermonId.trim();
  if (!normalizedSermonId) {
    throw new Error("Sermon id is required.");
  }

  const clips = await prisma.clipCandidate.findMany({
    where: {
      sermonId: normalizedSermonId,
      status: {
        in: ["APPROVED", "EXPORTED"],
      },
    },
    orderBy: [{ overallPostScore: "desc" }, { score: "desc" }, { startTimeSeconds: "asc" }],
    select: {
      id: true,
      status: true,
      renderStatus: true,
    },
  });

  const summary: RenderSummary = {
    sermonId: normalizedSermonId,
    attempted: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const clipsToRender: typeof clips = [];
  for (const clip of clips) {
    if (clip.status === "REJECTED") {
      summary.skipped += 1;
      continue;
    }

    if (clip.renderStatus === "COMPLETED" && !options?.force) {
      summary.skipped += 1;
      continue;
    }

    summary.attempted += 1;
    clipsToRender.push(clip);
  }

  const concurrency = resolveRenderConcurrency(options?.concurrency);
  let nextClipIndex = 0;

  async function renderWorker(): Promise<void> {
    while (nextClipIndex < clipsToRender.length) {
      const clip = clipsToRender[nextClipIndex];
      nextClipIndex += 1;

      if (!clip) {
        continue;
      }

      try {
        await renderApprovedClip(clip.id, {
          ffmpegPath: options?.ffmpegPath,
          allowRerender: Boolean(options?.force),
          force: options?.force,
        });
        summary.completed += 1;
      } catch (error) {
        summary.failed += 1;
        summary.errors.push({
          clipId: clip.id,
          reason: error instanceof Error ? error.message : "Unknown render error.",
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, clipsToRender.length) }, () => renderWorker()),
  );

  await appendPipelineLog(
    normalizedSermonId,
    `Batch render summary: attempted=${summary.attempted}, completed=${summary.completed}, skipped=${summary.skipped}, failed=${summary.failed}, concurrency=${concurrency}.`,
  );

  return summary;
}

export const __clipRenderTestUtils = {
  buildEdgeSilenceCleanup,
  buildInternalSilenceCleanup,
  buildSilenceSelectExpression,
  buildVideoEncoderArgs,
  buildRenderMetadata,
  buildRenderFilter,
  fileHasBytes,
  resolveRenderConcurrency,
  resolveRenderBoundaries,
};
