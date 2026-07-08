import { createReadStream } from "node:fs";

import { getOpenAiClient } from "@/server/ai/openaiClient";
import { recordAiInvocation } from "@/server/ai/aiInvocationLogger";

export type NormalizedTranscriptSegment = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

export type NormalizedTranscript = {
  fullText: string;
  language?: string;
  provider: "openai";
  model: string;
  segments: NormalizedTranscriptSegment[];
  raw: unknown;
};

export type OpenAITranscriptionOptions = {
  language?: string;
  prompt?: string;
  model?: string;
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
};

type OpenAIWordLike = {
  start?: number | string;
  end?: number | string;
  word?: string;
  text?: string;
};

type NormalizedWordTimestamp = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

const MAX_WORD_TIMED_SEGMENT_SECONDS = 4.5;
const MAX_WORD_TIMED_SEGMENT_WORDS = 10;
const WORD_GAP_SPLIT_SECONDS = 1.2;
const MIN_WORDS_FOR_WORD_TIMED_SEGMENTS = 20;
const MIN_WORD_TIMED_SEGMENT_RETENTION_RATIO = 0.72;
const MAX_WORD_TIMED_RETENTION_LOSS_VS_SEGMENTS = 0.08;
const DEFAULT_TRANSCRIPTION_MAX_ATTEMPTS = 4;
const MAX_TRANSCRIPTION_MAX_ATTEMPTS = 8;
const DEFAULT_TRANSCRIPTION_RETRY_BASE_DELAY_MS = 2_000;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);

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

      return {
        startTimeSeconds,
        endTimeSeconds,
        text,
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

  return wordTimedSegments;
}

export function resolveOpenAITranscriptionModel(modelOverride?: string): string {
  return modelOverride?.trim() || process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "whisper-1";
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

  let response;
  try {
    response = await runTranscriptionRequestWithRetry(
      () => client.audio.transcriptions.create({
        model,
        file: createReadStream(audioPath),
        response_format: "verbose_json",
        timestamp_granularities: ["segment", "word"],
        ...(options?.language ? { language: options.language } : {}),
        ...(options?.prompt ? { prompt: options.prompt } : {}),
      }),
      { onRetry: options?.onRetry },
    );
  } catch (error) {
    await recordAiInvocation({
      operation: "transcription",
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
  });

  return {
    fullText,
    language,
    provider: "openai",
    model,
    segments,
    raw: response,
  };
}

export const __openAITranscriptionProviderTestUtils = {
  isRetryableOpenAITranscriptionError,
  normalizeWords,
  runTranscriptionRequestWithRetry,
  wordsToTranscriptSegments,
  selectBestTimestampedSegments,
};
