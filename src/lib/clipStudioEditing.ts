import { parseSermonTimestampInput } from "@/lib/sermonSegment";

const HARD_MIN_CLIP_SECONDS = 24;
const HARD_MAX_CLIP_SECONDS = 150;
const SHORT_CLIP_WARNING_SECONDS = 30;
const LONG_CLIP_WARNING_SECONDS = 120;

export type ClipStudioTimingValidationInput = {
  startTimestamp: string;
  endTimestamp: string;
  knownDurationSeconds: number | null;
};

export type ClipStudioTimingValidationResult = {
  isValid: boolean;
  startSeconds: number | null;
  endSeconds: number | null;
  durationSeconds: number | null;
  fieldErrors: {
    startTimestamp?: string;
    endTimestamp?: string;
  };
  warnings: string[];
};

function parseClipTimestamp(value: string, field: "start" | "end"): { seconds: number | null; error?: string } {
  const normalized = value.trim();

  if (!normalized) {
    return {
      seconds: null,
      error: field === "start"
        ? "Clip start time is not valid. Use a format like 42:10."
        : "Clip end time is not valid. Use a format like 42:10.",
    };
  }

  if (normalized.startsWith("-")) {
    return {
      seconds: null,
      error: field === "start"
        ? "Clip start time cannot be negative."
        : "Clip end time cannot be negative.",
    };
  }

  const parsed = parseSermonTimestampInput(normalized);
  if (parsed.seconds === null) {
    return {
      seconds: null,
      error: field === "start"
        ? "Clip start time is not valid. Use a format like 42:10."
        : "Clip end time is not valid. Use a format like 42:10.",
    };
  }

  return { seconds: parsed.seconds };
}

export function validateClipStudioTiming(
  input: ClipStudioTimingValidationInput,
): ClipStudioTimingValidationResult {
  const startParsed = parseClipTimestamp(input.startTimestamp, "start");
  const endParsed = parseClipTimestamp(input.endTimestamp, "end");

  const fieldErrors: ClipStudioTimingValidationResult["fieldErrors"] = {};
  const warnings: string[] = [];

  if (startParsed.error) {
    fieldErrors.startTimestamp = startParsed.error;
  }

  if (endParsed.error) {
    fieldErrors.endTimestamp = endParsed.error;
  }

  if (startParsed.seconds !== null && startParsed.seconds < 0) {
    fieldErrors.startTimestamp = "Clip start time must be 0 or greater.";
  }

  if (startParsed.seconds !== null && endParsed.seconds !== null && endParsed.seconds <= startParsed.seconds) {
    fieldErrors.endTimestamp = "Clip end time must be after the start time.";
  }

  if (
    input.knownDurationSeconds !== null &&
    endParsed.seconds !== null &&
    endParsed.seconds > input.knownDurationSeconds
  ) {
    fieldErrors.endTimestamp = "Clip end time is longer than the sermon video duration.";
  }

  const durationSeconds =
    startParsed.seconds !== null && endParsed.seconds !== null
      ? endParsed.seconds - startParsed.seconds
      : null;

  if (durationSeconds !== null && durationSeconds <= 0) {
    fieldErrors.endTimestamp = "Clip end time must be after the start time.";
  }

  if (durationSeconds !== null && durationSeconds > 0 && durationSeconds < HARD_MIN_CLIP_SECONDS) {
    fieldErrors.endTimestamp = `Clip must be at least ${HARD_MIN_CLIP_SECONDS} seconds so it can be rendered and captioned reliably.`;
  }

  if (durationSeconds !== null && durationSeconds > HARD_MAX_CLIP_SECONDS) {
    fieldErrors.endTimestamp = `Clip must be ${HARD_MAX_CLIP_SECONDS} seconds or less. Use a tighter sermon moment for short-form publishing.`;
  }

  if (durationSeconds !== null && durationSeconds < SHORT_CLIP_WARNING_SECONDS) {
    warnings.push("This clip may be too short for meaningful context.");
  }

  if (durationSeconds !== null && durationSeconds > LONG_CLIP_WARNING_SECONDS) {
    warnings.push("Long clips work best for testimony, scripture explanation, prayer, or emotional ministry moments.");
  }

  return {
    isValid: Object.keys(fieldErrors).length === 0,
    startSeconds: startParsed.seconds,
    endSeconds: endParsed.seconds,
    durationSeconds,
    fieldErrors,
    warnings,
  };
}

