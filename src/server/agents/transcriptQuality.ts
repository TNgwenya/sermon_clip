export type TranscriptQualitySegment = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

export type TranscriptQualityAssessment = {
  ready: boolean;
  reason: string | null;
  warnings: string[];
  wordCount: number;
  meaningfulSegmentCount: number;
  durationSeconds: number;
  totalSegmentDurationSeconds: number;
  coverageRatio: number;
  wordsPerMinute: number;
  maxGapSeconds: number;
  largeGapCount: number;
  repeatedSegmentRatio: number;
  repeatedPhraseRatio: number;
  maxSegmentDurationSeconds: number;
  averageSegmentDurationSeconds: number;
  coarseSegmentRatio: number;
  meaningfulSegmentsPerMinute: number;
  sermonTokenCoverageRatio: number;
  distinctSermonTokenCount: number;
  distinctSermonTokenRatio: number;
};

const MIN_TRANSCRIPT_WORDS_FOR_CLIPPING = 120;
const MIN_TRANSCRIPT_DURATION_SECONDS_FOR_CLIPPING = 90;
const MIN_MEANINGFUL_SEGMENTS_FOR_CLIPPING = 8;
const MIN_TRANSCRIPT_COVERAGE_RATIO = 0.24;
const MAX_TRANSCRIPT_GAP_SECONDS = 150;
const MAX_LARGE_TRANSCRIPT_GAPS = 2;
const MAX_REPEATED_SEGMENT_RATIO = 0.28;
const WARN_REPEATED_PHRASE_RATIO = 0.1;
const MAX_REPEATED_PHRASE_RATIO = 0.13;
const MIN_SERMON_WORDS_PER_MINUTE = 22;
const MAX_SERMON_WORDS_PER_MINUTE = 260;
const LARGE_GAP_SECONDS = 45;
const COARSE_SEGMENT_SECONDS = 45;
const WARN_COARSE_SEGMENT_SECONDS = 30;
const MAX_COARSE_SEGMENT_SECONDS_FOR_CLIPPING = 75;
const MAX_AVERAGE_SEGMENT_SECONDS_FOR_CLIPPING = 38;
const MAX_COARSE_SEGMENT_RATIO = 0.38;
const WARN_MEANINGFUL_SEGMENTS_PER_MINUTE = 1.8;
const MIN_MEANINGFUL_SEGMENTS_PER_MINUTE_FOR_CLIPPING = 1.2;
const MIN_TRANSCRIPT_DISTINCT_SERMON_TOKENS = 32;
const MIN_TRANSCRIPT_SERMON_TOKEN_COVERAGE_RATIO = 0.28;
const MIN_TRANSCRIPT_DISTINCT_SERMON_TOKEN_RATIO = 0.38;
const TRANSCRIPT_SUBSTANCE_TOKEN_STOP_WORDS = new Set([
  "about",
  "again",
  "also",
  "amen",
  "because",
  "been",
  "being",
  "come",
  "from",
  "have",
  "into",
  "just",
  "like",
  "lord",
  "more",
  "okay",
  "over",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "yeah",
  "your",
]);

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/g)
    .filter(Boolean)
    .length;
}

function normalizeSegmentText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{M}\p{N}\s'’]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function sermonSubstanceTokens(text: string): string[] {
  return normalizeSegmentText(text)
    .split(/\s+/g)
    .filter((token) => token.length >= 4 && !TRANSCRIPT_SUBSTANCE_TOKEN_STOP_WORDS.has(token));
}

function distinctSermonTokenStats(text: string, wordCount: number): {
  tokenCoverageRatio: number;
  distinctTokenCount: number;
  distinctTokenRatio: number;
} {
  const tokens = sermonSubstanceTokens(text);
  const distinctTokenCount = new Set(tokens).size;
  const tokenCoverageRatio = wordCount > 0
    ? Number((tokens.length / wordCount).toFixed(3))
    : 0;
  const distinctTokenRatio = tokens.length > 0
    ? Number((distinctTokenCount / tokens.length).toFixed(3))
    : 0;

  return {
    tokenCoverageRatio,
    distinctTokenCount,
    distinctTokenRatio,
  };
}

