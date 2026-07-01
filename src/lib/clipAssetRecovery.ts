export type ClipAssetStatusValue =
  | "NOT_RENDERED"
  | "NOT_GENERATED"
  | "NOT_BURNED"
  | "QUEUED"
  | "RENDERING"
  | "GENERATING"
  | "BURNING"
  | "EXPORTING"
  | "GENERATED"
  | "COMPLETED"
  | "FAILED"
  | "NOT_EXPORTED"
  | null
  | undefined;

export type ClipAssetFreshnessValue =
  | "UP_TO_DATE"
  | "OUTDATED"
  | "NEEDS_REGENERATION"
  | "FAILED"
  | null
  | undefined;

export type ClipAssetRecoveryInput = {
  renderStatus?: ClipAssetStatusValue;
  captionStatus?: ClipAssetStatusValue;
  captionBurnStatus?: ClipAssetStatusValue;
  overlayStatus?: ClipAssetStatusValue;
  exportStatus?: ClipAssetStatusValue;
  renderFreshness?: ClipAssetFreshnessValue;
  captionFreshness?: ClipAssetFreshnessValue;
  captionBurnFreshness?: ClipAssetFreshnessValue;
  overlayFreshness?: ClipAssetFreshnessValue;
  exportFreshness?: ClipAssetFreshnessValue;
};

export type ClipAssetRecoveryPlan = {
  hasRecoverableIssue: boolean;
  failedLabels: string[];
  staleLabels: string[];
  issueCount: number;
  summary: string;
  actionLabel: string;
};

const assetLabels = {
  render: "Render",
  caption: "Captions",
  captionBurn: "Caption burn",
  overlay: "Branding",
  export: "Export",
} as const;

type ClipAssetLabel = typeof assetLabels[keyof typeof assetLabels];

function isAssetLabel(value: ClipAssetLabel | null): value is ClipAssetLabel {
  return value !== null;
}

function isStaleFreshness(value: ClipAssetFreshnessValue): boolean {
  return value === "OUTDATED" || value === "NEEDS_REGENERATION" || value === "FAILED";
}

export function buildClipAssetRecoveryPlan(input: ClipAssetRecoveryInput): ClipAssetRecoveryPlan {
  const failedLabels = [
    input.renderStatus === "FAILED" ? assetLabels.render : null,
    input.captionStatus === "FAILED" ? assetLabels.caption : null,
    input.captionBurnStatus === "FAILED" ? assetLabels.captionBurn : null,
    input.overlayStatus === "FAILED" ? assetLabels.overlay : null,
    input.exportStatus === "FAILED" ? assetLabels.export : null,
  ].filter(isAssetLabel);

  const staleLabels = [
    isStaleFreshness(input.renderFreshness) ? assetLabels.render : null,
    isStaleFreshness(input.captionFreshness) ? assetLabels.caption : null,
    isStaleFreshness(input.captionBurnFreshness) ? assetLabels.captionBurn : null,
    isStaleFreshness(input.overlayFreshness) ? assetLabels.overlay : null,
    isStaleFreshness(input.exportFreshness) ? assetLabels.export : null,
  ].filter(isAssetLabel).filter((label) => !failedLabels.includes(label));

  const issueCount = failedLabels.length + staleLabels.length;

  return {
    hasRecoverableIssue: issueCount > 0,
    failedLabels,
    staleLabels,
    issueCount,
    summary: issueCount === 0
      ? "Clip media is up to date."
      : [
          failedLabels.length > 0 ? `Failed: ${failedLabels.join(", ")}` : null,
          staleLabels.length > 0 ? "Final video needs updating." : null,
        ].filter(Boolean).join(". "),
    actionLabel: failedLabels.length > 0 ? "Retry failed media" : "Prepare for Posting",
  };
}
