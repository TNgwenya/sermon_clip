export type ClipStudioPrepareFreshness = "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";

export type ClipStudioPrepareAssetSnapshot = {
  renderStatus: "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
  renderFreshness?: ClipStudioPrepareFreshness | null;
  renderedFileReady: boolean;
  captionsEnabled: boolean;
  captionStatus: "NOT_GENERATED" | "GENERATING" | "GENERATED" | "FAILED";
  captionBurnStatus: "NOT_BURNED" | "BURNING" | "COMPLETED" | "FAILED";
  captionBurnFreshness?: ClipStudioPrepareFreshness | null;
  captionedFileReady: boolean;
  exportStatus: "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED";
  exportFreshness?: ClipStudioPrepareFreshness | null;
};

export type ClipStudioPrepareAssetPlan = {
  prepareVideo: boolean;
  burnCaptions: boolean;
  skipCaptionBurn: boolean;
  exportPreparedVideo: boolean;
};

function isUpToDate(value: ClipStudioPrepareFreshness | null | undefined): boolean {
  return value === "UP_TO_DATE";
}

export function buildClipStudioPrepareAssetPlan(
  snapshot: ClipStudioPrepareAssetSnapshot,
): ClipStudioPrepareAssetPlan {
  const prepareVideo =
    snapshot.renderStatus !== "COMPLETED" ||
    !isUpToDate(snapshot.renderFreshness) ||
    !snapshot.renderedFileReady;
  const burnCaptions =
    snapshot.captionsEnabled &&
    (
      prepareVideo ||
      snapshot.captionStatus !== "GENERATED" ||
      snapshot.captionBurnStatus !== "COMPLETED" ||
      !isUpToDate(snapshot.captionBurnFreshness) ||
      !snapshot.captionedFileReady
    );
  const skipCaptionBurn = !snapshot.captionsEnabled && snapshot.captionBurnStatus !== "NOT_BURNED";
  const exportPreparedVideo =
    prepareVideo ||
    burnCaptions ||
    skipCaptionBurn ||
    snapshot.exportStatus !== "COMPLETED" ||
    !isUpToDate(snapshot.exportFreshness);

  return {
    prepareVideo,
    burnCaptions,
    skipCaptionBurn,
    exportPreparedVideo,
  };
}
