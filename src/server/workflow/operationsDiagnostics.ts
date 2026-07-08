import { stat } from "node:fs/promises";

import type { ClipCandidate, Prisma, ProcessingJobStatus, ProcessingJobType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isStaleActiveProcessingJob } from "@/lib/pastorWorkflow";

export type OperationalMetrics = {
  sermonsProcessed: number;
  clipsGenerated: number;
  clipsApproved: number;
  clipsRendered: number;
  clipsCaptioned: number;
  clipsOverlayed: number;
  clipsExported: number;
  failedProcessingJobs: number;
  failedClipAssets: number;
  failedOperations: number;
  runningOperations: number;
  pendingActions: number;
  outdatedAssets: number;
};

export type ReadinessChecklistItem = {
  label: string;
  ready: boolean;
  detail: string;
};

export type DataConsistencySummary = {
  issues: string[];
  issueDetails: DataConsistencyIssueDetail[];
  issueCount: number;
  affectedClipIds: string[];
  affectedSermonIds: string[];
  draftIssues: string[];
  draftIssueDetails: DataConsistencyIssueDetail[];
  draftIssueCount: number;
  affectedDraftClipIds: string[];
  affectedDraftSermonIds: string[];
  totalIssueCount: number;
};

export type DataConsistencyIssueDetail = {
  clipId: string;
  sermonId: string;
  clipTitle: string;
  sermonTitle: string | null;
  assetLabel: string;
  problem: string;
  recoveryAction: string;
  blocksPosting: boolean;
};

export type LocalAssetRepairSummary = {
  scannedClips: number;
  repairedClips: number;
  repairedAssets: number;
  messages: string[];
};

export type ProcessingJobRetryCandidate = {
  id: string;
  sermonId: string;
  type: ProcessingJobType;
  status: ProcessingJobStatus;
  updatedAt: Date;
  heartbeatAt?: Date | null;
};

type DiagnosticsRepository = {
  countSermons(where?: Prisma.SermonWhereInput): Promise<number>;
  countClips(where?: Prisma.ClipCandidateWhereInput): Promise<number>;
  countProcessingJobs(where?: Prisma.ProcessingJobWhereInput): Promise<number>;
  findProcessingJobsForDiagnostics(): Promise<ProcessingJobRetryCandidate[]>;
  findClipsForConsistency(): Promise<Array<Pick<ClipCandidate,
    | "id"
    | "sermonId"
    | "status"
    | "renderStatus"
    | "renderedFilePath"
    | "exportStatus"
    | "exportedFilePath"
    | "captionStatus"
    | "subtitleFilePath"
    | "captionBurnStatus"
    | "captionedVideoPath"
    | "overlayStatus"
    | "overlayVideoPath"
  > & {
    title?: string | null;
    sermon?: { title: string } | null;
  }>>;
};

function countUnresolvedFailedProcessingJobs(
  jobs: Array<{
    sermonId: string;
    type: ProcessingJobType;
    status: ProcessingJobStatus;
    updatedAt: Date;
    heartbeatAt?: Date | null;
  }>,
): number {
  const latestBySermonAndType = new Map<string, {
    type: ProcessingJobType;
    status: ProcessingJobStatus;
    updatedAt: Date;
    heartbeatAt?: Date | null;
  }>();

  for (const job of jobs) {
    const key = `${job.sermonId}:${job.type}`;
    const existing = latestBySermonAndType.get(key);
    if (!existing || job.updatedAt > existing.updatedAt) {
      latestBySermonAndType.set(key, {
        type: job.type,
        status: job.status,
        updatedAt: job.updatedAt,
        heartbeatAt: job.heartbeatAt,
      });
    }
  }

  return [...latestBySermonAndType.values()]
    .filter((job) => job.status === "FAILED" || isStaleActiveProcessingJob(job))
    .length;
}

