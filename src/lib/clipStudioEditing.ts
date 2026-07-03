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

export type CaptionSourceSegment = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

type TimedCaptionWord = {
  text: string;
  startSeconds: number;
  endSeconds: number;
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

function splitCaptionWords(value: string): string[] {
  const normalized = normalizeCaptionCueText(value);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

export function buildEditableCaptionCuesFromTranscriptSegments({
  startTimeSeconds,
  endTimeSeconds,
  segments,
}: {
  startTimeSeconds: number;
  endTimeSeconds: number;
  segments: CaptionSourceSegment[];
}): EditableCaptionCue[] {
  const clipDurationSeconds = Math.max(0, Number((endTimeSeconds - startTimeSeconds).toFixed(3)));
  const cues: EditableCaptionCue[] = [];

  for (const segment of segments) {
    const overlapStart = Math.max(startTimeSeconds, segment.startTimeSeconds);
    const overlapEnd = Math.min(endTimeSeconds, segment.endTimeSeconds);
    const relativeStart = Math.max(0, Number((overlapStart - startTimeSeconds).toFixed(3)));
    const relativeEnd = Math.min(
      clipDurationSeconds,
      Number((overlapEnd - startTimeSeconds).toFixed(3)),
    );
    const text = normalizeCaptionCueText(segment.text);

    if (!text || relativeEnd <= relativeStart) {
      continue;
    }

    cues.push({
      index: cues.length + 1,
      startSeconds: relativeStart,
      endSeconds: relativeEnd,
      text,
    });
  }

  return cues;
}

const DEFAULT_TIMED_CAPTION_WORDS_PER_CUE = 1;
const DEFAULT_TIMED_CAPTION_MAX_CUE_SECONDS = 1.4;
const PUNCTUATION_PAUSE_WEIGHT = 0.45;

function getCaptionWordWeight(word: string): number {
  const spokenCharacterCount = word.replace(/[^\p{L}\p{N}]+/gu, "").length;
  const punctuationWeight = /[.!?]["')\]]?$/.test(word)
    ? PUNCTUATION_PAUSE_WEIGHT
    : /[,;:]["')\]]?$/.test(word)
      ? PUNCTUATION_PAUSE_WEIGHT / 2
      : 0;

  return Math.max(1, spokenCharacterCount) + punctuationWeight;
}

function estimateTimedCaptionWordsForSegment(
  segment: CaptionSourceSegment,
  clipStartSeconds: number,
  clipEndSeconds: number,
): TimedCaptionWord[] {
  const words = splitCaptionWords(segment.text);
  const segmentStartSeconds = Number(segment.startTimeSeconds);
  const segmentEndSeconds = Number(segment.endTimeSeconds);

  if (
    words.length === 0 ||
    !Number.isFinite(segmentStartSeconds) ||
    !Number.isFinite(segmentEndSeconds) ||
    segmentEndSeconds <= segmentStartSeconds ||
    segmentEndSeconds <= clipStartSeconds ||
    segmentStartSeconds >= clipEndSeconds
  ) {
    return [];
  }

  const weights = words.map(getCaptionWordWeight);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  if (totalWeight <= 0) {
    return [];
  }

  const segmentDurationSeconds = segmentEndSeconds - segmentStartSeconds;
  let cursorSeconds = segmentStartSeconds;
  let cumulativeWeight = 0;

  return words.flatMap((word, index) => {
    const wordStartSeconds = cursorSeconds;
    cumulativeWeight += weights[index];
    const wordEndSeconds = index === words.length - 1
      ? segmentEndSeconds
      : segmentStartSeconds + segmentDurationSeconds * (cumulativeWeight / totalWeight);
    cursorSeconds = wordEndSeconds;

    const clippedStartSeconds = Math.max(clipStartSeconds, wordStartSeconds);
    const clippedEndSeconds = Math.min(clipEndSeconds, wordEndSeconds);

    if (clippedEndSeconds <= clippedStartSeconds) {
      return [];
    }

    return [{
      text: word,
      startSeconds: Number((clippedStartSeconds - clipStartSeconds).toFixed(3)),
      endSeconds: Number((clippedEndSeconds - clipStartSeconds).toFixed(3)),
    }];
  });
}

function shouldStartNextTimedCaptionCue({
  currentWords,
  nextWord,
  maxWordsPerCue,
  maxCueDurationSeconds,
}: {
  currentWords: TimedCaptionWord[];
  nextWord: TimedCaptionWord;
  maxWordsPerCue: number;
  maxCueDurationSeconds: number;
}): boolean {
  if (currentWords.length === 0) {
    return false;
  }

  const previousWord = currentWords[currentWords.length - 1];
  const nextDurationSeconds = nextWord.endSeconds - currentWords[0].startSeconds;
  const previousEndsSentence = /[.!?]["')\]]?$/.test(previousWord.text);

  return (
    currentWords.length >= maxWordsPerCue ||
    nextDurationSeconds > maxCueDurationSeconds ||
    previousEndsSentence
  );
}

export function buildTimedCaptionCuesFromTranscriptSegments({
  startTimeSeconds,
  endTimeSeconds,
  segments,
  maxWordsPerCue = DEFAULT_TIMED_CAPTION_WORDS_PER_CUE,
  maxCueDurationSeconds = DEFAULT_TIMED_CAPTION_MAX_CUE_SECONDS,
}: {
  startTimeSeconds: number;
  endTimeSeconds: number;
  segments: CaptionSourceSegment[];
  maxWordsPerCue?: number;
  maxCueDurationSeconds?: number;
}): EditableCaptionCue[] {
  const clipDurationSeconds = Math.max(0, Number((endTimeSeconds - startTimeSeconds).toFixed(3)));
  const normalizedMaxWordsPerCue = Number.isFinite(maxWordsPerCue)
    ? Math.max(1, Math.min(8, Math.floor(maxWordsPerCue)))
    : DEFAULT_TIMED_CAPTION_WORDS_PER_CUE;
  const normalizedMaxCueDurationSeconds = Number.isFinite(maxCueDurationSeconds) && maxCueDurationSeconds > 0
    ? Math.max(0.25, maxCueDurationSeconds)
    : DEFAULT_TIMED_CAPTION_MAX_CUE_SECONDS;
  const timedWords = segments
    .flatMap((segment) => estimateTimedCaptionWordsForSegment(segment, startTimeSeconds, endTimeSeconds))
    .sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds);
  const cues: EditableCaptionCue[] = [];
  let currentWords: TimedCaptionWord[] = [];

  function flushCurrentCue(): void {
    if (currentWords.length === 0) {
      return;
    }

    const cueStartSeconds = Math.max(0, currentWords[0].startSeconds);
    const cueEndSeconds = Math.min(
      clipDurationSeconds,
      Math.max(cueStartSeconds + 0.05, currentWords[currentWords.length - 1].endSeconds),
    );
    const text = normalizeCaptionCueText(currentWords.map((word) => word.text).join(" "));

    if (text && cueEndSeconds > cueStartSeconds) {
      cues.push({
        index: cues.length + 1,
        startSeconds: Number(cueStartSeconds.toFixed(3)),
        endSeconds: Number(cueEndSeconds.toFixed(3)),
        text,
      });
    }

    currentWords = [];
  }

  for (const word of timedWords) {
    if (
      shouldStartNextTimedCaptionCue({
        currentWords,
        nextWord: word,
        maxWordsPerCue: normalizedMaxWordsPerCue,
        maxCueDurationSeconds: normalizedMaxCueDurationSeconds,
      })
    ) {
      flushCurrentCue();
    }

    currentWords.push(word);
  }

  flushCurrentCue();

  return cues;
}

function normalizeTranscriptGroundingText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateCaptionCuesFromTranscript(
  cues: EditableCaptionCue[],
  transcriptText: string,
): { isValid: boolean; errors: string[] } {
  const normalizedTranscript = normalizeTranscriptGroundingText(transcriptText);

  if (!normalizedTranscript) {
    return {
      isValid: false,
      errors: ["Caption source transcription is missing. Regenerate captions from the transcript before saving burned-in captions."],
    };
  }

  const errors = cues.flatMap((cue) => {
    const normalizedCueText = normalizeTranscriptGroundingText(cue.text);
    if (!normalizedCueText) {
      return [];
    }

    return normalizedTranscript.includes(normalizedCueText)
      ? []
      : [`Caption ${cue.index} must use words from the sermon transcription.`];
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
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
