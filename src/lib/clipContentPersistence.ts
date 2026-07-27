export type ClipStudioContentValues = {
  title: string;
  socialCaption: string;
  editorialHook: string;
};

/**
 * Resolves publish copy independently from timed subtitle cues and visual overlays.
 * Keeping this boundary explicit prevents a transcript edit from becoming a social caption.
 */
export function resolveClipStudioContentValues(input: {
  mainCaption: string;
  title: string;
  editorialHook: string;
  existingTitle: string;
  existingEditorialHook: string;
}): ClipStudioContentValues {
  return {
    title: input.title.trim() || input.existingTitle.trim(),
    socialCaption: input.mainCaption.trim(),
    editorialHook: input.editorialHook.trim() || input.existingEditorialHook.trim(),
  };
}

export type ClipStudioAssetInvalidation =
  | "BOUNDARIES"
  | "SPEECH_CLEANUP"
  | "ON_VIDEO_CAPTIONS"
  | "VISUAL_OVERLAYS"
  | "EXPORT_SETTINGS"
  | "NONE";

export function resolveClipStudioChangeScope(input: {
  boundariesChanged: boolean;
  speechCleanupChanged: boolean;
  onVideoCaptionChanged: boolean;
  visualHookChanged: boolean;
  brollLayerChanged: boolean;
  socialCopyChanged: boolean;
  hashtagChanged: boolean;
  editorialHookChanged: boolean;
}): {
  mediaCompositionChanged: boolean;
  postGuidanceChanged: boolean;
  studioEditsChanged: boolean;
} {
  const mediaCompositionChanged =
    input.boundariesChanged
    || input.speechCleanupChanged
    || input.onVideoCaptionChanged
    || input.visualHookChanged
    || input.brollLayerChanged;
  const postGuidanceChanged =
    input.socialCopyChanged
    || input.hashtagChanged
    || input.editorialHookChanged;

  return {
    mediaCompositionChanged,
    postGuidanceChanged,
    studioEditsChanged: mediaCompositionChanged || postGuidanceChanged,
  };
}

type ClipStudioCompositionReset = {
  renderStatus?: "NOT_RENDERED";
  renderedFilePath?: null;
  renderedAt?: null;
  renderError?: null;
  renderedDurationSeconds?: null;
  renderedSizeBytes?: null;
  renderFreshness?: "NEEDS_REGENERATION";
  captionBurnStatus?: "NOT_BURNED";
  captionedVideoPath?: null;
  captionBurnedAt?: null;
  captionBurnError?: null;
  subtitlesBurned?: false;
  captionBurnFreshness?: "NEEDS_REGENERATION" | "UP_TO_DATE";
  overlayStatus?: "NOT_RENDERED";
  overlayVideoPath?: null;
  overlayRenderedAt?: null;
  overlayRenderError?: null;
  overlayFreshness?: "NEEDS_REGENERATION";
  exportStatus?: "NOT_EXPORTED";
  exportedFilePath?: null;
  exportPath?: null;
  exportedAt?: null;
  exportError?: null;
  exportFreshness?: "NEEDS_REGENERATION";
};

const downstreamCaptionCompositionReset = {
  captionBurnStatus: "NOT_BURNED",
  captionedVideoPath: null,
  captionBurnedAt: null,
  captionBurnError: null,
  subtitlesBurned: false,
  overlayStatus: "NOT_RENDERED",
  overlayVideoPath: null,
  overlayRenderedAt: null,
  overlayRenderError: null,
  overlayFreshness: "NEEDS_REGENERATION",
  exportStatus: "NOT_EXPORTED",
  exportedFilePath: null,
  exportPath: null,
  exportedAt: null,
  exportError: null,
  exportFreshness: "NEEDS_REGENERATION",
} as const;

/**
 * Applies the invalidation in the same write as the user's Studio edit.
 * This fail-closed update prevents a worker or publisher from observing new
 * settings alongside an older composition that still appears ready.
 */
