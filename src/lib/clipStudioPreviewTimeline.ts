import type { HookOverlayConfig } from "@/lib/clipStudio";

export type PreviewCaptionCue = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export function shouldShowHookOverlay(hookOverlay: HookOverlayConfig, previewSeconds: number): boolean {
  if (!hookOverlay.enabled || !hookOverlay.text.trim()) {
    return false;
  }

  const startSeconds = Number.isFinite(hookOverlay.startSeconds) ? Math.max(0, hookOverlay.startSeconds) : 0;
  const durationSeconds = Number.isFinite(hookOverlay.durationSeconds) ? Math.max(1, hookOverlay.durationSeconds) : 6;
  const endSeconds = startSeconds + durationSeconds;

  return previewSeconds >= startSeconds && previewSeconds <= endSeconds;
}

export function resolveActiveCaptionCueText({
  applyCaptionsToClip,
  captionCues,
  fallbackText,
  previewSeconds,
}: {
  applyCaptionsToClip: boolean;
  captionCues: PreviewCaptionCue[];
  fallbackText: string;
  previewSeconds: number;
}): string {
  if (!applyCaptionsToClip) {
    return "";
  }

  const activeCue = captionCues.find(
    (cue) =>
      cue.text.trim().length > 0 &&
      previewSeconds >= cue.startSeconds &&
      previewSeconds <= cue.endSeconds,
  );

  return activeCue?.text.trim() ?? (captionCues.length === 0 ? fallbackText.trim() : "");
}
