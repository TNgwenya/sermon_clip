export type ClipVolumeTarget = {
  durationSeconds: number;
  label: "short" | "standard" | "full-sermon" | "long-sermon" | "extended";
  minReviewSuggestions: number;
  targetReviewSuggestions: number;
  maxReviewSuggestions: number;
  batchClipLimit: number;
  rangeLabel: string;
};

function normalizeDurationSeconds(durationSeconds: number | null | undefined): number {
  return typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
    ? Math.max(0, durationSeconds)
    : 0;
}

export function resolveClipVolumeTarget(durationSeconds: number | null | undefined): ClipVolumeTarget {
  const safeDurationSeconds = normalizeDurationSeconds(durationSeconds);
  const minutes = safeDurationSeconds / 60;

  if (minutes <= 10) {
    return {
      durationSeconds: safeDurationSeconds,
      label: "short",
      minReviewSuggestions: 3,
      targetReviewSuggestions: 6,
      maxReviewSuggestions: 10,
      batchClipLimit: 2,
      rangeLabel: "3-10",
    };
  }

  if (minutes <= 30) {
    return {
      durationSeconds: safeDurationSeconds,
      label: "standard",
      minReviewSuggestions: 8,
      targetReviewSuggestions: 14,
      maxReviewSuggestions: 20,
      batchClipLimit: 3,
      rangeLabel: "8-20",
    };
  }

  if (minutes <= 60) {
    return {
      durationSeconds: safeDurationSeconds,
      label: "full-sermon",
      minReviewSuggestions: 20,
      targetReviewSuggestions: 26,
      maxReviewSuggestions: 32,
      batchClipLimit: 4,
      rangeLabel: "20-32",
    };
  }

  if (minutes <= 120) {
    return {
      durationSeconds: safeDurationSeconds,
      label: "long-sermon",
      minReviewSuggestions: 32,
      targetReviewSuggestions: 37,
      maxReviewSuggestions: 42,
      batchClipLimit: 4,
      rangeLabel: "32-42",
    };
  }

  return {
    durationSeconds: safeDurationSeconds,
    label: "extended",
    minReviewSuggestions: 42,
    targetReviewSuggestions: 48,
    maxReviewSuggestions: 55,
    batchClipLimit: 4,
    rangeLabel: "42-55",
  };
}

export function shouldReuseClipSuggestionsForTarget(input: {
  existingSuggestionCount: number;
  force?: boolean;
  target?: Pick<ClipVolumeTarget, "minReviewSuggestions"> | null;
}): boolean {
  if (input.force || input.existingSuggestionCount <= 0) {
    return false;
  }

  const minNeeded = input.target?.minReviewSuggestions ?? 1;
  return input.existingSuggestionCount >= minNeeded;
}
