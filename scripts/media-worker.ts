import os from "node:os";

import type { ProcessingJob } from "@prisma/client";
import nextEnv from "@next/env";

import {
  createWorkerLogger,
  errorFields,
  formatDiagnosticLogEntry,
  formatDuration,
} from "./worker-log.ts";
import {
  runCaptionBurnBatch,
  runClipGenerationWorkerJob,
  runOverlayAndExportBatch,
  summarizeCaptionBatch,
  summarizeQualityRefreshBatch,
  summarizeRedoClipGeneration,
  summarizeRenderBatch,
} from "./media-worker-jobs.ts";
import {
  isClipGenerationForcedRetrySummary,
  isClipGenerationPreviewRepairSummary,
} from "../src/lib/clipGenerationRetry.ts";

process.env.WORKER_ENABLED ||= "true";
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
  throw new Error(
    [
      "MEDIA WORKER DATABASE_URL must point to the same Postgres/Neon database used by Vercel.",
      "Set DATABASE_URL to a postgresql:// or postgres:// connection string before running npm run worker:media.",
    ].join(" "),
  );
}

const { prisma } = await import("../src/lib/prisma");
const {
  appendJobLog,
  markJobFailed,
  markJobSucceeded,
} = await import("../src/server/agents/processing");

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const workerId = process.env.MEDIA_WORKER_ID?.trim() || `${os.hostname()}-media-worker`;
const pollIntervalMs = positiveNumber(process.env.MEDIA_WORKER_POLL_SECONDS, 15) * 1000;
const heartbeatIntervalMs = positiveNumber(process.env.MEDIA_WORKER_HEARTBEAT_SECONDS, 30) * 1000;
const staleJobMs = positiveNumber(process.env.MEDIA_WORKER_STALE_JOB_MINUTES, 60) * 60 * 1000;
const maxWorkerAttempts = Math.max(1, Math.floor(positiveNumber(process.env.MEDIA_WORKER_MAX_ATTEMPTS, 2)));
const logger = createWorkerLogger("media");
let processing = false;

const SERMON_STAGE_ORDER = [
  "CREATED",
  "DOWNLOADING",
  "DOWNLOADED",
  "AUDIO_EXTRACTING",
  "AUDIO_EXTRACTED",
  "TRANSCRIBING",
  "TRANSCRIBED",
  "GENERATING_CLIPS",
  "CLIPS_GENERATED",
  "REVIEWING",
  "EXPORTING",
  "EXPORTED",
  "FAILED",
] as const;

const OBSOLETE_STAGE_JOB_TARGETS = {
  DOWNLOAD_VIDEO: "DOWNLOADING",
  EXTRACT_AUDIO: "AUDIO_EXTRACTING",
  TRANSCRIBE_AUDIO: "TRANSCRIBING",
} as const;

function staleJobCutoff(): Date {
  return new Date(Date.now() - staleJobMs);
}

function staleRunningJobWhere(cutoff: Date) {
  return {
    status: "RUNNING" as const,
    OR: [
      { heartbeatAt: { lt: cutoff } },
      { heartbeatAt: null, updatedAt: { lt: cutoff } },
    ],
  };
}

async function failExhaustedStaleJobs(): Promise<void> {
  const cutoff = staleJobCutoff();
  const staleJobs = await prisma.processingJob.findMany({
    where: {
      ...staleRunningJobWhere(cutoff),
      attemptCount: { gte: maxWorkerAttempts },
    },
    orderBy: { updatedAt: "asc" },
    take: 10,
  });

  for (const job of staleJobs) {
    const message = `Media worker lease expired after ${job.attemptCount}/${maxWorkerAttempts} claim attempt(s).`;
    await markJobFailed(job.id, message, `${message} Start a new retry from the sermon recovery tools.`);
    logger.warn("stale job marked failed", {
      job: job.id,
      sermon: job.sermonId,
      type: job.type,
      attempts: job.attemptCount,
    });
  }
}

