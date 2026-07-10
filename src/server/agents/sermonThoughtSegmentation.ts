export type TimedSermonMicrosegment = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

export const SERMON_SEGMENT_SIGNALS = [
  "SCRIPTURE_REFERENCE",
  "PRAYER",
  "STORY",
  "AUDIENCE_RESPONSE",
  "STRUCTURAL_TRANSITION",
] as const;

export type SermonSegmentSignal = typeof SERMON_SEGMENT_SIGNALS[number];
export type ThoughtStartStrength = "STRONG" | "LIKELY" | "WEAK";
export type TranscriptGapSeverity = "NONE" | "MODERATE" | "LONG";

export type SermonSegmentClassification = {
  signals: SermonSegmentSignal[];
  tokens: string[];
  wordCount: number;
  hasTerminalPunctuation: boolean;
  beginsWithLowercase: boolean;
  beginsWithContinuationMarker: boolean;
};

export type SermonThoughtStartAnchor = {
  segmentIndex: number;
  timeSeconds: number;
  strength: ThoughtStartStrength;
  reasons: string[];
  signals: SermonSegmentSignal[];
};

export type SermonThoughtSpan = {
  startIndex: number;
  endIndex: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  startStrength: ThoughtStartStrength;
  startReasons: string[];
  signals: SermonSegmentSignal[];
  hasTerminalEnding: boolean;
};

export type TranscriptGapAssessment = {
  afterSegmentIndex: number;
  beforeSegmentIndex: number;
  gapSeconds: number;
  severity: TranscriptGapSeverity;
};

export const MODERATE_TRANSCRIPT_GAP_SECONDS = 2.5;
export const LONG_TRANSCRIPT_GAP_SECONDS = 8;

const MAX_DERIVED_THOUGHT_SECONDS = 30;
const ADJACENT_MICROSEGMENT_GAP_SECONDS = 1.5;
const SCRIPTURE_LEAD_IN_LOOKBACK_SEGMENTS = 3;