export function selectUnresolvedFailedProcessingJobRetries<T extends ProcessingJobRetryCandidate>(
  jobs: T[],
  limit: number,
): T[] {
  const latestBySermonAndType = new Map<string, T>();

  for (const job of jobs) {
    const key = `${job.sermonId}:${job.type}`;
    const existing = latestBySermonAndType.get(key);
    if (!existing || job.updatedAt > existing.updatedAt) {
      latestBySermonAndType.set(key, job);
    }
  }

  return [...latestBySermonAndType.values()]
    .filter((job) => job.status === "FAILED" || isStaleActiveProcessingJob(job))
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, limit);
}

export function isLatestUnresolvedFailedProcessingJobRetry(
  retryJob: ProcessingJobRetryCandidate,
  jobs: ProcessingJobRetryCandidate[],
): boolean {
  const latest = jobs
    .filter((job) => job.sermonId === retryJob.sermonId && job.type === retryJob.type)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];

  return Boolean(latest?.id === retryJob.id && (latest.status === "FAILED" || isStaleActiveProcessingJob(latest)));
}

async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.size > 0;
  } catch {
    return false;
  }
}

export function createOperationsDiagnosticsService(repository: DiagnosticsRepository) {
  async function getOperationalMetrics(): Promise<OperationalMetrics> {
    const postingClipWhere: Prisma.ClipCandidateWhereInput = {
      status: {
        in: ["APPROVED", "EXPORTED"],
      },
    };
    const [
      sermonsProcessed,
      clipsGenerated,
      clipsApproved,
      clipsRendered,
      clipsCaptioned,
      clipsOverlayed,
      clipsExported,
      processingJobs,
      failedClipRenderCount,
      failedClipExportCount,
      failedCaptionCount,
      failedCaptionBurnCount,
      failedOverlayCount,
      runningJobCount,
      runningClipRenderCount,
      runningClipExportCount,
      runningCaptionCount,
      runningCaptionBurnCount,
      runningOverlayCount,
      pendingClipCount,
      outdatedRenderCount,
      outdatedCaptionCount,
      outdatedCaptionBurnCount,
      outdatedOverlayCount,
      outdatedExportCount,
    ] = await Promise.all([
      repository.countSermons({
        status: {
          in: ["CLIPS_GENERATED", "REVIEWING", "EXPORTING", "EXPORTED"],
        },
      }),
      repository.countClips(),
      repository.countClips({ status: { in: ["APPROVED", "EXPORTED"] } }),
      repository.countClips({ renderStatus: "COMPLETED" }),
      repository.countClips({ captionStatus: "GENERATED" }),
      repository.countClips({ overlayStatus: "COMPLETED" }),
      repository.countClips({ exportStatus: "COMPLETED" }),
      repository.findProcessingJobsForDiagnostics(),
      repository.countClips({ ...postingClipWhere, renderStatus: "FAILED" }),
      repository.countClips({ ...postingClipWhere, exportStatus: "FAILED" }),
      repository.countClips({ ...postingClipWhere, captionStatus: "FAILED" }),
      repository.countClips({ ...postingClipWhere, captionBurnStatus: "FAILED" }),
      repository.countClips({ ...postingClipWhere, overlayStatus: "FAILED" }),
      repository.countProcessingJobs({ status: "RUNNING" }),
      repository.countClips({ renderStatus: "RENDERING" }),
      repository.countClips({ exportStatus: "EXPORTING" }),
      repository.countClips({ captionStatus: "GENERATING" }),
      repository.countClips({ captionBurnStatus: "BURNING" }),
      repository.countClips({ overlayStatus: "RENDERING" }),
      repository.countClips({ status: "SUGGESTED" }),
      repository.countClips({ ...postingClipWhere, renderFreshness: { in: ["OUTDATED", "NEEDS_REGENERATION"] } }),
      repository.countClips({ ...postingClipWhere, captionFreshness: { in: ["OUTDATED", "NEEDS_REGENERATION"] } }),
      repository.countClips({ ...postingClipWhere, captionBurnFreshness: { in: ["OUTDATED", "NEEDS_REGENERATION"] } }),
      repository.countClips({ ...postingClipWhere, overlayFreshness: { in: ["OUTDATED", "NEEDS_REGENERATION"] } }),
      repository.countClips({ ...postingClipWhere, exportFreshness: { in: ["OUTDATED", "NEEDS_REGENERATION"] } }),
    ]);

    const failedJobCount = countUnresolvedFailedProcessingJobs(processingJobs);

    const failedClipAssets =
      failedClipRenderCount +
      failedClipExportCount +
      failedCaptionCount +
      failedCaptionBurnCount +
      failedOverlayCount;

    const failedOperations = failedJobCount + failedClipAssets;

    const runningOperations =
      runningJobCount +
      runningClipRenderCount +
      runningClipExportCount +
      runningCaptionCount +
      runningCaptionBurnCount +
      runningOverlayCount;

    const outdatedAssets =
      outdatedRenderCount +
      outdatedCaptionCount +
      outdatedCaptionBurnCount +
      outdatedOverlayCount +
      outdatedExportCount;

    const pendingActions = pendingClipCount + outdatedAssets;

    return {
      sermonsProcessed,
      clipsGenerated,
      clipsApproved,
      clipsRendered,
      clipsCaptioned,
      clipsOverlayed,
      clipsExported,
      failedProcessingJobs: failedJobCount,
      failedClipAssets,
      failedOperations,
      runningOperations,
      pendingActions,
      outdatedAssets,
    };
  }

  function getReadinessChecklist(metrics: OperationalMetrics): ReadinessChecklistItem[] {
    return [
      {
        label: "Pastor can upload sermon",
        ready: metrics.sermonsProcessed > 0 || metrics.clipsGenerated > 0,
        detail: metrics.sermonsProcessed > 0 ? "At least one sermon has been processed." : "Process at least one sermon in the pipeline.",
      },
      {
        label: "Pastor can generate clips",
        ready: metrics.clipsGenerated > 0,
        detail: metrics.clipsGenerated > 0 ? `${metrics.clipsGenerated} clip candidates exist.` : "Generate clip suggestions from a sermon transcript.",
      },
      {
        label: "Pastor can review clips",
        ready: metrics.clipsGenerated > 0,
        detail: metrics.clipsGenerated > 0 ? "Clip review UI has generated candidates to review." : "No clip candidates available for review yet.",
      },
      {
        label: "Pastor can approve clips",
        ready: metrics.clipsApproved > 0,
        detail: metrics.clipsApproved > 0 ? `${metrics.clipsApproved} clips are approved or exported.` : "Approve at least one clip from review.",
      },
      {
        label: "Pastor can render clips",
        ready: metrics.clipsRendered > 0,
        detail: metrics.clipsRendered > 0 ? `${metrics.clipsRendered} clips rendered successfully.` : "Render at least one approved clip.",
      },
      {
        label: "Pastor can generate captions",
        ready: metrics.clipsCaptioned > 0,
        detail: metrics.clipsCaptioned > 0 ? `${metrics.clipsCaptioned} clips have generated captions.` : "Generate captions for at least one approved clip.",
      },
      {
        label: "Pastor can generate overlays",
        ready: metrics.clipsOverlayed > 0,
        detail: metrics.clipsOverlayed > 0 ? `${metrics.clipsOverlayed} clips have overlays.` : "Generate overlays for at least one rendered clip.",
      },
      {
        label: "Pastor can export clips",
        ready: metrics.clipsExported > 0,
        detail: metrics.clipsExported > 0 ? `${metrics.clipsExported} clips exported successfully.` : "Export at least one rendered clip.",
      },
      {
        label: "Pastor can post clips manually",
        ready: metrics.clipsExported > 0,
        detail: metrics.clipsExported > 0 ? "Downloadable export files are available for manual posting." : "No downloadable exports yet.",
      },
    ];
  }

  async function getDataConsistencySummary(): Promise<DataConsistencySummary> {
    const issues: string[] = [];
    const issueDetails: DataConsistencyIssueDetail[] = [];
    const draftIssues: string[] = [];
    const draftIssueDetails: DataConsistencyIssueDetail[] = [];
    const affectedClipIds = new Set<string>();
    const affectedSermonIds = new Set<string>();
    const affectedDraftClipIds = new Set<string>();
    const affectedDraftSermonIds = new Set<string>();
    const clips = await repository.findClipsForConsistency();

    function addIssue(clip: typeof clips[number], input: {
      issue: string;
      assetLabel: string;
      problem: string;
      recoveryAction: string;
    }): void {
      const detail: DataConsistencyIssueDetail = {
        clipId: clip.id,
        sermonId: clip.sermonId,
        clipTitle: clip.title?.trim() || clip.id,
        sermonTitle: clip.sermon?.title?.trim() || null,
        assetLabel: input.assetLabel,
        problem: input.problem,
        recoveryAction: input.recoveryAction,
        blocksPosting: clip.status === "APPROVED" || clip.status === "EXPORTED",
      };

      if (clip.status === "APPROVED" || clip.status === "EXPORTED") {
        issues.push(input.issue);
        issueDetails.push(detail);
        affectedClipIds.add(clip.id);
        affectedSermonIds.add(clip.sermonId);
        return;
      }

      draftIssues.push(input.issue);
      draftIssueDetails.push(detail);
      affectedDraftClipIds.add(clip.id);
      affectedDraftSermonIds.add(clip.sermonId);
    }

    for (const clip of clips) {
      if (clip.renderStatus === "COMPLETED" && !clip.renderedFilePath) {
        addIssue(clip, {
          issue: `Clip ${clip.id}: render status is COMPLETED but rendered path is missing.`,
          assetLabel: "Rendered video",
          problem: "Marked complete, but no rendered video path is stored.",
          recoveryAction: "Mark render for regeneration, then prepare the clip again.",
        });
      }

      if (clip.exportStatus === "COMPLETED" && !clip.exportedFilePath) {
        addIssue(clip, {
          issue: `Clip ${clip.id}: export status is COMPLETED but export path is missing.`,
          assetLabel: "Posting export",
          problem: "Marked complete, but no exported posting file path is stored.",
          recoveryAction: "Mark export for regeneration, then rebuild posting clips.",
        });
      }

      if (clip.captionStatus === "GENERATED" && !clip.subtitleFilePath) {
        addIssue(clip, {
          issue: `Clip ${clip.id}: caption status is GENERATED but subtitle file path is missing.`,
          assetLabel: "Subtitle file",
          problem: "Captions are marked generated, but the subtitle file path is missing.",
          recoveryAction: "Mark captions for regeneration, then write captions again.",
        });
      }

      if (clip.captionBurnStatus === "COMPLETED" && !clip.captionedVideoPath) {
        addIssue(clip, {
          issue: `Clip ${clip.id}: caption burn status is COMPLETED but captioned video path is missing.`,
          assetLabel: "Captioned video",
          problem: "Captions are marked burned in, but the captioned video path is missing.",
          recoveryAction: "Mark caption burn for regeneration, then burn captions again.",
        });
      }

      if (clip.overlayStatus === "COMPLETED" && !clip.overlayVideoPath) {
        addIssue(clip, {
          issue: `Clip ${clip.id}: overlay status is COMPLETED but overlay video path is missing.`,
          assetLabel: "Branded overlay",
          problem: "Branding is marked complete, but the branded video path is missing.",
          recoveryAction: "Mark overlay for regeneration, then apply church branding again.",
        });
      }

      if (clip.renderStatus === "COMPLETED" && clip.renderedFilePath && !(await fileHasBytes(clip.renderedFilePath))) {
        addIssue(clip, {
          issue: `Clip ${clip.id}: rendered file path does not exist on disk or is empty.`,
          assetLabel: "Rendered video",
          problem: "Rendered video path points to a missing or empty local file.",
          recoveryAction: "Clear the broken render reference, then regenerate the rendered clip.",
        });
      }

      if (clip.exportStatus === "COMPLETED" && clip.exportedFilePath && !(await fileHasBytes(clip.exportedFilePath))) {
        addIssue(clip, {
          issue: `Clip ${clip.id}: exported file path does not exist on disk or is empty.`,
          assetLabel: "Posting export",
          problem: "Export path points to a missing or empty local file.",
          recoveryAction: "Clear the broken export reference, then create the posting export again.",
        });
      }

      if (clip.captionStatus === "GENERATED" && clip.subtitleFilePath && !(await fileHasBytes(clip.subtitleFilePath))) {
        addIssue(clip, {
          issue: `Clip ${clip.id}: subtitle file path does not exist on disk or is empty.`,
          assetLabel: "Subtitle file",
          problem: "Subtitle path points to a missing or empty local file.",
          recoveryAction: "Clear the broken subtitle reference, then regenerate captions.",
        });
      }

      if (clip.captionBurnStatus === "COMPLETED" && clip.captionedVideoPath && !(await fileHasBytes(clip.captionedVideoPath))) {
        addIssue(clip, {
          issue: `Clip ${clip.id}: captioned video path does not exist on disk or is empty.`,
          assetLabel: "Captioned video",
          problem: "Captioned video path points to a missing or empty local file.",
          recoveryAction: "Clear the broken captioned video reference, then burn captions again.",
        });
      }

      if (clip.overlayStatus === "COMPLETED" && clip.overlayVideoPath && !(await fileHasBytes(clip.overlayVideoPath))) {
        addIssue(clip, {
          issue: `Clip ${clip.id}: overlay video path does not exist on disk or is empty.`,
          assetLabel: "Branded overlay",
          problem: "Branded overlay path points to a missing or empty local file.",
          recoveryAction: "Clear the broken branded video reference, then apply branding again.",
        });
      }
    }

    return {
      issues,
      issueDetails,
      issueCount: issues.length,
      affectedClipIds: [...affectedClipIds],
      affectedSermonIds: [...affectedSermonIds],
      draftIssues,
      draftIssueDetails,
      draftIssueCount: draftIssues.length,
      affectedDraftClipIds: [...affectedDraftClipIds],
      affectedDraftSermonIds: [...affectedDraftSermonIds],
      totalIssueCount: issues.length + draftIssues.length,
    };
  }

  return {
    getOperationalMetrics,
    getReadinessChecklist,
    getDataConsistencySummary,
  };
}

