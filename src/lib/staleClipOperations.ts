export const STALE_CLIP_OPERATION_MS = 2 * 60 * 60 * 1000;

export type ClipOperationSnapshot = {
  updatedAt: Date;
  renderStatus: "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
  captionStatus: "NOT_GENERATED" | "GENERATING" | "GENERATED" | "FAILED";
  captionBurnStatus: "NOT_BURNED" | "BURNING" | "COMPLETED" | "FAILED";
  overlayStatus: "NOT_RENDERED" | "RENDERING" | "COMPLETED" | "FAILED";
  exportStatus: "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED";
};

export type StaleClipOperation = "render" | "captions" | "captionBurn" | "branding" | "export";

export type StaleClipOperationRecoveryData = {
  renderStatus?: "FAILED";
  renderError?: string;
  renderFreshness?: "NEEDS_REGENERATION";
  captionStatus?: "FAILED";
  captionGenerationError?: string;
  captionFreshness?: "NEEDS_REGENERATION";
  captionBurnStatus?: "FAILED";
  captionBurnError?: string;
  captionBurnFreshness?: "NEEDS_REGENERATION";
  overlayStatus?: "FAILED";
  overlayRenderError?: string;
  overlayFreshness?: "NEEDS_REGENERATION";
  exportStatus?: "FAILED";
  exportError?: string;
  exportFreshness?: "NEEDS_REGENERATION";
};

const RECOVERY_REASON = "Marked as stale by Refresh blocked processes after more than two hours without an update.";

export function isStaleClipOperation(
  clip: Pick<ClipOperationSnapshot, "updatedAt">,
  now = new Date(),
): boolean {
  return now.getTime() - clip.updatedAt.getTime() > STALE_CLIP_OPERATION_MS;
}

export function buildStaleClipOperationRecovery(
  clip: ClipOperationSnapshot,
  now = new Date(),
): { operations: StaleClipOperation[]; data: StaleClipOperationRecoveryData } {
  if (!isStaleClipOperation(clip, now)) {
    return { operations: [], data: {} };
  }

  const operations: StaleClipOperation[] = [];
  const data: StaleClipOperationRecoveryData = {};

  if (clip.renderStatus === "QUEUED" || clip.renderStatus === "RENDERING") {
    operations.push("render");
    data.renderStatus = "FAILED";
    data.renderError = RECOVERY_REASON;
    data.renderFreshness = "NEEDS_REGENERATION";
  }
  if (clip.captionStatus === "GENERATING") {
    operations.push("captions");
    data.captionStatus = "FAILED";
    data.captionGenerationError = RECOVERY_REASON;
    data.captionFreshness = "NEEDS_REGENERATION";
  }
  if (clip.captionBurnStatus === "BURNING") {
    operations.push("captionBurn");
    data.captionBurnStatus = "FAILED";
    data.captionBurnError = RECOVERY_REASON;
    data.captionBurnFreshness = "NEEDS_REGENERATION";
  }
  if (clip.overlayStatus === "RENDERING") {
    operations.push("branding");
    data.overlayStatus = "FAILED";
    data.overlayRenderError = RECOVERY_REASON;
    data.overlayFreshness = "NEEDS_REGENERATION";
  }
  if (clip.exportStatus === "QUEUED" || clip.exportStatus === "EXPORTING") {
    operations.push("export");
    data.exportStatus = "FAILED";
    data.exportError = RECOVERY_REASON;
    data.exportFreshness = "NEEDS_REGENERATION";
  }

  return { operations, data };
}
