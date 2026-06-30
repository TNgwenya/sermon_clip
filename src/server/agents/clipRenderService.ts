import { access, rename, stat, unlink } from "node:fs/promises";
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
import { resolveSmartCropCenter, resolveSmartCropTimeline } from "@/server/agents/videoSubjectTrackingService";
import {
  buildVerticalFramingFilter,
  resolveFramingPreset,
  type FramingPreset,
} from "@/lib/clipFraming";
import {
  invalidateAfterRenderCompleted,
  markRenderAssetCompleted,
  markRenderAssetFailed,
} from "@/server/regeneration/dependencies";

type RenderOptions = {
  ffmpegPath?: string;
  allowRerender?: boolean;
  force?: boolean;
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
  | "renderStatus"
  | "renderedFilePath"
  | "exportLayoutStrategy"
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

type InternalSilenceCut = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  trimSeconds: number;
  originalSilenceStartSeconds: number;
  originalSilenceEndSeconds: number;
  originalSilenceDurationSeconds: number;
};

type InternalSilenceCleanup = {
  applied: boolean;
  originalStartTimeSeconds: number;
  originalEndTimeSeconds: number;
  renderedDurationSeconds: number;
  totalTrimSeconds: number;
  detectedInternalSilenceCount: number;
  longestInternalSilenceSeconds: number;
  cuts: InternalSilenceCut[];
};

const FALLBACK_VIDEO_ENCODER = "libx264";
const HARDWARE_VIDEO_ENCODER = "h264_videotoolbox";
const EDGE_SPEECH_PAD_SECONDS = 0.12;
const INTERNAL_SPEECH_PAD_SECONDS = 0.18;
const MIN_EDGE_SILENCE_SECONDS = 0.5;
const MIN_INTERNAL_SILENCE_SECONDS = 1.2;