function startJobHeartbeat(jobId: string): () => void {
  const pulse = async () => {
    try {
      await prisma.processingJob.updateMany({
        where: {
          id: jobId,
          status: "RUNNING",
          workerId,
        },
        data: {
          heartbeatAt: new Date(),
        },
      });
    } catch (error) {
      logger.warn("heartbeat failed", {
        job: jobId,
        ...errorFields(error),
      });
    }
  };

  void pulse();
  const interval = setInterval(() => {
    void pulse();
  }, heartbeatIntervalMs);

  return () => {
    clearInterval(interval);
  };
}

async function runCaptionBurnJob(sermonId: string): Promise<string> {
  const clips = await prisma.clipCandidate.findMany({
    where: {
      sermonId,
      status: { in: ["APPROVED", "EXPORTED"] },
      renderStatus: "COMPLETED",
      captionStatus: "GENERATED",
      captionBurnStatus: { not: "BURNING" },
      OR: [
        { captionBurnStatus: { not: "COMPLETED" } },
        { captionBurnFreshness: { not: "UP_TO_DATE" } },
      ],
    },
    orderBy: [{ overallPostScore: "desc" }, { score: "desc" }, { createdAt: "asc" }],
    select: { id: true, captionData: true },
  });

  if (clips.length === 0) {
    return "No caption burn assets need work.";
  }

  const { burnCaptionsIntoRenderedClip } = await import("../src/server/agents/captionBurnService");
  return runCaptionBurnBatch(clips, {
    burnCaptions: burnCaptionsIntoRenderedClip,
  });
}

