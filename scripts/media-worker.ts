import os from "node:os";

import type { ProcessingJob, ProcessingJobType } from "@prisma/client";
import nextEnv from "@next/env";

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

const workerId = process.env.MEDIA_WORKER_ID?.trim() || `${os.hostname()}-media-worker`;
const pollIntervalMs = Number(process.env.MEDIA_WORKER_POLL_SECONDS ?? 15) * 1000;
let processing = false;

function log(message: string, data?: unknown): void {
  const suffix = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[media-worker] ${new Date().toISOString()} ${message}${suffix}`);
}

async function runCaptionBurnJob(sermonId: string): Promise<string> {
  const clips = await prisma.clipCandidate.findMany({
    where: {
      sermonId,
      status: { in: ["APPROVED", "EXPORTED"] },
      renderStatus: "COMPLETED",
      captionStatus: "GENERATED",
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
  let completed = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const clip of clips) {
    const captionData =
      clip.captionData && typeof clip.captionData === "object" && !Array.isArray(clip.captionData)
        ? clip.captionData as Record<string, unknown>
        : {};
    if (captionData["applyCaptionsToClip"] === false) {
      skipped += 1;
      continue;
    }

    try {
      await burnCaptionsIntoRenderedClip(clip.id, {
        allowReburn: true,
        force: true,
      });
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${clip.id}: ${message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Caption burn completed ${completed}/${clips.length}; failures: ${failures.slice(0, 3).join(" | ")}`);
  }

  return `Caption burn completed for ${completed} clip(s), skipped ${skipped} with captions off.`;
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
  let overlaysCompleted = 0;
  let exportsCompleted = 0;
  const failures: string[] = [];

  for (const clip of clips) {
    const needsOverlay = clip.overlayStatus !== "COMPLETED" || clip.overlayFreshness !== "UP_TO_DATE";
    const needsExport = clip.exportStatus !== "COMPLETED" || clip.exportFreshness !== "UP_TO_DATE";

    try {
      if (needsOverlay) {
        await renderClipOverlay(clip.id, {
          allowRerender: true,
          force: true,
        });
        overlaysCompleted += 1;
      }

      if (needsExport) {
        const layoutStrategy = clip.exportLayoutStrategy ?? "SMART_CROP";
        try {
          await exportVerticalClip(clip.id, {
            allowReexport: true,
            force: true,
            layoutStrategy,
          });
        } catch (error) {
          if (layoutStrategy !== "SMART_CROP") {
            throw error;
          }

          await prisma.clipCandidate.update({
            where: { id: clip.id },
            data: {
              exportLayoutStrategy: "FIT_BLURRED_BACKGROUND",
              exportStatus: "NOT_EXPORTED",
              exportError: null,
            },
          });
          await exportVerticalClip(clip.id, {
            allowReexport: true,
            force: true,
            layoutStrategy: "FIT_BLURRED_BACKGROUND",
          });
        }
        exportsCompleted += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${clip.id}: ${message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Overlay/export completed with ${failures.length} failure(s): ${failures.slice(0, 3).join(" | ")}`);
  }

  return `Overlay/export completed: ${overlaysCompleted} overlay(s), ${exportsCompleted} export(s).`;
}

async function claimNextJob(): Promise<ProcessingJob | null> {
  const next = await prisma.processingJob.findFirst({
    where: {
      status: "PENDING",
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
      status: "PENDING",
    },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      errorMessage: null,
      logs: `[${new Date().toISOString()}] Claimed by ${workerId}.`,
    },
  });

  if (claimed.count === 0) {
    return null;
  }

  return prisma.processingJob.findUnique({
    where: { id: next.id },
  });
}

async function runJob(type: ProcessingJobType, sermonId: string): Promise<string> {
  switch (type) {
    case "PROCESS_SERMON": {
      const { processSermonPipeline } = await import("../src/server/pipeline/processSermonPipeline");
      const result = await processSermonPipeline(sermonId);
      return result.summary;
    }
    case "DOWNLOAD_VIDEO": {
      const { downloadSermonVideo } = await import("../src/server/agents/videoDownloadAgent");
      const result = await downloadSermonVideo(sermonId, { force: false });
      return result.reusedExistingFile ? "Existing source video reused." : "Source video downloaded.";
    }
    case "EXTRACT_AUDIO": {
      const { extractSermonAudio } = await import("../src/server/agents/audioExtractionAgent");
      const result = await extractSermonAudio(sermonId, { force: false });
      return result.reusedExistingFile ? "Existing audio reused." : "Audio extracted.";
    }
    case "TRANSCRIBE_AUDIO": {
      const { transcribeSermonAudio } = await import("../src/server/agents/transcriptionAgent");
      const result = await transcribeSermonAudio(sermonId, { force: false });
      return result.reusedExistingTranscript ? "Existing transcript reused." : "Audio transcribed.";
    }
    case "GENERATE_CLIPS": {
      const { generateClipSuggestions } = await import("../src/server/agents/clipIntelligenceAgent");
      const { prepareGeneratedClipReviewAssets } = await import("../src/server/agents/clipReviewAssetService");
      const result = await generateClipSuggestions(sermonId, { force: false });
      const previewResult = await prepareGeneratedClipReviewAssets({ sermonId, force: false });
      const previewSummary = `Preview prep: ${previewResult.prepared} prepared, ${previewResult.skipped} skipped, ${previewResult.failed} failed.`;
      return result.reusedExistingSuggestions
        ? `Existing clip suggestions reused. ${previewSummary}`
        : `Generated ${result.clipCount} clip suggestion(s). ${previewSummary}`;
    }
    case "EXPORT_CLIPS": {
      const { renderApprovedClipsForSermon } = await import("../src/server/agents/clipRenderService");
      const result = await renderApprovedClipsForSermon(sermonId, { force: false });
      return `Rendered ${result.completed} clip(s), skipped ${result.skipped}, failed ${result.failed}.`;
    }
    case "GENERATE_SUBTITLES": {
      const { generateCaptionsForApprovedClips } = await import("../src/server/agents/captionService");
      const result = await generateCaptionsForApprovedClips(sermonId, { force: false });
      return `Generated captions for ${result.generated} clip(s), reused ${result.reused}, skipped ${result.skipped}; ${result.failed} failed.`;
    }
    case "QUALITY_REFRESH": {
      const { refreshSermonClipQuality } = await import("../src/server/agents/clipQualityRefreshService");
      const result = await refreshSermonClipQuality({ sermonId, mode: "missing" });
      return `Refreshed ${result.clipsRefreshed} clip quality record(s); ${result.clipsFailed} failed.`;
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

    log("claimed job", { id: job.id, sermonId: job.sermonId, type: job.type });
    await appendJobLog(job.id, `Started ${job.type} on ${workerId}.`);

    try {
      const summary = await runJob(job.type, job.sermonId);
      await markJobSucceeded(job.id, summary);
      log("job succeeded", { id: job.id, type: job.type, summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markJobFailed(job.id, message);
      log("job failed", { id: job.id, type: job.type, error: message });
    }
  } finally {
    processing = false;
  }
}

async function main(): Promise<void> {
  log("starting", {
    workerId,
    pollIntervalSeconds: pollIntervalMs / 1000,
  });

  await processNextJob();
  setInterval(() => {
    void processNextJob();
  }, pollIntervalMs);
}

process.on("SIGINT", () => {
  log("stopping");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("stopping");
  process.exit(0);
});

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