function repeatedPhraseRatio(text: string): number {
  const tokens = sermonSubstanceTokens(text);
  if (tokens.length < 24) {
    return 0;
  }

  const phraseCounts = new Map<string, number>();
  for (let index = 0; index <= tokens.length - 4; index += 1) {
    const phrase = tokens.slice(index, index + 4).join(" ");
    phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
  }

  const phraseCount = Math.max(0, tokens.length - 3);
  const repeatedPhraseCount = [...phraseCounts.values()].reduce((total, count) => {
    return total + Math.max(0, count - 1);
  }, 0);

  return phraseCount > 0 ? Number((repeatedPhraseCount / phraseCount).toFixed(3)) : 0;
}

function fail(
  reason: string,
  metrics: Omit<TranscriptQualityAssessment, "ready" | "reason">,
): TranscriptQualityAssessment {
  return {
    ...metrics,
    ready: false,
    reason,
  };
}

export function assessTranscriptQualityForClipping(
  segments: TranscriptQualitySegment[],
): TranscriptQualityAssessment {
  const emptyMetrics: Omit<TranscriptQualityAssessment, "ready" | "reason"> = {
    warnings: [],
    wordCount: 0,
    meaningfulSegmentCount: 0,
    durationSeconds: 0,
    totalSegmentDurationSeconds: 0,
    coverageRatio: 0,
    wordsPerMinute: 0,
    maxGapSeconds: 0,
    largeGapCount: 0,
    repeatedSegmentRatio: 0,
    repeatedPhraseRatio: 0,
    maxSegmentDurationSeconds: 0,
    averageSegmentDurationSeconds: 0,
    coarseSegmentRatio: 0,
    meaningfulSegmentsPerMinute: 0,
    sermonTokenCoverageRatio: 0,
    distinctSermonTokenCount: 0,
    distinctSermonTokenRatio: 0,
  };

  if (segments.length === 0) {
    return fail("No transcript segments exist.", emptyMetrics);
  }

  const ordered = [...segments].sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
  const invalidSegment = ordered.find((segment) => (
    !Number.isFinite(segment.startTimeSeconds) ||
    !Number.isFinite(segment.endTimeSeconds) ||
    segment.endTimeSeconds <= segment.startTimeSeconds ||
    segment.text.trim().length === 0
  ));

  const wordCount = ordered.reduce((total, segment) => total + countWords(segment.text), 0);
  const meaningfulSegmentCount = ordered.filter((segment) => countWords(segment.text) >= 3).length;
  const firstStart = ordered[0]?.startTimeSeconds ?? 0;
  const lastEnd = ordered[ordered.length - 1]?.endTimeSeconds ?? firstStart;
  const durationSeconds = Math.max(0, lastEnd - firstStart);
  const totalSegmentDurationSeconds = ordered.reduce(
    (total, segment) => total + Math.max(0, segment.endTimeSeconds - segment.startTimeSeconds),
    0,
  );
  const meaningfulSegmentDurations = ordered
    .filter((segment) => countWords(segment.text) >= 3)
    .map((segment) => Math.max(0, segment.endTimeSeconds - segment.startTimeSeconds));
  const maxSegmentDurationSeconds = meaningfulSegmentDurations.length > 0
    ? Number(Math.max(...meaningfulSegmentDurations).toFixed(1))
    : 0;
  const averageSegmentDurationSeconds = meaningfulSegmentDurations.length > 0
    ? Number((meaningfulSegmentDurations.reduce((total, duration) => total + duration, 0) / meaningfulSegmentDurations.length).toFixed(1))
    : 0;
  const coarseSegmentRatio = meaningfulSegmentDurations.length > 0
    ? Number((meaningfulSegmentDurations.filter((duration) => duration >= COARSE_SEGMENT_SECONDS).length / meaningfulSegmentDurations.length).toFixed(3))
    : 0;
  const coverageRatio = durationSeconds > 0 ? Number((totalSegmentDurationSeconds / durationSeconds).toFixed(3)) : 0;
  const wordsPerMinute = durationSeconds > 0 ? Number(((wordCount / durationSeconds) * 60).toFixed(1)) : 0;
  const meaningfulSegmentsPerMinute = durationSeconds > 0
    ? Number(((meaningfulSegmentCount / durationSeconds) * 60).toFixed(2))
    : 0;
  const gaps = ordered.slice(1).map((segment, index) => {
    return Math.max(0, segment.startTimeSeconds - ordered[index].endTimeSeconds);
  });
  const maxGapSeconds = gaps.length > 0 ? Number(Math.max(...gaps).toFixed(1)) : 0;
  const largeGapCount = gaps.filter((gap) => gap >= LARGE_GAP_SECONDS).length;
  const normalizedSegments = ordered
    .map((segment) => normalizeSegmentText(segment.text))
    .filter((text) => countWords(text) >= 4);
  const seenSegments = new Set<string>();
  let repeatedSegments = 0;
  for (const text of normalizedSegments) {
    if (seenSegments.has(text)) {
      repeatedSegments += 1;
    } else {
      seenSegments.add(text);
    }
  }
  const repeatedSegmentRatio = normalizedSegments.length > 0
    ? Number((repeatedSegments / normalizedSegments.length).toFixed(3))
    : 0;
  const transcriptText = ordered.map((segment) => segment.text).join(" ");
  const distinctStats = distinctSermonTokenStats(transcriptText, wordCount);
  const phraseRepeatRatio = repeatedPhraseRatio(transcriptText);
  const warnings: string[] = [];

  if (coverageRatio < 0.5) {
    warnings.push("LOW_TRANSCRIPT_COVERAGE");
  }
  if (maxGapSeconds >= LARGE_GAP_SECONDS) {
    warnings.push("LARGE_TRANSCRIPT_GAPS");
  }
  if (repeatedSegmentRatio > 0) {
    warnings.push("REPEATED_TRANSCRIPT_SEGMENTS");
  }
  if (phraseRepeatRatio >= WARN_REPEATED_PHRASE_RATIO) {
    warnings.push("REPEATED_TRANSCRIPT_PHRASES");
  }
  if (
    maxSegmentDurationSeconds >= WARN_COARSE_SEGMENT_SECONDS ||
    averageSegmentDurationSeconds >= 24 ||
    coarseSegmentRatio > 0
  ) {
    warnings.push("COARSE_TRANSCRIPT_TIMING");
  }
  if (meaningfulSegmentsPerMinute > 0 && meaningfulSegmentsPerMinute < WARN_MEANINGFUL_SEGMENTS_PER_MINUTE) {
    warnings.push("LOW_TIMESTAMP_DENSITY");
  }
  if (wordsPerMinute > 0 && wordsPerMinute < 45) {
    warnings.push("LOW_WORD_DENSITY");
  }
  if (wordsPerMinute > MAX_SERMON_WORDS_PER_MINUTE) {
    warnings.push("UNUSUALLY_HIGH_WORD_DENSITY");
  }
  if (
    (
      distinctStats.distinctTokenCount < MIN_TRANSCRIPT_DISTINCT_SERMON_TOKENS &&
      distinctStats.tokenCoverageRatio < MIN_TRANSCRIPT_SERMON_TOKEN_COVERAGE_RATIO
    ) ||
    (
      distinctStats.distinctTokenCount < MIN_TRANSCRIPT_DISTINCT_SERMON_TOKENS &&
      distinctStats.distinctTokenRatio < MIN_TRANSCRIPT_DISTINCT_SERMON_TOKEN_RATIO
    )
  ) {
    warnings.push("LOW_TRANSCRIPT_DISTINCT_SERMON_SUBSTANCE");
  }

  const metrics: Omit<TranscriptQualityAssessment, "ready" | "reason"> = {
    warnings,
    wordCount,
    meaningfulSegmentCount,
    durationSeconds,
    totalSegmentDurationSeconds,
    coverageRatio,
    wordsPerMinute,
    maxGapSeconds,
    largeGapCount,
    repeatedSegmentRatio,
    repeatedPhraseRatio: phraseRepeatRatio,
    maxSegmentDurationSeconds,
    averageSegmentDurationSeconds,
    coarseSegmentRatio,
    meaningfulSegmentsPerMinute,
    sermonTokenCoverageRatio: distinctStats.tokenCoverageRatio,
    distinctSermonTokenCount: distinctStats.distinctTokenCount,
    distinctSermonTokenRatio: distinctStats.distinctTokenRatio,
  };

  if (invalidSegment) {
    return fail("Transcript has empty or invalid timestamped segments.", metrics);
  }

  if (wordCount < MIN_TRANSCRIPT_WORDS_FOR_CLIPPING) {
    return fail(`Transcript is too short for reliable clipping (${wordCount} words). Re-run transcription or check the sermon audio.`, metrics);
  }

  if (meaningfulSegmentCount < MIN_MEANINGFUL_SEGMENTS_FOR_CLIPPING) {
    return fail(`Transcript has too few meaningful timestamped segments (${meaningfulSegmentCount}). Re-run transcription before clipping.`, metrics);
  }

  if (durationSeconds < MIN_TRANSCRIPT_DURATION_SECONDS_FOR_CLIPPING) {
    return fail(`Transcript covers only ${Math.round(durationSeconds)} seconds, which is too short for reliable sermon clip selection.`, metrics);
  }

  if (coverageRatio < MIN_TRANSCRIPT_COVERAGE_RATIO) {
    return fail(`Transcript coverage is too sparse for reliable clipping (${Math.round(coverageRatio * 100)}% coverage). Re-run transcription, check the saved language settings, or improve the source audio.`, metrics);
  }

  if (maxGapSeconds >= MAX_TRANSCRIPT_GAP_SECONDS || largeGapCount > MAX_LARGE_TRANSCRIPT_GAPS) {
    return fail(`Transcript has large unexplained gaps (${largeGapCount} gap(s), max ${Math.round(maxGapSeconds)} seconds). Re-run transcription, check the saved language settings, or improve the source audio.`, metrics);
  }

  if (repeatedSegmentRatio > MAX_REPEATED_SEGMENT_RATIO) {
    return fail(`Transcript appears repetitive (${Math.round(repeatedSegmentRatio * 100)}% repeated segments). Re-run transcription before clipping.`, metrics);
  }

  if (
    (
      distinctStats.distinctTokenCount < MIN_TRANSCRIPT_DISTINCT_SERMON_TOKENS &&
      distinctStats.tokenCoverageRatio < MIN_TRANSCRIPT_SERMON_TOKEN_COVERAGE_RATIO
    ) ||
    (
      distinctStats.distinctTokenCount < MIN_TRANSCRIPT_DISTINCT_SERMON_TOKENS &&
      distinctStats.distinctTokenRatio < MIN_TRANSCRIPT_DISTINCT_SERMON_TOKEN_RATIO
    )
  ) {
    return fail(
      `Transcript has too little distinct sermon substance for reliable clipping (${distinctStats.distinctTokenCount} distinct sermon tokens, ${Math.round(distinctStats.distinctTokenRatio * 100)}% distinct substance). Re-run transcription or check the audio source.`,
      metrics,
    );
  }

  if (phraseRepeatRatio > MAX_REPEATED_PHRASE_RATIO) {
    return fail(`Transcript appears to repeat the same sermon phrases too often (${Math.round(phraseRepeatRatio * 100)}% repeated phrases). Re-run transcription before clipping.`, metrics);
  }

  if (
    maxSegmentDurationSeconds >= MAX_COARSE_SEGMENT_SECONDS_FOR_CLIPPING ||
    averageSegmentDurationSeconds >= MAX_AVERAGE_SEGMENT_SECONDS_FOR_CLIPPING ||
    coarseSegmentRatio > MAX_COARSE_SEGMENT_RATIO
  ) {
    return fail(
      `Transcript timestamps are too coarse for reliable clipping (max segment ${Math.round(maxSegmentDurationSeconds)} seconds, average ${Math.round(averageSegmentDurationSeconds)} seconds). Re-run transcription before clipping.`,
      metrics,
    );
  }

  if (meaningfulSegmentsPerMinute < MIN_MEANINGFUL_SEGMENTS_PER_MINUTE_FOR_CLIPPING) {
    return fail(
      `Transcript has too few timestamp anchors for reliable clipping (${meaningfulSegmentsPerMinute} meaningful segments per minute). Re-run transcription before clipping.`,
      metrics,
    );
  }

  if (durationSeconds >= 10 * 60 && wordsPerMinute < MIN_SERMON_WORDS_PER_MINUTE) {
    return fail(`Transcript word density is too low for a sermon (${wordsPerMinute} words per minute). Re-run transcription or check the audio source.`, metrics);
  }

  if (wordsPerMinute > MAX_SERMON_WORDS_PER_MINUTE) {
    return fail(`Transcript word density is unusually high (${wordsPerMinute} words per minute). Re-run transcription before clipping.`, metrics);
  }

  return {
    ...metrics,
    ready: true,
    reason: null,
  };
}
