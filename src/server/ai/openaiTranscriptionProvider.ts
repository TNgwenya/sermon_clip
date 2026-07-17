import { createReadStream } from "node:fs";

import { getOpenAiClient } from "@/server/ai/openaiClient";
import { recordAiInvocation } from "@/server/ai/aiInvocationLogger";

export type NormalizedTranscriptSegment = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  speakerLabel?: string;
  /**
   * Conservative, provider-derived transcription evidence. This is a
   * heuristic built from Whisper diagnostics, not a calibrated probability
   * that every word is correct. It is omitted when the provider does not
   * return enough evidence.
   */
  confidence?: number;
};

export type NormalizedTranscript = {
  fullText: string;
  language?: string;
  provider: "openai";
  model: string;
  segments: NormalizedTranscriptSegment[];
  words?: NormalizedWordTimestamp[];
  raw: unknown;
};

export type OpenAITranscriptionOptions = {
  sermonId?: string;
  language?: string;
  prompt?: string;
  model?: string;
  accuracyModel?: string;
  diarizationModel?: string;
  hybrid?: boolean;
  diarization?: boolean;
  audioDurationSeconds?: number;
  onRetry?: (info: OpenAITranscriptionRetryInfo) => void | Promise<void>;
};

export type OpenAITranscriptionRetryInfo = {
  attempt: number;
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
  message: string;
  status?: number;
};

type OpenAISegmentLike = {
  start?: number | string;
  end?: number | string;
  text?: string;
  avg_logprob?: number | string;
  no_speech_prob?: number | string;
  speaker?: string;
};

type OpenAIWordLike = {
  start?: number | string;
  end?: number | string;
  word?: string;
  text?: string;
};

export type NormalizedWordTimestamp = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

type HighAccuracyTranscript = {
  fullText: string;
  model: string;
  confidence?: number;
  raw: unknown;
};

type TranscriptAlignment = {
  segments: NormalizedTranscriptSegment[];
  matchedAnchorRatio: number;
  wordCountRatio: number;
  accepted: boolean;
};

const MAX_WORD_TIMED_SEGMENT_SECONDS = 4.5;
const MAX_WORD_TIMED_SEGMENT_WORDS = 10;
const WORD_GAP_SPLIT_SECONDS = 1.2;
const MIN_WORDS_FOR_WORD_TIMED_SEGMENTS = 20;
const MIN_WORD_TIMED_SEGMENT_RETENTION_RATIO = 0.72;
const MAX_WORD_TIMED_RETENTION_LOSS_VS_SEGMENTS = 0.08;
const MIN_PROVIDER_CONFIDENCE_OVERLAP_RATIO = 0.8;
const DEFAULT_TRANSCRIPTION_MAX_ATTEMPTS = 4;
const MAX_TRANSCRIPTION_MAX_ATTEMPTS = 8;
const DEFAULT_TRANSCRIPTION_RETRY_BASE_DELAY_MS = 2_000;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);
const DEFAULT_ACCURACY_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
const DEFAULT_DIARIZATION_TRANSCRIPTION_MODEL = "gpt-4o-transcribe-diarize";
const MIN_ACCURACY_ALIGNMENT_ANCHOR_RATIO = 0.22;
const MIN_ACCURACY_WORD_COUNT_RATIO = 0.68;
const MAX_ACCURACY_WORD_COUNT_RATIO = 1.42;
const ALIGNMENT_LOOKAHEAD_WORDS = 48;
const MIN_WORDS_FOR_ACCURACY_ALIGNMENT = 8;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolvePositiveIntegerEnv(name: string, fallback: number): number {
  const configured = process.env[name]?.trim();
  if (!configured) {
    return fallback;
  }

  const value = Number(configured);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function resolveOpenAITranscriptionMaxAttempts(): number {
  return Math.min(
    resolvePositiveIntegerEnv("OPENAI_TRANSCRIPTION_MAX_ATTEMPTS", DEFAULT_TRANSCRIPTION_MAX_ATTEMPTS),
    MAX_TRANSCRIPTION_MAX_ATTEMPTS,
  );
}

function resolveOpenAITranscriptionRetryBaseDelayMs(): number {
  return resolvePositiveIntegerEnv("OPENAI_TRANSCRIPTION_RETRY_BASE_DELAY_MS", DEFAULT_TRANSCRIPTION_RETRY_BASE_DELAY_MS);
}

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const status = "status" in error ? (error as { status?: unknown }).status : undefined;
  if (typeof status === "number" && Number.isFinite(status)) {
    return status;
  }

  const response = "response" in error ? (error as { response?: { status?: unknown } }).response : undefined;
  if (response && typeof response.status === "number" && Number.isFinite(response.status)) {
    return response.status;
  }

  return undefined;
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRetryableOpenAITranscriptionError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status && RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }

  const code = getErrorCode(error)?.toLowerCase() ?? "";
  if (
    [
      "econnreset",
      "econnrefused",
      "etimedout",
      "eai_again",
      "enetunreach",
      "und_err_socket",
      "und_err_headers_timeout",
      "und_err_body_timeout",
    ].includes(code)
  ) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("500 status code") ||
    message.includes("502 status code") ||
    message.includes("503 status code") ||
    message.includes("504 status code") ||
    message.includes("no body") ||
    message.includes("rate limit") ||
    message.includes("timeout") ||
    message.includes("temporarily unavailable") ||
    message.includes("socket") ||
    message.includes("network")
  );
}

