import type { ClipRenderStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { appendPipelineLog } from "@/server/agents/storage";
import { renderApprovedClip } from "@/server/agents/clipRenderService";

type ReviewAssetClip = {
  id: string;
  renderStatus: ClipRenderStatus;
  exportLayoutStrategy: "CENTER_CROP" | "LEFT_FOCUS" | "RIGHT_FOCUS" | "FIT_BLURRED_BACKGROUND" | "SMART_CROP" | null;
};

export type ClipReviewAssetSummary = {
  prepared: number;
  failed: number;
  skipped: number;
};

function shouldPreparePreview(clip: Pick<ReviewAssetClip, "renderStatus">, force?: boolean): boolean {
  const renderInProgress = clip.renderStatus === "QUEUED" || clip.renderStatus === "RENDERING";
  const previewAlreadyReady = clip.renderStatus === "COMPLETED";
  return !renderInProgress && (Boolean(force) || !previewAlreadyReady);
}

async function renderReviewPreviewWithFallback(sermonId: string, clip: ReviewAssetClip, force?: boolean): Promise<void> {
  try {
    await renderApprovedClip(clip.id, {
      force,
      allowRerender: Boolean(force),
    });
    return;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown preview render error.";
    if (clip.exportLayoutStrategy !== "SMART_CROP") {
      throw error;
    }

    await appendPipelineLog(
      sermonId,
      `Smart crop preview render failed for clip ${clip.id}; retrying with full-stage framing. Reason: ${reason}`,
    );
    await prisma.clipCandidate.update({
      where: { id: clip.id },
      data: {
        exportLayoutStrategy: "FIT_BLURRED_BACKGROUND",
        renderStatus: "NOT_RENDERED",
        renderError: null,
      },
    });
    await renderApprovedClip(clip.id, {
      force: true,
      allowRerender: true,
    });
  }
}

export async function prepareGeneratedClipReviewAssets(input: {
  sermonId: string;
  force?: boolean;
  onlyFailed?: boolean;
}): Promise<ClipReviewAssetSummary> {
  const clips = await prisma.clipCandidate.findMany({
    where: {
      sermonId: input.sermonId,
      status: "SUGGESTED",
      isAiGenerated: true,
      ...(input.onlyFailed ? { renderStatus: "FAILED" } : {}),
    },
    orderBy: [{ overallPostScore: "desc" }, { score: "desc" }, { startTimeSeconds: "asc" }],
    select: {
      id: true,
      renderStatus: true,
      exportLayoutStrategy: true,
    },
  });

  if (clips.length === 0) {
    return { prepared: 0, failed: 0, skipped: 0 };
  }

  let prepared = 0;
  let failed = 0;
  let skipped = 0;

  await appendPipelineLog(input.sermonId, `Preparing preview assets for ${clips.length} generated clip(s).`);

  for (const clip of clips) {
    if (!shouldPreparePreview(clip, input.force)) {
      skipped += 1;
      continue;
    }

    try {
      await renderReviewPreviewWithFallback(input.sermonId, clip, input.force);
      prepared += 1;
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message : "Unknown preview render error.";
      await appendPipelineLog(input.sermonId, `Preview render failed for clip ${clip.id}: ${reason}`);
    }
  }

  await appendPipelineLog(
    input.sermonId,
    `Preview preparation complete. Prepared: ${prepared}, skipped: ${skipped}, failed: ${failed}.`,
  );

  return { prepared, failed, skipped };
}

export const __clipReviewAssetServiceTestUtils = {
  shouldPreparePreview,
};