function addRepairMessage(messages: string[], clipId: string, assetLabel: string): void {
  messages.push(`Clip ${clipId}: marked missing or empty ${assetLabel} for regeneration.`);
}

export async function repairMissingLocalAssetReferences(limit = 200): Promise<LocalAssetRepairSummary> {
  const clips = await prisma.clipCandidate.findMany({
    take: limit,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      renderStatus: true,
      renderedFilePath: true,
      exportStatus: true,
      exportedFilePath: true,
      captionStatus: true,
      subtitleFilePath: true,
      captionBurnStatus: true,
      captionedVideoPath: true,
      overlayStatus: true,
      overlayVideoPath: true,
    },
  });

  let repairedClips = 0;
  let repairedAssets = 0;
  const messages: string[] = [];

  for (const clip of clips) {
    const data: Prisma.ClipCandidateUpdateInput = {};

    if (clip.renderStatus === "COMPLETED" && (!clip.renderedFilePath || !(await fileHasBytes(clip.renderedFilePath)))) {
      repairedAssets += 1;
      addRepairMessage(messages, clip.id, "rendered video");
      data.renderStatus = "NOT_RENDERED";
      data.renderedFilePath = null;
      data.renderedAt = null;
      data.renderedDurationSeconds = null;
      data.renderedSizeBytes = null;
      data.renderError = "The rendered video file is missing from local storage. Prepare this clip again.";
      data.renderFreshness = "NEEDS_REGENERATION";
    }

    if (clip.captionStatus === "GENERATED" && (!clip.subtitleFilePath || !(await fileHasBytes(clip.subtitleFilePath)))) {
      repairedAssets += 1;
      addRepairMessage(messages, clip.id, "subtitle file");
      data.captionStatus = "NOT_GENERATED";
      data.subtitleFilePath = null;
      data.srtPath = null;
      data.subtitlesGenerated = false;
      data.captionGeneratedAt = null;
      data.captionGenerationError = "The subtitle file is missing from local storage. Write captions again.";
      data.captionFreshness = "NEEDS_REGENERATION";
    }

    if (clip.captionBurnStatus === "COMPLETED" && (!clip.captionedVideoPath || !(await fileHasBytes(clip.captionedVideoPath)))) {
      repairedAssets += 1;
      addRepairMessage(messages, clip.id, "captioned video");
      data.captionBurnStatus = "NOT_BURNED";
      data.captionedVideoPath = null;
      data.captionBurnedAt = null;
      data.captionBurnError = "The captioned video file is missing from local storage. Add captions to the video again.";
      data.subtitlesBurned = false;
      data.captionBurnFreshness = "NEEDS_REGENERATION";
    }

    if (clip.overlayStatus === "COMPLETED" && (!clip.overlayVideoPath || !(await fileHasBytes(clip.overlayVideoPath)))) {
      repairedAssets += 1;
      addRepairMessage(messages, clip.id, "church branding video");
      data.overlayStatus = "NOT_RENDERED";
      data.overlayVideoPath = null;
      data.overlayRenderedAt = null;
      data.overlayRenderError = "The church branding video file is missing from local storage. Add branding again.";
      data.overlayFreshness = "NEEDS_REGENERATION";
    }

    if (clip.exportStatus === "COMPLETED" && (!clip.exportedFilePath || !(await fileHasBytes(clip.exportedFilePath)))) {
      repairedAssets += 1;
      addRepairMessage(messages, clip.id, "download export");
      data.exportStatus = "NOT_EXPORTED";
      data.exportedFilePath = null;
      data.exportPath = null;
      data.exportedAt = null;
      data.exportError = "The exported download file is missing from local storage. Create the download again.";
      data.exportFreshness = "NEEDS_REGENERATION";
    }

    if (Object.keys(data).length > 0) {
      repairedClips += 1;
      data.assetInvalidationReason = "Local repair found one or more missing media files.";
      await prisma.clipCandidate.update({
        where: { id: clip.id },
        data,
      });
    }
  }

  return {
    scannedClips: clips.length,
    repairedClips,
    repairedAssets,
    messages,
  };
}

