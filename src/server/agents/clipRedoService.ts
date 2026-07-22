import { rm } from "node:fs/promises";

import { formatSecondsForTimestampInput, validateSermonSegmentRange } from "@/lib/sermonSegment";
import { prisma } from "@/lib/prisma";
import { prunePostingPackageHistoryByClipIds } from "@/lib/postingPackages";
import { TARGET_MIN_DURATION_SECONDS } from "@/server/agents/clipBoundaryRefinement";
import {
  appendPipelineLog,
  ensureSermonFolders,
  getClipFolderPath,
} from "@/server/agents/storage";

// The smallest accepted review board contains three distinct suggestions, and
// each saved suggestion must span at least TARGET_MIN_DURATION_SECONDS.
const MIN_REDO_CLIP_GENERATION_WINDOW_SECONDS = TARGET_MIN_DURATION_SECONDS * 3;

export type RedoClipGenerationSummary = {
  deletedClips: number;
  generatedClips?: number;
  clearedDrafts: number;
  clearedScheduledPosts: number;
  clearedPackages: number;
  previewPrepared?: number;
  previewFailed?: number;
  previewSkipped?: number;
};

export type RedoClipGenerationResult = RedoClipGenerationSummary & {
  success: boolean;
  message: string;
};

export type RedoClipGenerationReadiness =
  | { ok: true }
  | { ok: false; message: string };

export type RedoClipGenerationSourceWindow = {
  sermonStartSeconds: number | null;
  sermonEndSeconds: number | null;
  analyzeFullRecording: boolean;
};

export function buildRedoClipGenerationSourceWindow(
  sermonStartSeconds: number | null,
  sermonEndSeconds: number | null,
): RedoClipGenerationSourceWindow {
  const analyzeFullRecording = sermonStartSeconds === null && sermonEndSeconds === null;
  return {
    sermonStartSeconds,
    sermonEndSeconds,
    analyzeFullRecording,
  };
}

export function validateRedoClipGenerationSourceWindow(
  sourceWindow: RedoClipGenerationSourceWindow,
  knownDurationSeconds?: number | null,
): RedoClipGenerationReadiness {
  const rangeValidation = validateSermonSegmentRange({
    sermonStartSeconds: sourceWindow.sermonStartSeconds,
    sermonEndSeconds: sourceWindow.sermonEndSeconds,
    knownDurationSeconds,
  });
  const message = rangeValidation.startError ?? rangeValidation.endError;
  if (message) {
    return { ok: false, message };
  }

  if (
    sourceWindow.sermonEndSeconds !== null
    && sourceWindow.sermonEndSeconds <= (sourceWindow.sermonStartSeconds ?? 0)
  ) {
    return { ok: false, message: "Sermon end time must be after the start time." };
  }

  const selectedStartSeconds = sourceWindow.sermonStartSeconds ?? 0;
  const selectedEndSeconds = sourceWindow.sermonEndSeconds ?? (
    typeof knownDurationSeconds === "number"
    && Number.isFinite(knownDurationSeconds)
    && knownDurationSeconds > 0
      ? knownDurationSeconds
      : null
  );
  if (
    selectedEndSeconds !== null
    && selectedEndSeconds - selectedStartSeconds < MIN_REDO_CLIP_GENERATION_WINDOW_SECONDS
  ) {
    if (sourceWindow.sermonStartSeconds !== null && sourceWindow.sermonEndSeconds === null) {
      return {
        ok: false,
        message: `Sermon start time must leave at least ${MIN_REDO_CLIP_GENERATION_WINDOW_SECONDS} seconds before the end of the video.`,
      };
    }
    if (sourceWindow.sermonStartSeconds === null) {
      return {
        ok: false,
        message: `Sermon end time must include at least ${MIN_REDO_CLIP_GENERATION_WINDOW_SECONDS} seconds from the beginning.`,
      };
    }
    return {
      ok: false,
      message: `Sermon end time must be at least ${MIN_REDO_CLIP_GENERATION_WINDOW_SECONDS} seconds after the start time.`,
    };
  }

  return { ok: true };
}

function describeRedoClipGenerationSourceWindow(sourceWindow: RedoClipGenerationSourceWindow): string {
  if (sourceWindow.analyzeFullRecording) {
    return "the full transcript";
  }

  const start = sourceWindow.sermonStartSeconds === null
    ? "the beginning"
    : formatSecondsForTimestampInput(sourceWindow.sermonStartSeconds);
  const end = sourceWindow.sermonEndSeconds === null
    ? "the end"
    : formatSecondsForTimestampInput(sourceWindow.sermonEndSeconds);
  return `${start} to ${end}`;
}

function jsonStringArrayIncludesAny(value: unknown, clipIdSet: Set<string>): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === "string" && clipIdSet.has(item));
}

