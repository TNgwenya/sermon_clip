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
  | "NONE";

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