const TERMINAL_PUNCTUATION_PATTERN = /[.!?…]["'’”)\]]*\s*$/u;
const LEADING_DECORATION_PATTERN = /^[\s"'‘’“”([\]{–—-]+/u;
const CONTINUATION_MARKER_PATTERN = /^(?:and|but|because|although|unless|until|while|which|who|whom|whose|where|when|or|nor|yet|to|of|from|with|into|through|as well as)\b/iu;
const DANGLING_END_PATTERN = /[,;:–—-]\s*$|\b(?:and|but|because|although|unless|until|while|which|who|where|when|or|nor|yet|to|of|from|with|into|through)\s*$/iu;

const NUMBER_WORD_PATTERN = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)";
const BIBLE_BOOK_PATTERN = "(?:genesis|exodus|leviticus|numbers|deuteronomy|joshua|judges|ruth|samuel|kings|chronicles|ezra|nehemiah|esther|job|psalms?|proverbs|ecclesiastes|isaiah|jeremiah|lamentations|ezekiel|daniel|hosea|joel|amos|obadiah|jonah|micah|nahum|habakkuk|zephaniah|haggai|zechariah|malachi|matthew|mark|luke|john|acts|romans|corinthians|galatians|ephesians|philippians|colossians|thessalonians|timothy|titus|philemon|hebrews|james|peter|jude|revelation)";
const SCRIPTURE_REFERENCE_PATTERN = new RegExp(
  `\\b(?:${BIBLE_BOOK_PATTERN})\\s+(?:chapter\\s+)?${NUMBER_WORD_PATTERN}|\\b(?:chapter|verse)\\s+${NUMBER_WORD_PATTERN}|\\b(?:the bible says|scripture says|turn with me to|it is written|we read in|our reading comes from)|\\b(?:ibhayibheli|ibhayibhile|bibele|baebele)\\b`,
  "iu",
);
const PRAYER_PATTERN = /^(?:(?:let us|let's|shall we)\s+pray\b|heavenly\s+father\b|father\s*[,，]|dear\s+god\b|lord\s*[,，]|masithandaz(?:e|eni)\b|a\s+re\s+rapeleng\b|ha\s+re\s+rapeleng\b|baba\s+wethu\b|nkosi\s+yethu\b|morena\s+oa\s+rona\b)|\b(?:in\s+jesus(?:'|\u2019)?\s+name(?:\s+we\s+pray)?|siyakhuleka|re\s+a\s+rapela)\b/iu;
const STORY_PATTERN = /^(?:i\s+remember\b|when\s+i\s+was\b|years?\s+ago\b|one\s+day\b|there\s+was\s+a\s+time\b|let\s+me\s+tell\s+you\b|ngikhumbula\b|ndikhumbula\b|ke\s+hopola\b|ke\s+gakologelwa\b|ngelinye\s+ilanga\b|ngenye\s+imini\b|ka\s+letsatsi\s+le\s+leng\b)/iu;
const STRUCTURAL_TRANSITION_PATTERN = /^(?:first(?:ly)?|second(?:ly)?|third(?:ly)?|finally|the\s+point\s+is|here\s+is\s+the\s+point|in\s+conclusion|to\s+close|now\s+(?:let\s+us|we)|turn\s+with\s+me)\b/iu;
const AUDIENCE_RESPONSE_PATTERN = /^(?:amen|hallelujah|yes(?:\s+lord)?|praise\s+god|yebo|ewe|applause|laughter)$/iu;

function roundSeconds(value: number): number {
  return Number(value.toFixed(3));
}

function uniqueSignals(signals: SermonSegmentSignal[]): SermonSegmentSignal[] {
  return Array.from(new Set(signals));
}

function trimLeadingDecoration(text: string): string {
  return text.trim().replace(LEADING_DECORATION_PATTERN, "");
}

export function tokenizeSermonText(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .match(/[\p{L}\p{M}\p{N}]+(?:['\u2019][\p{L}\p{M}\p{N}]+)*/gu) ?? [];
}

function beginsWithUnicodeLowercase(text: string): boolean {
  return /^\p{Ll}/u.test(trimLeadingDecoration(text));
}

export function hasTerminalThoughtPunctuation(text: string): boolean {
  return TERMINAL_PUNCTUATION_PATTERN.test(text.trim());
}

export function classifySermonSegment(text: string): SermonSegmentClassification {
  const normalized = trimLeadingDecoration(text).replace(/\s+/g, " ").trim();
  const tokens = tokenizeSermonText(normalized);
  const signals: SermonSegmentSignal[] = [];

  if (SCRIPTURE_REFERENCE_PATTERN.test(normalized)) signals.push("SCRIPTURE_REFERENCE");
  if (PRAYER_PATTERN.test(normalized)) signals.push("PRAYER");
  if (STORY_PATTERN.test(normalized)) signals.push("STORY");
  if (tokens.length <= 4 && AUDIENCE_RESPONSE_PATTERN.test(tokens.join(" "))) signals.push("AUDIENCE_RESPONSE");
  if (STRUCTURAL_TRANSITION_PATTERN.test(normalized)) signals.push("STRUCTURAL_TRANSITION");

  return {
    signals: uniqueSignals(signals),
    tokens,
    wordCount: tokens.length,
    hasTerminalPunctuation: hasTerminalThoughtPunctuation(normalized),
    beginsWithLowercase: beginsWithUnicodeLowercase(normalized),
    beginsWithContinuationMarker: CONTINUATION_MARKER_PATTERN.test(normalized),
  };
}

export function assessTranscriptGap(
  previous: TimedSermonMicrosegment,
  next: TimedSermonMicrosegment,
  afterSegmentIndex = 0,
): TranscriptGapAssessment {
  const gapSeconds = roundSeconds(Math.max(0, next.startTimeSeconds - previous.endTimeSeconds));
  const severity: TranscriptGapSeverity = gapSeconds >= LONG_TRANSCRIPT_GAP_SECONDS
    ? "LONG"
    : gapSeconds >= MODERATE_TRANSCRIPT_GAP_SECONDS
      ? "MODERATE"
      : "NONE";

  return {
    afterSegmentIndex,
    beforeSegmentIndex: afterSegmentIndex + 1,
    gapSeconds,
    severity,
  };
}

export function isLikelyContinuationChunk(
  current: TimedSermonMicrosegment,
  previous?: TimedSermonMicrosegment | null,
): boolean {
  const currentClassification = classifySermonSegment(current.text);
  if (currentClassification.signals.includes("AUDIENCE_RESPONSE")) {
    return false;
  }

  if (currentClassification.beginsWithContinuationMarker) {
    return true;
  }

  if (!previous) {
    return false;
  }

  const gap = assessTranscriptGap(previous, current);
  if (gap.severity !== "NONE" || gap.gapSeconds > ADJACENT_MICROSEGMENT_GAP_SECONDS) {
    return false;
  }

  const previousClassification = classifySermonSegment(previous.text);
  return (
    !previousClassification.hasTerminalPunctuation &&
    (
      currentClassification.beginsWithLowercase ||
      DANGLING_END_PATTERN.test(previous.text.trim())
    )
  );
}

function shouldStartNewThought(input: {
  segments: TimedSermonMicrosegment[];
  currentIndex: number;
  currentSpanStartIndex: number;
}): Omit<SermonThoughtStartAnchor, "segmentIndex" | "timeSeconds" | "signals"> | null {
  const { segments, currentIndex, currentSpanStartIndex } = input;
  const current = segments[currentIndex];
  const previous = segments[currentIndex - 1];
  const currentClassification = classifySermonSegment(current.text);
  const previousClassification = classifySermonSegment(previous.text);
  const gap = assessTranscriptGap(previous, current, currentIndex - 1);
  const continuation = isLikelyContinuationChunk(current, previous);

  if (gap.severity === "LONG") {
    return { strength: "STRONG", reasons: [`Long ${gap.gapSeconds}s transcript gap`] };
  }
  if (gap.severity === "MODERATE" && !continuation) {
    return { strength: "LIKELY", reasons: [`Moderate ${gap.gapSeconds}s transcript gap`] };
  }
  if (currentClassification.signals.includes("AUDIENCE_RESPONSE")) {
    return { strength: "STRONG", reasons: ["Short audience-response marker"] };
  }
  if (previousClassification.signals.includes("AUDIENCE_RESPONSE")) {
    return { strength: "STRONG", reasons: ["Speech resumes after an audience-response marker"] };
  }
  if (
    currentClassification.signals.some((signal) => (
      signal === "SCRIPTURE_REFERENCE" ||
      signal === "PRAYER" ||
      signal === "STORY" ||
      signal === "STRUCTURAL_TRANSITION"
    )) &&
    !continuation
  ) {
    return { strength: "LIKELY", reasons: ["Conservative sermon-structure marker"] };
  }
  if (previousClassification.hasTerminalPunctuation && !continuation) {
    return { strength: "STRONG", reasons: ["Previous segment ends with sentence punctuation"] };
  }

  const spanDuration = current.endTimeSeconds - segments[currentSpanStartIndex].startTimeSeconds;
  if (spanDuration > MAX_DERIVED_THOUGHT_SECONDS && !continuation) {
    return { strength: "WEAK", reasons: ["Maximum derived thought length reached"] };
  }

  return null;
}

function buildThoughtSpan(
  segments: TimedSermonMicrosegment[],
  startIndex: number,
  endIndex: number,
  anchor: SermonThoughtStartAnchor,
): SermonThoughtSpan {
  const selected = segments.slice(startIndex, endIndex + 1);
  return {
    startIndex,
    endIndex,
    startTimeSeconds: selected[0].startTimeSeconds,
    endTimeSeconds: selected[selected.length - 1].endTimeSeconds,
    text: selected.map((segment) => segment.text.trim()).filter(Boolean).join(" "),
    startStrength: anchor.strength,
    startReasons: anchor.reasons,
    signals: uniqueSignals(selected.flatMap((segment) => classifySermonSegment(segment.text).signals)),
    hasTerminalEnding: hasTerminalThoughtPunctuation(selected[selected.length - 1].text),
  };
}

export function deriveLikelyThoughtStartAnchors(
  segments: TimedSermonMicrosegment[],
): SermonThoughtStartAnchor[] {
  if (segments.length === 0) {
    return [];
  }

  const anchors: SermonThoughtStartAnchor[] = [{
    segmentIndex: 0,
    timeSeconds: segments[0].startTimeSeconds,
    strength: "STRONG",
    reasons: ["First transcript segment"],
    signals: classifySermonSegment(segments[0].text).signals,
  }];
  let currentSpanStartIndex = 0;

  for (let index = 1; index < segments.length; index += 1) {
    const boundary = shouldStartNewThought({ segments, currentIndex: index, currentSpanStartIndex });
    if (!boundary) {
      continue;
    }

    anchors.push({
      segmentIndex: index,
      timeSeconds: segments[index].startTimeSeconds,
      strength: boundary.strength,
      reasons: boundary.reasons,
      signals: classifySermonSegment(segments[index].text).signals,
    });
    currentSpanStartIndex = index;
  }

  return anchors;
}

export function deriveSermonThoughtSpans(
  segments: TimedSermonMicrosegment[],
): SermonThoughtSpan[] {
  const anchors = deriveLikelyThoughtStartAnchors(segments);
  return anchors.map((anchor, index) => {
    const nextAnchor = anchors[index + 1];
    return buildThoughtSpan(
      segments,
      anchor.segmentIndex,
      nextAnchor ? nextAnchor.segmentIndex - 1 : segments.length - 1,
      anchor,
    );
  });
}

export function findThoughtSpanForSegment(
  spans: SermonThoughtSpan[],
  segmentIndex: number,
): SermonThoughtSpan | null {
  return spans.find((span) => span.startIndex <= segmentIndex && span.endIndex >= segmentIndex) ?? null;
}

export function transcriptGapsInRange(
  segments: TimedSermonMicrosegment[],
  startIndex: number,
  endIndex: number,
): TranscriptGapAssessment[] {
  const gaps: TranscriptGapAssessment[] = [];
  for (let index = Math.max(0, startIndex); index < Math.min(endIndex, segments.length - 1); index += 1) {
    const assessment = assessTranscriptGap(segments[index], segments[index + 1], index);
    if (assessment.severity !== "NONE") {
      gaps.push(assessment);
    }
  }
  return gaps;
}

export function rangeContainsLongTranscriptGap(
  segments: TimedSermonMicrosegment[],
  startIndex: number,
  endIndex: number,
): boolean {
  return transcriptGapsInRange(segments, startIndex, endIndex).some((gap) => gap.severity === "LONG");
}

export function findSafeScriptureLeadInIndex(
  segments: TimedSermonMicrosegment[],
  startIndex: number,
  maxBacktrackSeconds: number,
): number | null {
  if (startIndex <= 0 || startIndex >= segments.length) {
    return null;
  }

  const candidateStart = segments[startIndex].startTimeSeconds;
  const minimumIndex = Math.max(0, startIndex - SCRIPTURE_LEAD_IN_LOOKBACK_SEGMENTS);
  for (let index = startIndex - 1; index >= minimumIndex; index -= 1) {
    if (candidateStart - segments[index].startTimeSeconds > maxBacktrackSeconds) {
      break;
    }
    if (rangeContainsLongTranscriptGap(segments, index, startIndex)) {
      break;
    }
    const classification = classifySermonSegment(segments[index].text);
    if (classification.signals.includes("SCRIPTURE_REFERENCE")) {
      return index;
    }
    if (
      classification.hasTerminalPunctuation ||
      classification.signals.some((signal) => (
        signal === "PRAYER" ||
        signal === "STORY" ||
        signal === "AUDIENCE_RESPONSE" ||
        signal === "STRUCTURAL_TRANSITION"
      ))
    ) {
      break;
    }
  }

  return null;
}
