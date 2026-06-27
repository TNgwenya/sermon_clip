export type SermonWindowInferenceSegment = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

export type SermonWindowInferenceOptions = {
  sermonStartSeconds?: number | null;
  sermonEndSeconds?: number | null;
  analyzeFullRecording?: boolean | null;
  knownDurationSeconds?: number | null;
};

export type InferredSermonWindow = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  wordCount: number;
  segmentCount: number;
  reason: string;
};

const LONG_SERVICE_SECONDS = 60 * 60;
const BUCKET_SECONDS = 5 * 60;
const ACTIVE_BUCKET_MIN_WORDS = 220;
const CONTEXT_BUCKET_MIN_WORDS = 120;
const MAX_CONTEXT_BUCKETS_PER_SIDE = 1;
const MIN_INFERRED_WINDOW_SECONDS = 20 * 60;
const MIN_INFERRED_WINDOW_WORDS = 1000;
const LARGE_INTERNAL_GAP_SECONDS = 75;

function countWords(text: string): number {
  return text.trim().split(/\s+/g).filter(Boolean).length;
}

function hasManualWindow(options: SermonWindowInferenceOptions): boolean {
  return typeof options.sermonStartSeconds === "number" || typeof options.sermonEndSeconds === "number";
}

function sortedSegments(segments: SermonWindowInferenceSegment[]): SermonWindowInferenceSegment[] {
  return [...segments]
    .filter((segment) => (
      Number.isFinite(segment.startTimeSeconds) &&
      Number.isFinite(segment.endTimeSeconds) &&
      segment.endTimeSeconds > segment.startTimeSeconds &&
      segment.text.trim().length > 0
    ))
    .sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
}

function shouldInferWindow(
  segments: SermonWindowInferenceSegment[],
  options: SermonWindowInferenceOptions,
): boolean {
  if (options.analyzeFullRecording || hasManualWindow(options) || segments.length === 0) {
    return false;
  }

  const firstStart = segments[0]?.startTimeSeconds ?? 0;
  const lastEnd = segments[segments.length - 1]?.endTimeSeconds ?? firstStart;
  const transcriptDurationSeconds = Math.max(0, lastEnd - firstStart);
  const knownDurationSeconds = typeof options.knownDurationSeconds === "number" && Number.isFinite(options.knownDurationSeconds)
    ? options.knownDurationSeconds
    : null;

  return transcriptDurationSeconds >= LONG_SERVICE_SECONDS || (knownDurationSeconds ?? 0) >= LONG_SERVICE_SECONDS;
}

function buildBuckets(segments: SermonWindowInferenceSegment[]): Array<{ index: number; words: number; segments: number }> {
  const buckets = new Map<number, { index: number; words: number; segments: number }>();

  for (const segment of segments) {
    const index = Math.floor(segment.startTimeSeconds / BUCKET_SECONDS);
    const bucket = buckets.get(index) ?? { index, words: 0, segments: 0 };
    bucket.words += countWords(segment.text);
    bucket.segments += 1;
    buckets.set(index, bucket);
  }

  return [...buckets.values()].sort((left, right) => left.index - right.index);
}

function bucketWordsByIndex(buckets: Array<{ index: number; words: number }>): Map<number, number> {
  return new Map(buckets.map((bucket) => [bucket.index, bucket.words]));
}

function findActiveRuns(buckets: Array<{ index: number; words: number }>): Array<{ startIndex: number; endIndex: number; words: number }> {
  const runs: Array<{ startIndex: number; endIndex: number; words: number }> = [];
  let current: { startIndex: number; endIndex: number; words: number } | null = null;

  for (const bucket of buckets) {
    const active = bucket.words >= ACTIVE_BUCKET_MIN_WORDS;

    if (!active) {
      if (current) {
        runs.push(current);
        current = null;
      }
      continue;
    }

    if (!current || bucket.index > current.endIndex + 1) {
      if (current) {
        runs.push(current);
      }
      current = { startIndex: bucket.index, endIndex: bucket.index, words: bucket.words };
      continue;
    }

    current.endIndex = bucket.index;
    current.words += bucket.words;
  }

  if (current) {
    runs.push(current);
  }

  return runs;
}

function expandRunWithContext(
  run: { startIndex: number; endIndex: number; words: number },
  wordsByIndex: Map<number, number>,
): { startIndex: number; endIndex: number; words: number } {
  let startIndex = run.startIndex;
  let endIndex = run.endIndex;
  let words = run.words;
  let leadingContextBuckets = 0;
  let trailingContextBuckets = 0;

  while (
    leadingContextBuckets < MAX_CONTEXT_BUCKETS_PER_SIDE &&
    (wordsByIndex.get(startIndex - 1) ?? 0) >= CONTEXT_BUCKET_MIN_WORDS
  ) {
    startIndex -= 1;
    leadingContextBuckets += 1;
    words += wordsByIndex.get(startIndex) ?? 0;
  }

  while (
    trailingContextBuckets < MAX_CONTEXT_BUCKETS_PER_SIDE &&
    (wordsByIndex.get(endIndex + 1) ?? 0) >= CONTEXT_BUCKET_MIN_WORDS
  ) {
    endIndex += 1;
    trailingContextBuckets += 1;
    words += wordsByIndex.get(endIndex) ?? 0;
  }

  return { startIndex, endIndex, words };
}

