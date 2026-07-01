import { describe, expect, it } from "vitest";

import { buildClipAssetRecoveryPlan } from "@/lib/clipAssetRecovery";

describe("clip asset recovery", () => {
  it("summarizes failed media stages and prefers retry language", () => {
    const plan = buildClipAssetRecoveryPlan({
      renderStatus: "FAILED",
      captionStatus: "GENERATED",
      captionBurnStatus: "FAILED",
      overlayStatus: "COMPLETED",
      exportStatus: "FAILED",
      renderFreshness: "FAILED",
      captionFreshness: "UP_TO_DATE",
      captionBurnFreshness: "FAILED",
      overlayFreshness: "UP_TO_DATE",
      exportFreshness: "FAILED",
    });

    expect(plan.hasRecoverableIssue).toBe(true);
    expect(plan.failedLabels).toEqual(["Render", "Caption burn", "Export"]);
    expect(plan.staleLabels).toEqual([]);
    expect(plan.issueCount).toBe(3);
    expect(plan.summary).toBe("Failed: Render, Caption burn, Export");
    expect(plan.actionLabel).toBe("Retry failed media");
  });

  it("summarizes stale media without duplicating failed labels", () => {
    const plan = buildClipAssetRecoveryPlan({
      renderStatus: "COMPLETED",
      captionStatus: "GENERATED",
      captionBurnStatus: "COMPLETED",
      overlayStatus: "COMPLETED",
      exportStatus: "COMPLETED",
      renderFreshness: "UP_TO_DATE",
      captionFreshness: "OUTDATED",
      captionBurnFreshness: "NEEDS_REGENERATION",
      overlayFreshness: "UP_TO_DATE",
      exportFreshness: "OUTDATED",
    });

    expect(plan.hasRecoverableIssue).toBe(true);
    expect(plan.failedLabels).toEqual([]);
    expect(plan.staleLabels).toEqual(["Captions", "Caption burn", "Export"]);
    expect(plan.summary).toBe("Final video needs updating.");
    expect(plan.actionLabel).toBe("Prepare for Posting");
  });

  it("reports ready media when every stage is healthy", () => {
    const plan = buildClipAssetRecoveryPlan({
      renderStatus: "COMPLETED",
      captionStatus: "GENERATED",
      captionBurnStatus: "COMPLETED",
      overlayStatus: "COMPLETED",
      exportStatus: "COMPLETED",
      renderFreshness: "UP_TO_DATE",
      captionFreshness: "UP_TO_DATE",
      captionBurnFreshness: "UP_TO_DATE",
      overlayFreshness: "UP_TO_DATE",
      exportFreshness: "UP_TO_DATE",
    });

    expect(plan.hasRecoverableIssue).toBe(false);
    expect(plan.issueCount).toBe(0);
    expect(plan.summary).toBe("Clip media is up to date.");
  });
});