export async function validateRedoClipGenerationReadiness(
  sermonId: string,
  options?: {
    currentJobId?: string;
    sourceWindow?: RedoClipGenerationSourceWindow;
  },
): Promise<RedoClipGenerationReadiness> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      transcriptJsonPath: true,
      sourceDurationSeconds: true,
      transcriptSegments: {
        orderBy: { startTimeSeconds: "asc" },
        select: {
          startTimeSeconds: true,
          endTimeSeconds: true,
        },
      },
      processingJobs: {
        where: {
          status: { in: ["PENDING", "RUNNING"] },
          ...(options?.currentJobId ? { id: { not: options.currentJobId } } : {}),
        },
        select: {
          id: true,
          type: true,
          status: true,
        },
        take: 5,
      },
    },
  });

  if (!sermon) {
    return { ok: false, message: "Sermon was not found." };
  }

  if (!sermon.transcriptJsonPath || sermon.transcriptSegments.length === 0) {
    return { ok: false, message: "A completed transcript is required before redoing clip generation." };
  }

  if (options?.sourceWindow) {
    const firstTranscriptStartSeconds = sermon.transcriptSegments.reduce(
      (earliest, segment) => Math.min(earliest, segment.startTimeSeconds),
      Number.POSITIVE_INFINITY,
    );
    const lastTranscriptEndSeconds = sermon.transcriptSegments.reduce(
      (latest, segment) => Math.max(latest, segment.endTimeSeconds),
      0,
    );
    const knownDurationSeconds = typeof sermon.sourceDurationSeconds === "number"
      && Number.isFinite(sermon.sourceDurationSeconds)
      && sermon.sourceDurationSeconds > 0
      ? sermon.sourceDurationSeconds
      : lastTranscriptEndSeconds;
    const sourceWindowReadiness = validateRedoClipGenerationSourceWindow(
      options.sourceWindow,
      knownDurationSeconds,
    );
    if (!sourceWindowReadiness.ok) {
      return sourceWindowReadiness;
    }

    if (
      options.sourceWindow.sermonStartSeconds !== null
      && knownDurationSeconds > 0
      && options.sourceWindow.sermonStartSeconds >= knownDurationSeconds
    ) {
      return {
        ok: false,
        message: "Sermon start time must be earlier than the end of the video.",
      };
    }

    const selectedStartSeconds = options.sourceWindow.sermonStartSeconds ?? 0;
    const selectedEndSeconds = options.sourceWindow.sermonEndSeconds ?? Number.POSITIVE_INFINITY;
    const overlapsSavedTranscript = sermon.transcriptSegments.some((segment) => (
      segment.startTimeSeconds < selectedEndSeconds
      && segment.endTimeSeconds > selectedStartSeconds
    ));
    if (!overlapsSavedTranscript) {
      return {
        ok: false,
        message: "No saved transcript content exists in that source range. Choose a range that overlaps the transcript, or retranscribe the sermon for that part of the video.",
      };
    }

    const transcriptIntersectionStartSeconds = Math.max(
      selectedStartSeconds,
      firstTranscriptStartSeconds,
    );
    const transcriptIntersectionEndSeconds = Math.min(
      selectedEndSeconds,
      lastTranscriptEndSeconds,
    );
    if (
      transcriptIntersectionEndSeconds - transcriptIntersectionStartSeconds
      < MIN_REDO_CLIP_GENERATION_WINDOW_SECONDS
    ) {
      return {
        ok: false,
        message: `The selected source range contains less than ${MIN_REDO_CLIP_GENERATION_WINDOW_SECONDS} seconds of saved transcript. Choose a wider range or retranscribe that part of the video.`,
      };
    }
  }

  if (sermon.processingJobs.length > 0) {
    return {
      ok: false,
      message: "A processing job is already running for this sermon. Wait for it to finish before redoing clip generation.",
    };
  }

  const runningClipOperationCount = await prisma.clipCandidate.count({
    where: {
      sermonId,
      OR: [
        { renderStatus: "RENDERING" },
        { exportStatus: "EXPORTING" },
        { captionStatus: "GENERATING" },
        { captionBurnStatus: "BURNING" },
        { overlayStatus: "RENDERING" },
      ],
    },
  });

  if (runningClipOperationCount > 0) {
    return {
      ok: false,
      message: "One or more clip operations are still running. Wait for them to finish before redoing clip generation.",
    };
  }

  return { ok: true };
}

