import { stat } from "node:fs/promises";

import type { ClipRenderStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { appendPipelineLog } from "@/server/agents/storage";
import { renderApprovedClip } from "@/server/agents/clipRenderService";
import {
  remotePreviewStorageConfigured,
  uploadClipPreviewToR2,
} from "@/server/agents/clipRemotePreviewStorage";

type ReviewAssetClip = {
  id: string;
  renderStatus: ClipRenderStatus;
  renderedFilePath: string | null;
  renderedSizeBytes: number | null;
  remotePreviewUrl: string | null;
  exportLayoutStrategy: "CENTER_CROP" | "LEFT_FOCUS" | "RIGHT_FOCUS" | "FIT_BLURRED_BACKGROUND" | "SMART_CROP" | null;
};

export type ClipReviewAssetSummary = {
  prepared: number;
  remoteUploaded: number;
  failed: number;
  skipped: number;
};

function shouldPreparePreview(clip: Pick<ReviewAssetClip, "renderStatus">, force?: boolean): boolean {
  const renderInProgress = clip.renderStatus === "QUEUED" || clip.renderStatus === "RENDERING";
  const previewAlreadyReady = clip.renderStatus === "COMPLETED";
  return !renderInProgress && (Boolean(force) || !previewAlreadyReady);
}

function shouldUploadRemotePreview(
  clip: Pick<ReviewAssetClip, "renderStatus" | "renderedFilePath" | "remotePreviewUrl">,
  force?: boolean,
): boolean {
  return (
    remotePreviewStorageConfigured() &&
    clip.renderStatus === "COMPLETED" &&
    Boolean(clip.renderedFilePath) &&
    (Boolean(force) || !clip.remotePreviewUrl)
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
      status: "SUGGESTED",
      isAiGenerated: true,
      ...(input.onlyFailed ? { renderStatus: "FAILED" } : {}),
    },
    orderBy: [{ overallPostScore: "desc" }, { score: "desc" }, { startTimeSeconds: "asc" }],
    select: {
      id: true,
      renderStatus: true,
      renderedFilePath: true,
      renderedSizeBytes: true,
      remotePreviewUrl: true,
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

  await appendPipelineLog(input.sermonId, `Preparing preview assets for ${clips.length} generated clip(s).`);

  for (const clip of clips) {
    if (!shouldPreparePreview(clip, input.force)) {
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
      const renderResult = await renderReviewPreviewWithFallback(input.sermonId, clip, input.force);
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
};