export function resolveClipStudioCompositionReset(input: {
  invalidation: ClipStudioAssetInvalidation;
  captionsEnabled: boolean;
}): ClipStudioCompositionReset {
  if (input.invalidation === "BOUNDARIES" || input.invalidation === "SPEECH_CLEANUP") {
    return {
      renderStatus: "NOT_RENDERED",
      renderedFilePath: null,
      renderedAt: null,
      renderError: null,
      renderedDurationSeconds: null,
      renderedSizeBytes: null,
      renderFreshness: "NEEDS_REGENERATION",
      ...downstreamCaptionCompositionReset,
      captionBurnFreshness: input.captionsEnabled ? "NEEDS_REGENERATION" : "UP_TO_DATE",
    };
  }

  if (input.invalidation === "ON_VIDEO_CAPTIONS") {
    return {
      ...downstreamCaptionCompositionReset,
      captionBurnFreshness: input.captionsEnabled ? "NEEDS_REGENERATION" : "UP_TO_DATE",
    };
  }

  if (input.invalidation === "VISUAL_OVERLAYS") {
    return {
      overlayStatus: "NOT_RENDERED",
      overlayVideoPath: null,
      overlayRenderedAt: null,
      overlayRenderError: null,
      overlayFreshness: "NEEDS_REGENERATION",
      exportStatus: "NOT_EXPORTED",
      exportedFilePath: null,
      exportPath: null,
      exportedAt: null,
      exportError: null,
      exportFreshness: "NEEDS_REGENERATION",
    };
  }

  if (input.invalidation === "EXPORT_SETTINGS") {
    return {
      exportStatus: "NOT_EXPORTED",
      exportedFilePath: null,
      exportPath: null,
      exportedAt: null,
      exportError: null,
      exportFreshness: "NEEDS_REGENERATION",
    };
  }

  return {};
}

export function resolveClipStudioAssetInvalidation(input: {
  boundariesChanged: boolean;
  speechCleanupChanged: boolean;
  onVideoCaptionChanged: boolean;
  visualOverlayChanged: boolean;
}): ClipStudioAssetInvalidation {
  if (input.boundariesChanged) return "BOUNDARIES";
  if (input.speechCleanupChanged) return "SPEECH_CLEANUP";
  if (input.onVideoCaptionChanged) return "ON_VIDEO_CAPTIONS";
  if (input.visualOverlayChanged) return "VISUAL_OVERLAYS";
  return "NONE";
}

export function resolveClipStudioBoundaryReviewUpdate(input: {
  boundariesChanged: boolean;
  startSeconds: number;
  endSeconds: number;
}): Record<string, never> | {
  boundaryQuality: "NEEDS_REVIEW";
  boundaryAdjustmentReason: string;
} {
  if (!input.boundariesChanged) {
    return {};
  }

  return {
    boundaryQuality: "NEEDS_REVIEW",
    boundaryAdjustmentReason: `Clip boundaries were manually edited to ${input.startSeconds.toFixed(2)}-${input.endSeconds.toFixed(2)}s. Re-review recommended.`,
  };
}

export function canChooseClipForProduction(
  transcriptSafetyStatus: "TRUSTED" | "REVIEW_REQUIRED" | "REVIEWED",
): boolean {
  return transcriptSafetyStatus !== "REVIEW_REQUIRED";
}

/**
 * Transcript review is a human safety decision, not a side effect of saving
 * generated or existing caption cues. Keep this explicit so default-on
 * captions can never clear a local-language review gate.
 */
export function shouldRecordExplicitTranscriptReview(input: {
  transcriptSafetyStatus: "TRUSTED" | "REVIEW_REQUIRED" | "REVIEWED";
  explicitlyConfirmed: boolean;
}): boolean {
  return input.transcriptSafetyStatus === "REVIEW_REQUIRED" && input.explicitlyConfirmed;
}
