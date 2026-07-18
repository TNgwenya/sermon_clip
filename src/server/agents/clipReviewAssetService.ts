import { stat } from "node:fs/promises";

import type { AssetFreshness, ClipRenderStatus, ClipStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isFreshRemotePreview, listBestPreviewCandidates } from "@/lib/clipPreview";
import { appendPipelineLog } from "@/server/agents/storage";
import { renderApprovedClip } from "@/server/agents/clipRenderService";
import {
  remotePreviewStorageConfigured,
  uploadClipPreviewToR2,
} from "@/server/agents/clipRemotePreviewStorage";

type ReviewAssetClip = {
  id: string;
  status: ClipStatus;
  isAiGenerated: boolean;
  renderStatus: ClipRenderStatus;
  renderedFilePath: string | null;
  captionedVideoPath: string | null;
  overlayVideoPath: string | null;
  exportedFilePath: string | null;
  renderedSizeBytes: number | null;
  renderedAt: Date | null;
  remotePreviewUrl: string | null;
  remotePreviewUploadedAt: Date | null;
  renderFreshness: AssetFreshness;
  captionBurnFreshness: AssetFreshness;
  overlayFreshness: AssetFreshness;
  exportFreshness: AssetFreshness;
  exportLayoutStrategy: "CENTER_CROP" | "LEFT_FOCUS" | "RIGHT_FOCUS" | "FIT_BLURRED_BACKGROUND" | "SMART_CROP" | null;
};

export type ClipReviewAssetSummary = {
  prepared: number;
  remoteUploaded: number;
  failed: number;
  skipped: number;
};

function shouldPreparePreview(
  clip: Pick<ReviewAssetClip, "renderStatus">,
  force?: boolean,
  previewMediaIsUsable = clip.renderStatus === "COMPLETED",
): boolean {
  const renderInProgress = clip.renderStatus === "QUEUED" || clip.renderStatus === "RENDERING";
  const previewAlreadyReady = previewMediaIsUsable;
  return !renderInProgress && (Boolean(force) || !previewAlreadyReady);
}

function shouldRenderReviewPreview(
  clip: Pick<ReviewAssetClip, "status" | "isAiGenerated" | "renderStatus">,
  force?: boolean,
  previewMediaIsUsable?: boolean,
): boolean {
  return (
    (clip.status === "SUGGESTED" || clip.status === "APPROVED") &&
    clip.isAiGenerated &&
    shouldPreparePreview(clip, force, previewMediaIsUsable)
  );
}

function shouldUploadRemotePreview(
  clip: Pick<
    ReviewAssetClip,
    "renderStatus" | "renderedFilePath" | "remotePreviewUrl" | "remotePreviewUploadedAt" | "renderedAt" | "renderFreshness"
  >,
  force?: boolean,
): boolean {
  return (
    remotePreviewStorageConfigured() &&
    clip.renderStatus === "COMPLETED" &&
    Boolean(clip.renderedFilePath) &&
    (Boolean(force) || !isFreshRemotePreview(clip))
  );
}

async function resolveFileSize(filePath: string, knownSize: number | null): Promise<number | null> {
  if (knownSize && knownSize > 0) {
    return knownSize;
  }

  try {
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    return fileStat.isFile() && fileStat.size > 0 ? fileStat.size : null;
  } catch {
    return null;
  }
}

async function reviewPreviewMediaIsUsable(clip: Pick<
  ReviewAssetClip,
  | "renderStatus"
  | "renderedFilePath"
  | "captionedVideoPath"
  | "overlayVideoPath"
  | "exportedFilePath"
  | "remotePreviewUrl"
  | "remotePreviewUploadedAt"
  | "renderedAt"
  | "renderFreshness"
  | "captionBurnFreshness"
  | "overlayFreshness"
  | "exportFreshness"
>): Promise<boolean> {
  if (isFreshRemotePreview(clip)) {
    return true;
  }

  for (const candidatePath of listBestPreviewCandidates(clip)) {
    try {
      const fileStat = await stat(/* turbopackIgnore: true */ candidatePath);
      if (fileStat.isFile() && fileStat.size > 0) {
        return true;
      }
    } catch {
      // Keep checking lower-priority preview artifacts.
    }
  }

  return false;
}

async function renderReviewPreviewWithFallback(sermonId: string, clip: ReviewAssetClip, force?: boolean): Promise<{
  renderedFilePath: string;
  fileSizeBytes: number | null;
}> {
  try {
    const result = await renderApprovedClip(clip.id, {
      force,
      allowRerender: Boolean(force),
    });
    const renderedClip = await prisma.clipCandidate.findUnique({
      where: { id: clip.id },
      select: { renderedSizeBytes: true },
    });
    return {
      renderedFilePath: result.renderedFilePath,
      fileSizeBytes: renderedClip?.renderedSizeBytes ?? null,
    };
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
    const result = await renderApprovedClip(clip.id, {
      force: true,
      allowRerender: true,
    });
    const renderedClip = await prisma.clipCandidate.findUnique({
      where: { id: clip.id },
      select: { renderedSizeBytes: true },
    });
    return {
      renderedFilePath: result.renderedFilePath,
      fileSizeBytes: renderedClip?.renderedSizeBytes ?? null,
    };
  }
}

