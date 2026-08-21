import { stat } from "node:fs/promises";

import type { AssetFreshness, ClipOverlayStatus, ClipRenderStatus, ClipStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isFreshRemotePreview, listBestPreviewCandidates } from "@/lib/clipPreview";
import { BASIC_CLIP_FALLBACK_WARNING } from "@/server/agents/basicClipFallbackService";
import { appendPipelineLog } from "@/server/agents/storage";
import { renderApprovedClip } from "@/server/agents/clipRenderService";
import { renderClipOverlay } from "@/server/agents/clipOverlayService";
import {
  remotePreviewStorageConfigured,
  uploadClipPreviewToR2,
} from "@/server/agents/clipRemotePreviewStorage";
import {
  COMPACT_CLIP_PREVIEW_VERSION,
  compactClipPreviewUrlIsCurrent,
  createCompactClipPreview,
  removeCompactClipPreview,
} from "@/server/agents/clipPreviewProxyService";
import type { TenantScope } from "@/server/tenancy/scope";

type ReviewAssetClip = {
  id: string;
  status: ClipStatus;
  isAiGenerated: boolean;
  clipType: string;
  qualityWarnings: Prisma.JsonValue | null;
  renderStatus: ClipRenderStatus;
  renderedFilePath: string | null;
  captionedVideoPath: string | null;
  overlayVideoPath: string | null;
  overlayStatus: ClipOverlayStatus;
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
  selectedClipIds: string[];
  deferredClipCount: number;
  firstBrandedClipId: string | null;
  firstBrandedPreviewReady: boolean;
  firstBrandedPreviewFailed: boolean;
};

function normalizePreviewLimit(maxClips: number | undefined, clipCount: number): number {
  if (maxClips === undefined) {
    return clipCount;
  }

  if (!Number.isFinite(maxClips)) {
    throw new Error("Preview limit must be a finite number.");
  }

  return Math.min(clipCount, Math.max(0, Math.floor(maxClips)));
}

function buildPriorityPreviewPlan<T extends { id: string }>(clips: T[], maxClips?: number): {
  selected: T[];
  deferred: T[];
} {
  const selectedCount = normalizePreviewLimit(maxClips, clips.length);
  return {
    selected: clips.slice(0, selectedCount),
    deferred: clips.slice(selectedCount),
  };
}

function buildReviewAssetWhere(input: {
  sermonId: string;
  tenantScope?: TenantScope;
  onlyFailed?: boolean;
  clipIds?: string[];
}): Prisma.ClipCandidateWhereInput {
  const clipIds = Array.from(new Set(
    (input.clipIds ?? []).map((clipId) => clipId.trim()).filter(Boolean),
  ));

  return {
    sermonId: input.sermonId,
    ...(input.tenantScope ? { sermon: input.tenantScope } : {}),
    ...(input.clipIds !== undefined ? { id: { in: clipIds } } : {}),
    ...(input.onlyFailed
      ? {
          status: { in: ["SUGGESTED", "APPROVED"] },
          renderStatus: "FAILED",
          OR: [
            { isAiGenerated: true },
            {
              isAiGenerated: false,
              clipType: "basic",
              qualityWarnings: { array_contains: [BASIC_CLIP_FALLBACK_WARNING] },
            },
          ],
        }
      : {
          OR: [
            {
              status: { in: ["SUGGESTED", "APPROVED"] },
              isAiGenerated: true,
            },
            {
              status: { in: ["SUGGESTED", "APPROVED"] },
              isAiGenerated: false,
              clipType: "basic",
              qualityWarnings: { array_contains: [BASIC_CLIP_FALLBACK_WARNING] },
            },
            {
              status: { in: ["SUGGESTED", "APPROVED", "EXPORTED"] },
              renderStatus: "COMPLETED",
              renderedFilePath: { not: null },
            },
          ],
        }),
  };
}

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
  clip: Pick<ReviewAssetClip, "status" | "isAiGenerated" | "renderStatus">
    & Partial<Pick<ReviewAssetClip, "clipType" | "qualityWarnings">>,
  force?: boolean,
  previewMediaIsUsable?: boolean,
): boolean {
  return (
    (clip.status === "SUGGESTED" || clip.status === "APPROVED") &&
    (
      clip.isAiGenerated
      || (
        clip.clipType === "basic"
        && Array.isArray(clip.qualityWarnings)
        && clip.qualityWarnings.includes(BASIC_CLIP_FALLBACK_WARNING)
      )
    ) &&
    shouldPreparePreview(clip, force, previewMediaIsUsable)
  );
}

