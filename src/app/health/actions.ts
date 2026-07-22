"use server";

import { revalidatePath } from "next/cache";

import { buildPostingClipAssetRecoveryWhere } from "@/lib/healthRecovery";
import { prisma } from "@/lib/prisma";
import {
  repairMissingLocalAssetReferences,
  selectUnresolvedFailedProcessingJobRetries,
} from "@/server/workflow/operationsDiagnostics";
import { canRunInlineMediaProcessing } from "@/server/runtime/workerRuntime";

export type HealthActionResult = {
  success: boolean;
  message: string;
};

const HEALTH_RECOVERY_FAILED_JOB_LIMIT = 6;
const LOCAL_WORKER_ONLY_MESSAGE = "This recovery action must run from the local worker because it needs local media files, ffmpeg, or sharp.";

async function backfillClipThumbnails(
  ...args: Parameters<typeof import("@/server/agents/clipThumbnailService").backfillClipThumbnails>
): ReturnType<typeof import("@/server/agents/clipThumbnailService").backfillClipThumbnails> {
  const { backfillClipThumbnails: run } = await import("@/server/agents/clipThumbnailService");
  return run(...args);
}

async function regenerateClipOutdatedAssetsAction(
  ...args: Parameters<typeof import("@/server/actions/sermons").regenerateClipOutdatedAssetsAction>
): ReturnType<typeof import("@/server/actions/sermons").regenerateClipOutdatedAssetsAction> {
  const { regenerateClipOutdatedAssetsAction: run } = await import("@/server/actions/sermons");
  return run(...args);
}

async function retryFailedProcessingJobById(
  ...args: Parameters<typeof import("@/server/actions/sermons").retryFailedProcessingJobById>
): ReturnType<typeof import("@/server/actions/sermons").retryFailedProcessingJobById> {
  const { retryFailedProcessingJobById: run } = await import("@/server/actions/sermons");
  return run(...args);
}

function revalidateHealthRecoveryPaths(): void {
  revalidatePath("/health");
  revalidatePath("/");
  revalidatePath("/sermons");
  revalidatePath("/ready-to-post");
}

export async function prepareMissingPostersAction(): Promise<HealthActionResult> {
  if (!canRunInlineMediaProcessing()) {
    return { success: false, message: LOCAL_WORKER_ONLY_MESSAGE };
  }

  const result = await backfillClipThumbnails({ limit: 50 });
  revalidateHealthRecoveryPaths();

  return {
    success: result.fallbackCount === 0,
    message:
      result.attemptedCount === 0
        ? "All available clip posters are already prepared."
        : `Prepared ${result.generatedCount} poster(s), reused ${result.existingCount}, and ${result.fallbackCount} still need attention. ${result.missingPosterCount} poster(s) remain.`,
  };
}

export async function repairLocalLibraryAction(): Promise<HealthActionResult> {
  if (!canRunInlineMediaProcessing()) {
    return { success: false, message: LOCAL_WORKER_ONLY_MESSAGE };
  }

  const result = await repairMissingLocalAssetReferences();
  revalidateHealthRecoveryPaths();

  return {
    success: true,
    message:
      result.repairedAssets === 0
        ? `Scanned ${result.scannedClips} clip(s). No broken local file references needed repair.`
        : `Repaired ${result.repairedAssets} missing asset reference(s) across ${result.repairedClips} clip(s). Those clips are now marked for regeneration.`,
  };
}

export async function rebuildPriorityLibraryAssetsAction(): Promise<HealthActionResult> {
  if (!canRunInlineMediaProcessing()) {
    return { success: false, message: LOCAL_WORKER_ONLY_MESSAGE };
  }

  const clips = await prisma.clipCandidate.findMany({
    where: buildPostingClipAssetRecoveryWhere(),
    select: {
      id: true,
      title: true,
    },
    orderBy: [
      { finalQualityScore: "desc" },
      { updatedAt: "desc" },
    ],
    take: 12,
  });

  if (clips.length === 0) {
    revalidateHealthRecoveryPaths();
    return {
      success: true,
      message: "No approved or exported clips need media regeneration right now.",
    };
  }

  let completed = 0;
  const failures: string[] = [];

  for (const clip of clips) {
    const result = await regenerateClipOutdatedAssetsAction(clip.id);
    if (result.success) {
      completed += 1;
    } else {
      failures.push(`${clip.title}: ${result.message}`);
    }
  }

  revalidateHealthRecoveryPaths();

  return {
    success: failures.length === 0,
    message:
      failures.length === 0
        ? `Rebuilt needed media for ${completed} approved/exported clip(s).`
        : `Rebuilt ${completed} approved/exported clip(s). ${failures.length} clip(s) still need attention: ${failures.slice(0, 3).join(" | ")}`,
  };
}

export async function retryLatestFailedProcessingJobsAction(): Promise<HealthActionResult> {
  if (!canRunInlineMediaProcessing()) {
    return { success: false, message: LOCAL_WORKER_ONLY_MESSAGE };
  }

  const jobs = await prisma.processingJob.findMany({
    select: {
      id: true,
      sermonId: true,
      type: true,
      status: true,
      updatedAt: true,
      sermon: {
        select: {
          title: true,
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 300,
  });
  const retryTargets = selectUnresolvedFailedProcessingJobRetries(jobs, HEALTH_RECOVERY_FAILED_JOB_LIMIT);

  if (retryTargets.length === 0) {
    revalidateHealthRecoveryPaths();
    return {
      success: true,
      message: "No failed processing jobs need retry right now.",
    };
  }

  let completed = 0;
  const failures: string[] = [];

  for (const job of retryTargets) {
    const result = await retryFailedProcessingJobById({
      sermonId: job.sermonId,
      jobId: job.id,
    });

    if (result.success) {
      completed += 1;
    } else {
      failures.push(`${job.sermon.title} (${job.type}): ${result.message}`);
    }
  }

  revalidateHealthRecoveryPaths();

  return {
    success: failures.length === 0,
    message:
      failures.length === 0
        ? `Retried ${completed} failed processing job${completed === 1 ? "" : "s"} successfully.`
        : `Retried ${completed} failed processing job${completed === 1 ? "" : "s"}. ${failures.length} still need attention: ${failures.slice(0, 3).join(" | ")}`,
  };
}

export async function repairAndRebuildLibraryAction(): Promise<HealthActionResult> {
  if (!canRunInlineMediaProcessing()) {
    return { success: false, message: LOCAL_WORKER_ONLY_MESSAGE };
  }

  const repair = await repairMissingLocalAssetReferences();
  const retries = await retryLatestFailedProcessingJobsAction();
  const rebuild = await rebuildPriorityLibraryAssetsAction();
  const posters = await backfillClipThumbnails({ limit: 50 });
  revalidateHealthRecoveryPaths();

  const messages = [
    repair.repairedAssets === 0
      ? `Scanned ${repair.scannedClips} clip(s); no missing file references needed repair.`
      : `Marked ${repair.repairedAssets} missing asset reference(s) across ${repair.repairedClips} clip(s) for regeneration.`,
    retries.message,
    rebuild.message,
    posters.attemptedCount === 0
      ? "Clip posters were already prepared where possible."
      : `Prepared ${posters.generatedCount} poster(s), reused ${posters.existingCount}, and ${posters.fallbackCount} still need attention.`,
  ];

  return {
    success: retries.success && rebuild.success && posters.fallbackCount === 0,
    message: messages.join(" "),
  };
}
