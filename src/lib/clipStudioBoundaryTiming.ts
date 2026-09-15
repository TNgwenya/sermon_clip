import type { BrollLayerConfig } from "@/lib/clipStudio";
import { buildTimedCaptionCuesFromTranscriptSegments, buildTimedCaptionCuesFromTranscriptWords,
  type CaptionSourceSegment, type CaptionSourceWord, type EditableCaptionCue } from "@/lib/clipStudioEditing";
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

/** Preserve the creator's current wording; generate only newly included speech. */
export function preserveCaptionCuesForClipBoundaryChange({
  cues, previousEndSeconds, words, segments, singleWord, ...window
}: ClipBoundaryWindow & {
  previousEndSeconds: number;
  cues: EditableCaptionCue[];
  words: CaptionSourceWord[];
  segments: CaptionSourceSegment[];
  singleWord: boolean;
}): EditableCaptionCue[] {
  const preserved = remapCaptionCueOverridesForClipBoundaryChange(cues, window) ?? [];
  const sourceWords = words.length ? words : buildTimedCaptionCuesFromTranscriptSegments({
    startTimeSeconds: window.nextStartSeconds,
    endTimeSeconds: window.nextEndSeconds,
    segments,
    maxWordsPerCue: 1,
  }).flatMap((cue) => (cue.wordTimings ?? []).map((word) => ({
    text: word.text,
    startTimeSeconds: word.startSeconds + window.nextStartSeconds,
    endTimeSeconds: word.endSeconds + window.nextStartSeconds,
  })));
  // A word straddling an old boundary already belongs to the preserved cue.
  const addedWords = sourceWords.filter((word) =>
    word.endTimeSeconds <= window.previousStartSeconds || word.startTimeSeconds >= previousEndSeconds);
  const ranges = [
    [window.nextStartSeconds, Math.min(window.previousStartSeconds, window.nextEndSeconds)],
    [Math.max(previousEndSeconds, window.nextStartSeconds), window.nextEndSeconds],
  ];
  const added = ranges.flatMap(([startTimeSeconds, endTimeSeconds]) => {
    if (endTimeSeconds <= startTimeSeconds) return [];
    const options = {
      startTimeSeconds, endTimeSeconds,
      maxWordsPerCue: singleWord ? 1 : 5,
      maxCueDurationSeconds: singleWord ? 1.4 : 2.4,
      groupingStrategy: singleWord ? "timed" as const : "semantic" as const,
    };
    const generated = buildTimedCaptionCuesFromTranscriptWords({ ...options, words: addedWords });
    const offset = startTimeSeconds - window.nextStartSeconds;
    return generated.map((cue) => ({
      ...cue,
      startSeconds: roundBoundarySeconds(cue.startSeconds + offset),
      endSeconds: roundBoundarySeconds(cue.endSeconds + offset),
      ...(cue.wordTimings ? { wordTimings: cue.wordTimings.map((word) => ({
        ...word,
        startSeconds: roundBoundarySeconds(word.startSeconds + offset),
        endSeconds: roundBoundarySeconds(word.endSeconds + offset),
      })) } : {}),
    }));
  });
  return [...preserved, ...added].sort((a, b) => a.startSeconds - b.startSeconds)
    .map((cue, index) => ({ ...cue, index: index + 1 }));
}

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