async function uploadRemotePreviewBestEffort(input: {
  sermonId: string;
  clipId: string;
  renderedFilePath: string;
  fileSizeBytes: number | null;
}): Promise<boolean> {
  if (!remotePreviewStorageConfigured()) {
    await appendPipelineLog(input.sermonId, `Remote preview upload skipped for clip ${input.clipId}: R2 preview storage is not configured.`);
    return false;
  }

  if (!input.fileSizeBytes || input.fileSizeBytes <= 0) {
    await appendPipelineLog(input.sermonId, `Remote preview upload skipped for clip ${input.clipId}: rendered file size is unknown.`);
    return false;
  }

  try {
    const uploaded = await uploadClipPreviewToR2({
      sermonId: input.sermonId,
      clipId: input.clipId,
      videoPath: input.renderedFilePath,
      videoSize: input.fileSizeBytes,
    });
    await prisma.clipCandidate.update({
      where: { id: input.clipId },
      data: {
        remotePreviewObjectKey: uploaded.objectKey,
        remotePreviewUrl: uploaded.publicUrl,
        remotePreviewUploadedAt: uploaded.uploadedAt,
      },
    });
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown remote preview upload error.";
    await appendPipelineLog(input.sermonId, `Remote preview upload failed for clip ${input.clipId}: ${reason}`);
    return false;
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
      ...(input.onlyFailed
        ? {
            status: { in: ["SUGGESTED", "APPROVED"] },
            isAiGenerated: true,
            renderStatus: "FAILED",
          }
        : {
            OR: [
              {
                status: { in: ["SUGGESTED", "APPROVED"] },
                isAiGenerated: true,
              },
              {
                status: { in: ["SUGGESTED", "APPROVED", "EXPORTED"] },
                renderStatus: "COMPLETED",
                renderedFilePath: { not: null },
              },
            ],
          }),
    },
    orderBy: [{ overallPostScore: "desc" }, { score: "desc" }, { startTimeSeconds: "asc" }],
    select: {
      id: true,
      status: true,
      isAiGenerated: true,
      renderStatus: true,
      renderedFilePath: true,
      captionedVideoPath: true,
      overlayVideoPath: true,
      exportedFilePath: true,
      renderedSizeBytes: true,
      renderedAt: true,
      remotePreviewUrl: true,
      remotePreviewUploadedAt: true,
      renderFreshness: true,
      captionBurnFreshness: true,
      overlayFreshness: true,
      exportFreshness: true,
      exportLayoutStrategy: true,
    },
  });

  if (clips.length === 0) {
    return { prepared: 0, remoteUploaded: 0, failed: 0, skipped: 0 };
  }

  let prepared = 0;
  let remoteUploaded = 0;
  let failed = 0;
  let skipped = 0;

  await appendPipelineLog(input.sermonId, `Preparing preview assets for ${clips.length} clip(s).`);

  for (const clip of clips) {
    const previewIsUsable = await reviewPreviewMediaIsUsable(clip);
    if (!shouldRenderReviewPreview(clip, input.force, previewIsUsable)) {
      if (shouldUploadRemotePreview(clip, input.force) && clip.renderedFilePath) {
        const uploaded = await uploadRemotePreviewBestEffort({
          sermonId: input.sermonId,
          clipId: clip.id,
          renderedFilePath: clip.renderedFilePath,
          fileSizeBytes: await resolveFileSize(clip.renderedFilePath, clip.renderedSizeBytes),
        });
        if (uploaded) {
          remoteUploaded += 1;
        }
      }
      skipped += 1;
      continue;
    }

    try {
      // A completed database status can outlive its local file after a move or
      // cleanup. Let the renderer repair that stale record instead of skipping
      // it forever and leaving every browser preview blank.
      const repairStaleCompletedPreview = clip.renderStatus === "COMPLETED" && !previewIsUsable;
      const renderResult = await renderReviewPreviewWithFallback(
        input.sermonId,
        clip,
        Boolean(input.force) || repairStaleCompletedPreview,
      );
      prepared += 1;
      if (await uploadRemotePreviewBestEffort({
        sermonId: input.sermonId,
        clipId: clip.id,
        renderedFilePath: renderResult.renderedFilePath,
        fileSizeBytes: renderResult.fileSizeBytes,
      })) {
        remoteUploaded += 1;
      }
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message : "Unknown preview render error.";
      await appendPipelineLog(input.sermonId, `Preview render failed for clip ${clip.id}: ${reason}`);
    }
  }

  await appendPipelineLog(
    input.sermonId,
    `Preview preparation complete. Prepared: ${prepared}, remote uploaded: ${remoteUploaded}, skipped: ${skipped}, failed: ${failed}.`,
  );

  return { prepared, remoteUploaded, failed, skipped };
}

export const __clipReviewAssetServiceTestUtils = {
  shouldPreparePreview,
  shouldRenderReviewPreview,
};
