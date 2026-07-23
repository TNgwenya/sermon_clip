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

export type CaptionCueWordTiming = {
  text: string;
  startSeconds: number;
  endSeconds: number;
};

export type EditableCaptionCue = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  wordTimings?: CaptionCueWordTiming[];
};

export type CaptionSourceSegment = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

export type CaptionSourceWord = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

type TimedCaptionWord = CaptionCueWordTiming;

export type CaptionCueValidationResult = {
  isValid: boolean;
  cues: EditableCaptionCue[];
  errors: string[];
  warnings: string[];
  coverageRatio: number;
  maxGapSeconds: number;
};

export type CaptionCueGroupingStrategy = "timed" | "semantic";

export type CaptionCueEditResult = {
  cues: EditableCaptionCue[];
  changed: boolean;
  wasClamped: boolean;
  error: string | null;
};

export type CaptionCueTimelineNormalizationResult = {
  isValid: boolean;
  cues: EditableCaptionCue[];
  errors: string[];
  wasClamped: boolean;
};

export type SemanticCaptionLineBreakOptions = {
  maxCharactersPerLine?: number;
  maxLines?: number;
};

export const MIN_EDITABLE_CAPTION_CUE_SECONDS = 0.2;

function normalizeCaptionCueText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parseCaptionSourceWords(value: unknown): CaptionSourceWord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;
    const text = typeof record["text"] === "string" ? normalizeCaptionCueText(record["text"]) : "";
    const startTimeSeconds = record["startTimeSeconds"];
    const endTimeSeconds = record["endTimeSeconds"];
    if (
      !text ||
      typeof startTimeSeconds !== "number" ||
      !Number.isFinite(startTimeSeconds) ||
      typeof endTimeSeconds !== "number" ||
      !Number.isFinite(endTimeSeconds) ||
      endTimeSeconds <= startTimeSeconds
    ) {
      return [];
    }

    return [{ text, startTimeSeconds, endTimeSeconds }];
  });
}

export function normalizeCaptionCueWordTimings(
  value: unknown,
  cueStartSeconds: number,
  cueEndSeconds: number,
): CaptionCueWordTiming[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !Number.isFinite(cueStartSeconds) ||
    !Number.isFinite(cueEndSeconds) ||
    cueEndSeconds <= cueStartSeconds
  ) {
    return undefined;
  }

  const normalized: CaptionCueWordTiming[] = [];
  let previousStartSeconds = Number.NEGATIVE_INFINITY;

  for (const timing of value) {
    if (!timing || typeof timing !== "object" || Array.isArray(timing)) {
      return undefined;
    }

    const record = timing as Record<string, unknown>;
    const text = typeof record["text"] === "string" ? normalizeCaptionCueText(record["text"]) : "";
    const rawStartSeconds = record["startSeconds"];
    const rawEndSeconds = record["endSeconds"];
    if (
      !text ||
      typeof rawStartSeconds !== "number" ||
      !Number.isFinite(rawStartSeconds) ||
      typeof rawEndSeconds !== "number" ||
      !Number.isFinite(rawEndSeconds) ||
      rawEndSeconds <= rawStartSeconds ||
      rawStartSeconds < cueStartSeconds - 0.001 ||
      rawEndSeconds > cueEndSeconds + 0.001 ||
      rawStartSeconds + 0.001 < previousStartSeconds
    ) {
      return undefined;
    }

    const startSeconds = Number(Math.max(cueStartSeconds, rawStartSeconds).toFixed(3));
    const endSeconds = Number(Math.min(cueEndSeconds, rawEndSeconds).toFixed(3));
    if (endSeconds <= startSeconds) {
      return undefined;
    }

    normalized.push({ text, startSeconds, endSeconds });
    previousStartSeconds = rawStartSeconds;
  }

  return normalized;
}

function splitCaptionWords(value: string): string[] {
  const normalized = normalizeCaptionCueText(value);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

function normalizeCaptionWordIdentity(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}:–-]+/gu, "")
    .toLowerCase();
}

type CaptionProtectedWordSpan = {
  startIndex: number;
  endIndex: number;
};

const BIBLE_BOOK_TOKEN_SEQUENCES = [
  ["genesis"],
  ["exodus"],
  ["leviticus"],
  ["numbers"],
  ["deuteronomy"],
  ["joshua"],
  ["judges"],
  ["ruth"],
  ["samuel"],
  ["kings"],
  ["chronicles"],
  ["ezra"],
  ["nehemiah"],
  ["esther"],
  ["job"],
  ["psalm"],
  ["psalms"],
  ["proverbs"],
  ["ecclesiastes"],
  ["song", "of", "solomon"],
  ["song", "of", "songs"],
  ["isaiah"],
  ["jeremiah"],
  ["lamentations"],
  ["ezekiel"],
  ["daniel"],
  ["hosea"],
  ["joel"],
  ["amos"],
  ["obadiah"],
  ["jonah"],
  ["micah"],
  ["nahum"],
  ["habakkuk"],
  ["zephaniah"],
  ["haggai"],
  ["zechariah"],
  ["malachi"],
  ["matthew"],
  ["mark"],
  ["luke"],
  ["john"],
  ["acts"],
  ["romans"],
  ["corinthians"],
  ["galatians"],
  ["ephesians"],
  ["philippians"],
  ["colossians"],
  ["thessalonians"],
  ["timothy"],
  ["titus"],
  ["philemon"],
  ["hebrews"],
  ["james"],
  ["peter"],
  ["jude"],
  ["revelation"],
] as const;

const CAPTION_NAME_TITLES = new Set([
  "apostle",
  "bishop",
  "doctor",
  "dr",
  "elder",
  "evangelist",
  "father",
  "mr",
  "mrs",
  "ms",
  "pastor",
  "prophet",
  "reverend",
  "rev",
]);