export function parseHashtagEditorInput(value: string): string[] {
  const tokens = value
    .split(/[\n,\s]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => (token.startsWith("#") ? token : `#${token}`));

  const deduped = new Map<string, string>();
  for (const token of tokens) {
    const normalizedKey = token.toLowerCase();
    if (!deduped.has(normalizedKey)) {
      deduped.set(normalizedKey, token);
    }
  }

  return Array.from(deduped.values());
}

export function hashtagsToEditorInput(hashtags: string[]): string {
  return hashtags.join(" ");
}

export type EditableCaptionCue = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type CaptionCueValidationResult = {
  isValid: boolean;
  cues: EditableCaptionCue[];
  errors: string[];
  warnings: string[];
  coverageRatio: number;
  maxGapSeconds: number;
};

function normalizeCaptionCueText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatSrtTimestamp(seconds: number): string {
  const clampedMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(clampedMilliseconds / 3600000);
  const minutes = Math.floor((clampedMilliseconds % 3600000) / 60000);
  const remainingSeconds = Math.floor((clampedMilliseconds % 60000) / 1000);
  const milliseconds = clampedMilliseconds % 1000;

  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":")
    .concat(",", String(milliseconds).padStart(3, "0"));
}

export function validateEditableCaptionCues(
  cues: EditableCaptionCue[],
  clipDurationSeconds: number | null,
): CaptionCueValidationResult {
  const normalizedCues = cues
    .map((cue, index) => ({
      index: index + 1,
      startSeconds: Number(cue.startSeconds),
      endSeconds: Number(cue.endSeconds),
      text: normalizeCaptionCueText(cue.text),
    }))
    .filter((cue) => cue.text.length > 0);

  const errors: string[] = [];
  const warnings: string[] = [];
  let previousStart = -1;

  for (const cue of normalizedCues) {
    if (!Number.isFinite(cue.startSeconds) || cue.startSeconds < 0) {
      errors.push(`Caption ${cue.index} has an invalid start time.`);
    }

    if (!Number.isFinite(cue.endSeconds) || cue.endSeconds <= cue.startSeconds) {
      errors.push(`Caption ${cue.index} must end after it starts.`);
    }

    if (clipDurationSeconds !== null && cue.endSeconds > clipDurationSeconds + 0.001) {
      errors.push(`Caption ${cue.index} ends after the clip duration.`);
    }

    if (cue.startSeconds + 0.001 < previousStart) {
      errors.push(`Caption ${cue.index} starts before a previous caption.`);
    }

    previousStart = cue.startSeconds;
  }

  if (normalizedCues.length === 0) {
    errors.push("Add at least one on-video caption line before saving.");
  }

  const totalCueDurationSeconds = normalizedCues.reduce(
    (total, cue) => total + Math.max(0, cue.endSeconds - cue.startSeconds),
    0,
  );
  const coverageRatio = clipDurationSeconds && clipDurationSeconds > 0
    ? Number((totalCueDurationSeconds / clipDurationSeconds).toFixed(3))
    : 0;
  const gaps = normalizedCues.slice(1).map((cue, index) => Math.max(0, cue.startSeconds - normalizedCues[index].endSeconds));
  const maxGapSeconds = gaps.length > 0 ? Number(Math.max(...gaps).toFixed(3)) : 0;

  if (clipDurationSeconds !== null && normalizedCues.length > 0 && coverageRatio < 0.12) {
    errors.push("On-video captions cover too little of the clip. Add more caption lines or turn off burned-in captions.");
  } else if (clipDurationSeconds !== null && normalizedCues.length > 0 && coverageRatio < 0.25) {
    warnings.push("On-video captions cover only a small part of the clip.");
  }

  if (maxGapSeconds > 45) {
    errors.push("On-video captions have a large timing gap. Add caption lines across the clip or turn off burned-in captions.");
  } else if (maxGapSeconds > 30) {
    warnings.push("On-video captions have a noticeable timing gap.");
  }

  return {
    isValid: errors.length === 0,
    cues: normalizedCues,
    errors,
    warnings,
    coverageRatio,
    maxGapSeconds,
  };
}

export function buildSrtFromEditableCues(cues: EditableCaptionCue[]): string {
  const normalized = validateEditableCaptionCues(cues, null).cues;
  const blocks = normalized.map((cue) => [
    String(cue.index),
    `${formatSrtTimestamp(cue.startSeconds)} --> ${formatSrtTimestamp(cue.endSeconds)}`,
    cue.text,
  ].join("\n"));

  return `${blocks.join("\n\n")}\n`;
}