const prismaRepository: DiagnosticsRepository = {
  countSermons(where) {
    return prisma.sermon.count({ where });
  },
  countClips(where) {
    return prisma.clipCandidate.count({ where });
  },
  countProcessingJobs(where) {
    return prisma.processingJob.count({ where });
  },
  findProcessingJobsForDiagnostics() {
    return prisma.processingJob.findMany({
      select: {
        id: true,
        sermonId: true,
        type: true,
        status: true,
        updatedAt: true,
        heartbeatAt: true,
      },
    });
  },
  findClipsForConsistency() {
    return prisma.clipCandidate.findMany({
      select: {
        id: true,
        sermonId: true,
        title: true,
        status: true,
        renderStatus: true,
        renderedFilePath: true,
        exportStatus: true,
        exportedFilePath: true,
        captionStatus: true,
        subtitleFilePath: true,
        captionBurnStatus: true,
        captionedVideoPath: true,
        overlayStatus: true,
        overlayVideoPath: true,
        sermon: {
          select: {
            title: true,
          },
        },
      },
    });
  },
};

const operationsDiagnostics = createOperationsDiagnosticsService(prismaRepository);

export async function getOperationalMetrics(): Promise<OperationalMetrics> {
  return operationsDiagnostics.getOperationalMetrics();
}

export async function getReadinessChecklist(): Promise<ReadinessChecklistItem[]> {
  const metrics = await getOperationalMetrics();
  return operationsDiagnostics.getReadinessChecklist(metrics);
}

export async function getDataConsistencySummary(): Promise<DataConsistencySummary> {
  return operationsDiagnostics.getDataConsistencySummary();
}

export const __operationsDiagnosticsTestUtils = {
  createOperationsDiagnosticsService,
  countUnresolvedFailedProcessingJobs,
  isLatestUnresolvedFailedProcessingJobRetry,
  selectUnresolvedFailedProcessingJobRetries,
};
