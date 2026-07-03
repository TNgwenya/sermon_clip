import type { HookOverlayConfig } from "@/lib/clipStudio";
import type {
  SpeechCleanupAudioSilenceEvent,
  SpeechCleanupCaptionCue,
  SpeechCleanupCut,
  SpeechCleanupCutPlan,
  SpeechCleanupMarkerConfidence,
  SpeechCleanupMarkerSource,
  SpeechCleanupRemovedRange,
  SpeechCleanupReviewItem,
} from "@/lib/speechCleanupPlan";
import {
  buildSpeechCleanupCutPlan,
  mapCleanedSecondsToSourceSeconds,
  mapSourceSecondsToCleanedSeconds,
  resolveSpeechCleanupJumpTarget,
} from "@/lib/speechCleanupPlan";

export type PreviewCaptionCue = SpeechCleanupCaptionCue;
export type SpeechCleanupPreviewCut = SpeechCleanupCut;
export type SpeechCleanupPreviewRemovedRange = SpeechCleanupRemovedRange;
export type SpeechCleanupPreviewPlan = SpeechCleanupCutPlan;
export type {
  SpeechCleanupAudioSilenceEvent,
  SpeechCleanupMarkerConfidence,
  SpeechCleanupMarkerSource,
  SpeechCleanupReviewItem,
};

export { buildSpeechCleanupCutPlan as buildSpeechCleanupPreviewPlan, resolveSpeechCleanupJumpTarget };

function clampPreviewSeconds(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mapSourceSecondsToCleanedPreviewSeconds(sourceSeconds: number, plan: SpeechCleanupPreviewPlan): number {
  return mapSourceSecondsToCleanedSeconds(sourceSeconds, plan);
}

export function mapCleanedPreviewSecondsToSourceSeconds(cleanedSeconds: number, plan: SpeechCleanupPreviewPlan): number {
  return mapCleanedSecondsToSourceSeconds(cleanedSeconds, plan);
}

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

  const sortedCues = [...captionCues]
    .filter((cue) => cue.text.trim().length > 0)
    .sort((left, right) => left.startSeconds - right.startSeconds);
  const activeCue = sortedCues.find((cue, index) => {
    const isLastCue = index === sortedCues.length - 1;
    return previewSeconds >= cue.startSeconds && (previewSeconds < cue.endSeconds || (isLastCue && previewSeconds <= cue.endSeconds));
  });

  return activeCue?.text.trim() ?? (captionCues.length === 0 ? fallbackText.trim() : "");
}

function getPreviewCaptionWordWeight(word: string): number {
  const spokenCharacterCount = word.replace(/[^\p{L}\p{N}]+/gu, "").length;
  const punctuationWeight = /[.!?]["')\]]?$/.test(word)
    ? 0.45
    : /[,;:]["')\]]?$/.test(word)
      ? 0.225
      : 0;

  return Math.max(1, spokenCharacterCount) + punctuationWeight;
}

export function resolveActiveCaptionWordIndex({
  activeCue,
  words,
  previewSeconds,
}: {
  activeCue: PreviewCaptionCue | null | undefined;
  words: string[];
  previewSeconds: number;
}): number {
  const visibleWords = words.filter((word) => word.trim().length > 0);

  if (visibleWords.length === 0) {
    return -1;
  }

  if (!activeCue || activeCue.endSeconds <= activeCue.startSeconds) {
    return 0;
  }

  const cueDurationSeconds = Math.max(0.1, activeCue.endSeconds - activeCue.startSeconds);
  const clampedSeconds = clampPreviewSeconds(previewSeconds, activeCue.startSeconds, activeCue.endSeconds);
  const elapsedSeconds = clampedSeconds - activeCue.startSeconds;
  const weights = visibleWords.map(getPreviewCaptionWordWeight);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);

  if (totalWeight <= 0) {
    return 0;
  }

  let cumulativeWeight = 0;
  for (let index = 0; index < weights.length; index += 1) {
    cumulativeWeight += weights[index];
    const wordEndSeconds = cueDurationSeconds * (cumulativeWeight / totalWeight);
    if (elapsedSeconds < wordEndSeconds || index === weights.length - 1) {
      return index;
    }
  }

  return visibleWords.length - 1;
}
