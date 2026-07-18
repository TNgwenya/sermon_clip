import { rm } from "node:fs/promises";

import { prisma } from "@/lib/prisma";
import { prunePostingPackageHistoryByClipIds } from "@/lib/postingPackages";
import {
  appendPipelineLog,
  ensureSermonFolders,
  getClipFolderPath,
} from "@/server/agents/storage";

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

function jsonStringArrayIncludesAny(value: unknown, clipIdSet: Set<string>): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === "string" && clipIdSet.has(item));
}

export async function validateRedoClipGenerationReadiness(
  sermonId: string,
  options?: { currentJobId?: string },
): Promise<RedoClipGenerationReadiness> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      transcriptJsonPath: true,
      _count: {
        select: {
          transcriptSegments: true,
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

  if (!sermon.transcriptJsonPath || sermon._count.transcriptSegments === 0) {
    return { ok: false, message: "A completed transcript is required before redoing clip generation." };
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
  options?: { currentJobId?: string },
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
