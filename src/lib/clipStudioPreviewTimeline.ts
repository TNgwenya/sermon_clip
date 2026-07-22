import type { HookOverlayConfig } from "@/lib/clipStudio";
import { normalizeCaptionCueWordTimings } from "@/lib/clipStudioEditing";
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

export function resolveCompositionPreviewDuration(input: {
  draftDurationSeconds: number | null;
  mediaDurationSeconds: number | null;
  speechCleanupPlan: SpeechCleanupPreviewPlan | null | undefined;
}): number | null {
  if (input.speechCleanupPlan?.enabled) {
    return input.speechCleanupPlan.cleanedDurationSeconds;
  }

  return input.draftDurationSeconds ?? input.mediaDurationSeconds;
}

type PreviewMediaSynchronizationTarget = {
  currentTime: number;
  duration: number;
  readyState: number;
  playbackRate: number;
  paused: boolean;
  ended: boolean;
  play: () => Promise<unknown>;
  pause: () => void;
};

export function synchronizePreviewBackdropMedia(
  foreground: PreviewMediaSynchronizationTarget | null,
  backdrop: PreviewMediaSynchronizationTarget | null,
): void {
  if (!foreground || !backdrop || backdrop.readyState < 1) {
    return;
  }

  const foregroundSeconds = Number.isFinite(foreground.currentTime) ? foreground.currentTime : 0;
  const backdropDuration = Number.isFinite(backdrop.duration)
    ? Math.max(0, backdrop.duration)
    : Number.POSITIVE_INFINITY;
  const targetSeconds = Math.max(0, Math.min(foregroundSeconds, backdropDuration));
  if (Math.abs(backdrop.currentTime - targetSeconds) > 0.08) {
    backdrop.currentTime = targetSeconds;
  }

  backdrop.playbackRate = foreground.playbackRate;
  if (!foreground.paused && !foreground.ended) {
    if (backdrop.paused) {
      void backdrop.play().catch(() => undefined);
    }
    return;
  }

  if (!backdrop.paused) {
    backdrop.pause();
  }
}

function clampPreviewSeconds(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mapSourceSecondsToCleanedPreviewSeconds(sourceSeconds: number, plan: SpeechCleanupPreviewPlan): number {
  return mapSourceSecondsToCleanedSeconds(sourceSeconds, plan);
}

export function mapCleanedPreviewSecondsToSourceSeconds(cleanedSeconds: number, plan: SpeechCleanupPreviewPlan): number {
  return mapCleanedSecondsToSourceSeconds(cleanedSeconds, plan);
}

export type PreviewSeekTimeDomain = "cleaned" | "source";

export function resolvePreviewSeekSourceSeconds({
  requestedSeconds,
  timeDomain,
  plan,
}: {
  requestedSeconds: number;
  timeDomain: PreviewSeekTimeDomain;
  plan: SpeechCleanupPreviewPlan | null | undefined;
}): number {
  const safeRequestedSeconds = Number.isFinite(requestedSeconds) ? Math.max(0, requestedSeconds) : 0;
  if (!plan?.enabled) {
    return safeRequestedSeconds;
  }

  if (timeDomain === "cleaned") {
    return mapCleanedPreviewSecondsToSourceSeconds(safeRequestedSeconds, plan);
  }

  // A source-time request can land inside a removed range. Round-tripping it
  // through the cleaned timeline moves it to the first playable source frame.
  return mapCleanedPreviewSecondsToSourceSeconds(
    mapSourceSecondsToCleanedPreviewSeconds(safeRequestedSeconds, plan),
    plan,
  );
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

export type HookOverlayAnimationFrame = {
  opacity: number;
  translateXPercent: number;
  translateYPercent: number;
};

/**
 * Mirrors the short intro/outro windows used by the FFmpeg hook overlay.
 * Keeping this pure lets the Studio preview and final render share the same
 * visible animation state instead of approximating it with unrelated CSS.
 */
export function resolveHookOverlayAnimationFrame(
  hookOverlay: HookOverlayConfig,
  previewSeconds: number,
): HookOverlayAnimationFrame {
  const startSeconds = Number.isFinite(hookOverlay.startSeconds) ? Math.max(0, hookOverlay.startSeconds) : 0;
  const durationSeconds = Number.isFinite(hookOverlay.durationSeconds) ? Math.max(1, hookOverlay.durationSeconds) : 6;
  const endSeconds = startSeconds + durationSeconds;
  const fadeDuration = Math.min(0.35, Math.max(0.12, durationSeconds / 6));
  const introProgress = clampPreviewSeconds((previewSeconds - startSeconds) / fadeDuration, 0, 1);
  const outroProgress = clampPreviewSeconds((endSeconds - previewSeconds) / fadeDuration, 0, 1);

  return {
    opacity: hookOverlay.animation === "fade" ? Math.min(introProgress, outroProgress) : 1,
    translateXPercent: hookOverlay.animation === "pan-in" && introProgress < 1 ? -12.5 * (1 - introProgress) : 0,
    translateYPercent: hookOverlay.animation === "pop" && introProgress < 1 ? 8 * (1 - introProgress) : 0,
  };
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

export function resolveCaptionLookupSeconds(
  sourcePreviewSeconds: number,
  captionSyncOffsetSeconds: number,
): number {
  const previewSeconds = Number.isFinite(sourcePreviewSeconds) ? sourcePreviewSeconds : 0;
  const offsetSeconds = Number.isFinite(captionSyncOffsetSeconds) ? captionSyncOffsetSeconds : 0;
  // Positive offsets make captions appear later, so the preview looks up an
  // earlier point in the unshifted cue timeline.
  return previewSeconds - offsetSeconds;
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

function normalizePreviewCaptionWord(word: string): string {
  return word
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
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

  const exactWordTimings = normalizeCaptionCueWordTimings(
    activeCue.wordTimings,
    activeCue.startSeconds,
    activeCue.endSeconds,
  );
  const exactWordsMatch = exactWordTimings?.length === visibleWords.length && visibleWords.every((word, index) => {
    const normalizedVisibleWord = normalizePreviewCaptionWord(word);
    const normalizedTimedWord = normalizePreviewCaptionWord(exactWordTimings[index]?.text ?? "");
    return normalizedVisibleWord.length > 0 && normalizedVisibleWord === normalizedTimedWord;
  });

  if (exactWordTimings && exactWordsMatch) {
    const clampedSeconds = clampPreviewSeconds(previewSeconds, activeCue.startSeconds, activeCue.endSeconds);
    for (let index = exactWordTimings.length - 1; index >= 0; index -= 1) {
      const timing = exactWordTimings[index];
      const isLastWord = index === exactWordTimings.length - 1;
      if (
        clampedSeconds >= timing.startSeconds &&
        (clampedSeconds < timing.endSeconds || (isLastWord && clampedSeconds <= timing.endSeconds))
      ) {
        return index;
      }
    }

    const nextWordIndex = exactWordTimings.findIndex((timing) => clampedSeconds < timing.startSeconds);
    return nextWordIndex < 0 ? exactWordTimings.length - 1 : Math.max(0, nextWordIndex - 1);
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
