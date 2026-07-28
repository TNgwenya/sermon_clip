import type { EditableCaptionCue } from "@/lib/clipStudioEditing";

export type CaptionCueSelection = {
  anchorIndex: number;
  focusIndex: number;
};

export type ResolvedCaptionCueSelection = {
  startIndex: number;
  endIndex: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  cueCount: number;
};

function clampCueIndex(index: number, cueCount: number): number {
  return Math.max(0, Math.min(Math.max(0, cueCount - 1), Math.round(index)));
}

export function resolveCaptionCueSelection(
  cues: readonly EditableCaptionCue[],
  selection: CaptionCueSelection | null,
): ResolvedCaptionCueSelection | null {
  if (!selection || cues.length === 0) {
    return null;
  }

  const anchorIndex = clampCueIndex(selection.anchorIndex, cues.length);
  const focusIndex = clampCueIndex(selection.focusIndex, cues.length);
  const startIndex = Math.min(anchorIndex, focusIndex);
  const endIndex = Math.max(anchorIndex, focusIndex);
  const selectedCues = cues.slice(startIndex, endIndex + 1);

  if (selectedCues.length === 0) {
    return null;
  }

  return {
    startIndex,
    endIndex,
    startSeconds: selectedCues[0].startSeconds,
    endSeconds: selectedCues[selectedCues.length - 1].endSeconds,
    text: selectedCues.map((cue) => cue.text.trim()).filter(Boolean).join(" "),
    cueCount: selectedCues.length,
  };
}

export function isCaptionCueSelected(
  cueIndex: number,
  selection: ResolvedCaptionCueSelection | null,
): boolean {
  return Boolean(
    selection
    && cueIndex >= selection.startIndex
    && cueIndex <= selection.endIndex,
  );
}

function splitWords(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

export function replaceSelectedCaptionCueText({
  cues,
  selection,
  replacementText,
}: {
  cues: readonly EditableCaptionCue[];
  selection: CaptionCueSelection | null;
  replacementText: string;
}): EditableCaptionCue[] {
  const resolved = resolveCaptionCueSelection(cues, selection);
  if (!resolved) {
    return [...cues];
  }

  const replacementWords = splitWords(replacementText);
  const selectedCues = cues.slice(resolved.startIndex, resolved.endIndex + 1);
  let nextWordIndex = 0;

  return cues.map((cue, cueIndex) => {
    if (cueIndex < resolved.startIndex || cueIndex > resolved.endIndex) {
      return { ...cue };
    }

    const selectedIndex = cueIndex - resolved.startIndex;
    const remainingCueCount = selectedCues.length - selectedIndex;
    const remainingWordCount = replacementWords.length - nextWordIndex;
    const originalWordCount = Math.max(1, splitWords(cue.text).length);
    const wordCount = selectedIndex === selectedCues.length - 1
      ? Math.max(0, remainingWordCount)
      : remainingWordCount > 0 && remainingWordCount < remainingCueCount
        ? 1
      : Math.max(
          0,
          Math.min(
            originalWordCount,
            remainingWordCount - Math.max(0, remainingCueCount - 1),
          ),
        );
    const text = replacementWords.slice(nextWordIndex, nextWordIndex + wordCount).join(" ");
    nextWordIndex += wordCount;

    return {
      ...cue,
      text,
    };
  });
}

export function hideSelectedCaptionCues({
  cues,
  selection,
}: {
  cues: readonly EditableCaptionCue[];
  selection: CaptionCueSelection | null;
}): EditableCaptionCue[] {
  const resolved = resolveCaptionCueSelection(cues, selection);
  if (!resolved) {
    return [...cues];
  }

  return cues.map((cue, cueIndex) => ({
    ...cue,
    text: cueIndex >= resolved.startIndex && cueIndex <= resolved.endIndex ? "" : cue.text,
  }));
}
