import { createReadStream } from "node:fs";

import { getOpenAiClient } from "@/server/ai/openaiClient";

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

  const response = await client.audio.transcriptions.create({
    model,
    file: createReadStream(audioPath),
    response_format: "verbose_json",
    timestamp_granularities: ["segment", "word"],
    ...(options?.language ? { language: options.language } : {}),
    ...(options?.prompt ? { prompt: options.prompt } : {}),
  });

  const fullText = typeof response.text === "string" ? response.text.trim() : "";
  const segmentTimestamps = normalizeSegments((response as { segments?: unknown }).segments);
  const wordTimestamps = normalizeWords((response as { words?: unknown }).words);
  const segments = selectBestTimestampedSegments({
    responseText: fullText,
    segmentTimestamps,
    wordTimestamps,
  });
  const language = typeof response.language === "string" ? response.language : undefined;

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
  normalizeWords,
  wordsToTranscriptSegments,
  selectBestTimestampedSegments,
};