function segmentsInWindow(
  segments: SermonWindowInferenceSegment[],
  startTimeSeconds: number,
  endTimeSeconds: number,
): SermonWindowInferenceSegment[] {
  return segments.filter((segment) => segment.startTimeSeconds < endTimeSeconds && segment.endTimeSeconds > startTimeSeconds);
}

function segmentStats(segments: SermonWindowInferenceSegment[]): { wordCount: number; segmentCount: number } {
  return {
    wordCount: segments.reduce((total, segment) => total + countWords(segment.text), 0),
    segmentCount: segments.length,
  };
}

function refineWindowAroundLargeGaps(
  segments: SermonWindowInferenceSegment[],
  startTimeSeconds: number,
  endTimeSeconds: number,
): { startTimeSeconds: number; endTimeSeconds: number } {
  const selected = segmentsInWindow(segments, startTimeSeconds, endTimeSeconds);
  if (selected.length < 2) {
    return { startTimeSeconds, endTimeSeconds };
  }

  const groups: SermonWindowInferenceSegment[][] = [[]];
  for (const segment of selected) {
    const group = groups[groups.length - 1];
    const previous = group[group.length - 1];
    if (previous && segment.startTimeSeconds - previous.endTimeSeconds >= LARGE_INTERNAL_GAP_SECONDS) {
      groups.push([segment]);
    } else {
      group.push(segment);
    }
  }

  if (groups.length === 1) {
    return { startTimeSeconds, endTimeSeconds };
  }

  const totalWords = segmentStats(selected).wordCount;
  const bestGroup = groups
    .map((group) => {
      const stats = segmentStats(group);
      const first = group[0];
      const last = group[group.length - 1];
      return {
        group,
        wordCount: stats.wordCount,
        durationSeconds: first && last ? last.endTimeSeconds - first.startTimeSeconds : 0,
      };
    })
    .filter((group) => group.durationSeconds >= MIN_INFERRED_WINDOW_SECONDS)
    .sort((left, right) => right.wordCount - left.wordCount)[0];

  if (!bestGroup || bestGroup.wordCount < totalWords * 0.6) {
    return { startTimeSeconds, endTimeSeconds };
  }

  const first = bestGroup.group[0];
  const last = bestGroup.group[bestGroup.group.length - 1];
  return {
    startTimeSeconds: first?.startTimeSeconds ?? startTimeSeconds,
    endTimeSeconds: last?.endTimeSeconds ?? endTimeSeconds,
  };
}

export function inferSermonWindowFromTranscript(
  inputSegments: SermonWindowInferenceSegment[],
  options: SermonWindowInferenceOptions = {},
): InferredSermonWindow | null {
  const segments = sortedSegments(inputSegments);
  if (!shouldInferWindow(segments, options)) {
    return null;
  }

  const buckets = buildBuckets(segments);
  const wordsByIndex = bucketWordsByIndex(buckets);
  const runs = findActiveRuns(buckets)
    .map((run) => expandRunWithContext(run, wordsByIndex))
    .map((run) => {
      const startTimeSeconds = run.startIndex * BUCKET_SECONDS;
      const endTimeSeconds = (run.endIndex + 1) * BUCKET_SECONDS;
      const selected = segmentsInWindow(segments, startTimeSeconds, endTimeSeconds);
      const stats = segmentStats(selected);
      return {
        ...run,
        startTimeSeconds,
        endTimeSeconds,
        durationSeconds: endTimeSeconds - startTimeSeconds,
        wordCount: stats.wordCount,
        segmentCount: stats.segmentCount,
      };
    })
    .filter((run) => (
      run.durationSeconds >= MIN_INFERRED_WINDOW_SECONDS &&
      run.wordCount >= MIN_INFERRED_WINDOW_WORDS
    ))
    .sort((left, right) => {
      const leftScore = left.wordCount + left.durationSeconds / 6;
      const rightScore = right.wordCount + right.durationSeconds / 6;
      return rightScore - leftScore;
    });

  const best = runs[0];
  if (!best) {
    return null;
  }

  const refined = refineWindowAroundLargeGaps(segments, best.startTimeSeconds, best.endTimeSeconds);
  const refinedSegments = segmentsInWindow(segments, refined.startTimeSeconds, refined.endTimeSeconds);
  const refinedStats = segmentStats(refinedSegments);
  const durationSeconds = Math.max(0, refined.endTimeSeconds - refined.startTimeSeconds);

  if (durationSeconds < MIN_INFERRED_WINDOW_SECONDS || refinedStats.wordCount < MIN_INFERRED_WINDOW_WORDS) {
    return null;
  }

  return {
    startTimeSeconds: Number(refined.startTimeSeconds.toFixed(3)),
    endTimeSeconds: Number(refined.endTimeSeconds.toFixed(3)),
    durationSeconds: Number(durationSeconds.toFixed(3)),
    wordCount: refinedStats.wordCount,
    segmentCount: refinedStats.segmentCount,
    reason: `Detected the densest sustained preaching section from a long service recording (${refinedStats.wordCount} words across ${Math.round(durationSeconds / 60)} minutes).`,
  };
}

export function applyInferredSermonWindowToSegments<T extends SermonWindowInferenceSegment>(
  segments: T[],
  window: InferredSermonWindow | null,
): T[] {
  if (!window) {
    return segments;
  }

  return segments.filter((segment) => (
    segment.startTimeSeconds < window.endTimeSeconds &&
    segment.endTimeSeconds > window.startTimeSeconds
  ));
}
