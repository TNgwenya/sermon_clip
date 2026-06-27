export type PrepareClipStatus = {
  id: string;
  renderStatus: "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
  captionStatus: "NOT_GENERATED" | "GENERATING" | "GENERATED" | "FAILED";
  captionBurnStatus: "NOT_BURNED" | "BURNING" | "COMPLETED" | "FAILED";
  overlayStatus: "NOT_RENDERED" | "RENDERING" | "COMPLETED" | "FAILED";
  exportStatus: "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED";
  renderFreshness?: "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
  captionFreshness?: "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
  captionBurnFreshness?: "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
  overlayFreshness?: "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
  exportFreshness?: "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
};

export type PrepareClipPlan = {
  clipId: string;
  prepareVideo: boolean;
  writeCaptions: boolean;
  addCaptionsToVideo: boolean;
  addChurchBranding: boolean;
  createDownload: boolean;
};

export type PrepareApprovedSummaryInput = {
  prepared: number;
  failed: number;
};

function isStaleFreshness(value: PrepareClipStatus["renderFreshness"]): boolean {
  return value === "OUTDATED" || value === "NEEDS_REGENERATION" || value === "FAILED";
}

export function buildPrepareClipPlan(clip: PrepareClipStatus): PrepareClipPlan {
  const prepareVideo = clip.renderStatus !== "COMPLETED" || isStaleFreshness(clip.renderFreshness);
  const writeCaptions = clip.captionStatus !== "GENERATED" || isStaleFreshness(clip.captionFreshness);
  const addCaptionsToVideo = clip.captionBurnStatus !== "COMPLETED" || isStaleFreshness(clip.captionBurnFreshness);
  const addChurchBranding = clip.overlayStatus !== "COMPLETED" || isStaleFreshness(clip.overlayFreshness);
  const preparedAssetChanged = prepareVideo || writeCaptions || addCaptionsToVideo || addChurchBranding;

  return {
    clipId: clip.id,
    prepareVideo,
    writeCaptions,
    addCaptionsToVideo,
    addChurchBranding,
    createDownload: clip.exportStatus !== "COMPLETED" || isStaleFreshness(clip.exportFreshness) || preparedAssetChanged,
  };
}

export function buildPrepareProgressSteps(plan: PrepareClipPlan): string[] {
  const steps: string[] = [];

  if (plan.prepareVideo) {
    steps.push("Prepare the video clip");
  }
  if (plan.writeCaptions) {
    steps.push("Write captions");
  }
  if (plan.addCaptionsToVideo) {
    steps.push("Add captions to the video");
  }
  if (plan.addChurchBranding) {
    steps.push("Add church branding");
  }
  if (plan.createDownload) {
    steps.push("Create the ready-to-post download");
  }

  return steps.length > 0 ? steps : ["Confirm this clip is ready to post"];
}

export function buildPrepareApprovedSummary(input: PrepareApprovedSummaryInput): {
  success: boolean;
  message: string;
} {
  const clipWord = input.prepared === 1 ? "clip" : "clips";

  if (input.failed === 0) {
    return {
      success: true,
      message: `Prepared ${input.prepared} ${clipWord}. Captions, church branding, and downloads are ready.`,
    };
  }

  return {
    success: false,
    message: `Prepared ${input.prepared} ${clipWord}; ${input.failed} need attention before posting.`,
  };
}
