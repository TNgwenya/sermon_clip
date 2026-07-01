import type { HookOverlayConfig, SpeechCleanupSettings } from "@/lib/clipStudio";

export type PreviewCaptionCue = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type SpeechCleanupPreviewCut = {
  startSeconds: number;
  endSeconds: number;
  removedSeconds: number;
};

export type SpeechCleanupPreviewPlan = {
  enabled: boolean;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  cleanedDurationSeconds: number;
  cuts: SpeechCleanupPreviewCut[];
};

const EDGE_SPEECH_PAD_SECONDS = 0.12;
const INTERNAL_SPEECH_PAD_SECONDS = 0.18;
const MIN_EDGE_SILENCE_SECONDS = 0.5;
const MIN_INTERNAL_SILENCE_SECONDS = 1.2;

function roundPreviewSeconds(value: number): number {
  return Number(value.toFixed(3));
}

function clampPreviewSeconds(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function buildSpeechCleanupPreviewPlan({
  captionCues,
  durationSeconds,
  speechCleanup,
}: {
  captionCues: PreviewCaptionCue[];
  durationSeconds: number | null;
  speechCleanup: SpeechCleanupSettings;
}): SpeechCleanupPreviewPlan {
  const duration = Number.isFinite(durationSeconds) && durationSeconds !== null ? Math.max(0, durationSeconds) : 0;
  const sortedCues = [...captionCues]
    .filter((cue) => cue.text.trim().length > 0 && cue.endSeconds > cue.startSeconds)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  const canPreviewCleanup = duration > 0 && sortedCues.length > 0;
  const cleanupEnabled = canPreviewCleanup && (speechCleanup.removeDeadAir || speechCleanup.tightenLongPauses);

  let sourceStartSeconds = 0;
  let sourceEndSeconds = duration;

  if (canPreviewCleanup && speechCleanup.removeDeadAir) {
    const firstCue = sortedCues[0];
    const lastCue = sortedCues[sortedCues.length - 1];
    if (firstCue.startSeconds >= MIN_EDGE_SILENCE_SECONDS) {
      sourceStartSeconds = roundPreviewSeconds(Math.max(0, firstCue.startSeconds - EDGE_SPEECH_PAD_SECONDS));
    }
    if (duration - lastCue.endSeconds >= MIN_EDGE_SILENCE_SECONDS) {
      sourceEndSeconds = roundPreviewSeconds(Math.min(duration, lastCue.endSeconds + EDGE_SPEECH_PAD_SECONDS));
    }
  }

  const cuts = canPreviewCleanup && speechCleanup.tightenLongPauses
    ? sortedCues.flatMap((cue, index) => {
        const nextCue = sortedCues[index + 1];
        if (!nextCue) {
          return [];
        }

        const gapSeconds = nextCue.startSeconds - cue.endSeconds;
        if (gapSeconds < MIN_INTERNAL_SILENCE_SECONDS) {
          return [];
        }

        const startSeconds = roundPreviewSeconds(clampPreviewSeconds(cue.endSeconds + INTERNAL_SPEECH_PAD_SECONDS, sourceStartSeconds, sourceEndSeconds));
        const endSeconds = roundPreviewSeconds(clampPreviewSeconds(nextCue.startSeconds - INTERNAL_SPEECH_PAD_SECONDS, sourceStartSeconds, sourceEndSeconds));
        if (endSeconds <= startSeconds) {
          return [];
        }

        return [{
          startSeconds,
          endSeconds,
          removedSeconds: roundPreviewSeconds(endSeconds - startSeconds),
        }];
      })
    : [];

  const edgeRemovedSeconds = Math.max(0, sourceStartSeconds) + Math.max(0, duration - sourceEndSeconds);
  const cutRemovedSeconds = cuts.reduce((total, cut) => total + cut.removedSeconds, 0);
  const cleanedDurationSeconds = roundPreviewSeconds(Math.max(0, duration - edgeRemovedSeconds - cutRemovedSeconds));

  return {
    enabled: cleanupEnabled,
    sourceStartSeconds,
    sourceEndSeconds,
    cleanedDurationSeconds,
    cuts,
  };
}

export function mapSourceSecondsToCleanedPreviewSeconds(sourceSeconds: number, plan: SpeechCleanupPreviewPlan): number {
  const clampedSourceSeconds = clampPreviewSeconds(sourceSeconds, plan.sourceStartSeconds, plan.sourceEndSeconds);
  const removedBefore = plan.cuts.reduce((total, cut) => {
    if (clampedSourceSeconds <= cut.startSeconds) {
      return total;
    }

    return total + Math.min(cut.removedSeconds, clampedSourceSeconds - cut.startSeconds);
  }, plan.sourceStartSeconds);

  return roundPreviewSeconds(Math.max(0, clampedSourceSeconds - removedBefore));
}

export function mapCleanedPreviewSecondsToSourceSeconds(cleanedSeconds: number, plan: SpeechCleanupPreviewPlan): number {
  let sourceSeconds = plan.sourceStartSeconds + Math.max(0, cleanedSeconds);
  for (const cut of plan.cuts) {
    const cleanedCutStart = mapSourceSecondsToCleanedPreviewSeconds(cut.startSeconds, plan);
    if (cleanedSeconds >= cleanedCutStart) {
      sourceSeconds += cut.removedSeconds;
    }
  }

  return roundPreviewSeconds(clampPreviewSeconds(sourceSeconds, plan.sourceStartSeconds, plan.sourceEndSeconds));
}

export function resolveSpeechCleanupJumpTarget(sourceSeconds: number, plan: SpeechCleanupPreviewPlan): number | null {
  if (sourceSeconds < plan.sourceStartSeconds) {
    return plan.sourceStartSeconds;
  }

  if (sourceSeconds > plan.sourceEndSeconds) {
    return plan.sourceEndSeconds;
  }

  const activeCut = plan.cuts.find((cut) => sourceSeconds >= cut.startSeconds && sourceSeconds < cut.endSeconds);
  return activeCut ? activeCut.endSeconds : null;
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

  const activeCue = captionCues.find(
    (cue) =>
      cue.text.trim().length > 0 &&
      previewSeconds >= cue.startSeconds &&
      previewSeconds <= cue.endSeconds,
  );

  return activeCue?.text.trim() ?? (captionCues.length === 0 ? fallbackText.trim() : "");
}
