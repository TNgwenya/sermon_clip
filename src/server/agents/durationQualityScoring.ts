export const CLIP_DURATION_QUALITY_LABELS = [
  "TOO_SHORT",
  "TIGHT",
  "IDEAL",
  "SLIGHTLY_LONG",
  "TOO_LONG",
] as const;

export type ClipDurationQualityLabel = typeof CLIP_DURATION_QUALITY_LABELS[number];

export type ClipDurationQuality = {
  durationQualityScore: number;
  durationQualityLabel: ClipDurationQualityLabel;
  durationReason: string;
  targetMinSeconds: number;
  targetMaxSeconds: number;
};

type DurationCandidate = {
  durationSeconds: number;
  clipType?: string | null;
  smartClipCategory?: string | null;
  clipArcType?: string | null;
  transcriptText?: string | null;
};

type DurationTarget = {
  min: number;
  max: number;
  hardMax: number;
};

const DEFAULT_TARGET: DurationTarget = { min: 45, max: 90, hardMax: 120 };

export function getDurationTarget(candidate: DurationCandidate): DurationTarget {
  const text = `${candidate.clipType ?? ""} ${candidate.smartClipCategory ?? ""} ${candidate.clipArcType ?? ""} ${candidate.transcriptText ?? ""}`.toLowerCase();

  if (/quote|punchline|funny/.test(text)) {
    return { min: 20, max: 40, hardMax: 90 };
  }
  if (/scripture|explanation/.test(text)) {
    return { min: 45, max: 90, hardMax: 120 };
  }
  if (/story|testimony/.test(text)) {
    return { min: 45, max: 90, hardMax: 120 };
  }
  if (/emotional|ministry|prayer|pain|hope|declaration/.test(text)) {
    return { min: 45, max: 90, hardMax: 120 };
  }
  if (/altar|invitation|salvation/.test(text)) {
    return { min: 30, max: 75, hardMax: 90 };
  }
  if (/application|apply/.test(text)) {
    return { min: 35, max: 75, hardMax: 90 };
  }
  if (/teaching|insight|pastoral|leadership/.test(text)) {
    return { min: 45, max: 90, hardMax: 120 };
  }

  return DEFAULT_TARGET;
}

export function scoreDurationQuality(candidate: DurationCandidate): ClipDurationQuality {
  const target = getDurationTarget(candidate);
  const duration = candidate.durationSeconds;
  let label: ClipDurationQualityLabel = "IDEAL";
  let score = 9;

  if (duration < target.min * 0.75) {
    label = "TOO_SHORT";
    score = 3.5;
  } else if (duration < target.min) {
    label = "TIGHT";
    score = 6.8;
  } else if (duration <= target.max) {
    label = "IDEAL";
    score = duration > 90 && target.hardMax <= 120 ? 8 : 9.2;
  } else if (duration <= target.hardMax) {
    label = "SLIGHTLY_LONG";
    score = 6.4;
  } else {
    label = "TOO_LONG";
    score = 2.8;
  }

  return {
    durationQualityScore: score,
    durationQualityLabel: label,
    durationReason: `Clip is ${label.toLowerCase().replace(/_/g, " ")} for its content type (${target.min}-${target.max}s target).`,
    targetMinSeconds: target.min,
    targetMaxSeconds: target.max,
  };
}