async function runTranscriptionRequestWithRetry<T>(
  operation: () => Promise<T>,
  options?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    onRetry?: OpenAITranscriptionOptions["onRetry"];
    sleepFn?: (delayMs: number) => Promise<void>;
  },
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options?.maxAttempts ?? resolveOpenAITranscriptionMaxAttempts()));
  const baseDelayMs = Math.max(0, Math.floor(options?.baseDelayMs ?? resolveOpenAITranscriptionRetryBaseDelayMs()));
  const wait = options?.sleepFn ?? sleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableOpenAITranscriptionError(error)) {
        throw error;
      }

      const delayMs = baseDelayMs * (2 ** (attempt - 1));
      await options?.onRetry?.({
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts,
        delayMs,
        message: getErrorMessage(error),
        status: getErrorStatus(error),
      });

      if (delayMs > 0) {
        await wait(delayMs);
      }
    }
  }

  throw new Error("Transcription retry loop exited unexpectedly.");
}

function normalizeNumber(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/**
 * Derive conservative transcription evidence from Whisper's verbose segment
 * diagnostics. `exp(avg_logprob)` is the geometric mean token likelihood and
 * `1 - no_speech_prob` discounts regions Whisper considered non-speech. Their
 * product is useful for relative review guidance, but is not a calibrated word
 * accuracy probability. Without average log probability, no confidence is
 * emitted because speech likelihood alone says nothing about word correctness.
 */
function deriveWhisperSegmentConfidence(segment: OpenAISegmentLike): number | undefined {
  const averageLogProbability = normalizeNumber(segment.avg_logprob);
  if (averageLogProbability === null) {
    return undefined;
  }

  const tokenLikelihood = Math.exp(Math.max(-20, Math.min(0, averageLogProbability)));
  const noSpeechProbability = normalizeNumber(segment.no_speech_prob);
  const speechLikelihood = noSpeechProbability === null
    ? 1
    : 1 - Math.max(0, Math.min(1, noSpeechProbability));

  return Number(Math.max(0, Math.min(1, tokenLikelihood * speechLikelihood)).toFixed(4));
}

function normalizeSegments(rawSegments: unknown): NormalizedTranscriptSegment[] {
  if (!Array.isArray(rawSegments)) {
    return [];
  }

  return rawSegments
    .map((segment) => {
      const candidate = segment as OpenAISegmentLike;
      const startTimeSeconds = normalizeNumber(candidate.start);
      const endTimeSeconds = normalizeNumber(candidate.end);
      const text = candidate.text?.trim() ?? "";

      if (
        startTimeSeconds === null ||
        endTimeSeconds === null ||
        !text ||
        endTimeSeconds <= startTimeSeconds
      ) {
        return null;
      }

      const confidence = deriveWhisperSegmentConfidence(candidate);
      const speakerLabel = candidate.speaker?.trim();

      return {
        startTimeSeconds,
        endTimeSeconds,
        text,
        ...(speakerLabel ? { speakerLabel } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
      };
    })
    .filter((segment): segment is NormalizedTranscriptSegment => segment !== null);
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/g)
    .filter(Boolean)
    .length;
}

type OptionalPassMode = "always" | "auto" | "never";

function resolveOptionalPassMode(name: string, fallback: OptionalPassMode): OptionalPassMode {
  const configured = process.env[name]?.trim().toLowerCase();
  if (!configured) return fallback;
  if (["1", "true", "yes", "on", "always"].includes(configured)) return "always";
  if (["0", "false", "no", "off", "never"].includes(configured)) return "never";
  if (configured === "auto") return "auto";
  return fallback;
}

function shouldRunAccuracyPass(transcript: NormalizedTranscript): boolean {
  const confidences = transcript.segments
    .map((segment) => segment.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const averageConfidence = confidences.length > 0
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : null;
  const lowConfidenceRatio = confidences.length > 0
    ? confidences.filter((value) => value < 0.55).length / confidences.length
    : 0;
  const language = transcript.language?.trim().toLowerCase();
  const isEnglish = language === "en" || language === "english";

  return (
    transcript.words === undefined ||
    transcript.words.length < MIN_WORDS_FOR_WORD_TIMED_SEGMENTS ||
    confidences.length < Math.max(3, Math.floor(transcript.segments.length * 0.5)) ||
    (averageConfidence !== null && averageConfidence < 0.68) ||
    lowConfidenceRatio >= 0.15 ||
    Boolean(language && !isEnglish)
  );
}

function normalizeAlignmentToken(text: string): string {
  return text
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}'’]+/gu, "")
    .replace(/[’']/g, "");
}

function transcriptTokens(text: string): string[] {
  return text.trim().match(/\S+/gu) ?? [];
}

function deriveHighAccuracyConfidence(rawLogprobs: unknown): number | undefined {
  if (!Array.isArray(rawLogprobs)) return undefined;
  const values = rawLogprobs
    .map((entry) => entry && typeof entry === "object" ? normalizeNumber((entry as { logprob?: number | string }).logprob) : null)
    .filter((value): value is number => value !== null);
  if (values.length === 0) return undefined;
  const averageLogProbability = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(Math.exp(Math.max(-20, Math.min(0, averageLogProbability))).toFixed(4));
}

function findGreedyAlignmentAnchors(
  accurateTokens: string[],
  timedWords: NormalizedWordTimestamp[],
): Array<{ accurateIndex: number; timedIndex: number }> {
  const normalizedTimed = timedWords.map((word) => normalizeAlignmentToken(word.text));
  const anchors: Array<{ accurateIndex: number; timedIndex: number }> = [];
  let nextTimedIndex = 0;

  for (let accurateIndex = 0; accurateIndex < accurateTokens.length && nextTimedIndex < timedWords.length; accurateIndex += 1) {
    const token = normalizeAlignmentToken(accurateTokens[accurateIndex]);
    if (!token) continue;

    const searchEnd = Math.min(timedWords.length, nextTimedIndex + ALIGNMENT_LOOKAHEAD_WORDS);
    let matchedIndex = -1;
    for (let timedIndex = nextTimedIndex; timedIndex < searchEnd; timedIndex += 1) {
      if (normalizedTimed[timedIndex] === token) {
        matchedIndex = timedIndex;
        break;
      }
    }

    if (matchedIndex >= 0) {
      anchors.push({ accurateIndex, timedIndex: matchedIndex });
      nextTimedIndex = matchedIndex + 1;
    }
  }

  return anchors;
}

function interpolateAccurateWordTimeline(
  accurateTokens: string[],
  timedWords: NormalizedWordTimestamp[],
  anchors: Array<{ accurateIndex: number; timedIndex: number }>,
): NormalizedWordTimestamp[] {
  if (accurateTokens.length === 0 || timedWords.length === 0) return [];

  const anchorByAccurateIndex = new Map(anchors.map((anchor) => [anchor.accurateIndex, anchor.timedIndex]));
  const sentinels = [
    { accurateIndex: -1, timedIndex: -1 },
    ...anchors,
    { accurateIndex: accurateTokens.length, timedIndex: timedWords.length },
  ];
  const result: NormalizedWordTimestamp[] = [];
  let intervalIndex = 0;

  for (let accurateIndex = 0; accurateIndex < accurateTokens.length; accurateIndex += 1) {
    while (intervalIndex < sentinels.length - 2 && accurateIndex > sentinels[intervalIndex + 1].accurateIndex) {
      intervalIndex += 1;
    }

    const exactTimedIndex = anchorByAccurateIndex.get(accurateIndex);
    if (typeof exactTimedIndex === "number") {
      result.push({ ...timedWords[exactTimedIndex], text: accurateTokens[accurateIndex] });
      continue;
    }

    const previous = sentinels[intervalIndex];
    const next = sentinels[intervalIndex + 1];
    const accurateSpan = Math.max(1, next.accurateIndex - previous.accurateIndex);
    const progress = (accurateIndex - previous.accurateIndex) / accurateSpan;
    const projectedTimedIndex = Math.max(
      0,
      Math.min(timedWords.length - 1, Math.round(previous.timedIndex + progress * (next.timedIndex - previous.timedIndex))),
    );
    const projected = timedWords[projectedTimedIndex];
    const duration = Math.max(0.04, projected.endTimeSeconds - projected.startTimeSeconds);
    result.push({
      startTimeSeconds: projected.startTimeSeconds,
      endTimeSeconds: projected.startTimeSeconds + duration,
      text: accurateTokens[accurateIndex],
    });
  }

  for (let index = 1; index < result.length; index += 1) {
    if (result[index].startTimeSeconds < result[index - 1].startTimeSeconds) {
      result[index].startTimeSeconds = result[index - 1].startTimeSeconds;
    }
    if (result[index].endTimeSeconds <= result[index].startTimeSeconds) {
      result[index].endTimeSeconds = result[index].startTimeSeconds + 0.04;
    }
  }

  return result;
}

function alignHighAccuracyTranscript(input: {
  accurateText: string;
  timedWords: NormalizedWordTimestamp[];
  timingSegments: NormalizedTranscriptSegment[];
  accuracyConfidence?: number;
}): TranscriptAlignment {
  const accurateTokens = transcriptTokens(input.accurateText);
  const timingWordCount = input.timedWords.length;
  const wordCountRatio = timingWordCount > 0 ? accurateTokens.length / timingWordCount : 0;
  const anchors = findGreedyAlignmentAnchors(accurateTokens, input.timedWords);
  const matchedAnchorRatio = accurateTokens.length > 0 ? anchors.length / accurateTokens.length : 0;
  const accepted = (
    accurateTokens.length >= MIN_WORDS_FOR_ACCURACY_ALIGNMENT &&
    wordCountRatio >= MIN_ACCURACY_WORD_COUNT_RATIO &&
    wordCountRatio <= MAX_ACCURACY_WORD_COUNT_RATIO &&
    matchedAnchorRatio >= MIN_ACCURACY_ALIGNMENT_ANCHOR_RATIO
  );

  if (!accepted) {
    return {
      segments: input.timingSegments,
      matchedAnchorRatio: Number(matchedAnchorRatio.toFixed(4)),
      wordCountRatio: Number(wordCountRatio.toFixed(4)),
      accepted: false,
    };
  }

  const accurateWords = interpolateAccurateWordTimeline(accurateTokens, input.timedWords, anchors);
  let segments = wordsToTranscriptSegments(accurateWords);
  segments = mapProviderConfidenceByOverlap(segments, input.timingSegments);
  if (typeof input.accuracyConfidence === "number") {
    const accuracyConfidence = input.accuracyConfidence;
    segments = segments.map((segment) => ({
      ...segment,
      confidence: typeof segment.confidence === "number"
        ? Number(Math.min(segment.confidence, accuracyConfidence).toFixed(4))
        : accuracyConfidence,
    }));
  }

  return {
    segments,
    matchedAnchorRatio: Number(matchedAnchorRatio.toFixed(4)),
    wordCountRatio: Number(wordCountRatio.toFixed(4)),
    accepted: true,
  };
}

function mapSpeakerLabelsByOverlap(
  segments: NormalizedTranscriptSegment[],
  speakerSegments: NormalizedTranscriptSegment[],
): NormalizedTranscriptSegment[] {
  if (speakerSegments.length === 0) return segments;
  return segments.map((segment) => {
    const overlapBySpeaker = new Map<string, number>();
    for (const speakerSegment of speakerSegments) {
      if (!speakerSegment.speakerLabel) continue;
      const overlap = Math.max(
        0,
        Math.min(segment.endTimeSeconds, speakerSegment.endTimeSeconds) -
          Math.max(segment.startTimeSeconds, speakerSegment.startTimeSeconds),
      );
      if (overlap > 0) {
        overlapBySpeaker.set(speakerSegment.speakerLabel, (overlapBySpeaker.get(speakerSegment.speakerLabel) ?? 0) + overlap);
      }
    }
    const best = [...overlapBySpeaker.entries()].sort((left, right) => right[1] - left[1])[0];
    return best ? { ...segment, speakerLabel: best[0] } : segment;
  });
}

function normalizePrimarySpeakerLabel(segments: NormalizedTranscriptSegment[]): NormalizedTranscriptSegment[] {
  const durationBySpeaker = new Map<string, number>();
  for (const segment of segments) {
    if (!segment.speakerLabel) continue;
    const duration = Math.max(0, segment.endTimeSeconds - segment.startTimeSeconds);
    durationBySpeaker.set(segment.speakerLabel, (durationBySpeaker.get(segment.speakerLabel) ?? 0) + duration);
  }
  const primarySpeaker = [...durationBySpeaker.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  if (!primarySpeaker) return segments;
  return segments.map((segment) => segment.speakerLabel
    ? { ...segment, speakerLabel: segment.speakerLabel === primarySpeaker ? "PRIMARY" : `SECONDARY_${segment.speakerLabel}` }
    : segment);
}

function normalizeWords(rawWords: unknown): NormalizedWordTimestamp[] {
  if (!Array.isArray(rawWords)) {
    return [];
  }

  return rawWords
    .map((word) => {
      const candidate = word as OpenAIWordLike;
      const startTimeSeconds = normalizeNumber(candidate.start);
      const endTimeSeconds = normalizeNumber(candidate.end);
      const text = (candidate.word ?? candidate.text ?? "").trim();

      if (
        startTimeSeconds === null ||
        endTimeSeconds === null ||
        !text ||
        endTimeSeconds <= startTimeSeconds
      ) {
        return null;
      }

      return {
        startTimeSeconds,
        endTimeSeconds,
        text,
      };
    })
    .filter((word): word is NormalizedWordTimestamp => word !== null)
    .sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
}

function wordsToTranscriptSegments(words: NormalizedWordTimestamp[]): NormalizedTranscriptSegment[] {
  const segments: NormalizedTranscriptSegment[] = [];
  let currentWords: NormalizedWordTimestamp[] = [];

  function flush(): void {
    if (currentWords.length === 0) {
      return;
    }

    const first = currentWords[0];
    const last = currentWords[currentWords.length - 1];
    segments.push({
      startTimeSeconds: Number(first.startTimeSeconds.toFixed(3)),
      endTimeSeconds: Number(last.endTimeSeconds.toFixed(3)),
      text: currentWords.map((word) => word.text).join(" ").replace(/\s+/g, " ").trim(),
    });
    currentWords = [];
  }

  for (const word of words) {
    const previous = currentWords[currentWords.length - 1];
    const durationIfAdded = currentWords.length > 0
      ? word.endTimeSeconds - currentWords[0].startTimeSeconds
      : word.endTimeSeconds - word.startTimeSeconds;
    const gapFromPrevious = previous ? word.startTimeSeconds - previous.endTimeSeconds : 0;
    const previousEndsSentence = previous ? /[.!?]$/.test(previous.text.trim()) : false;

    if (
      currentWords.length > 0 &&
      (
        durationIfAdded > MAX_WORD_TIMED_SEGMENT_SECONDS ||
        currentWords.length >= MAX_WORD_TIMED_SEGMENT_WORDS ||
        gapFromPrevious > WORD_GAP_SPLIT_SECONDS ||
        (previousEndsSentence && currentWords.length >= 3)
      )
    ) {
      flush();
    }

    currentWords.push(word);
  }

  flush();
  return segments;
}

function mapProviderConfidenceByOverlap(
  targetSegments: NormalizedTranscriptSegment[],
  providerSegments: NormalizedTranscriptSegment[],
): NormalizedTranscriptSegment[] {
  return targetSegments.map((target) => {
    let weightedConfidence = 0;
    let coveredSeconds = 0;

    for (const providerSegment of providerSegments) {
      if (typeof providerSegment.confidence !== "number") {
        continue;
      }

      const overlapSeconds = Math.max(
        0,
        Math.min(target.endTimeSeconds, providerSegment.endTimeSeconds) -
          Math.max(target.startTimeSeconds, providerSegment.startTimeSeconds),
      );
      if (overlapSeconds <= 0) {
        continue;
      }

      weightedConfidence += providerSegment.confidence * overlapSeconds;
      coveredSeconds += overlapSeconds;
    }

    const targetDurationSeconds = target.endTimeSeconds - target.startTimeSeconds;
    if (
      coveredSeconds <= 0 ||
      targetDurationSeconds <= 0 ||
      coveredSeconds / targetDurationSeconds < MIN_PROVIDER_CONFIDENCE_OVERLAP_RATIO
    ) {
      return target;
    }

    return {
      ...target,
      confidence: Number((weightedConfidence / coveredSeconds).toFixed(4)),
    };
  });
}

function selectBestTimestampedSegments(input: {
  responseText: string;
  segmentTimestamps: NormalizedTranscriptSegment[];
  wordTimestamps: NormalizedWordTimestamp[];
}): NormalizedTranscriptSegment[] {
  if (input.wordTimestamps.length < MIN_WORDS_FOR_WORD_TIMED_SEGMENTS) {
    return input.segmentTimestamps;
  }

  const wordTimedSegments = wordsToTranscriptSegments(input.wordTimestamps);
  const responseWordCount = countWords(input.responseText);
  const wordTimedWordCount = wordTimedSegments.reduce((total, segment) => total + countWords(segment.text), 0);
  const retentionRatio = responseWordCount > 0 ? wordTimedWordCount / responseWordCount : 1;
  const segmentTimestampWordCount = input.segmentTimestamps.reduce((total, segment) => total + countWords(segment.text), 0);
  const segmentRetentionRatio = responseWordCount > 0 ? segmentTimestampWordCount / responseWordCount : 1;

  if (wordTimedSegments.length === 0 || retentionRatio < MIN_WORD_TIMED_SEGMENT_RETENTION_RATIO) {
    return input.segmentTimestamps;
  }

  if (
    input.segmentTimestamps.length > 0 &&
    segmentRetentionRatio - retentionRatio > MAX_WORD_TIMED_RETENTION_LOSS_VS_SEGMENTS
  ) {
    return input.segmentTimestamps;
  }

  return mapProviderConfidenceByOverlap(wordTimedSegments, input.segmentTimestamps);
}

export function resolveOpenAITranscriptionModel(modelOverride?: string): string {
  return modelOverride?.trim() || process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "whisper-1";
}

export function resolveOpenAIAccuracyTranscriptionModel(modelOverride?: string): string {
  return modelOverride?.trim() || process.env.OPENAI_TRANSCRIPTION_ACCURACY_MODEL?.trim() || DEFAULT_ACCURACY_TRANSCRIPTION_MODEL;
}

export function resolveOpenAIDiarizationTranscriptionModel(modelOverride?: string): string {
  return modelOverride?.trim() || process.env.OPENAI_TRANSCRIPTION_DIARIZATION_MODEL?.trim() || DEFAULT_DIARIZATION_TRANSCRIPTION_MODEL;
}

export function assertTimestampedTranscriptionModel(model: string): void {
  if (model !== "whisper-1") {
    throw new Error(
      `Transcription model "${model}" is not enabled for clip generation because this app requires segment timestamps. Use whisper-1 until the provider supports timestamped output for this model.`,
    );
  }
}

export async function transcribeAudioWithOpenAI(
  audioPath: string,
  options?: OpenAITranscriptionOptions,
): Promise<NormalizedTranscript> {
  const client = getOpenAiClient(
    "OPENAI_API_KEY is missing. Add it to your environment before transcribing.",
  );
  const model = resolveOpenAITranscriptionModel(options?.model);
  assertTimestampedTranscriptionModel(model);
  const startedAt = Date.now();
  let providerRequestCount = 0;

  let response;
  try {
    response = await runTranscriptionRequestWithRetry(
      () => {
        providerRequestCount += 1;
        return client.audio.transcriptions.create({
          model,
          file: createReadStream(audioPath),
          response_format: "verbose_json",
          timestamp_granularities: ["segment", "word"],
          ...(options?.language ? { language: options.language } : {}),
          ...(options?.prompt ? { prompt: options.prompt } : {}),
        });
      },
      { onRetry: options?.onRetry },
    );
  } catch (error) {
    await recordAiInvocation({
      operation: "transcription",
      sermonId: options?.sermonId,
      model,
      status: "FAILED",
      latencyMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
      metadata: {
        language: options?.language ?? null,
        promptProvided: Boolean(options?.prompt),
        responseFormat: "verbose_json",
        timestampGranularities: ["segment", "word"],
      },
      audioDurationSeconds: options?.audioDurationSeconds,
      providerRequestCount,
    });
    throw error;
  }

  const fullText = typeof response.text === "string" ? response.text.trim() : "";
  const segmentTimestamps = normalizeSegments((response as { segments?: unknown }).segments);
  const wordTimestamps = normalizeWords((response as { words?: unknown }).words);
  const segments = selectBestTimestampedSegments({
    responseText: fullText,
    segmentTimestamps,
    wordTimestamps,
  });
  const language = typeof response.language === "string" ? response.language : undefined;

  await recordAiInvocation({
    operation: "transcription",
    sermonId: options?.sermonId,
    model,
    status: "SUCCEEDED",
    latencyMs: Date.now() - startedAt,
    metadata: {
      language: options?.language ?? null,
      providerDetectedLanguage: language ?? null,
      promptProvided: Boolean(options?.prompt),
      responseFormat: "verbose_json",
      timestampGranularities: ["segment", "word"],
      segmentCount: segments.length,
      wordTimestampCount: wordTimestamps.length,
      textCharacters: fullText.length,
    },
    audioDurationSeconds: options?.audioDurationSeconds,
    providerRequestCount,
  });

  const timingTranscript: NormalizedTranscript = {
    fullText,
    language,
    provider: "openai",
    model,
    segments,
    words: wordTimestamps,
    raw: response,
  };

  const hybridMode = options?.hybrid === undefined
    ? resolveOptionalPassMode("OPENAI_TRANSCRIPTION_HYBRID_ENABLED", "auto")
    : options.hybrid ? "always" : "never";
  const diarizationMode = options?.diarization === undefined
    ? resolveOptionalPassMode("OPENAI_TRANSCRIPTION_DIARIZATION_ENABLED", "never")
    : options.diarization ? "always" : "never";
  const hybridEnabled = hybridMode === "always" || (hybridMode === "auto" && shouldRunAccuracyPass(timingTranscript));
  const diarizationEnabled = diarizationMode === "always";
  if (!hybridEnabled && !diarizationEnabled) {
    return timingTranscript;
  }

  const accuracyModel = resolveOpenAIAccuracyTranscriptionModel(options?.accuracyModel);
  const diarizationModel = resolveOpenAIDiarizationTranscriptionModel(options?.diarizationModel);
  const accuracyPromise = hybridEnabled
    ? transcribeHighAccuracyText(audioPath, {
        model: accuracyModel,
        language: options?.language,
        prompt: options?.prompt,
        sermonId: options?.sermonId,
        audioDurationSeconds: options?.audioDurationSeconds,
        onRetry: options?.onRetry,
      })
    : Promise.resolve(null);
  const diarizationPromise = diarizationEnabled
    ? transcribeSpeakerSegments(audioPath, {
        model: diarizationModel,
        language: options?.language,
        sermonId: options?.sermonId,
        audioDurationSeconds: options?.audioDurationSeconds,
        onRetry: options?.onRetry,
      })
    : Promise.resolve(null);
  const [accuracyResult, diarizationResult] = await Promise.allSettled([accuracyPromise, diarizationPromise]);
  const accuracy = accuracyResult.status === "fulfilled" ? accuracyResult.value : null;
  const speakerSegments = diarizationResult.status === "fulfilled" ? diarizationResult.value : null;
  const alignment = accuracy && wordTimestamps.length > 0
    ? alignHighAccuracyTranscript({
        accurateText: accuracy.fullText,
        timedWords: wordTimestamps,
        timingSegments: segments,
        accuracyConfidence: accuracy.confidence,
      })
    : null;
  const alignedSegments = alignment?.accepted ? alignment.segments : segments;
  const speakerLabeledSegments = mapSpeakerLabelsByOverlap(alignedSegments, speakerSegments?.segments ?? []);
  const resolvedFullText = alignment?.accepted
    ? speakerLabeledSegments.map((segment) => segment.text).join(" ").replace(/\s+/g, " ").trim()
    : fullText;

  return {
    ...timingTranscript,
    fullText: resolvedFullText,
    model: alignment?.accepted ? `${model}+${accuracyModel}` : model,
    segments: speakerLabeledSegments,
    raw: {
      timing: response,
      hybrid: {
        enabled: hybridEnabled,
        model: accuracyModel,
        succeeded: accuracyResult.status === "fulfilled" && Boolean(accuracy),
        error: accuracyResult.status === "rejected" ? getErrorMessage(accuracyResult.reason) : null,
        alignment,
        response: accuracy?.raw ?? null,
      },
      diarization: {
        enabled: diarizationEnabled,
        model: diarizationModel,
        succeeded: diarizationResult.status === "fulfilled" && Boolean(speakerSegments),
        error: diarizationResult.status === "rejected" ? getErrorMessage(diarizationResult.reason) : null,
        segmentCount: speakerSegments?.segments.length ?? 0,
        response: speakerSegments?.raw ?? null,
      },
    },
  };
}

async function transcribeHighAccuracyText(
  audioPath: string,
  options: Pick<OpenAITranscriptionOptions, "sermonId" | "language" | "prompt" | "onRetry" | "audioDurationSeconds"> & { model: string },
): Promise<HighAccuracyTranscript> {
  const client = getOpenAiClient("OPENAI_API_KEY is missing. Add it to your environment before transcribing.");
  const startedAt = Date.now();
  let providerRequestCount = 0;
  try {
    const response = await runTranscriptionRequestWithRetry(
      () => {
        providerRequestCount += 1;
        return client.audio.transcriptions.create({
          model: options.model,
          file: createReadStream(audioPath),
          response_format: "json",
          include: ["logprobs"],
          temperature: 0,
          ...(options.language ? { language: options.language } : {}),
          ...(options.prompt ? { prompt: options.prompt } : {}),
        });
      },
      { onRetry: options.onRetry },
    );
    const fullText = response.text.trim();
    const confidence = deriveHighAccuracyConfidence(response.logprobs);
    await recordAiInvocation({
      operation: "transcription_accuracy",
      sermonId: options.sermonId,
      model: options.model,
      status: "SUCCEEDED",
      latencyMs: Date.now() - startedAt,
      metadata: { textCharacters: fullText.length, confidence: confidence ?? null, promptProvided: Boolean(options.prompt) },
      audioDurationSeconds: options.audioDurationSeconds,
      providerRequestCount,
    });
    return { fullText, model: options.model, confidence, raw: response };
  } catch (error) {
    await recordAiInvocation({
      operation: "transcription_accuracy",
      sermonId: options.sermonId,
      model: options.model,
      status: "FAILED",
      latencyMs: Date.now() - startedAt,
      errorMessage: getErrorMessage(error),
      metadata: { promptProvided: Boolean(options.prompt) },
      audioDurationSeconds: options.audioDurationSeconds,
      providerRequestCount,
    });
    throw error;
  }
}

async function transcribeSpeakerSegments(
  audioPath: string,
  options: Pick<OpenAITranscriptionOptions, "sermonId" | "language" | "onRetry" | "audioDurationSeconds"> & { model: string },
): Promise<{ segments: NormalizedTranscriptSegment[]; raw: unknown }> {
  const client = getOpenAiClient("OPENAI_API_KEY is missing. Add it to your environment before transcribing.");
  const startedAt = Date.now();
  let providerRequestCount = 0;
  try {
    const response = await runTranscriptionRequestWithRetry(
      () => {
        providerRequestCount += 1;
        return client.audio.transcriptions.create({
          model: options.model,
          file: createReadStream(audioPath),
          response_format: "diarized_json",
          chunking_strategy: "auto",
          ...(options.language ? { language: options.language } : {}),
        });
      },
      { onRetry: options.onRetry },
    );
    const speakerSegments = normalizePrimarySpeakerLabel(
      normalizeSegments((response as { segments?: unknown }).segments),
    );
    await recordAiInvocation({
      operation: "transcription_diarization",
      sermonId: options.sermonId,
      model: options.model,
      status: "SUCCEEDED",
      latencyMs: Date.now() - startedAt,
      metadata: { segmentCount: speakerSegments.length },
      audioDurationSeconds: options.audioDurationSeconds,
      providerRequestCount,
    });
    return { segments: speakerSegments, raw: response };
  } catch (error) {
    await recordAiInvocation({
      operation: "transcription_diarization",
      sermonId: options.sermonId,
      model: options.model,
      status: "FAILED",
      latencyMs: Date.now() - startedAt,
      errorMessage: getErrorMessage(error),
      audioDurationSeconds: options.audioDurationSeconds,
      providerRequestCount,
    });
    throw error;
  }
}

export const __openAITranscriptionProviderTestUtils = {
  deriveWhisperSegmentConfidence,
  isRetryableOpenAITranscriptionError,
  mapProviderConfidenceByOverlap,
  mapSpeakerLabelsByOverlap,
  normalizePrimarySpeakerLabel,
  alignHighAccuracyTranscript,
  deriveHighAccuracyConfidence,
  normalizeSegments,
  normalizeWords,
  runTranscriptionRequestWithRetry,
  wordsToTranscriptSegments,
  selectBestTimestampedSegments,
  shouldRunAccuracyPass,
};
