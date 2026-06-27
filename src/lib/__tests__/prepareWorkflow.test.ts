import { describe, expect, it } from "vitest";

import {
  buildPrepareApprovedSummary,
  buildPrepareClipPlan,
  buildPrepareProgressSteps,
  type PrepareClipStatus,
} from "@/lib/prepareWorkflow";

function clip(overrides: Partial<PrepareClipStatus> = {}): PrepareClipStatus {
  return {
    id: "clip-1",
    renderStatus: "NOT_RENDERED",
    captionStatus: "NOT_GENERATED",
    captionBurnStatus: "NOT_BURNED",
    overlayStatus: "NOT_RENDERED",
    exportStatus: "NOT_EXPORTED",
    ...overrides,
  };
}

describe("prepare approved clips workflow", () => {
  it("plans every preparation step for a fresh approved clip", () => {
    expect(buildPrepareClipPlan(clip())).toEqual({
      clipId: "clip-1",
      prepareVideo: true,
      writeCaptions: true,
      addCaptionsToVideo: true,
      addChurchBranding: true,
      createDownload: true,
    });
  });

  it("only confirms readiness when all prepared outputs already exist", () => {
    const plan = buildPrepareClipPlan(clip({
      renderStatus: "COMPLETED",
      captionStatus: "GENERATED",
      captionBurnStatus: "COMPLETED",
      overlayStatus: "COMPLETED",
      exportStatus: "COMPLETED",
    }));

    expect(plan).toMatchObject({
      prepareVideo: false,
      writeCaptions: false,
      addCaptionsToVideo: false,
      addChurchBranding: false,
      createDownload: false,
    });
    expect(buildPrepareProgressSteps(plan)).toEqual(["Confirm this clip is ready to post"]);
  });

  it("recreates downloads when captions or branding need to be refreshed", () => {
    expect(
      buildPrepareClipPlan(clip({
        renderStatus: "COMPLETED",
        captionStatus: "GENERATED",
        captionBurnStatus: "NOT_BURNED",
        overlayStatus: "COMPLETED",
        exportStatus: "COMPLETED",
      })).createDownload,
    ).toBe(true);

    expect(
      buildPrepareClipPlan(clip({
        renderStatus: "COMPLETED",
        captionStatus: "GENERATED",
        captionBurnStatus: "COMPLETED",
        overlayStatus: "FAILED",
        exportStatus: "COMPLETED",
      })).createDownload,
    ).toBe(true);
  });

  it("rebuilds completed assets when freshness says they are stale", () => {
    const plan = buildPrepareClipPlan(clip({
      renderStatus: "COMPLETED",
      captionStatus: "GENERATED",
      captionBurnStatus: "COMPLETED",
      overlayStatus: "COMPLETED",
      exportStatus: "COMPLETED",
      renderFreshness: "UP_TO_DATE",
      captionFreshness: "UP_TO_DATE",
      captionBurnFreshness: "OUTDATED",
      overlayFreshness: "UP_TO_DATE",
      exportFreshness: "UP_TO_DATE",
    }));

    expect(plan).toMatchObject({
      prepareVideo: false,
      writeCaptions: false,
      addCaptionsToVideo: true,
      addChurchBranding: false,
      createDownload: true,
    });
  });

  it("recreates only the download when export freshness is stale", () => {
    const plan = buildPrepareClipPlan(clip({
      renderStatus: "COMPLETED",
      captionStatus: "GENERATED",
      captionBurnStatus: "COMPLETED",
      overlayStatus: "COMPLETED",
      exportStatus: "COMPLETED",
      exportFreshness: "NEEDS_REGENERATION",
    }));

    expect(plan).toMatchObject({
      prepareVideo: false,
      writeCaptions: false,
      addCaptionsToVideo: false,
      addChurchBranding: false,
      createDownload: true,
    });
  });

  it("uses pastor-facing progress step labels", () => {
    const plan = buildPrepareClipPlan(clip({
      renderStatus: "COMPLETED",
      captionStatus: "GENERATED",
      captionBurnStatus: "NOT_BURNED",
      overlayStatus: "NOT_RENDERED",
      exportStatus: "COMPLETED",
    }));

    expect(buildPrepareProgressSteps(plan)).toEqual([
      "Add captions to the video",
      "Add church branding",
      "Create the ready-to-post download",
    ]);
  });

  it("builds final pastor-friendly summaries", () => {
    expect(buildPrepareApprovedSummary({ prepared: 1, failed: 0 })).toEqual({
      success: true,
      message: "Prepared 1 clip. Captions, church branding, and downloads are ready.",
    });

    expect(buildPrepareApprovedSummary({ prepared: 2, failed: 1 })).toEqual({
      success: false,
      message: "Prepared 2 clips; 1 need attention before posting.",
    });
  });
});