const CAPTION_PROTECTED_PHRASES = [
  ["holy", "spirit"],
  ["jesus", "christ"],
  ["new", "testament"],
  ["old", "testament"],
] as const;

const CAPTION_WEAK_LINE_END_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "may",
  "must",
  "of",
  "on",
  "or",
  "should",
  "the",
  "to",
  "was",
  "were",
  "will",
  "with",
  "would",
]);

const CAPTION_WEAK_LINE_START_WORDS = new Set([
  "a",
  "an",
  "of",
  "the",
  "to",
]);

function roundCaptionSeconds(value: number): number {
  return Number(value.toFixed(3));
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isCaptionNameToken(value: string): boolean {
  const normalized = value.replace(/^[("'[\{]+|[.,!?;:)"'\]\}]+$/g, "");
  return /^[\p{Lu}][\p{L}'’-]+$/u.test(normalized);
}

function tokenSequenceMatches(
  normalizedWords: string[],
  startIndex: number,
  sequence: readonly string[],
): boolean {
  return sequence.every((token, offset) => normalizedWords[startIndex + offset] === token);
}

function findProtectedCaptionWordSpans(words: string[]): CaptionProtectedWordSpan[] {
  const normalizedWords = words.map(normalizeCaptionWordIdentity);
  const spans: CaptionProtectedWordSpan[] = [];

  for (let index = 0; index < normalizedWords.length; index += 1) {
    const numericPrefixLength = /^[1-3]$/.test(normalizedWords[index] ?? "") ? 1 : 0;
    const bookStartIndex = index + numericPrefixLength;

    for (const bookTokens of BIBLE_BOOK_TOKEN_SEQUENCES) {
      if (!tokenSequenceMatches(normalizedWords, bookStartIndex, bookTokens)) {
        continue;
      }

      const referenceIndex = bookStartIndex + bookTokens.length;
      if (/^\d{1,3}(?::\d{1,3}(?:[-–]\d{1,3})?)?$/.test(normalizedWords[referenceIndex] ?? "")) {
        spans.push({ startIndex: index, endIndex: referenceIndex });
      }
    }

    for (const phrase of CAPTION_PROTECTED_PHRASES) {
      if (tokenSequenceMatches(normalizedWords, index, phrase)) {
        spans.push({ startIndex: index, endIndex: index + phrase.length - 1 });
      }
    }

    if (CAPTION_NAME_TITLES.has(normalizedWords[index] ?? "")) {
      let nameEndIndex = index;
      while (
        nameEndIndex + 1 < words.length
        && nameEndIndex - index < 3
        && isCaptionNameToken(words[nameEndIndex + 1])
      ) {
        nameEndIndex += 1;
      }
      if (nameEndIndex > index) {
        spans.push({ startIndex: index, endIndex: nameEndIndex });
      }
    }

    if (isCaptionNameToken(words[index]) && isCaptionNameToken(words[index + 1] ?? "")) {
      let nameEndIndex = index + 1;
      while (nameEndIndex + 1 < words.length && nameEndIndex - index < 2 && isCaptionNameToken(words[nameEndIndex + 1])) {
        nameEndIndex += 1;
      }
      spans.push({ startIndex: index, endIndex: nameEndIndex });
    }
  }

  return spans;
}

function isProtectedCaptionBoundary(
  spans: CaptionProtectedWordSpan[],
  boundaryIndex: number,
): boolean {
  return spans.some((span) => boundaryIndex > span.startIndex && boundaryIndex <= span.endIndex);
}

function captionBoundaryPenalty(
  words: string[],
  boundaryIndex: number,
  spans = findProtectedCaptionWordSpans(words),
): number {
  if (boundaryIndex <= 0 || boundaryIndex >= words.length) {
    return 0;
  }

  if (isProtectedCaptionBoundary(spans, boundaryIndex)) {
    return Number.POSITIVE_INFINITY;
  }

  const leftWord = words[boundaryIndex - 1];
  const rightWord = words[boundaryIndex];
  const normalizedLeft = normalizeCaptionWordIdentity(leftWord);
  const normalizedRight = normalizeCaptionWordIdentity(rightWord);
  let penalty = 0;

  if (CAPTION_WEAK_LINE_END_WORDS.has(normalizedLeft)) {
    penalty += 46;
  }
  if (CAPTION_WEAK_LINE_START_WORDS.has(normalizedRight)) {
    penalty += 34;
  }
  if (/[,;:]["')\]]?$/.test(leftWord)) {
    penalty -= 22;
  } else if (/[.!?]["')\]]?$/.test(leftWord)) {
    penalty -= 48;
  }

  return penalty;
}

function captionLineLength(words: string[], startIndex: number, endIndex: number): number {
  return words.slice(startIndex, endIndex).join(" ").length;
}

/**
 * Breaks display text without losing words. It favours balanced lines, avoids
 * one-word orphans, and treats Bible references and common proper names as
 * indivisible spans.
 */
export function breakCaptionTextIntoSemanticLines(
  value: string,
  options: SemanticCaptionLineBreakOptions = {},
): string[] {
  const words = splitCaptionWords(value);
  if (words.length === 0) {
    return [];
  }

  const maxCharactersPerLine = Number.isFinite(options.maxCharactersPerLine)
    ? Math.max(12, Math.min(80, Math.floor(options.maxCharactersPerLine ?? 32)))
    : 32;
  const maxLines = Number.isFinite(options.maxLines)
    ? Math.max(1, Math.min(4, Math.floor(options.maxLines ?? 2)))
    : 2;
  if (words.join(" ").length <= maxCharactersPerLine || maxLines === 1) {
    return [words.join(" ")];
  }

  const protectedSpans = findProtectedCaptionWordSpans(words);
  type LineBreakCandidate = {
    score: number;
    boundaries: number[];
  };
  const candidates: LineBreakCandidate[][] = Array.from(
    { length: maxLines + 1 },
    () => Array.from({ length: words.length + 1 }, () => ({ score: Number.POSITIVE_INFINITY, boundaries: [] })),
  );
  candidates[0][0] = { score: 0, boundaries: [] };

  for (let line = 1; line <= maxLines; line += 1) {
    for (let endIndex = 1; endIndex <= words.length; endIndex += 1) {
      for (let startIndex = line - 1; startIndex < endIndex; startIndex += 1) {
        const previous = candidates[line - 1][startIndex];
        if (!Number.isFinite(previous.score) || isProtectedCaptionBoundary(protectedSpans, startIndex)) {
          continue;
        }

        const wordCount = endIndex - startIndex;
        const lineLength = captionLineLength(words, startIndex, endIndex);
        const overflow = Math.max(0, lineLength - maxCharactersPerLine);
        const unused = Math.max(0, maxCharactersPerLine - lineLength);
        const isLastLine = endIndex === words.length;
        const orphanPenalty = words.length > line && wordCount === 1 ? 180 : 0;
        const boundaryPenalty = isLastLine
          ? 0
          : captionBoundaryPenalty(words, endIndex, protectedSpans);
        if (!Number.isFinite(boundaryPenalty)) {
          continue;
        }

        const score = previous.score
          + overflow * overflow * 12
          + unused * unused * (isLastLine ? 0.12 : 0.3)
          + orphanPenalty
          + boundaryPenalty
          + 8;
        if (score < candidates[line][endIndex].score) {
          candidates[line][endIndex] = {
            score,
            boundaries: [...previous.boundaries, endIndex],
          };
        }
      }
    }
  }

  const best = candidates
    .slice(1)
    .map((lineCandidates) => lineCandidates[words.length])
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => left.score - right.score)[0];
  if (!best) {
    return [words.join(" ")];
  }

  let startIndex = 0;
  return best.boundaries.map((endIndex) => {
    const line = words.slice(startIndex, endIndex).join(" ");
    startIndex = endIndex;
    return line;
  });
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

function buildSemanticTimedCaptionCues({
  timedWords,
  clipDurationSeconds,
  maxWordsPerCue,
  maxCueDurationSeconds,
}: {
  timedWords: TimedCaptionWord[];
  clipDurationSeconds: number;
  maxWordsPerCue: number;
  maxCueDurationSeconds: number;
}): EditableCaptionCue[] {
  const cues: EditableCaptionCue[] = [];
  const visibleWords = timedWords.map((word) => word.text);
  const protectedSpans = findProtectedCaptionWordSpans(visibleWords);
  let startIndex = 0;

  while (startIndex < timedWords.length) {
    let hardEndIndex = startIndex + 1;
    while (hardEndIndex < timedWords.length) {
      const candidateWordCount = hardEndIndex - startIndex + 1;
      const candidateDurationSeconds = timedWords[hardEndIndex].endSeconds - timedWords[startIndex].startSeconds;
      if (
        candidateWordCount > maxWordsPerCue
        || candidateDurationSeconds > maxCueDurationSeconds
      ) {
        break;
      }
      hardEndIndex += 1;
    }

    // The timing limit is a readability target rather than permission to
    // strand a Bible reference, a name, or the final word on its own.
    let expandedEndIndex = hardEndIndex;
    const protectedSpanAtHardBoundary = protectedSpans.find(
      (span) => hardEndIndex > span.startIndex && hardEndIndex <= span.endIndex,
    );
    if (protectedSpanAtHardBoundary) {
      expandedEndIndex = Math.max(expandedEndIndex, protectedSpanAtHardBoundary.endIndex + 1);
    }
    const remainingDurationSeconds = timedWords[timedWords.length - 1].endSeconds
      - timedWords[startIndex].startSeconds;
    if (
      timedWords.length - startIndex <= maxWordsPerCue
      && remainingDurationSeconds <= maxCueDurationSeconds * 2
    ) {
      expandedEndIndex = timedWords.length;
    }
    while (expandedEndIndex < timedWords.length) {
      const boundaryPenalty = captionBoundaryPenalty(
        visibleWords,
        expandedEndIndex,
        protectedSpans,
      );
      const remainingWords = timedWords.length - expandedEndIndex;
      const shouldExpand = !Number.isFinite(boundaryPenalty)
        || boundaryPenalty >= 34
        || remainingWords === 1;
      if (!shouldExpand) {
        break;
      }

      const nextEndIndex = expandedEndIndex + 1;
      const expandedWordCount = nextEndIndex - startIndex;
      const expandedDurationSeconds = timedWords[nextEndIndex - 1].endSeconds
        - timedWords[startIndex].startSeconds;
      if (
        expandedWordCount > maxWordsPerCue + 2
        || expandedDurationSeconds > maxCueDurationSeconds * 1.75
      ) {
        break;
      }
      expandedEndIndex = nextEndIndex;
    }

    const candidateLimit = Math.min(expandedEndIndex, timedWords.length);
    let selectedEndIndex = candidateLimit;
    let selectedScore = Number.POSITIVE_INFINITY;
    for (let candidateEndIndex = startIndex + 1; candidateEndIndex <= candidateLimit; candidateEndIndex += 1) {
      const boundaryPenalty = candidateEndIndex === timedWords.length
        ? 0
        : captionBoundaryPenalty(visibleWords, candidateEndIndex, protectedSpans);
      if (!Number.isFinite(boundaryPenalty)) {
        continue;
      }

      const currentWordCount = candidateEndIndex - startIndex;
      const remainingWordCount = timedWords.length - candidateEndIndex;
      const currentOrphanPenalty = currentWordCount === 1 && remainingWordCount > 0 ? 70 : 0;
      const remainingOrphanPenalty = remainingWordCount === 1 ? 150 : 0;
      const unusedCapacityPenalty = Math.max(0, candidateLimit - candidateEndIndex) * 18;
      const score = boundaryPenalty
        + currentOrphanPenalty
        + remainingOrphanPenalty
        + unusedCapacityPenalty;
      if (score < selectedScore || (score === selectedScore && candidateEndIndex > selectedEndIndex)) {
        selectedScore = score;
        selectedEndIndex = candidateEndIndex;
      }
    }

    if (selectedEndIndex <= startIndex) {
      selectedEndIndex = startIndex + 1;
    }

    const cueWords = timedWords.slice(startIndex, selectedEndIndex);
    const cueStartSeconds = Math.max(0, cueWords[0].startSeconds);
    const cueEndSeconds = Math.min(
      clipDurationSeconds,
      Math.max(cueStartSeconds + 0.05, cueWords[cueWords.length - 1].endSeconds),
    );
    const text = normalizeCaptionCueText(cueWords.map((word) => word.text).join(" "));
    if (text && cueEndSeconds > cueStartSeconds) {
      cues.push({
        index: cues.length + 1,
        startSeconds: roundCaptionSeconds(cueStartSeconds),
        endSeconds: roundCaptionSeconds(cueEndSeconds),
        text,
        wordTimings: cueWords.map((word) => ({
          text: word.text,
          startSeconds: roundCaptionSeconds(Math.max(cueStartSeconds, word.startSeconds)),
          endSeconds: roundCaptionSeconds(Math.min(cueEndSeconds, word.endSeconds)),
        })),
      });
    }

    startIndex = selectedEndIndex;
  }

  return cues;
}

function buildTimedCaptionCuesFromWords({
  timedWords,
  clipDurationSeconds,
  maxWordsPerCue,
  maxCueDurationSeconds,
  groupingStrategy,
}: {
  timedWords: TimedCaptionWord[];
  clipDurationSeconds: number;
  maxWordsPerCue: number;
  maxCueDurationSeconds: number;
  groupingStrategy: CaptionCueGroupingStrategy;
}): EditableCaptionCue[] {
  const normalizedMaxWordsPerCue = Number.isFinite(maxWordsPerCue)
    ? Math.max(1, Math.min(8, Math.floor(maxWordsPerCue)))
    : DEFAULT_TIMED_CAPTION_WORDS_PER_CUE;
  const normalizedMaxCueDurationSeconds = Number.isFinite(maxCueDurationSeconds) && maxCueDurationSeconds > 0
    ? Math.max(0.25, maxCueDurationSeconds)
    : DEFAULT_TIMED_CAPTION_MAX_CUE_SECONDS;
  if (groupingStrategy === "semantic" && normalizedMaxWordsPerCue > 1) {
    return buildSemanticTimedCaptionCues({
      timedWords,
      clipDurationSeconds,
      maxWordsPerCue: normalizedMaxWordsPerCue,
      maxCueDurationSeconds: normalizedMaxCueDurationSeconds,
    });
  }

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
      const wordTimings = currentWords.map((word) => ({
        text: word.text,
        startSeconds: Number(Math.max(cueStartSeconds, word.startSeconds).toFixed(3)),
        endSeconds: Number(Math.min(cueEndSeconds, word.endSeconds).toFixed(3)),
      }));
      cues.push({
        index: cues.length + 1,
        startSeconds: Number(cueStartSeconds.toFixed(3)),
        endSeconds: Number(cueEndSeconds.toFixed(3)),
        text,
        wordTimings,
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

export function buildTimedCaptionCuesFromTranscriptWords({
  startTimeSeconds,
  endTimeSeconds,
  words,
  maxWordsPerCue = DEFAULT_TIMED_CAPTION_WORDS_PER_CUE,
  maxCueDurationSeconds = DEFAULT_TIMED_CAPTION_MAX_CUE_SECONDS,
  groupingStrategy = "timed",
}: {
  startTimeSeconds: number;
  endTimeSeconds: number;
  words: CaptionSourceWord[];
  maxWordsPerCue?: number;
  maxCueDurationSeconds?: number;
  groupingStrategy?: CaptionCueGroupingStrategy;
}): EditableCaptionCue[] {
  const clipDurationSeconds = Math.max(0, Number((endTimeSeconds - startTimeSeconds).toFixed(3)));
  const timedWords = words.flatMap((word) => {
    const text = normalizeCaptionCueText(word.text);
    const absoluteStartSeconds = Number(word.startTimeSeconds);
    const absoluteEndSeconds = Number(word.endTimeSeconds);
    const clippedStartSeconds = Math.max(startTimeSeconds, absoluteStartSeconds);
    const clippedEndSeconds = Math.min(endTimeSeconds, absoluteEndSeconds);

    if (
      !text ||
      !Number.isFinite(absoluteStartSeconds) ||
      !Number.isFinite(absoluteEndSeconds) ||
      clippedEndSeconds <= clippedStartSeconds
    ) {
      return [];
    }

    return [{
      text,
      startSeconds: Number((clippedStartSeconds - startTimeSeconds).toFixed(3)),
      endSeconds: Number((clippedEndSeconds - startTimeSeconds).toFixed(3)),
    }];
  }).sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds);

  return buildTimedCaptionCuesFromWords({
    timedWords,
    clipDurationSeconds,
    maxWordsPerCue,
    maxCueDurationSeconds,
    groupingStrategy,
  });
}

export function buildTimedCaptionCuesFromTranscriptSegments({
  startTimeSeconds,
  endTimeSeconds,
  segments,
  maxWordsPerCue = DEFAULT_TIMED_CAPTION_WORDS_PER_CUE,
  maxCueDurationSeconds = DEFAULT_TIMED_CAPTION_MAX_CUE_SECONDS,
  groupingStrategy = "timed",
}: {
  startTimeSeconds: number;
  endTimeSeconds: number;
  segments: CaptionSourceSegment[];
  maxWordsPerCue?: number;
  maxCueDurationSeconds?: number;
  groupingStrategy?: CaptionCueGroupingStrategy;
}): EditableCaptionCue[] {
  const clipDurationSeconds = Math.max(0, Number((endTimeSeconds - startTimeSeconds).toFixed(3)));
  const timedWords = segments
    .flatMap((segment) => estimateTimedCaptionWordsForSegment(segment, startTimeSeconds, endTimeSeconds))
    .sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds);

  return buildTimedCaptionCuesFromWords({
    timedWords,
    clipDurationSeconds,
    maxWordsPerCue,
    maxCueDurationSeconds,
    groupingStrategy,
  });
}

function reindexEditableCaptionCues(cues: EditableCaptionCue[]): EditableCaptionCue[] {
  return cues.map((cue, index) => ({ ...cue, index: index + 1 }));
}

function cueWordTimingsMatchText(cue: EditableCaptionCue): CaptionCueWordTiming[] | null {
  const words = splitCaptionWords(cue.text);
  const timings = normalizeCaptionCueWordTimings(cue.wordTimings, cue.startSeconds, cue.endSeconds);
  if (
    !timings
    || timings.length !== words.length
    || !timings.every((timing, index) => (
      normalizeCaptionWordIdentity(timing.text) === normalizeCaptionWordIdentity(words[index])
    ))
  ) {
    return null;
  }

  return timings;
}

function captionCuesEqual(left: EditableCaptionCue[], right: EditableCaptionCue[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Produces a chronological, non-overlapping cue timeline inside the clip.
 * Invalid numeric input is reported rather than guessed. Overlapping valid
 * cues share a deterministic boundary while retaining the configured minimum
 * display duration.
 */
export function clampEditableCaptionCueTimeline({
  cues,
  clipDurationSeconds,
  minimumCueDurationSeconds = MIN_EDITABLE_CAPTION_CUE_SECONDS,
}: {
  cues: EditableCaptionCue[];
  clipDurationSeconds: number;
  minimumCueDurationSeconds?: number;
}): CaptionCueTimelineNormalizationResult {
  const errors: string[] = [];
  if (!Number.isFinite(clipDurationSeconds) || clipDurationSeconds <= 0) {
    return {
      isValid: false,
      cues: reindexEditableCaptionCues(cues),
      errors: ["Clip duration must be greater than zero before caption timing can be edited."],
      wasClamped: false,
    };
  }

  const minimumDuration = Number.isFinite(minimumCueDurationSeconds)
    ? Math.max(0.05, Math.min(2, minimumCueDurationSeconds))
    : MIN_EDITABLE_CAPTION_CUE_SECONDS;
  if (clipDurationSeconds + 0.001 < minimumDuration && cues.length > 0) {
    return {
      isValid: false,
      cues: reindexEditableCaptionCues(cues),
      errors: ["The clip is too short for an editable caption cue."],
      wasClamped: false,
    };
  }

  const normalized = cues.map((cue, originalIndex) => {
    const startSeconds = Number(cue.startSeconds);
    const endSeconds = Number(cue.endSeconds);
    const text = normalizeCaptionCueText(cue.text);
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
      errors.push(`Caption ${originalIndex + 1} has invalid timing.`);
      return { ...cue, index: originalIndex + 1, text, originalIndex };
    }
    if (!text) {
      errors.push(`Caption ${originalIndex + 1} has no text.`);
    }

    const clampedStart = roundCaptionSeconds(clampNumber(
      startSeconds,
      0,
      Math.max(0, clipDurationSeconds - minimumDuration),
    ));
    const clampedEnd = roundCaptionSeconds(clampNumber(
      endSeconds,
      clampedStart + minimumDuration,
      clipDurationSeconds,
    ));
    return {
      ...cue,
      index: originalIndex + 1,
      startSeconds: clampedStart,
      endSeconds: clampedEnd,
      text,
      originalIndex,
    };
  });

  if (errors.some((error) => error.includes("invalid timing"))) {
    return {
      isValid: false,
      cues: normalized.map(({ originalIndex, ...cue }) => {
        void originalIndex;
        return cue;
      }),
      errors,
      wasClamped: false,
    };
  }

  normalized.sort((left, right) => (
    left.startSeconds - right.startSeconds
    || left.endSeconds - right.endSeconds
    || left.originalIndex - right.originalIndex
  ));

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (current.startSeconds + 0.001 >= previous.endSeconds) {
      continue;
    }

    const minimumBoundary = previous.startSeconds + minimumDuration;
    const maximumBoundary = current.endSeconds - minimumDuration;
    if (maximumBoundary + 0.001 < minimumBoundary) {
      errors.push(`Captions ${index} and ${index + 1} overlap without enough room for readable timing.`);
      continue;
    }

    const sharedBoundary = roundCaptionSeconds(clampNumber(
      (previous.endSeconds + current.startSeconds) / 2,
      minimumBoundary,
      maximumBoundary,
    ));
    previous.endSeconds = sharedBoundary;
    current.startSeconds = sharedBoundary;
  }

  const resultCues = normalized.map(({ originalIndex, ...cue }, index) => {
    void originalIndex;
    const wordTimings = normalizeCaptionCueWordTimings(cue.wordTimings, cue.startSeconds, cue.endSeconds);
    return {
      ...cue,
      index: index + 1,
      ...(wordTimings ? { wordTimings } : { wordTimings: undefined }),
    };
  });
  const inputComparable = reindexEditableCaptionCues(cues).map((cue) => ({
    ...cue,
    text: normalizeCaptionCueText(cue.text),
  }));

  return {
    isValid: errors.length === 0,
    cues: resultCues,
    errors,
    wasClamped: !captionCuesEqual(inputComparable, resultCues),
  };
}

/**
 * Updates one cue by zero-based chronological array index. Requested timing is
 * clamped between adjacent cues and the clip edges instead of creating an
 * overlap or a zero-duration cue.
 */
export function updateEditableCaptionCueTiming({
  cues,
  cueIndex,
  startSeconds,
  endSeconds,
  clipDurationSeconds,
  minimumCueDurationSeconds = MIN_EDITABLE_CAPTION_CUE_SECONDS,
}: {
  cues: EditableCaptionCue[];
  cueIndex: number;
  startSeconds?: number;
  endSeconds?: number;
  clipDurationSeconds: number;
  minimumCueDurationSeconds?: number;
}): CaptionCueEditResult {
  const normalized = clampEditableCaptionCueTimeline({
    cues,
    clipDurationSeconds,
    minimumCueDurationSeconds,
  });
  if (!normalized.isValid) {
    return {
      cues: normalized.cues,
      changed: false,
      wasClamped: normalized.wasClamped,
      error: normalized.errors[0] ?? "Caption timing could not be normalized.",
    };
  }
  if (!Number.isInteger(cueIndex) || cueIndex < 0 || cueIndex >= normalized.cues.length) {
    return {
      cues: normalized.cues,
      changed: false,
      wasClamped: normalized.wasClamped,
      error: "Choose an existing caption cue to edit.",
    };
  }
  if (
    (startSeconds !== undefined && !Number.isFinite(startSeconds))
    || (endSeconds !== undefined && !Number.isFinite(endSeconds))
  ) {
    return {
      cues: normalized.cues,
      changed: false,
      wasClamped: normalized.wasClamped,
      error: "Caption start and end times must be valid numbers.",
    };
  }

  const minimumDuration = Number.isFinite(minimumCueDurationSeconds)
    ? Math.max(0.05, Math.min(2, minimumCueDurationSeconds))
    : MIN_EDITABLE_CAPTION_CUE_SECONDS;
  const cue = normalized.cues[cueIndex];
  const previousEnd = normalized.cues[cueIndex - 1]?.endSeconds ?? 0;
  const nextStart = normalized.cues[cueIndex + 1]?.startSeconds ?? clipDurationSeconds;
  if (nextStart - previousEnd + 0.001 < minimumDuration) {
    return {
      cues: normalized.cues,
      changed: false,
      wasClamped: normalized.wasClamped,
      error: "There is not enough room between adjacent captions for this timing change.",
    };
  }

  const requestedStart = startSeconds ?? cue.startSeconds;
  const requestedEnd = endSeconds ?? cue.endSeconds;
  const nextCueStart = roundCaptionSeconds(clampNumber(
    requestedStart,
    previousEnd,
    Math.max(previousEnd, nextStart - minimumDuration),
  ));
  const nextCueEnd = roundCaptionSeconds(clampNumber(
    requestedEnd,
    nextCueStart + minimumDuration,
    nextStart,
  ));
  const nextWordTimings = normalizeCaptionCueWordTimings(
    cue.wordTimings,
    nextCueStart,
    nextCueEnd,
  );
  const nextCues = normalized.cues.map((item, index) => index === cueIndex
    ? {
        ...item,
        startSeconds: nextCueStart,
        endSeconds: nextCueEnd,
        ...(nextWordTimings ? { wordTimings: nextWordTimings } : { wordTimings: undefined }),
      }
    : item);
  const requestedWasClamped = Math.abs(nextCueStart - requestedStart) > 0.001
    || Math.abs(nextCueEnd - requestedEnd) > 0.001;

  return {
    cues: nextCues,
    changed: normalized.wasClamped || !captionCuesEqual(normalized.cues, nextCues),
    wasClamped: normalized.wasClamped || requestedWasClamped,
    error: null,
  };
}

function chooseCaptionSplitWordIndex(
  words: string[],
  preferredWordIndex: number,
): number | null {
  const protectedSpans = findProtectedCaptionWordSpans(words);
  let bestIndex: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let boundaryIndex = 1; boundaryIndex < words.length; boundaryIndex += 1) {
    const boundaryPenalty = captionBoundaryPenalty(words, boundaryIndex, protectedSpans);
    if (!Number.isFinite(boundaryPenalty)) {
      continue;
    }

    const leftCount = boundaryIndex;
    const rightCount = words.length - boundaryIndex;
    const orphanPenalty = words.length >= 4 && (leftCount === 1 || rightCount === 1) ? 140 : 0;
    const balancePenalty = Math.abs(
      captionLineLength(words, 0, boundaryIndex)
      - captionLineLength(words, boundaryIndex, words.length),
    ) * 0.35;
    const preferencePenalty = Math.abs(boundaryIndex - preferredWordIndex) * 18;
    const score = boundaryPenalty + orphanPenalty + balancePenalty + preferencePenalty;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = boundaryIndex;
    }
  }

  return bestIndex;
}

/**
 * Splits one cue at a semantic word boundary. `splitWordIndex` is the number of
 * words to keep on the left. Exact word timings are retained when available.
 */
export function splitEditableCaptionCue({
  cues,
  cueIndex,
  splitWordIndex,
  splitSeconds,
  clipDurationSeconds,
  minimumCueDurationSeconds = MIN_EDITABLE_CAPTION_CUE_SECONDS,
}: {
  cues: EditableCaptionCue[];
  cueIndex: number;
  splitWordIndex?: number;
  splitSeconds?: number;
  clipDurationSeconds: number;
  minimumCueDurationSeconds?: number;
}): CaptionCueEditResult {
  const normalized = clampEditableCaptionCueTimeline({
    cues,
    clipDurationSeconds,
    minimumCueDurationSeconds,
  });
  if (!normalized.isValid) {
    return {
      cues: normalized.cues,
      changed: false,
      wasClamped: normalized.wasClamped,
      error: normalized.errors[0] ?? "Caption timing could not be normalized.",
    };
  }
  if (!Number.isInteger(cueIndex) || cueIndex < 0 || cueIndex >= normalized.cues.length) {
    return {
      cues: normalized.cues,
      changed: false,
      wasClamped: normalized.wasClamped,
      error: "Choose an existing caption cue to split.",
    };
  }
  if (splitSeconds !== undefined && !Number.isFinite(splitSeconds)) {
    return {
      cues: normalized.cues,
      changed: false,
      wasClamped: normalized.wasClamped,
      error: "Caption split time must be a valid number.",
    };
  }

  const cue = normalized.cues[cueIndex];
  const words = splitCaptionWords(cue.text);
  if (words.length < 2) {
    return {
      cues: normalized.cues,
      changed: false,
      wasClamped: normalized.wasClamped,
      error: "This caption needs at least two words before it can be split.",
    };
  }

  const exactWordTimings = cueWordTimingsMatchText(cue);
  const hasExplicitWordIndex = Number.isFinite(splitWordIndex);
  let preferredWordIndex = hasExplicitWordIndex
    ? Math.round(splitWordIndex ?? words.length / 2)
    : Math.round(words.length / 2);
  if (!hasExplicitWordIndex && splitSeconds !== undefined && exactWordTimings) {
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = 1; index < exactWordTimings.length; index += 1) {
      const boundarySeconds = (exactWordTimings[index - 1].endSeconds + exactWordTimings[index].startSeconds) / 2;
      const distance = Math.abs(splitSeconds - boundarySeconds);
      if (distance < closestDistance) {
        closestDistance = distance;
        preferredWordIndex = index;
      }
    }
  } else if (!hasExplicitWordIndex && splitSeconds !== undefined) {
    const splitProgress = (splitSeconds - cue.startSeconds) / (cue.endSeconds - cue.startSeconds);
    preferredWordIndex = Math.round(words.length * clampNumber(splitProgress, 0, 1));
  }
  preferredWordIndex = Math.max(1, Math.min(words.length - 1, preferredWordIndex));
  const selectedWordIndex = chooseCaptionSplitWordIndex(words, preferredWordIndex);
  if (selectedWordIndex === null) {
    return {
      cues: normalized.cues,
      changed: false,
      wasClamped: normalized.wasClamped,
      error: "This caption cannot be split without breaking a protected name or Bible reference.",
    };
  }

  const minimumDuration = Number.isFinite(minimumCueDurationSeconds)
    ? Math.max(0.05, Math.min(2, minimumCueDurationSeconds))
    : MIN_EDITABLE_CAPTION_CUE_SECONDS;
  if (cue.endSeconds - cue.startSeconds + 0.001 < minimumDuration * 2) {
    return {
      cues: normalized.cues,
      changed: false,
      wasClamped: normalized.wasClamped,
      error: "This caption is too short to split into two readable cues.",
    };
  }

  const leftWordTimings = exactWordTimings?.slice(0, selectedWordIndex);
  const rightWordTimings = exactWordTimings?.slice(selectedWordIndex);
  const weightedWords = words.map(getCaptionWordWeight);
  const totalWeight = weightedWords.reduce((total, weight) => total + weight, 0);
  const leftWeight = weightedWords.slice(0, selectedWordIndex).reduce((total, weight) => total + weight, 0);
  const naturalSplitSeconds = leftWordTimings && rightWordTimings
    ? (leftWordTimings[leftWordTimings.length - 1].endSeconds + rightWordTimings[0].startSeconds) / 2
    : cue.startSeconds + (cue.endSeconds - cue.startSeconds) * (leftWeight / totalWeight);
  const requestedSplitSeconds = splitSeconds ?? naturalSplitSeconds;
  const selectedSplitSeconds = roundCaptionSeconds(clampNumber(
    exactWordTimings ? naturalSplitSeconds : requestedSplitSeconds,
    cue.startSeconds + minimumDuration,
    cue.endSeconds - minimumDuration,
  ));
  const leftCue: EditableCaptionCue = {
    index: cue.index,
    startSeconds: cue.startSeconds,
    endSeconds: selectedSplitSeconds,
    text: words.slice(0, selectedWordIndex).join(" "),
    ...(leftWordTimings ? { wordTimings: leftWordTimings } : {}),
  };
  const rightCue: EditableCaptionCue = {
    index: cue.index + 1,
    startSeconds: selectedSplitSeconds,
    endSeconds: cue.endSeconds,
    text: words.slice(selectedWordIndex).join(" "),
    ...(rightWordTimings ? { wordTimings: rightWordTimings } : {}),
  };
  const nextCues = reindexEditableCaptionCues([
    ...normalized.cues.slice(0, cueIndex),
    leftCue,
    rightCue,
    ...normalized.cues.slice(cueIndex + 1),
  ]);

  return {
    cues: nextCues,
    changed: true,
    wasClamped: normalized.wasClamped
      || selectedWordIndex !== preferredWordIndex
      || Math.abs(selectedSplitSeconds - requestedSplitSeconds) > 0.001,
    error: null,
  };
}

/**
 * Merges the cue at `cueIndex` with the immediately following cue and retains
 * exact word timings only when both source cues have complete timing data.
 */
export function mergeAdjacentEditableCaptionCues({
  cues,
  cueIndex,
  clipDurationSeconds,
  minimumCueDurationSeconds = MIN_EDITABLE_CAPTION_CUE_SECONDS,
}: {
  cues: EditableCaptionCue[];
  cueIndex: number;
  clipDurationSeconds: number;
  minimumCueDurationSeconds?: number;
}): CaptionCueEditResult {
  const normalized = clampEditableCaptionCueTimeline({
    cues,
    clipDurationSeconds,
    minimumCueDurationSeconds,
  });
  if (!normalized.isValid) {
    return {
      cues: normalized.cues,
      changed: false,
      wasClamped: normalized.wasClamped,
      error: normalized.errors[0] ?? "Caption timing could not be normalized.",
    };
  }
  if (!Number.isInteger(cueIndex) || cueIndex < 0 || cueIndex + 1 >= normalized.cues.length) {
    return {
      cues: normalized.cues,
      changed: false,
      wasClamped: normalized.wasClamped,
      error: "Choose a caption that has another caption immediately after it.",
    };
  }

  const leftCue = normalized.cues[cueIndex];
  const rightCue = normalized.cues[cueIndex + 1];
  const leftWordTimings = cueWordTimingsMatchText(leftCue);
  const rightWordTimings = cueWordTimingsMatchText(rightCue);
  const mergedWordTimings = leftWordTimings && rightWordTimings
    ? [...leftWordTimings, ...rightWordTimings]
    : undefined;
  const mergedCue: EditableCaptionCue = {
    index: leftCue.index,
    startSeconds: leftCue.startSeconds,
    endSeconds: rightCue.endSeconds,
    text: normalizeCaptionCueText(`${leftCue.text} ${rightCue.text}`),
    ...(mergedWordTimings ? { wordTimings: mergedWordTimings } : {}),
  };
  const nextCues = reindexEditableCaptionCues([
    ...normalized.cues.slice(0, cueIndex),
    mergedCue,
    ...normalized.cues.slice(cueIndex + 2),
  ]);

  return {
    cues: nextCues,
    changed: true,
    wasClamped: normalized.wasClamped,
    error: null,
  };
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
    .map((cue, index) => {
      const startSeconds = Number(cue.startSeconds);
      const endSeconds = Number(cue.endSeconds);
      const wordTimings = normalizeCaptionCueWordTimings(cue.wordTimings, startSeconds, endSeconds);

      return {
        index: index + 1,
        startSeconds,
        endSeconds,
        text: normalizeCaptionCueText(cue.text),
        ...(wordTimings ? { wordTimings } : {}),
      };
    })
    .filter((cue) => cue.text.length > 0);

  const errors: string[] = [];
  const warnings: string[] = [];
  let previousStart = -1;
  let previousEnd = -1;

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

    if (previousEnd >= 0 && cue.startSeconds < previousEnd - 0.001) {
      errors.push(`Caption ${cue.index} overlaps the previous caption.`);
    }

    previousStart = cue.startSeconds;
    previousEnd = Math.max(previousEnd, cue.endSeconds);
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

export function resolveClipStudioInitialCaptionCues({
  savedCues,
  transcriptCues,
  clipDurationSeconds,
  savedCuesManuallyEdited: _savedCuesManuallyEdited,
}: {
  savedCues: EditableCaptionCue[];
  transcriptCues: EditableCaptionCue[];
  clipDurationSeconds: number | null;
  savedCuesManuallyEdited: boolean;
}): EditableCaptionCue[] {
  void _savedCuesManuallyEdited;
  const savedValidation = validateEditableCaptionCues(savedCues, clipDurationSeconds);

  // What the creator last saved is the Studio source of truth. Regenerating
  // from transcript during hydration made the preview differ from the final
  // approved composition before the user touched a control.
  if (savedValidation.isValid) {
    return savedValidation.cues;
  }

  if (transcriptCues.length > 0) {
    return transcriptCues.map((cue, index) => ({ ...cue, index: index + 1 }));
  }

  return savedValidation.cues;
}

export function resolveClipStudioCaptionCuesForSave({
  submittedCues,
  transcriptCues,
}: {
  submittedCues: EditableCaptionCue[];
  transcriptCues: EditableCaptionCue[];
}): EditableCaptionCue[] {
  return submittedCues.length > 0 ? submittedCues : transcriptCues;
}

export function mergeCaptionCueTextOverrides({
  baseCues,
  textOverrideCues,
  timingToleranceSeconds = 0.08,
}: {
  baseCues: EditableCaptionCue[];
  textOverrideCues: EditableCaptionCue[];
  timingToleranceSeconds?: number;
}): EditableCaptionCue[] {
  if (baseCues.length === 0) {
    return textOverrideCues.map((cue, index) => ({ ...cue, index: index + 1 }));
  }

  const usedOverrideIndexes = new Set<number>();
  const mergedCues = baseCues.flatMap((baseCue) => {
    let closestOverrideIndex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;

    textOverrideCues.forEach((overrideCue, overrideIndex) => {
      if (usedOverrideIndexes.has(overrideIndex)) {
        return;
      }

      const startDistance = Math.abs(overrideCue.startSeconds - baseCue.startSeconds);
      const endDistance = Math.abs(overrideCue.endSeconds - baseCue.endSeconds);
      if (startDistance > timingToleranceSeconds || endDistance > timingToleranceSeconds) {
        return;
      }

      const totalDistance = startDistance + endDistance;
      if (totalDistance < closestDistance) {
        closestDistance = totalDistance;
        closestOverrideIndex = overrideIndex;
      }
    });

    if (closestOverrideIndex < 0) {
      return [baseCue];
    }

    usedOverrideIndexes.add(closestOverrideIndex);
    const overrideCue = textOverrideCues[closestOverrideIndex];
    const overrideText = normalizeCaptionCueText(overrideCue.text);
    return overrideText ? [{ ...baseCue, text: overrideText }] : [];
  });

  return mergedCues.map((cue, index) => ({ ...cue, index: index + 1 }));
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
