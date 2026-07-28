import type { BrollLayerConfig } from "@/lib/clipStudio";
import type { EditableCaptionCue } from "@/lib/clipStudioEditing";
import type { SpeechCleanupEdits } from "@/lib/speechCleanupPlan";

export const STUDIO_BOUNDARY_CONTEXT_SECONDS = 90;

type ClipBoundaryWindow = {
  previousStartSeconds: number;
  nextStartSeconds: number;
  nextEndSeconds: number;
};

type RemappedRange = {
  startSeconds: number;
  endSeconds: number;
};

function roundBoundarySeconds(value: number): number {
  return Number(value.toFixed(3));
}

function remapSourceAnchoredRange({
  startSeconds,
  endSeconds,
  previousStartSeconds,
  nextStartSeconds,
  nextEndSeconds,
  minimumDurationSeconds,
}: ClipBoundaryWindow & {
  startSeconds: number;
  endSeconds: number;
  minimumDurationSeconds: number;
}): RemappedRange | null {
  if (
    !Number.isFinite(startSeconds)
    || !Number.isFinite(endSeconds)
    || endSeconds <= startSeconds
    || !Number.isFinite(previousStartSeconds)
    || !Number.isFinite(nextStartSeconds)
    || !Number.isFinite(nextEndSeconds)
    || nextEndSeconds <= nextStartSeconds
  ) {
    return null;
  }

  const absoluteStartSeconds = previousStartSeconds + startSeconds;
  const absoluteEndSeconds = previousStartSeconds + endSeconds;
  const clippedStartSeconds = Math.max(nextStartSeconds, absoluteStartSeconds);
  const clippedEndSeconds = Math.min(nextEndSeconds, absoluteEndSeconds);

  if (clippedEndSeconds - clippedStartSeconds < minimumDurationSeconds) {
    return null;
  }

  return {
    startSeconds: roundBoundarySeconds(clippedStartSeconds - nextStartSeconds),
    endSeconds: roundBoundarySeconds(clippedEndSeconds - nextStartSeconds),
  };
}

export function remapBrollLayerForClipBoundaryChange(
  brollLayer: BrollLayerConfig,
  window: ClipBoundaryWindow,
): BrollLayerConfig {
  const nextDurationSeconds = Math.max(0, window.nextEndSeconds - window.nextStartSeconds);

  return {
    ...brollLayer,
    cards: brollLayer.cards.map((card) => {
      const remapped = remapSourceAnchoredRange({
        ...window,
        startSeconds: card.startSeconds,
        endSeconds: card.startSeconds + card.durationSeconds,
        minimumDurationSeconds: Math.min(1, nextDurationSeconds),
      });

      if (!remapped) {
        return {
          ...card,
          enabled: false,
          startSeconds: roundBoundarySeconds(
            Math.max(0, Math.min(nextDurationSeconds, card.startSeconds + window.previousStartSeconds - window.nextStartSeconds)),
          ),
        };
      }

      return {
        ...card,
        startSeconds: remapped.startSeconds,
        durationSeconds: roundBoundarySeconds(remapped.endSeconds - remapped.startSeconds),
      };
    }),
  };
}

export function remapSpeechCleanupEditsForClipBoundaryChange(
  edits: SpeechCleanupEdits | null,
  window: ClipBoundaryWindow,
): SpeechCleanupEdits | null {
  if (!edits) {
    return null;
  }

  return {
    ...edits,
    cuts: edits.cuts.flatMap((cut) => {
      const remapped = remapSourceAnchoredRange({
        ...window,
        startSeconds: cut.startSeconds,
        endSeconds: cut.endSeconds,
        minimumDurationSeconds: 0.2,
      });
      if (!remapped) {
        return [];
      }

      const removedSeconds = roundBoundarySeconds(remapped.endSeconds - remapped.startSeconds);
      return [{
        ...cut,
        startSeconds: remapped.startSeconds,
        endSeconds: remapped.endSeconds,
        removedSeconds,
        rawGapSeconds: Math.max(removedSeconds, cut.rawGapSeconds),
      }];
    }),
  };
}

export function remapCaptionCueOverridesForClipBoundaryChange(
  cues: EditableCaptionCue[] | null,
  window: ClipBoundaryWindow,
): EditableCaptionCue[] | null {
  if (!cues) {
    return null;
  }

  return cues.flatMap((cue) => {
    const remapped = remapSourceAnchoredRange({
      ...window,
      startSeconds: cue.startSeconds,
      endSeconds: cue.endSeconds,
      minimumDurationSeconds: 0.05,
    });
    if (!remapped) {
      return [];
    }

    const wordTimings = cue.wordTimings?.flatMap((word) => {
      const remappedWord = remapSourceAnchoredRange({
        ...window,
        startSeconds: word.startSeconds,
        endSeconds: word.endSeconds,
        minimumDurationSeconds: 0.01,
      });
      return remappedWord ? [{ ...word, ...remappedWord }] : [];
    });

    return [{
      ...cue,
      ...remapped,
      ...(wordTimings ? { wordTimings } : {}),
    }];
  });
}

export function remapCaptionCueTextEditsForClipBoundaryChange(
  edits: Record<string, string>,
  window: ClipBoundaryWindow,
): Record<string, string> {
  return Object.entries(edits).reduce<Record<string, string>>((remappedEdits, [key, text]) => {
    const [rawStartSeconds, rawEndSeconds] = key.split("-");
    const remapped = remapSourceAnchoredRange({
      ...window,
      startSeconds: Number(rawStartSeconds),
      endSeconds: Number(rawEndSeconds),
      minimumDurationSeconds: 0.05,
    });
    if (!remapped) {
      return remappedEdits;
    }

    remappedEdits[
      `${remapped.startSeconds.toFixed(3)}-${remapped.endSeconds.toFixed(3)}`
    ] = text;
    return remappedEdits;
  }, {});
}
