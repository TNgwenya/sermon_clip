import type { Prisma } from "@prisma/client";

export type WorkspaceHealthIssueCounts = {
  failedHealthChecks: number;
  missingReadyFiles: number;
  failedOperations: number;
  outdatedAssets: number;
  missingPosters: number;
  failedPosters: number;
};

export type WorkspaceHealthIssueBreakdown = {
  environmentBlockers: number;
  postingBlockers: number;
  retryableFailures: number;
  assetRegeneration: number;
  optionalCleanup: number;
  actionRequired: number;
  totalNeedsAttention: number;
};

export function buildPostingClipAssetRecoveryWhere(): Prisma.ClipCandidateWhereInput {
  return {
    status: { in: ["APPROVED", "EXPORTED"] },
    OR: [
      { renderStatus: "FAILED" },
      { captionStatus: "FAILED" },
      { captionBurnStatus: "FAILED" },
      { overlayStatus: "FAILED" },
      { exportStatus: "FAILED" },
      { renderFreshness: { not: "UP_TO_DATE" } },
      { captionFreshness: { not: "UP_TO_DATE" } },
      { captionBurnFreshness: { not: "UP_TO_DATE" } },
      { overlayFreshness: { not: "UP_TO_DATE" } },
      { exportFreshness: { not: "UP_TO_DATE" } },
    ],
  };
}

function positiveCount(value: number): number {
  return Math.max(0, value);
}

export function buildWorkspaceHealthIssueBreakdown(input: WorkspaceHealthIssueCounts): WorkspaceHealthIssueBreakdown {
  const environmentBlockers = positiveCount(input.failedHealthChecks);
  const postingBlockers = positiveCount(input.missingReadyFiles);
  const retryableFailures = positiveCount(input.failedOperations);
  const assetRegeneration = positiveCount(input.outdatedAssets);
  const optionalCleanup = positiveCount(input.missingPosters) + positiveCount(input.failedPosters);
  const actionRequired = environmentBlockers + postingBlockers + retryableFailures + assetRegeneration;

  return {
    environmentBlockers,
    postingBlockers,
    retryableFailures,
    assetRegeneration,
    optionalCleanup,
    actionRequired,
    totalNeedsAttention: actionRequired + optionalCleanup,
  };
}

export function countWorkspaceHealthIssues(input: WorkspaceHealthIssueCounts): number {
  return buildWorkspaceHealthIssueBreakdown(input).totalNeedsAttention;
}
