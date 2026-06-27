import { describe, expect, it } from "vitest";

import {
  buildPostingClipAssetRecoveryWhere,
  buildWorkspaceHealthIssueBreakdown,
  countWorkspaceHealthIssues,
} from "@/lib/healthRecovery";

describe("health recovery helpers", () => {
  it("selects approved or exported clips with failed asset statuses", () => {
    const where = buildPostingClipAssetRecoveryWhere();

    expect(where.status).toEqual({ in: ["APPROVED", "EXPORTED"] });
    expect(where.OR).toEqual(expect.arrayContaining([
      { renderStatus: "FAILED" },
      { captionStatus: "FAILED" },
      { captionBurnStatus: "FAILED" },
      { overlayStatus: "FAILED" },
      { exportStatus: "FAILED" },
    ]));
  });

  it("also selects clips with outdated or failed freshness flags", () => {
    const where = buildPostingClipAssetRecoveryWhere();

    expect(where.OR).toEqual(expect.arrayContaining([
      { renderFreshness: { not: "UP_TO_DATE" } },
      { captionFreshness: { not: "UP_TO_DATE" } },
      { captionBurnFreshness: { not: "UP_TO_DATE" } },
      { overlayFreshness: { not: "UP_TO_DATE" } },
      { exportFreshness: { not: "UP_TO_DATE" } },
    ]));
  });

  it("counts all visible workspace health blockers, not only failed environment checks", () => {
    expect(countWorkspaceHealthIssues({
      failedHealthChecks: 0,
      missingReadyFiles: 17,
      failedOperations: 9,
      outdatedAssets: 4,
      missingPosters: 135,
      failedPosters: 2,
    })).toBe(167);
  });

  it("separates required recovery from optional poster cleanup", () => {
    const breakdown = buildWorkspaceHealthIssueBreakdown({
      failedHealthChecks: 1,
      missingReadyFiles: 17,
      failedOperations: 9,
      outdatedAssets: 4,
      missingPosters: 135,
      failedPosters: 2,
    });

    expect(breakdown.environmentBlockers).toBe(1);
    expect(breakdown.postingBlockers).toBe(17);
    expect(breakdown.retryableFailures).toBe(9);
    expect(breakdown.assetRegeneration).toBe(4);
    expect(breakdown.optionalCleanup).toBe(137);
    expect(breakdown.actionRequired).toBe(31);
    expect(breakdown.totalNeedsAttention).toBe(168);
  });

  it("does not let negative diagnostic values reduce the attention count", () => {
    expect(countWorkspaceHealthIssues({
      failedHealthChecks: -1,
      missingReadyFiles: 2,
      failedOperations: -3,
      outdatedAssets: 1,
      missingPosters: 0,
      failedPosters: 0,
    })).toBe(3);
  });
});
