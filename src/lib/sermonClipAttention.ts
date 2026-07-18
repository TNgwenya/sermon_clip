type ClipStatus = "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
type RenderStatus = "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
type ExportStatus = "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED";
type CaptionStatus = "NOT_GENERATED" | "GENERATING" | "GENERATED" | "FAILED";
type CaptionBurnStatus = "NOT_BURNED" | "BURNING" | "COMPLETED" | "FAILED";
type OverlayStatus = "NOT_RENDERED" | "RENDERING" | "COMPLETED" | "FAILED";
type AssetFreshness = "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";

export type SermonClipAttentionInput = {
  status: ClipStatus;
  renderStatus: RenderStatus;
  exportStatus: ExportStatus;
  captionStatus?: CaptionStatus;
  captionBurnStatus?: CaptionBurnStatus;
  overlayStatus?: OverlayStatus;
  renderFreshness: AssetFreshness;
  captionFreshness: AssetFreshness;
  captionBurnFreshness: AssetFreshness;
  overlayFreshness: AssetFreshness;
  exportFreshness: AssetFreshness;
};

export type SermonClipAttentionSummary = {
  running: number;
  failed: number;
  clipsNeedingRefresh: number;
};

function isStaleFreshness(freshness: AssetFreshness): boolean {
  return freshness === "OUTDATED" || freshness === "NEEDS_REGENERATION";
}

function expectedPreviewNeedsRefresh(clip: SermonClipAttentionInput): boolean {
  if (clip.renderStatus === "QUEUED" || clip.renderStatus === "RENDERING" || clip.renderStatus === "FAILED") {
    return false;
  }

  return clip.renderStatus === "NOT_RENDERED" || isStaleFreshness(clip.renderFreshness);
}

function producedDownstreamAssetNeedsRefresh(
  status: CaptionStatus | CaptionBurnStatus | OverlayStatus | ExportStatus | undefined,
  freshness: AssetFreshness,
): boolean {
  const wasProduced = status === "GENERATED" || status === "COMPLETED";
  return wasProduced && isStaleFreshness(freshness);
}

function clipNeedsRefresh(clip: SermonClipAttentionInput): boolean {
  if (expectedPreviewNeedsRefresh(clip)) {
    return true;
  }

  if (clip.status === "SUGGESTED") {
    return false;
  }

  return producedDownstreamAssetNeedsRefresh(clip.captionStatus, clip.captionFreshness)
    || producedDownstreamAssetNeedsRefresh(clip.captionBurnStatus, clip.captionBurnFreshness)
    || producedDownstreamAssetNeedsRefresh(clip.overlayStatus, clip.overlayFreshness)
    || producedDownstreamAssetNeedsRefresh(clip.exportStatus, clip.exportFreshness);
}

export function summarizeSermonClipAttention(
  clips: readonly SermonClipAttentionInput[],
): SermonClipAttentionSummary {
  return clips.reduce<SermonClipAttentionSummary>((summary, clip) => {
    if (clip.status === "REJECTED") {
      return summary;
    }

    if (clip.renderStatus === "RENDERING") summary.running += 1;
    if (clip.exportStatus === "EXPORTING") summary.running += 1;
    if (clip.captionStatus === "GENERATING") summary.running += 1;
    if (clip.captionBurnStatus === "BURNING") summary.running += 1;
    if (clip.overlayStatus === "RENDERING") summary.running += 1;

    if (clip.renderStatus === "FAILED") summary.failed += 1;
    if (clip.exportStatus === "FAILED") summary.failed += 1;
    if (clip.captionStatus === "FAILED") summary.failed += 1;
    if (clip.captionBurnStatus === "FAILED") summary.failed += 1;
    if (clip.overlayStatus === "FAILED") summary.failed += 1;

    if (clipNeedsRefresh(clip)) {
      summary.clipsNeedingRefresh += 1;
    }

    return summary;
  }, { running: 0, failed: 0, clipsNeedingRefresh: 0 });
}