function isBasicFallbackReviewClip(
  clip: Pick<ReviewAssetClip, "clipType" | "qualityWarnings">,
): boolean {
  return clip.clipType === "basic"
    && Array.isArray(clip.qualityWarnings)
    && clip.qualityWarnings.includes(BASIC_CLIP_FALLBACK_WARNING);
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
    (Boolean(force) || !isFreshRemotePreview(clip) || !compactClipPreviewUrlIsCurrent(clip.remotePreviewUrl))
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
  const result = await renderApprovedClip(clip.id, {
    force,
    allowRerender: Boolean(force),
    // Review preparation must stay responsive on the shared media worker.
    // Clips without model tracking use the framing service's safe blurred
    // fallback; an explicit Studio edit can still request fresh tracking.
    allowTrackingGeneration: false,
  });
  const renderedClip = await prisma.clipCandidate.findUnique({
    where: { id: clip.id },
    select: { renderedSizeBytes: true },
  });
  await appendPipelineLog(
    sermonId,
    `Review preview uses the active revision's canonical framing plan for clip ${clip.id}.`,
  );
  return {
    renderedFilePath: result.renderedFilePath,
    fileSizeBytes: renderedClip?.renderedSizeBytes ?? null,
  };
}

async function prepareFirstBrandedReviewPreview(
  sermonId: string,
  clip: ReviewAssetClip,
  force?: boolean,
): Promise<{ overlayVideoPath: string; fileSizeBytes: number | null }> {
  if (
    !force
    && clip.overlayStatus === "COMPLETED"
    && clip.overlayFreshness === "UP_TO_DATE"
    && clip.overlayVideoPath
  ) {
    const existingSize = await resolveFileSize(clip.overlayVideoPath, null);
    if (existingSize) {
      return { overlayVideoPath: clip.overlayVideoPath, fileSizeBytes: existingSize };
    }
  }

  const result = await renderClipOverlay(clip.id, {
    force,
    allowRerender: Boolean(force) || clip.overlayStatus === "COMPLETED",
    reviewPreviewWithoutCaptions: true,
  });
  return {
    overlayVideoPath: result.overlayVideoPath,
    fileSizeBytes: await resolveFileSize(result.overlayVideoPath, null),
  };
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

  let compactPreviewPath: string | null = null;
  let uploadPath = input.renderedFilePath;
  let uploadSize = input.fileSizeBytes;
  let versionTag: string | undefined;

  try {
    try {
      const compactPreview = await createCompactClipPreview({
        sourcePath: input.renderedFilePath,
      });
      compactPreviewPath = compactPreview.filePath;
      uploadPath = compactPreview.filePath;
      uploadSize = compactPreview.fileSizeBytes;
      versionTag = compactPreview.version;
      await appendPipelineLog(
        input.sermonId,
        `Compact preview ${COMPACT_CLIP_PREVIEW_VERSION} prepared for clip ${input.clipId}: ${compactPreview.fileSizeBytes} bytes (master: ${input.fileSizeBytes} bytes).`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown compact preview encoding error.";
      await appendPipelineLog(
        input.sermonId,
        `Compact preview encoding failed for clip ${input.clipId}; uploading the full-quality master as a temporary fallback. Reason: ${reason}`,
      );
    }

    const uploaded = await uploadClipPreviewToR2({
      sermonId: input.sermonId,
      clipId: input.clipId,
      videoPath: uploadPath,
      videoSize: uploadSize,
      versionTag,
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
  } finally {
    if (compactPreviewPath) {
      await removeCompactClipPreview(compactPreviewPath);
    }
  }
}

export async function prepareGeneratedClipReviewAssets(input: {
  sermonId: string;
  tenantScope?: TenantScope;
  force?: boolean;
  onlyFailed?: boolean;
  clipIds?: string[];
  /**
   * Restricts this invocation to the strongest ranked clips. The query order is
   * deterministic, so a value of three always prepares the first suggestion
   * before the next two and leaves the rest for a follow-on job.
   */
  maxClips?: number;
  /** Build an actual branding overlay for the first ranked review preview. */
  prepareFirstBrandedPreview?: boolean;
}): Promise<ClipReviewAssetSummary> {
  const clips = await prisma.clipCandidate.findMany({
    where: buildReviewAssetWhere(input),
    orderBy: [
      { overallPostScore: "desc" },
      { score: "desc" },
      { startTimeSeconds: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      status: true,
      isAiGenerated: true,
      clipType: true,
      qualityWarnings: true,
      renderStatus: true,
      renderedFilePath: true,
      captionedVideoPath: true,
      overlayVideoPath: true,
      overlayStatus: true,
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
    return {
      prepared: 0,
      remoteUploaded: 0,
      failed: 0,
      skipped: 0,
      selectedClipIds: [],
      deferredClipCount: 0,
      firstBrandedClipId: null,
      firstBrandedPreviewReady: false,
      firstBrandedPreviewFailed: false,
    };
  }

  const priorityPlan = buildPriorityPreviewPlan(clips, input.maxClips);

  let prepared = 0;
  let remoteUploaded = 0;
  let failed = 0;
  let skipped = 0;
  let firstBrandedPreviewReady = false;
  let firstBrandedPreviewFailed = false;

  await appendPipelineLog(
    input.sermonId,
    `Preparing preview assets for ${priorityPlan.selected.length} highest-ranked clip(s) in order; ${priorityPlan.deferred.length} clip(s) deferred.`,
  );

  for (const [index, clip] of priorityPlan.selected.entries()) {
    // A Brand Kit overlay is a review aid, never an approval signal. Degraded
    // time-based fallback clips intentionally remain plainly labelled and
    // unbranded until a pastor has rebuilt them in Studio.
    const isFirstRankedClip = input.prepareFirstBrandedPreview === true
      && index === 0
      && !isBasicFallbackReviewClip(clip);
    const previewIsUsable = await reviewPreviewMediaIsUsable(clip);
    const shouldRender = shouldRenderReviewPreview(clip, input.force, previewIsUsable);
    let rawPreview: { renderedFilePath: string; fileSizeBytes: number | null } | null = null;

    if (shouldRender) {
      try {
      // A completed database status can outlive its local file after a move or
      // cleanup. Let the renderer repair that stale record instead of skipping
      // it forever and leaving every browser preview blank.
        const repairStaleCompletedPreview = clip.renderStatus === "COMPLETED" && !previewIsUsable;
        rawPreview = await renderReviewPreviewWithFallback(
          input.sermonId,
          clip,
          Boolean(input.force) || repairStaleCompletedPreview,
        );
        prepared += 1;
      } catch (error) {
        failed += 1;
        const reason = error instanceof Error ? error.message : "Unknown preview render error.";
        await appendPipelineLog(input.sermonId, `Preview render failed for clip ${clip.id}: ${reason}`);
        continue;
      }
    } else {
      skipped += 1;
      if (clip.renderedFilePath) {
        rawPreview = {
          renderedFilePath: clip.renderedFilePath,
          fileSizeBytes: await resolveFileSize(clip.renderedFilePath, clip.renderedSizeBytes),
        };
      }
    }

    if (isFirstRankedClip) {
      try {
        const branded = await prepareFirstBrandedReviewPreview(input.sermonId, clip, input.force);
        firstBrandedPreviewReady = true;
        if (await uploadRemotePreviewBestEffort({
          sermonId: input.sermonId,
          clipId: clip.id,
          renderedFilePath: branded.overlayVideoPath,
          fileSizeBytes: branded.fileSizeBytes,
        })) {
          remoteUploaded += 1;
        }
        await appendPipelineLog(input.sermonId, `First branded review preview prepared for highest-ranked clip ${clip.id}.`);
      } catch (error) {
        firstBrandedPreviewFailed = true;
        const reason = error instanceof Error ? error.message : "Unknown branding error.";
        await appendPipelineLog(
          input.sermonId,
          `First branded review preview failed for clip ${clip.id}; preserving the raw review preview. Reason: ${reason}`,
        );
      }
    }

    const rawRemoteUploadNeeded = shouldRender || shouldUploadRemotePreview(clip, input.force);
    if (
      rawPreview
      && rawRemoteUploadNeeded
      && (!isFirstRankedClip || !firstBrandedPreviewReady)
      && await uploadRemotePreviewBestEffort({
        sermonId: input.sermonId,
        clipId: clip.id,
        renderedFilePath: rawPreview.renderedFilePath,
        fileSizeBytes: rawPreview.fileSizeBytes,
      })
    ) {
      remoteUploaded += 1;
    }
  }

  await appendPipelineLog(
    input.sermonId,
    `Priority preview preparation complete. Prepared: ${prepared}, remote uploaded: ${remoteUploaded}, skipped: ${skipped}, failed: ${failed}, deferred: ${priorityPlan.deferred.length}, first branded preview: ${firstBrandedPreviewReady ? "ready" : firstBrandedPreviewFailed ? "failed with raw fallback preserved" : "not requested"}.`,
  );

  return {
    prepared,
    remoteUploaded,
    failed,
    skipped,
    selectedClipIds: priorityPlan.selected.map((clip) => clip.id),
    deferredClipCount: priorityPlan.deferred.length,
    firstBrandedClipId: input.prepareFirstBrandedPreview
      && priorityPlan.selected[0]
      && !isBasicFallbackReviewClip(priorityPlan.selected[0])
      ? priorityPlan.selected[0].id
      : null,
    firstBrandedPreviewReady,
    firstBrandedPreviewFailed,
  };
}

export const __clipReviewAssetServiceTestUtils = {
  buildReviewAssetWhere,
  shouldPreparePreview,
  shouldRenderReviewPreview,
  shouldUploadRemotePreview,
  buildPriorityPreviewPlan,
  isBasicFallbackReviewClip,
};