function commandFor(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

function roundSeconds(value: number): number {
  return Number(value.toFixed(2));
}

function resolvePreferredVideoEncoder(): string {
  return process.env.CLIP_RENDER_VIDEO_ENCODER?.trim()
    || process.env.CLIP_EXPORT_VIDEO_ENCODER?.trim()
    || (process.platform === "darwin" ? HARDWARE_VIDEO_ENCODER : FALLBACK_VIDEO_ENCODER);
}

function buildVideoEncoderArgs(encoder: string): string[] {
  if (encoder === HARDWARE_VIDEO_ENCODER) {
    return [
      "-c:v",
      HARDWARE_VIDEO_ENCODER,
      "-b:v",
      process.env.CLIP_RENDER_VIDEO_BITRATE?.trim() || process.env.CLIP_EXPORT_VIDEO_BITRATE?.trim() || "5000k",
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

function resolveRenderConcurrency(value?: number | null): number {
  const configured = value ?? Number(process.env.CLIP_RENDER_CONCURRENCY ?? 2);
  if (!Number.isFinite(configured) || configured <= 0) {
    return 1;
  }

  return Math.min(3, Math.max(1, Math.floor(configured)));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
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
    return { ok: false, reason: "Clip must be suggested or approved before rendering.", shouldMarkFailed: true };
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
    return {
      ok: false,
      reason: `Clip duration must be between ${HARD_MIN_DURATION_SECONDS} and ${HARD_MAX_DURATION_SECONDS} seconds.`,
      shouldMarkFailed: true,
    };
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

function buildEdgeSilenceCleanup(input: {
  startTimeSeconds: number;
  endTimeSeconds: number;
  silenceAtBeginningSeconds?: number | null;
  silenceAtEndSeconds?: number | null;
}): {
  applied: boolean;
  originalStartTimeSeconds: number;
  originalEndTimeSeconds: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  startTrimSeconds: number;
  endTrimSeconds: number;
} {
  const originalDuration = input.endTimeSeconds - input.startTimeSeconds;
  const startTrimSeconds = (input.silenceAtBeginningSeconds ?? 0) >= MIN_EDGE_SILENCE_SECONDS
    ? roundSeconds(Math.max(0, (input.silenceAtBeginningSeconds ?? 0) - EDGE_SPEECH_PAD_SECONDS))
    : 0;
  const endTrimSeconds = (input.silenceAtEndSeconds ?? 0) >= MIN_EDGE_SILENCE_SECONDS
    ? roundSeconds(Math.max(0, (input.silenceAtEndSeconds ?? 0) - EDGE_SPEECH_PAD_SECONDS))
    : 0;
  const renderedDurationSeconds = roundSeconds(originalDuration - startTrimSeconds - endTrimSeconds);

  if ((startTrimSeconds <= 0 && endTrimSeconds <= 0) || renderedDurationSeconds < HARD_MIN_DURATION_SECONDS) {
    return {
      applied: false,
      originalStartTimeSeconds: input.startTimeSeconds,
      originalEndTimeSeconds: input.endTimeSeconds,
      startTimeSeconds: input.startTimeSeconds,
      endTimeSeconds: input.endTimeSeconds,
      startTrimSeconds: 0,
      endTrimSeconds: 0,
    };
  }

  return {
    applied: true,
    originalStartTimeSeconds: input.startTimeSeconds,
    originalEndTimeSeconds: input.endTimeSeconds,
    startTimeSeconds: roundSeconds(input.startTimeSeconds + startTrimSeconds),
    endTimeSeconds: roundSeconds(input.endTimeSeconds - endTrimSeconds),
    startTrimSeconds,
    endTrimSeconds,
  };
}

function buildInternalSilenceCleanup(input: {
  startTimeSeconds: number;
  endTimeSeconds: number;
  silenceEvents: Array<{ start: number; end: number; duration: number }>;
}): InternalSilenceCleanup {
  const originalDuration = input.endTimeSeconds - input.startTimeSeconds;
  const eligibleEvents = input.silenceEvents.filter((event) => event.duration >= MIN_INTERNAL_SILENCE_SECONDS);
  const cuts = eligibleEvents.map((event) => {
    const trimSeconds = roundSeconds(Math.max(0, event.duration - INTERNAL_SPEECH_PAD_SECONDS * 2));
    return {
      startTimeSeconds: roundSeconds(input.startTimeSeconds + event.start + INTERNAL_SPEECH_PAD_SECONDS),
      endTimeSeconds: roundSeconds(input.startTimeSeconds + event.end - INTERNAL_SPEECH_PAD_SECONDS),
      trimSeconds,
      originalSilenceStartSeconds: roundSeconds(input.startTimeSeconds + event.start),
      originalSilenceEndSeconds: roundSeconds(input.startTimeSeconds + event.end),
      originalSilenceDurationSeconds: roundSeconds(event.duration),
    };
  }).filter((cut) => cut.trimSeconds > 0);
  const totalTrimSeconds = roundSeconds(cuts.reduce((total, cut) => total + cut.trimSeconds, 0));
  const renderedDurationSeconds = roundSeconds(originalDuration - totalTrimSeconds);

  if (cuts.length === 0 || renderedDurationSeconds < HARD_MIN_DURATION_SECONDS) {
    return {
      applied: false,
      originalStartTimeSeconds: input.startTimeSeconds,
      originalEndTimeSeconds: input.endTimeSeconds,
      renderedDurationSeconds: roundSeconds(originalDuration),
      totalTrimSeconds: 0,
      detectedInternalSilenceCount: input.silenceEvents.length,
      longestInternalSilenceSeconds: roundSeconds(Math.max(0, ...input.silenceEvents.map((event) => event.duration))),
      cuts: [],
    };
  }

  return {
    applied: true,
    originalStartTimeSeconds: input.startTimeSeconds,
    originalEndTimeSeconds: input.endTimeSeconds,
    renderedDurationSeconds,
    totalTrimSeconds,
    detectedInternalSilenceCount: input.silenceEvents.length,
    longestInternalSilenceSeconds: roundSeconds(Math.max(0, ...input.silenceEvents.map((event) => event.duration))),
    cuts,
  };
}

function buildRenderFilter(input: {
  framingPreset: FramingPreset;
  startTimeSeconds: number;
  internalSilenceCleanup?: InternalSilenceCleanup | null;
}): { filterComplex: string; videoMap: string; audioMap: string } {
  const cuts = input.internalSilenceCleanup?.applied ? input.internalSilenceCleanup.cuts : [];
  if (cuts.length === 0) {
    return {
      filterComplex: buildVerticalFramingFilter(input.framingPreset),
      videoMap: "[v]",
      audioMap: "0:a?",
    };
  }

  const exclusion = cuts
    .map((cut) => {
      const start = roundSeconds(cut.startTimeSeconds - input.startTimeSeconds);
      const end = roundSeconds(cut.endTimeSeconds - input.startTimeSeconds);
      return `between(t\\,${start}\\,${end})`;
    })
    .join("+");

  return {
    filterComplex: [
      `[0:v]select=not(${exclusion})[silence_v]`,
      "[silence_v]setpts=PTS-STARTPTS[v]",
      `[0:a]aselect=not(${exclusion})[silence_a]`,
      "[silence_a]asetpts=PTS-STARTPTS[a]",
    ].join(";"),
    videoMap: "[v]",
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
    subjectCenters?: Array<{ timeSeconds: number; centerX: number }>;
  } | null;
}): Promise<void> {
  const command = commandFor(input.ffmpegPath);
  const framingFilter = buildVerticalFramingFilter(input.framingPreset, input.smartCrop ?? undefined);
  const videoEncoderArgs = buildVideoEncoderArgs(resolvePreferredVideoEncoder());
  const args = [
    "-y",
    "-ss",
    String(input.startTimeSeconds),
    "-to",
    String(input.endTimeSeconds),
    "-i",
    input.sourceVideoPath,
    "-filter_complex",
    framingFilter,
    "-map",
    "[v]",
    "-map",
    "0:a?",
    ...videoEncoderArgs,
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
    `Render started for range ${input.startTimeSeconds.toFixed(2)}-${input.endTimeSeconds.toFixed(2)}s with framing: ${input.framingPreset}${input.smartCrop ? `, subject center ${input.smartCrop.subjectCenterX.toFixed(2)}` : ""}.`,
  );

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
      renderStatus: true,
      renderedFilePath: true,
      exportLayoutStrategy: true,
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

  const sourceVideoPath = getSourceVideoPath(clip.sermonId);
  const sourceVideoExists = await fileExists(sourceVideoPath);
  const boundaries = resolveRenderBoundaries(clip);
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
    if (eligibility.shouldMarkFailed !== false) {
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

  const outputPath = getClipOutputPath(clip.sermonId, clip.id);
  const outputExists = await fileExists(outputPath);

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

    return {
      clipId: clip.id,
      renderedFilePath: outputPath,
      durationSeconds: Number((boundaries.endTimeSeconds - boundaries.startTimeSeconds).toFixed(2)),
    };
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

    const framingPreset = resolveFramingPreset(clip.exportLayoutStrategy);
    const smartCrop =
      framingPreset === "SMART_CROP"
        ? await Promise.all([
            getMediaDimensions(sourceVideoPath, options?.ffmpegPath).catch(() => null),
            resolveSmartCropCenter(clip.id),
            resolveSmartCropTimeline(clip.id, boundaries),
          ]).then(([dimensions, center, timeline]) => (
            dimensions && center
              ? {
                  sourceWidth: dimensions.width,
                  sourceHeight: dimensions.height,
                  subjectCenterX: center.centerX,
                  subjectCenters: timeline.map((point) => ({
                    timeSeconds: point.timeSeconds,
                    centerX: point.centerX,
                  })),
                }
              : null
          ))
        : null;
    await runFfmpegRender({
      sermonId: clip.sermonId,
      sourceVideoPath,
      outputPath: tempOutputPath,
      startTimeSeconds: boundaries.startTimeSeconds,
      endTimeSeconds: boundaries.endTimeSeconds,
      ffmpegPath: options?.ffmpegPath,
      jobId: job.id,
      framingPreset,
      smartCrop,
    });

    await rename(tempOutputPath, outputPath);

    const renderedDurationSeconds = Number((boundaries.endTimeSeconds - boundaries.startTimeSeconds).toFixed(2));
    const outputStats = await stat(outputPath);
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
      },
    });
    await markRenderAssetCompleted(clip.id, true);
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

    await failClipRender(clip.id, message);
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
    orderBy: [{ score: "desc" }, { startTimeSeconds: "asc" }],
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

  await appendPipelineLog(
    normalizedSermonId,
    `Batch render summary: attempted=${summary.attempted}, completed=${summary.completed}, skipped=${summary.skipped}, failed=${summary.failed}.`,
  );

  return summary;
}

export const __clipRenderTestUtils = {
  buildEdgeSilenceCleanup,
  buildInternalSilenceCleanup,
  buildRenderFilter,
  buildRenderMetadata,
  buildVideoEncoderArgs,
  fileHasBytes,
  resolveRenderConcurrency,
  resolveRenderBoundaries,
};