export async function redoClipGenerationFromTranscript(
  sermonId: string,
  options?: {
    currentJobId?: string;
    sourceWindow?: RedoClipGenerationSourceWindow;
  },
): Promise<RedoClipGenerationResult> {
  const readiness = await validateRedoClipGenerationReadiness(sermonId, options);
  if (!readiness.ok) {
    return {
      success: false,
      message: readiness.message,
      deletedClips: 0,
      clearedDrafts: 0,
      clearedScheduledPosts: 0,
      clearedPackages: 0,
    };
  }

  const clips = await prisma.clipCandidate.findMany({
    where: { sermonId },
    select: { id: true },
  });
  const oldClipIds = clips.map((clip) => clip.id);
  const oldClipIdSet = new Set(oldClipIds);
  let clearedDrafts = 0;
  let clearedScheduledPosts = 0;
  let clearedPackages = 0;

  try {
    if (options?.sourceWindow) {
      const sourceWindow = buildRedoClipGenerationSourceWindow(
        options.sourceWindow.sermonStartSeconds,
        options.sourceWindow.sermonEndSeconds,
      );
      await prisma.sermon.update({
        where: { id: sermonId },
        data: sourceWindow,
      });
      await appendPipelineLog(
        sermonId,
        `Redo clip source window set to ${describeRedoClipGenerationSourceWindow(sourceWindow)}.`,
      );
    }

    await appendPipelineLog(sermonId, `Redo clip generation requested. Removing ${oldClipIds.length} existing clip candidate(s).`);

    if (oldClipIds.length > 0) {
      const [drafts, scheduledPosts] = await Promise.all([
        prisma.postingDraft.findMany({
          select: {
            id: true,
            clipIdsJson: true,
          },
        }),
        prisma.scheduledPost.findMany({
          select: {
            id: true,
            clipIdsJson: true,
          },
        }),
      ]);
      const draftIdsToDelete = drafts
        .filter((draft) => jsonStringArrayIncludesAny(draft.clipIdsJson, oldClipIdSet))
        .map((draft) => draft.id);
      const scheduledPostIdsToDelete = scheduledPosts
        .filter((post) => jsonStringArrayIncludesAny(post.clipIdsJson, oldClipIdSet))
        .map((post) => post.id);

      await prisma.$transaction(async (tx) => {
        if (scheduledPostIdsToDelete.length > 0) {
          const result = await tx.scheduledPost.deleteMany({
            where: { id: { in: scheduledPostIdsToDelete } },
          });
          clearedScheduledPosts = result.count;
        }

        if (draftIdsToDelete.length > 0) {
          const result = await tx.postingDraft.deleteMany({
            where: { id: { in: draftIdsToDelete } },
          });
          clearedDrafts = result.count;
        }

        await tx.contentOpportunity.updateMany({
          where: { relatedClipId: { in: oldClipIds } },
          data: { relatedClipId: null },
        });

        await tx.clipCandidate.deleteMany({
          where: { sermonId },
        });

        await tx.sermon.update({
          where: { id: sermonId },
          data: { status: "TRANSCRIBED" },
        });
      });

      clearedPackages = await prunePostingPackageHistoryByClipIds(oldClipIds);
    } else {
      await prisma.sermon.update({
        where: { id: sermonId },
        data: { status: "TRANSCRIBED" },
      });
    }

    await rm(getClipFolderPath(sermonId), { recursive: true, force: true });
    await ensureSermonFolders(sermonId);
    await appendPipelineLog(
      sermonId,
      `Generated clip cache cleared. Drafts removed: ${clearedDrafts}; scheduled posts removed: ${clearedScheduledPosts}; packages pruned: ${clearedPackages}.`,
    );

    const [{ generateClipSuggestions }, { prepareGeneratedClipReviewAssets }] = await Promise.all([
      import("@/server/agents/clipIntelligenceAgent"),
      import("@/server/agents/clipReviewAssetService"),
    ]);
    const generationResult = await generateClipSuggestions(sermonId, {
      force: true,
      processingJobId: options?.currentJobId,
    });
    const previewSummary = await prepareGeneratedClipReviewAssets({ sermonId, force: true });

    return {
      success: previewSummary.failed === 0,
      message: previewSummary.failed === 0
        ? `Redo complete. Deleted ${oldClipIds.length} old clip(s), generated ${generationResult.clipCount} new suggestion(s), and prepared ${previewSummary.prepared} preview(s).`
        : `Redo completed with preview issues. Deleted ${oldClipIds.length} old clip(s), generated ${generationResult.clipCount} new suggestion(s), prepared ${previewSummary.prepared} preview(s), and ${previewSummary.failed} preview(s) need attention.`,
      deletedClips: oldClipIds.length,
      generatedClips: generationResult.clipCount,
      clearedDrafts,
      clearedScheduledPosts,
      clearedPackages,
      previewPrepared: previewSummary.prepared,
      previewFailed: previewSummary.failed,
      previewSkipped: previewSummary.skipped,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Redo clip generation failed.";
    await appendPipelineLog(sermonId, `Redo clip generation failed: ${message}`);

    return {
      success: false,
      message,
      deletedClips: oldClipIds.length,
      clearedDrafts,
      clearedScheduledPosts,
      clearedPackages,
    };
  }
}