async function runOverlayAndExportJob(sermonId: string): Promise<string> {
  const clips = await prisma.clipCandidate.findMany({
    where: {
      sermonId,
      status: { in: ["APPROVED", "EXPORTED"] },
      renderStatus: "COMPLETED",
      OR: [
        { overlayStatus: { not: "COMPLETED" } },
        { overlayFreshness: { not: "UP_TO_DATE" } },
        { exportStatus: { not: "COMPLETED" } },
        { exportFreshness: { not: "UP_TO_DATE" } },
      ],
    },
    orderBy: [{ overallPostScore: "desc" }, { score: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      overlayStatus: true,
      overlayFreshness: true,
      exportStatus: true,
      exportFreshness: true,
      exportLayoutStrategy: true,
    },
  });

  if (clips.length === 0) {
    return "No overlay or export assets need work.";
  }

  const { renderClipOverlay } = await import("../src/server/agents/clipOverlayService");
  const { exportVerticalClip } = await import("../src/server/agents/clipExportService");
  return runOverlayAndExportBatch(clips, {
    renderOverlay: renderClipOverlay,
    exportClip: exportVerticalClip,
    prepareFitBlurredFallback: async (clipId) => {
      await prisma.clipCandidate.update({
        where: { id: clipId },
        data: {
          exportLayoutStrategy: "FIT_BLURRED_BACKGROUND",
          exportStatus: "NOT_EXPORTED",
          exportError: null,
        },
      });
    },
  });
}

async function claimNextJob(): Promise<ProcessingJob | null> {
  await failExhaustedStaleJobs();

  const cutoff = staleJobCutoff();
  const next = await prisma.processingJob.findFirst({
    where: {
      attemptCount: { lt: maxWorkerAttempts },
      OR: [
        { status: "PENDING", workerId: null },
        { status: "PENDING", workerId: { startsWith: "inline:" }, updatedAt: { lt: cutoff } },
        staleRunningJobWhere(cutoff),
      ],
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (!next) {
    return null;
  }

  const claimed = await prisma.processingJob.updateMany({
    where: {
      id: next.id,
      attemptCount: { lt: maxWorkerAttempts },
      OR: [
        { status: "PENDING", workerId: null },
        { status: "PENDING", workerId: { startsWith: "inline:" }, updatedAt: { lt: cutoff } },
        staleRunningJobWhere(cutoff),
      ],
    },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      completedAt: null,
      heartbeatAt: new Date(),
      workerId,
      attemptCount: { increment: 1 },
      errorMessage: null,
    },
  });

  if (claimed.count === 0) {
    return null;
  }

  return prisma.processingJob.findUnique({
    where: { id: next.id },
  });
}

function generationSummary(job: ProcessingJob): Record<string, unknown> | null {
  return job.generationSummary
    && typeof job.generationSummary === "object"
    && !Array.isArray(job.generationSummary)
    ? job.generationSummary as Record<string, unknown>
    : null;
}

function shouldAppendGeneratedClips(job: ProcessingJob): boolean {
  return generationSummary(job)?.append === true;
}

function shouldRedoGeneratedClips(job: ProcessingJob): boolean {
  return generationSummary(job)?.mode === "redo";
}

async function restoreCompletedClipGenerationStatus(sermonId: string): Promise<void> {
  await prisma.sermon.updateMany({
    where: {
      id: sermonId,
      status: { in: ["GENERATING_CLIPS", "FAILED"] },
    },
    data: { status: "CLIPS_GENERATED" },
  });
}

function stageIndex(status: string): number {
  return SERMON_STAGE_ORDER.findIndex((stage) => stage === status);
}

async function skipObsoleteStageJob(job: ProcessingJob): Promise<string | null> {
  const targetStatus = OBSOLETE_STAGE_JOB_TARGETS[job.type as keyof typeof OBSOLETE_STAGE_JOB_TARGETS];
  if (!targetStatus) {
    return null;
  }

  const sermon = await prisma.sermon.findUnique({
    where: { id: job.sermonId },
    select: { status: true },
  });
  if (!sermon) {
    throw new Error(`Sermon ${job.sermonId} was not found.`);
  }

  const currentIndex = stageIndex(sermon.status);
  const targetIndex = stageIndex(targetStatus);
  if (currentIndex <= targetIndex || currentIndex === -1 || targetIndex === -1) {
    return null;
  }

  const message = `Skipped obsolete ${job.type} job because sermon is already ${sermon.status}.`;
  await appendJobLog(job.id, message);
  return message;
}

async function runJob(job: ProcessingJob): Promise<string> {
  const type = job.type;
  const sermonId = job.sermonId;

  const obsoleteStageMessage = await skipObsoleteStageJob(job);
  if (obsoleteStageMessage) {
    return obsoleteStageMessage;
  }

  switch (type) {
    case "PROCESS_SERMON": {
      const { processSermonPipeline } = await import("../src/server/pipeline/processSermonPipeline");
      const result = await processSermonPipeline(sermonId, { parentJobId: job.id });
      return result.summary;
    }
    case "DOWNLOAD_VIDEO": {
      const { downloadSermonVideo } = await import("../src/server/agents/videoDownloadAgent");
      const result = await downloadSermonVideo(sermonId, { force: false, processingJobId: job.id });
      return result.reusedExistingFile ? "Existing source video reused." : "Source video downloaded.";
    }
    case "EXTRACT_AUDIO": {
      const { extractSermonAudio } = await import("../src/server/agents/audioExtractionAgent");
      const result = await extractSermonAudio(sermonId, { force: false, processingJobId: job.id });
      return result.reusedExistingFile ? "Existing audio reused." : "Audio extracted.";
    }
    case "TRANSCRIBE_AUDIO": {
      const { transcribeSermonAudio } = await import("../src/server/agents/transcriptionAgent");
      const result = await transcribeSermonAudio(sermonId, { force: false, processingJobId: job.id });
      return result.reusedExistingTranscript ? "Existing transcript reused." : "Audio transcribed.";
    }
    case "GENERATE_INTELLIGENCE": {
      const { generateSermonIntelligence } = await import("../src/server/agents/sermonIntelligenceService");
      const result = await generateSermonIntelligence(sermonId, {
        force: true,
        processingJobId: job.id,
      });
      if (result.status !== "COMPLETED") {
        throw new Error(result.failureReason ?? "Sermon intelligence generation failed.");
      }
      return "Sermon intelligence generated.";
    }
    case "GENERATE_CLIPS": {
      if (shouldRedoGeneratedClips(job)) {
        const { redoClipGenerationFromTranscript } = await import("../src/server/agents/clipRedoService");
        const result = await redoClipGenerationFromTranscript(sermonId, { currentJobId: job.id });
        const summary = summarizeRedoClipGeneration(result);
        await restoreCompletedClipGenerationStatus(sermonId);
        return summary;
      }

      const append = shouldAppendGeneratedClips(job);
      const summary = await runClipGenerationWorkerJob({
        previewRepairOnly: isClipGenerationPreviewRepairSummary(job.generationSummary),
        forceGeneration: isClipGenerationForcedRetrySummary(job.generationSummary),
        append,
      }, {
        generateSuggestions: async ({ force, append: appendSuggestions }) => {
          const { generateClipSuggestions } = await import("../src/server/agents/clipIntelligenceAgent");
          return generateClipSuggestions(sermonId, {
            force,
            append: appendSuggestions,
            processingJobId: job.id,
          });
        },
        preparePreviews: async () => {
          const { prepareGeneratedClipReviewAssets } = await import("../src/server/agents/clipReviewAssetService");
          return prepareGeneratedClipReviewAssets({ sermonId, force: false });
        },
      });
      await restoreCompletedClipGenerationStatus(sermonId);
      return summary;
    }
    case "EXPORT_CLIPS": {
      const { renderApprovedClipsForSermon } = await import("../src/server/agents/clipRenderService");
      const result = await renderApprovedClipsForSermon(sermonId, { force: false });
      return summarizeRenderBatch(result);
    }
    case "GENERATE_SUBTITLES": {
      const { generateCaptionsForApprovedClips } = await import("../src/server/agents/captionService");
      const result = await generateCaptionsForApprovedClips(sermonId, { force: false });
      return summarizeCaptionBatch(result);
    }
    case "QUALITY_REFRESH": {
      const { refreshSermonClipQuality } = await import("../src/server/agents/clipQualityRefreshService");
      const result = await refreshSermonClipQuality({ sermonId, mode: "missing" });
      return summarizeQualityRefreshBatch(result);
    }
    case "BURN_SUBTITLES":
    {
      return runCaptionBurnJob(sermonId);
    }
    case "RENDER_OVERLAY": {
      return runOverlayAndExportJob(sermonId);
    }
    default:
      throw new Error(`Unsupported processing job type: ${type}`);
  }
}

async function processNextJob(): Promise<void> {
  if (processing) {
    return;
  }

  processing = true;
  try {
    const job = await claimNextJob();
    if (!job) {
      return;
    }

    const startedAt = Date.now();
    logger.info("claimed job", {
      job: job.id,
      sermonId: job.sermonId,
      type: job.type,
      workerId,
      attempt: job.attemptCount,
      maxAttempts: maxWorkerAttempts,
    });
    await appendJobLog(
      job.id,
      `Claimed and started ${job.type} on ${workerId} for sermon ${job.sermonId}; attempt ${job.attemptCount}/${maxWorkerAttempts}.`,
    );
    const stopHeartbeat = startJobHeartbeat(job.id);

    try {
      const summary = await runJob(job);
      await markJobSucceeded(job.id, summary);
      logger.success("job succeeded", {
        job: job.id,
        type: job.type,
        duration: formatDuration(Date.now() - startedAt),
        summary,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startedAt;
      const diagnosticFields = {
        job: job.id,
        sermonId: job.sermonId,
        type: job.type,
        workerId,
        attempt: job.attemptCount,
        maxAttempts: maxWorkerAttempts,
        duration: formatDuration(durationMs),
        durationMs,
        ...errorFields(error),
      };
      const diagnosticLog = formatDiagnosticLogEntry("Media worker job failed", diagnosticFields);

      logger.error("job failed", diagnosticFields);
      await markJobFailed(job.id, message, diagnosticLog);
    } finally {
      stopHeartbeat();
    }
  } catch (error) {
    logger.error("poll failed; will retry", errorFields(error));
  } finally {
    processing = false;
  }
}

async function main(): Promise<void> {
  logger.banner("media worker started", {
    workerId,
    pollEvery: `${pollIntervalMs / 1000}s`,
    heartbeatEvery: `${heartbeatIntervalMs / 1000}s`,
    staleAfter: `${staleJobMs / 60_000}m`,
    maxAttempts: maxWorkerAttempts,
  });

  await processNextJob();
  setInterval(() => {
    void processNextJob();
  }, pollIntervalMs);
}

process.on("SIGINT", () => {
  logger.warn("stopping");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.warn("stopping");
  process.exit(0);
});

void main().catch((error) => {
  logger.error("fatal startup failure", errorFields(error));
  process.exit(1);
});
