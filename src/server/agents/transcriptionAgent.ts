import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { SermonStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  appendJobLog,
  ensureProcessingJobRunning,
  markJobFailed,
  markJobSucceeded,
  resolveProcessingJob,
} from "@/server/agents/processing";
import { assessTranscriptQualityForClipping, type TranscriptQualityAssessment } from "@/server/agents/transcriptQuality";
import {
  transcribeAudioWithOpenAI,
  type NormalizedTranscript,
  type OpenAITranscriptionRetryInfo,
} from "@/server/ai/openaiTranscriptionProvider";
import {
  appendPipelineLog,
  ensureSermonFolders,
  getAudioPath,
  getSermonStoragePath,
  getTranscriptJsonPath,
} from "@/server/agents/storage";
import { mediaFileIsUsable } from "@/server/media/fileGuards";
import { getMediaDurationSeconds } from "@/server/media/ffmpeg";
import { probeAudioQuality } from "@/server/agents/audioQualityScoringService";
import { updateSermonStatus } from "@/server/status/sermonStatus";
import {
  applyInferredSermonWindowToSegments,
  inferSermonWindowFromTranscript,
  type InferredSermonWindow,
} from "@/server/agents/sermonWindowInference";
import { invalidateTranscriptDerivedClipWork } from "@/server/agents/transcriptChangeInvalidation";

type TranscribeOptions = {
  force?: boolean;
  processingJobId?: string;
};

const TRANSCRIBED_OR_LATER_STATUSES: ReadonlySet<SermonStatus> = new Set([
  "TRANSCRIBED",
  "GENERATING_CLIPS",
  "CLIPS_GENERATED",
  "REVIEWING",
  "EXPORTING",
  "EXPORTED",
]);

async function markSermonTranscribedUnlessAdvanced(sermonId: string): Promise<void> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: { status: true },
  });

  if (!sermon) {
    throw new Error(`Sermon ${sermonId} not found.`);
  }

  if (TRANSCRIBED_OR_LATER_STATUSES.has(sermon.status)) {
    if (sermon.status !== "TRANSCRIBED") {
      await appendPipelineLog(sermonId, `Transcript status update skipped because sermon is already ${sermon.status}.`);
    }
    return;
  }

  await updateSermonStatus(sermonId, "TRANSCRIBED");
}

function buildOpenAITranscriptionRetryLogger(
  sermonId: string,
  label: string,
): (info: OpenAITranscriptionRetryInfo) => Promise<void> {
  return async (info) => {
    const status = info.status ? ` status ${info.status}` : "";
    const retryInSeconds = Math.round(info.delayMs / 1000);
    await appendPipelineLog(
      sermonId,
      `OpenAI transcription retry for ${label}: attempt ${info.attempt}/${info.maxAttempts} failed${status} (${info.message}). Retrying attempt ${info.nextAttempt} in ${retryInSeconds}s.`,
    );
  };
}

type SermonSegmentWindowInput = {
  sermonStartSeconds: number | null;
  sermonEndSeconds: number | null;
  analyzeFullRecording: boolean;
  knownDurationSeconds: number | null;
};

type SermonSegmentWindowResult = {
  transcript: NormalizedTranscript;
  applied: boolean;
  inferredWindow?: InferredSermonWindow | null;
};

type ChunkTimelineSummary = {
  index: number;
  path: string;
  bytes: number;
  durationSeconds: number;
  durationMeasured: boolean;
  segmentCount: number;
  timelineOffsetSeconds: number;
  cacheHit: boolean;
};

type CachedChunkTranscriptPayload = {
  version: typeof CHUNK_TRANSCRIPT_CACHE_VERSION;
  chunkFileName: string;
  bytes: number;
  durationSeconds: number | null;
  languageCode: string | null;
  configurationKey: string;
  transcript: NormalizedTranscript;
};

type TranscriptionAttemptSource = "original" | "speech_enhanced";

type AssessedTranscriptAttempt = {
  source: TranscriptionAttemptSource;
  audioPath: string;
  transcript: NormalizedTranscript;
  windowed: SermonSegmentWindowResult;
  quality: TranscriptQualityAssessment;
  expectedDurationSeconds?: number | null;
};

type ReusableTranscriptDecision = {
  reusable: boolean;
  reason: string;
  quality?: TranscriptQualityAssessment;
};

type AudioTranscriptionReadiness =
  | { ready: true; durationSeconds: number }
  | { ready: false; reason: string };

type TranscriptionAudioInput = {
  audioPath: string;
  timelineOffsetSeconds: number;
  description: string;
};

type ManualTranscriptionWindow = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
};

type TranscriptReliabilityContext = {
  expectedDurationSeconds?: number | null;
};

const OPENAI_UPLOAD_LIMIT_BYTES = 24 * 1024 * 1024;
const CHUNK_TARGET_BYTES = 20 * 1024 * 1024;
const MIN_TRANSCRIPTION_CHUNK_BYTES = 16 * 1024;
const CHUNK_DURATION_SECONDS = 20 * 60;
const LOCAL_LANGUAGE_CHUNK_DURATION_SECONDS = 5 * 60;
const CHUNK_FOLDER_NAME = "chunks";
const CHUNK_TRANSCRIPT_CACHE_FOLDER_NAME = "chunk-transcripts";
const CHUNK_TRANSCRIPT_CACHE_VERSION = 5;
const TRANSCRIPTION_CONTEXT_WORDS = 70;
const SPEECH_ENHANCED_AUDIO_NAME = "speech-enhanced-audio.mp3";
const TRANSCRIPTION_CHUNK_MANIFEST_VERSION = 1;
const TRANSCRIPTION_CHUNK_MANIFEST_NAME = "chunk-manifest.json";
const TRANSCRIPTION_CHUNK_OVERLAP_SECONDS = 3;
const TRANSCRIPTION_SILENCE_SEARCH_SECONDS = 45;
const TRANSCRIPTION_SILENCE_MIN_DURATION_SECONDS = 0.45;
const MAX_CONSECUTIVE_DUPLICATE_TRANSCRIPT_SEGMENTS = 1;
const CHUNK_SEAM_DUPLICATE_LOOKBACK_SEGMENTS = 3;
const CHUNK_SEAM_DUPLICATE_MAX_GAP_SECONDS = 12;
const CHUNK_SEAM_DUPLICATE_MAX_OVERLAP_SECONDS = 4;
const CHUNK_SEAM_DUPLICATE_MIN_CONTAINMENT = 0.78;
const MIN_EXPECTED_TRANSCRIPT_COVERAGE_RATIO = 0.62;
const MIN_EXPECTED_DURATION_FOR_COVERAGE_CHECK_SECONDS = 180;
const DEGRADED_MULTILINGUAL_MIN_DISTINCT_SERMON_TOKENS = 32;
const DEGRADED_MULTILINGUAL_MAX_REPEATED_SEGMENT_RATIO = 0.28;
const DEGRADED_MULTILINGUAL_MAX_REPEATED_PHRASE_RATIO = 0.13;
const TRANSCRIPT_SEGMENT_INSERT_BATCH_SIZE = 500;

const TRANSCRIPTION_LANGUAGE_ALIASES: Array<{ code: string; aliases: string[] }> = [
  { code: "xh", aliases: ["xh", "xho", "xhosa", "isixhosa", "isi xhosa"] },
  { code: "zu", aliases: ["zu", "zul", "zulu", "isizulu", "isi zulu"] },
  { code: "st", aliases: ["st", "sot", "sotho", "sesotho", "southern sotho"] },
  { code: "tn", aliases: ["tn", "tsn", "tswana", "setswana"] },
  { code: "nso", aliases: ["nso", "sepedi", "northern sotho"] },
  { code: "af", aliases: ["afrikaans"] },
  { code: "en", aliases: ["english", "eng"] },
];

const OPENAI_TRANSCRIPTION_LANGUAGE_CODES = new Set(["af", "en"]);
const LOCAL_MULTILINGUAL_LANGUAGE_CODES = new Set(["xh", "zu", "st", "tn", "nso"]);
type TranscriptionLanguageHint = {
  intendedLanguage: string;
  openAiLanguage?: string;
  prompt?: string;
};

type TranscriptionPromptContext = {
  sermonTitle?: string | null;
  speakerName?: string | null;
  churchName?: string | null;
};

type TranscriptionChunkManifest = {
  version: typeof TRANSCRIPTION_CHUNK_MANIFEST_VERSION;
  sourceBytes: number;
  sourceDurationSeconds: number;
  targetDurationSeconds: number;
  overlapSeconds: number;
  silenceAware: boolean;
  chunks: Array<{
    fileName: string;
    startTimeSeconds: number;
    endTimeSeconds: number;
  }>;
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(/* turbopackIgnore: true */ filePath);
    return true;
  } catch {
    return false;
  }
}

async function assessAudioFileReadinessForTranscription(audioPath: string): Promise<AudioTranscriptionReadiness> {
  const media = await mediaFileIsUsable(audioPath);
  if (!media.usable) {
    return { ready: false, reason: media.reason };
  }

  const audioQuality = await probeAudioQuality({ filePath: audioPath }).catch(() => null);
  if (audioQuality?.audioWarnings.includes("NO_AUDIO_DETECTED")) {
    return { ready: false, reason: "The audio file has no usable audio stream." };
  }
  if (audioQuality?.audioWarnings.includes("EFFECTIVE_SILENCE")) {
    return { ready: false, reason: "The audio file appears to be silent, so transcription would not be reliable." };
  }

  return { ready: true, durationSeconds: media.durationSeconds };
}

function validateNormalizedTranscript(transcript: NormalizedTranscript): NormalizedTranscript {
  const fullText = transcript.fullText.trim();
  if (!fullText) {
    throw new Error("Transcription returned empty text.");
  }

  if (transcript.segments.length === 0) {
    throw new Error("Transcription did not return usable timestamped segments.");
  }

  for (const segment of transcript.segments) {
    if (!Number.isFinite(segment.startTimeSeconds) || !Number.isFinite(segment.endTimeSeconds)) {
      throw new Error("Transcription returned invalid segment timestamps.");
    }

    if (segment.endTimeSeconds <= segment.startTimeSeconds) {
      throw new Error("Transcription returned a segment with invalid time ordering.");
    }

    if (!segment.text.trim()) {
      throw new Error("Transcription returned an empty segment.");
    }

    if (
      segment.confidence !== undefined &&
      (
        !Number.isFinite(segment.confidence) ||
        segment.confidence < 0 ||
        segment.confidence > 1
      )
    ) {
      throw new Error("Transcription returned invalid provider confidence evidence.");
    }
  }

  return {
    ...transcript,
    fullText,
  };
}

function isNormalizedTranscriptLike(value: unknown): value is NormalizedTranscript {
  if (!value || typeof value !== "object") {
    return false;
  }

  const transcript = value as Partial<NormalizedTranscript>;
  return (
    transcript.provider === "openai" &&
    typeof transcript.model === "string" &&
    typeof transcript.fullText === "string" &&
    Array.isArray(transcript.segments)
  );
}

function isCachedChunkTranscriptPayload(value: unknown): value is CachedChunkTranscriptPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<CachedChunkTranscriptPayload>;
  return (
    payload.version === CHUNK_TRANSCRIPT_CACHE_VERSION &&
    typeof payload.chunkFileName === "string" &&
    typeof payload.bytes === "number" &&
    (typeof payload.durationSeconds === "number" || payload.durationSeconds === null) &&
    (typeof payload.languageCode === "string" || payload.languageCode === null) &&
    typeof payload.configurationKey === "string" &&
    isNormalizedTranscriptLike(payload.transcript)
  );
}

function transcriptionConfigurationKey(): string {
  return [
    process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "whisper-1",
    process.env.OPENAI_TRANSCRIPTION_ACCURACY_MODEL?.trim() || "gpt-4o-transcribe",
    process.env.OPENAI_TRANSCRIPTION_DIARIZATION_MODEL?.trim() || "gpt-4o-transcribe-diarize",
    process.env.OPENAI_TRANSCRIPTION_HYBRID_ENABLED?.trim().toLowerCase() || "true",
    process.env.OPENAI_TRANSCRIPTION_DIARIZATION_ENABLED?.trim().toLowerCase() || "true",
    process.env.OPENAI_TRANSCRIPTION_GLOSSARY?.trim() || "",
  ].join("|");
}

function buildTranscriptSegmentRecord(input: {
  sermonId: string;
  transcriptId: string;
  segment: NormalizedTranscript["segments"][number];
}) {
  return {
    sermonId: input.sermonId,
    transcriptId: input.transcriptId,
    startTimeSeconds: input.segment.startTimeSeconds,
    endTimeSeconds: input.segment.endTimeSeconds,
    text: input.segment.text,
    confidence: input.segment.confidence ?? null,
    speakerLabel: input.segment.speakerLabel ?? null,
  };
}

async function replaceTranscriptRecords(input: {
  sermonId: string;
  fullText: string;
  provider: string;
  language: string;
  transcriptJsonPath: string;
  segments: NormalizedTranscript["segments"];
}): Promise<void> {
  const previousTranscript = await prisma.transcript.findUnique({
    where: { sermonId: input.sermonId },
    select: {
      fullText: true,
      segments: {
        orderBy: { startTimeSeconds: "asc" },
        select: {
          startTimeSeconds: true,
          endTimeSeconds: true,
          text: true,
          confidence: true,
        },
      },
    },
  });
  const invalidation = previousTranscript
    ? await invalidateTranscriptDerivedClipWork({
        sermonId: input.sermonId,
        previousFullText: previousTranscript.fullText,
        nextFullText: input.fullText,
        previousSegments: previousTranscript.segments,
        segments: input.segments,
      })
    : null;

  await prisma.$transaction(async (tx) => {
    const transcript = await tx.transcript.upsert({
      where: { sermonId: input.sermonId },
      update: {
        fullText: input.fullText,
        provider: input.provider,
        language: input.language,
        rawJsonPath: input.transcriptJsonPath,
      },
      create: {
        sermonId: input.sermonId,
        fullText: input.fullText,
        provider: input.provider,
        language: input.language,
        rawJsonPath: input.transcriptJsonPath,
      },
    });

    await tx.transcriptSegment.deleteMany({
      where: { sermonId: input.sermonId },
    });

    for (let index = 0; index < input.segments.length; index += TRANSCRIPT_SEGMENT_INSERT_BATCH_SIZE) {
      const batch = input.segments.slice(index, index + TRANSCRIPT_SEGMENT_INSERT_BATCH_SIZE);
      await tx.transcriptSegment.createMany({
        data: batch.map((segment) => buildTranscriptSegmentRecord({
          sermonId: input.sermonId,
          transcriptId: transcript.id,
          segment,
        })),
      });
    }

    await tx.sermon.update({
      where: { id: input.sermonId },
      data: {
        transcriptJsonPath: input.transcriptJsonPath,
      },
    });
  });

  if (invalidation?.transcriptChanged) {
    await appendPipelineLog(
      input.sermonId,
      `Transcript evidence changed: ${invalidation.clipsReviewedAgain} existing clip(s) need fresh quality guidance; ${invalidation.clipsWithChangedEvidence} clip range(s) were safety-blocked and marked for media regeneration (${invalidation.clipsWithChangedExcerpt} with changed wording).`,
    );
  }
}

function buildChunkTranscriptCachePath(cacheDir: string, chunkPath: string): string {
  return path.join(cacheDir, `${path.basename(chunkPath, path.extname(chunkPath))}.transcript.json`);
}

function buildChunkTranscriptCachePayload(input: {
  chunkPath: string;
  bytes: number;
  durationSeconds: number | null;
  languageCode?: string | null;
  transcript: NormalizedTranscript;
}): CachedChunkTranscriptPayload {
  return {
    version: CHUNK_TRANSCRIPT_CACHE_VERSION,
    chunkFileName: path.basename(input.chunkPath),
    bytes: input.bytes,
    durationSeconds: input.durationSeconds,
    languageCode: input.languageCode ?? null,
    configurationKey: transcriptionConfigurationKey(),
    transcript: input.transcript,
  };
}

function safeTranscriptionChunkNamespace(audioPath: string): string {
  const baseName = path.basename(audioPath, path.extname(audioPath)).trim();
  return baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "audio";
}

async function directoryHasChunkAudioFiles(directory: string): Promise<boolean> {
  const files = await readdir(directory).catch(() => []);
  return files.some((entry) => entry.endsWith(".mp3"));
}

async function resolveChunkWorkingDirectories(input: {
  transcriptDir: string;
  audioPath: string;
}): Promise<{ chunkDir: string; chunkTranscriptCacheDir: string; legacyRootChunkDirectory: boolean }> {
  const legacyChunkDir = path.join(input.transcriptDir, CHUNK_FOLDER_NAME);
  const legacyCacheDir = path.join(input.transcriptDir, CHUNK_TRANSCRIPT_CACHE_FOLDER_NAME);
  const namespace = safeTranscriptionChunkNamespace(input.audioPath);

  if (namespace === "sermon-window-audio" && (await directoryHasChunkAudioFiles(legacyChunkDir))) {
    return {
      chunkDir: legacyChunkDir,
      chunkTranscriptCacheDir: legacyCacheDir,
      legacyRootChunkDirectory: true,
    };
  }

  return {
    chunkDir: path.join(legacyChunkDir, namespace),
    chunkTranscriptCacheDir: path.join(legacyCacheDir, namespace),
    legacyRootChunkDirectory: false,
  };
}

async function readCachedChunkTranscript(input: {
  cachePath: string;
  chunkPath: string;
  bytes: number;
  durationSeconds: number | null;
  languageCode?: string | null;
}): Promise<NormalizedTranscript | null> {
  if (!(await fileExists(input.cachePath))) {
    return null;
  }

  const parsed = JSON.parse(await readFile(input.cachePath, "utf8")) as unknown;
  if (!isCachedChunkTranscriptPayload(parsed)) {
    return null;
  }

  const expectedLanguageCode = input.languageCode ?? null;
  const durationMatches =
    parsed.durationSeconds === null ||
    input.durationSeconds === null ||
    Math.abs(parsed.durationSeconds - input.durationSeconds) <= 0.75;

  if (
    parsed.chunkFileName !== path.basename(input.chunkPath) ||
    parsed.bytes !== input.bytes ||
    parsed.languageCode !== expectedLanguageCode ||
    parsed.configurationKey !== transcriptionConfigurationKey() ||
    !durationMatches
  ) {
    return null;
  }

  return validateNormalizedTranscript(parsed.transcript);
}

async function writeCachedChunkTranscript(cachePath: string, payload: CachedChunkTranscriptPayload): Promise<void> {
  await writeFile(cachePath, JSON.stringify(payload, null, 2), "utf8");
}

async function writeTranscriptJsonAtomically(
  transcriptJsonPath: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const tempPath = path.join(
    path.dirname(transcriptJsonPath),
    `.${path.basename(transcriptJsonPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const serializedPayload = JSON.stringify(payload, null, 2);

  try {
    await writeFile(tempPath, serializedPayload, "utf8");
    await rename(tempPath, transcriptJsonPath);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

function normalizeTranscriptTextForCleanup(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseTranscriptSegment(text: string): boolean {
  const normalized = normalizeTranscriptTextForCleanup(text);
  if (!normalized) {
    return true;
  }

  if (
    normalized.includes("thank you for watching") ||
    normalized.includes("please subscribe") ||
    normalized.includes("preserve english zulu xhosa") ||
    normalized.includes("do not translate") ||
    normalized.includes("exactly as spoken")
  ) {
    return true;
  }

  if (/^(music|applause|laughter|silence|inaudible|crosstalk|foreign language|speaking in foreign language)$/.test(normalized)) {
    return true;
  }

  return false;
}

function cleanupTranscriptForClipping(transcript: NormalizedTranscript): NormalizedTranscript {
  const cleanedSegments: NormalizedTranscript["segments"] = [];
  let previousNormalized = "";
  let duplicateRun = 0;

  for (const segment of transcript.segments) {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (isNoiseTranscriptSegment(text)) {
      continue;
    }

    const normalized = normalizeTranscriptTextForCleanup(text);
    if (normalized === previousNormalized) {
      duplicateRun += 1;
      if (duplicateRun > MAX_CONSECUTIVE_DUPLICATE_TRANSCRIPT_SEGMENTS) {
        continue;
      }
    } else {
      previousNormalized = normalized;
      duplicateRun = 0;
    }

    cleanedSegments.push({
      ...segment,
      text,
    });
  }

  return {
    ...transcript,
    fullText: cleanedSegments.map((segment) => segment.text).join(" ").trim(),
    segments: cleanedSegments,
    raw: {
      ...(transcript.raw && typeof transcript.raw === "object" ? transcript.raw : {}),
      cleanup: {
        removedSegmentCount: transcript.segments.length - cleanedSegments.length,
        originalSegmentCount: transcript.segments.length,
        cleanedSegmentCount: cleanedSegments.length,
      },
    },
  };
}

function normalizePromptContextValue(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized && normalized.length > 0 ? normalized.slice(0, 140) : null;
}

function buildTranscriptionPromptContext(context?: TranscriptionPromptContext): string[] {
  const sermonTitle = normalizePromptContextValue(context?.sermonTitle);
  const speakerName = normalizePromptContextValue(context?.speakerName);
  const churchName = normalizePromptContextValue(context?.churchName);
  const expectedTerms = Array.from(new Set([sermonTitle, speakerName, churchName].filter((value): value is string => Boolean(value))));
  const configuredGlossary = process.env.OPENAI_TRANSCRIPTION_GLOSSARY
    ?.split(/[,;\n]+/g)
    .map((value) => normalizePromptContextValue(value))
    .filter((value): value is string => Boolean(value))
    .slice(0, 40) ?? [];
  const glossaryTerms = Array.from(new Set([...expectedTerms, ...configuredGlossary]));
  return glossaryTerms.length > 0
    ? [`Known sermon terms: ${glossaryTerms.join(", ")}. Spell them exactly when spoken.`]
    : [];
}

function buildWhisperPromptContext(intendedLanguage: string, context?: TranscriptionPromptContext): string[] {
  return [
    `Languages spoken may include: ${intendedLanguage}. Preserve the spoken language changes rather than translating them.`,
    "Christian sermon, scripture, Bible verses, prayer, worship, altar call, Jesus, Amen, Hallelujah.",
    "Use natural sentence punctuation. Keep scripture references, personal names, place names, and local-language spelling faithful to the audio.",
    ...buildTranscriptionPromptContext(context),
  ];
}

function getDeclaredLanguageCodes(language: string | null | undefined): string[] {
  const normalized = language?.toLowerCase() ?? "";
  if (!normalized) {
    return [];
  }

  return TRANSCRIPTION_LANGUAGE_ALIASES
    .filter(({ aliases }) => aliases.some((alias) => declaredLanguageAliasMatches(normalized, alias)))
    .map(({ code }) => code);
}

function declaredLanguageAliasMatches(normalizedLanguage: string, alias: string): boolean {
  if (alias.length > 3) {
    return normalizedLanguage.includes(alias);
  }
  const tokens = new Set(normalizedLanguage.replace(/[^a-z0-9]+/g, " ").split(/\s+/g).filter(Boolean));
  return tokens.has(alias);
}

function usesLocalMultilingualLanguageHint(languageHint: TranscriptionLanguageHint | null): boolean {
  return getDeclaredLanguageCodes(languageHint?.intendedLanguage).some((code) => {
    return LOCAL_MULTILINGUAL_LANGUAGE_CODES.has(code);
  });
}

function resolveTranscriptionChunkDurationSeconds(languageHint: TranscriptionLanguageHint | null): number {
  return usesLocalMultilingualLanguageHint(languageHint)
    ? LOCAL_LANGUAGE_CHUNK_DURATION_SECONDS
    : CHUNK_DURATION_SECONDS;
}

function buildTranscriptionLanguageHint(
  language: string | null,
  context?: TranscriptionPromptContext,
): TranscriptionLanguageHint | null {
  const intendedLanguage = language?.trim();
  if (!intendedLanguage) {
    return null;
  }

  const normalized = intendedLanguage.toLowerCase();
  const matches = TRANSCRIPTION_LANGUAGE_ALIASES.filter(({ aliases }) => {
    return aliases.some((alias) => declaredLanguageAliasMatches(normalized, alias));
  });
  const preferredMatch = matches.find((match) => match.code !== "en") ?? matches[0];
  const openAiLanguage = preferredMatch && OPENAI_TRANSCRIPTION_LANGUAGE_CODES.has(preferredMatch.code)
    ? preferredMatch.code
    : undefined;

  return {
    intendedLanguage,
    openAiLanguage,
    prompt: buildWhisperPromptContext(intendedLanguage, context).join(" "),
  };
}

function getTranscriptTail(text: string, wordLimit = TRANSCRIPTION_CONTEXT_WORDS): string | null {
  const words = text
    .trim()
    .split(/\s+/g)
    .filter(Boolean);

  if (words.length === 0) {
    return null;
  }

  return words.slice(-wordLimit).join(" ");
}

function buildChunkTranscriptionPrompt(
  languageHint: TranscriptionLanguageHint | null,
  previousTranscriptTail: string | null,
): string | undefined {
  if (!languageHint?.prompt) {
    return undefined;
  }

  const promptParts = [
    languageHint.prompt,
    previousTranscriptTail
      ? `Previous transcript context: ${previousTranscriptTail}`
      : null,
  ].filter((part): part is string => Boolean(part?.trim()));

  return promptParts.length > 0 ? promptParts.join(" ") : undefined;
}

function getChunkTimelineOffsetSeconds(index: number, chunkDurationSeconds = CHUNK_DURATION_SECONDS): number {
  return index * chunkDurationSeconds;
}

function buildCumulativeChunkTimelineOffsets(
  chunkDurationsSeconds: Array<number | null>,
  fallbackDurationSeconds = CHUNK_DURATION_SECONDS,
): { offsets: number[]; fallbackCount: number } {
  const offsets: number[] = [];
  let elapsedSeconds = 0;
  let fallbackCount = 0;

  for (const durationSeconds of chunkDurationsSeconds) {
    offsets.push(Number(elapsedSeconds.toFixed(3)));

    if (typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0) {
      elapsedSeconds += durationSeconds;
    } else {
      elapsedSeconds += fallbackDurationSeconds;
      fallbackCount += 1;
    }
  }

  return { offsets, fallbackCount };
}

function offsetChunkTranscriptSegments(
  segments: NormalizedTranscript["segments"],
  timelineOffsetSeconds: number,
): NormalizedTranscript["segments"] {
  return segments.map((segment) => ({
    ...segment,
    startTimeSeconds: Number((segment.startTimeSeconds + timelineOffsetSeconds).toFixed(3)),
    endTimeSeconds: Number((segment.endTimeSeconds + timelineOffsetSeconds).toFixed(3)),
  }));
}

function offsetTranscriptTimeline(
  transcript: NormalizedTranscript,
  timelineOffsetSeconds: number,
): NormalizedTranscript {
  if (!Number.isFinite(timelineOffsetSeconds) || timelineOffsetSeconds <= 0) {
    return transcript;
  }

  return {
    ...transcript,
    segments: offsetChunkTranscriptSegments(transcript.segments, timelineOffsetSeconds),
    words: transcript.words?.map((word) => ({
      ...word,
      startTimeSeconds: Number((word.startTimeSeconds + timelineOffsetSeconds).toFixed(3)),
      endTimeSeconds: Number((word.endTimeSeconds + timelineOffsetSeconds).toFixed(3)),
    })),
    raw: {
      ...(transcript.raw && typeof transcript.raw === "object" ? transcript.raw : {}),
      timelineOffsetSeconds,
    },
  };
}

function isSameTranscriptPhrase(left: string, right: string): boolean {
  const normalizedLeft = normalizeTranscriptTextForCleanup(left);
  const normalizedRight = normalizeTranscriptTextForCleanup(right);
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function transcriptCleanupTokens(text: string): string[] {
  return normalizeTranscriptTextForCleanup(text)
    .split(/\s+/g)
    .filter((token) => token.length > 2);
}

function transcriptPhraseContainment(left: string, right: string): number {
  const leftTokens = new Set(transcriptCleanupTokens(left));
  const rightTokens = new Set(transcriptCleanupTokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of rightTokens) {
    if (leftTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / rightTokens.size;
}

function isContainedTranscriptPhrase(left: string, right: string): boolean {
  return transcriptPhraseContainment(left, right) >= CHUNK_SEAM_DUPLICATE_MIN_CONTAINMENT;
}

function isDuplicateAtChunkSeam(
  previousSegments: NormalizedTranscript["segments"],
  nextSegment: NormalizedTranscript["segments"][number],
): boolean {
  const recentSegments = previousSegments.slice(-CHUNK_SEAM_DUPLICATE_LOOKBACK_SEGMENTS);
  return recentSegments.some((previousSegment) => {
    const gapSeconds = nextSegment.startTimeSeconds - previousSegment.endTimeSeconds;
    return (
      gapSeconds >= -CHUNK_SEAM_DUPLICATE_MAX_OVERLAP_SECONDS &&
      gapSeconds <= CHUNK_SEAM_DUPLICATE_MAX_GAP_SECONDS &&
      (
        isSameTranscriptPhrase(previousSegment.text, nextSegment.text) ||
        isContainedTranscriptPhrase(previousSegment.text, nextSegment.text)
      )
    );
  });
}

function mergeChunkTranscriptSegments(
  previousSegments: NormalizedTranscript["segments"],
  nextSegments: NormalizedTranscript["segments"],
): { segments: NormalizedTranscript["segments"]; removedDuplicateCount: number } {
  const merged = [...previousSegments];
  let removedDuplicateCount = 0;
  let stillAtChunkStart = true;

  for (const segment of nextSegments) {
    if (stillAtChunkStart && isDuplicateAtChunkSeam(merged, segment)) {
      removedDuplicateCount += 1;
      continue;
    }

    stillAtChunkStart = false;
    merged.push(segment);
  }

  return { segments: merged, removedDuplicateCount };
}

function applySermonSegmentWindowToTranscript(
  transcript: NormalizedTranscript,
  window: SermonSegmentWindowInput,
): SermonSegmentWindowResult {
  if (window.analyzeFullRecording) {
    return { transcript, applied: false };
  }

  const hasStart = typeof window.sermonStartSeconds === "number";
  const hasEnd = typeof window.sermonEndSeconds === "number";
  if (!hasStart && !hasEnd) {
    return { transcript, applied: false };
  }

  const start = window.sermonStartSeconds ?? 0;
  const end = window.sermonEndSeconds ?? transcript.segments[transcript.segments.length - 1]?.endTimeSeconds ?? 0;

  if (end <= start) {
    throw new Error("Sermon end time must be after the start time.");
  }

  if (typeof window.knownDurationSeconds === "number" && end > window.knownDurationSeconds) {
    throw new Error("Sermon end time is longer than the video duration.");
  }

  const segments = transcript.segments.filter((segment) => {
    return segment.startTimeSeconds < end && segment.endTimeSeconds > start;
  });

  if (segments.length === 0) {
    throw new Error("No transcript content exists inside the selected sermon window.");
  }

  return {
    applied: true,
    transcript: {
      ...transcript,
      fullText: segments.map((segment) => segment.text.trim()).join(" ").trim(),
      segments,
    },
  };
}

function applyClippingWindowToTranscript(
  transcript: NormalizedTranscript,
  window: SermonSegmentWindowInput,
): SermonSegmentWindowResult {
  const windowed = applySermonSegmentWindowToTranscript(transcript, window);
  if (windowed.applied || window.analyzeFullRecording) {
    return windowed;
  }

  const inferredWindow = inferSermonWindowFromTranscript(windowed.transcript.segments, {
    sermonStartSeconds: window.sermonStartSeconds,
    sermonEndSeconds: window.sermonEndSeconds,
    analyzeFullRecording: window.analyzeFullRecording,
    knownDurationSeconds: window.knownDurationSeconds,
  });

  if (!inferredWindow) {
    return windowed;
  }

  const segments = applyInferredSermonWindowToSegments(windowed.transcript.segments, inferredWindow);
  return {
    applied: true,
    inferredWindow,
    transcript: {
      ...windowed.transcript,
      fullText: segments.map((segment) => segment.text.trim()).join(" ").trim(),
      segments,
    },
  };
}

function resolveExpectedTranscriptDurationSeconds(
  window: SermonSegmentWindowInput,
  audioDurationSeconds?: number | null,
): number | null {
  const knownDuration = typeof window.knownDurationSeconds === "number" && Number.isFinite(window.knownDurationSeconds)
    ? window.knownDurationSeconds
    : typeof audioDurationSeconds === "number" && Number.isFinite(audioDurationSeconds)
      ? audioDurationSeconds
      : null;

  if (window.analyzeFullRecording) {
    return knownDuration;
  }

  const start = typeof window.sermonStartSeconds === "number" && Number.isFinite(window.sermonStartSeconds)
    ? Math.max(0, window.sermonStartSeconds)
    : null;
  const end = typeof window.sermonEndSeconds === "number" && Number.isFinite(window.sermonEndSeconds)
    ? Math.max(0, window.sermonEndSeconds)
    : null;

  if (start !== null && end !== null && end > start) {
    return end - start;
  }

  if (start !== null && knownDuration !== null && knownDuration > start) {
    return knownDuration - start;
  }

  if (end !== null && end > 0) {
    return end;
  }

  return knownDuration;
}

function resolveManualTranscriptionWindow(
  window: SermonSegmentWindowInput,
  audioDurationSeconds?: number | null,
): ManualTranscriptionWindow | null {
  if (window.analyzeFullRecording) {
    return null;
  }

  const knownDuration = typeof window.knownDurationSeconds === "number" && Number.isFinite(window.knownDurationSeconds)
    ? window.knownDurationSeconds
    : typeof audioDurationSeconds === "number" && Number.isFinite(audioDurationSeconds)
      ? audioDurationSeconds
      : null;
  const startTimeSeconds = typeof window.sermonStartSeconds === "number" && Number.isFinite(window.sermonStartSeconds)
    ? Math.max(0, window.sermonStartSeconds)
    : 0;
  const endTimeSeconds = typeof window.sermonEndSeconds === "number" && Number.isFinite(window.sermonEndSeconds)
    ? Math.max(0, window.sermonEndSeconds)
    : knownDuration;

  if (endTimeSeconds === null || endTimeSeconds <= startTimeSeconds) {
    return null;
  }

  if (knownDuration !== null && startTimeSeconds >= knownDuration) {
    return null;
  }

  const clampedEndSeconds = knownDuration !== null ? Math.min(endTimeSeconds, knownDuration) : endTimeSeconds;
  const durationSeconds = clampedEndSeconds - startTimeSeconds;
  if (durationSeconds < MIN_EXPECTED_DURATION_FOR_COVERAGE_CHECK_SECONDS) {
    return null;
  }

  return {
    startTimeSeconds,
    endTimeSeconds: clampedEndSeconds,
    durationSeconds,
  };
}

function assessReusableTranscriptForClipping(input: {
  transcriptExists: boolean;
  transcriptJsonExists: boolean;
  transcriptConfigurationMatches?: boolean;
  segments: NormalizedTranscript["segments"];
  expectedDurationSeconds?: number | null;
  window?: SermonSegmentWindowInput | null;
}): ReusableTranscriptDecision {
  if (!input.transcriptExists) {
    return { reusable: false, reason: "No saved transcript record exists." };
  }

  if (!input.transcriptJsonExists) {
    return { reusable: false, reason: "Saved transcript JSON file is missing." };
  }

  if (input.transcriptConfigurationMatches === false) {
    return { reusable: false, reason: "Saved transcript was produced by an older transcription configuration." };
  }

  if (input.segments.length === 0) {
    return { reusable: false, reason: "Saved transcript has no timestamped segments." };
  }

  const cleanedTranscript = cleanupTranscriptForClipping({
    fullText: input.segments.map((segment) => segment.text).join(" "),
    language: undefined,
    provider: "openai",
    model: "saved-transcript",
    segments: input.segments,
    raw: {},
  });
  const windowedTranscript = input.window
    ? applyClippingWindowToTranscript(cleanedTranscript, input.window)
    : { transcript: cleanedTranscript, applied: false, inferredWindow: null };
  const expectedDurationSeconds = windowedTranscript.inferredWindow
    ? windowedTranscript.inferredWindow.durationSeconds
    : input.expectedDurationSeconds;
  const quality = assessTranscriptQualityForClipping(windowedTranscript.transcript.segments);

  if (!quality.ready) {
    return {
      reusable: false,
      reason: `Saved transcript is not clipping-ready: ${quality.reason}`,
      quality,
    };
  }

  const reliabilityIssue = finalTranscriptReliabilityIssue(quality, {
    expectedDurationSeconds,
  });
  if (reliabilityIssue) {
    return {
      reusable: false,
      reason: `Saved transcript is not reliable enough for clipping: ${reliabilityIssue}`,
      quality,
    };
  }

  return {
    reusable: true,
    reason: [
      `Saved transcript is clipping-ready (${quality.wordCount} words, ${quality.meaningfulSegmentCount} meaningful segments).`,
      windowedTranscript.inferredWindow
        ? `Auto-detected sermon window ${Math.round(windowedTranscript.inferredWindow.startTimeSeconds)}-${Math.round(windowedTranscript.inferredWindow.endTimeSeconds)}s.`
        : "",
    ].filter(Boolean).join(" "),
    quality,
  };
}

async function getReusableTranscriptDecision(sermonId: string, transcriptJsonPath: string): Promise<ReusableTranscriptDecision> {
  const [transcript, sermon] = await Promise.all([
    prisma.transcript.findUnique({
      where: { sermonId },
      select: { id: true },
    }),
    prisma.sermon.findUnique({
      where: { id: sermonId },
      select: {
        sermonStartSeconds: true,
        sermonEndSeconds: true,
        analyzeFullRecording: true,
        sourceDurationSeconds: true,
      },
    }),
  ]);

  if (!transcript) {
    return assessReusableTranscriptForClipping({
      transcriptExists: false,
      transcriptJsonExists: false,
      segments: [],
      expectedDurationSeconds: sermon
        ? resolveExpectedTranscriptDurationSeconds({
            sermonStartSeconds: sermon.sermonStartSeconds,
            sermonEndSeconds: sermon.sermonEndSeconds,
            analyzeFullRecording: sermon.analyzeFullRecording,
            knownDurationSeconds: sermon.sourceDurationSeconds,
          })
        : null,
    });
  }

  const transcriptJsonExists = await fileExists(transcriptJsonPath);
  const transcriptConfigurationMatches = transcriptJsonExists
    ? await readFile(transcriptJsonPath, "utf8")
        .then((value) => JSON.parse(value) as { transcriptionConfigurationKey?: unknown })
        .then((payload) => payload.transcriptionConfigurationKey === transcriptionConfigurationKey())
        .catch(() => false)
    : false;
  const segments = await prisma.transcriptSegment.findMany({
    where: { sermonId },
    orderBy: { startTimeSeconds: "asc" },
    select: {
      startTimeSeconds: true,
      endTimeSeconds: true,
      text: true,
      speakerLabel: true,
      confidence: true,
    },
  });

  return assessReusableTranscriptForClipping({
    transcriptExists: true,
    transcriptJsonExists,
    transcriptConfigurationMatches,
    segments: segments.map((segment) => ({
      startTimeSeconds: segment.startTimeSeconds,
      endTimeSeconds: segment.endTimeSeconds,
      text: segment.text,
      ...(segment.speakerLabel ? { speakerLabel: segment.speakerLabel } : {}),
      ...(typeof segment.confidence === "number" ? { confidence: segment.confidence } : {}),
    })),
    expectedDurationSeconds: sermon
      ? resolveExpectedTranscriptDurationSeconds({
          sermonStartSeconds: sermon.sermonStartSeconds,
          sermonEndSeconds: sermon.sermonEndSeconds,
          analyzeFullRecording: sermon.analyzeFullRecording,
          knownDurationSeconds: sermon.sourceDurationSeconds,
        })
      : null,
    window: sermon
      ? {
          sermonStartSeconds: sermon.sermonStartSeconds,
          sermonEndSeconds: sermon.sermonEndSeconds,
          analyzeFullRecording: sermon.analyzeFullRecording,
          knownDurationSeconds: sermon.sourceDurationSeconds,
        }
      : null,
  });
}

function ffmpegCommand(binaryPath?: string): string {
  return binaryPath?.trim() || "ffmpeg";
}

async function checkFfmpegInstalled(binaryPath?: string): Promise<void> {
  const command = ffmpegCommand(binaryPath);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, ["-version"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(new Error(`FFmpeg is not available for transcription chunking: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const details = stderr.trim() || `exit code ${code ?? "unknown"}`;
      reject(new Error(`FFmpeg is not installed or not executable (${details}).`));
    });
  });
}

function buildSilenceAwareChunkSpecs(input: {
  sourceDurationSeconds: number;
  targetDurationSeconds: number;
  silenceCentersSeconds: number[];
  overlapSeconds?: number;
}): TranscriptionChunkManifest["chunks"] {
  const overlapSeconds = input.overlapSeconds ?? TRANSCRIPTION_CHUNK_OVERLAP_SECONDS;
  const boundaries = [0];
  for (
    let target = input.targetDurationSeconds;
    target < input.sourceDurationSeconds;
    target += input.targetDurationSeconds
  ) {
    const nearestSilence = input.silenceCentersSeconds
      .filter((center) => Math.abs(center - target) <= TRANSCRIPTION_SILENCE_SEARCH_SECONDS)
      .sort((left, right) => Math.abs(left - target) - Math.abs(right - target))[0];
    const boundary = nearestSilence ?? target;
    if (boundary - boundaries[boundaries.length - 1] >= Math.min(60, input.targetDurationSeconds * 0.5)) {
      boundaries.push(Number(boundary.toFixed(3)));
    }
  }
  boundaries.push(Number(input.sourceDurationSeconds.toFixed(3)));

  return boundaries.slice(0, -1).map((boundary, index) => ({
    fileName: `chunk-${String(index).padStart(3, "0")}.mp3`,
    startTimeSeconds: Number(Math.max(0, boundary - (index > 0 ? overlapSeconds : 0)).toFixed(3)),
    endTimeSeconds: Number(Math.min(
      input.sourceDurationSeconds,
      boundaries[index + 1] + (index < boundaries.length - 2 ? overlapSeconds : 0),
    ).toFixed(3)),
  }));
}

async function runFfmpegChunking(
  sermonId: string,
  sourceAudioPath: string,
  chunkDirectory: string,
  chunkDurationSeconds = CHUNK_DURATION_SECONDS,
  binaryPath?: string,
): Promise<TranscriptionChunkManifest> {
  const command = ffmpegCommand(binaryPath);
  const sourceInfo = await stat(sourceAudioPath);
  const sourceDurationSeconds = await getMediaDurationSeconds(sourceAudioPath);

  const silenceOutput = await new Promise<string>((resolve) => {
    const child = spawn(command, [
      "-hide_banner",
      "-nostats",
      "-i",
      sourceAudioPath,
      "-af",
      `silencedetect=noise=-35dB:d=${TRANSCRIPTION_SILENCE_MIN_DURATION_SECONDS}`,
      "-f",
      "null",
      "-",
    ], { stdio: ["ignore", "ignore", "pipe"], shell: false });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(stderr));
  });
  const silenceStarts = [...silenceOutput.matchAll(/silence_start:\s*(-?\d+(?:\.\d+)?)/gi)]
    .map((match) => Number(match[1]));
  const silenceEnds = [...silenceOutput.matchAll(/silence_end:\s*(-?\d+(?:\.\d+)?)/gi)]
    .map((match) => Number(match[1]));
  const silenceCenters = silenceStarts
    .map((start, index) => {
      const end = silenceEnds[index];
      return Number.isFinite(end) && end > start ? (start + end) / 2 : null;
    })
    .filter((value): value is number => value !== null);

  const chunks = buildSilenceAwareChunkSpecs({
    sourceDurationSeconds,
    targetDurationSeconds: chunkDurationSeconds,
    silenceCentersSeconds: silenceCenters,
  });

  await appendPipelineLog(
    sermonId,
    `Running silence-aware FFmpeg chunking for oversized transcription input: ${sourceAudioPath} (${chunkDurationSeconds}s target, ${TRANSCRIPTION_CHUNK_OVERLAP_SECONDS}s overlap, ${silenceCenters.length} pause candidate(s)).`,
  );

  for (const chunk of chunks) {
    const outputPath = path.join(chunkDirectory, chunk.fileName);
    const durationSeconds = chunk.endTimeSeconds - chunk.startTimeSeconds;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, [
        "-y",
        "-ss",
        String(chunk.startTimeSeconds),
        "-t",
        String(durationSeconds),
        "-i",
        sourceAudioPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "96k",
        outputPath,
      ], { stdio: ["ignore", "ignore", "pipe"], shell: false });
      let stderr = "";
      child.stderr.on("data", (data) => { stderr += String(data); });
      child.on("error", (error) => reject(new Error(`Failed to start FFmpeg for chunking: ${error.message}`)));
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg chunking failed with code ${code ?? "unknown"}. ${stderr.trim().slice(-1500)}`.trim()));
      });
    });
  }

  const manifest: TranscriptionChunkManifest = {
    version: TRANSCRIPTION_CHUNK_MANIFEST_VERSION,
    sourceBytes: sourceInfo.size,
    sourceDurationSeconds: Number(sourceDurationSeconds.toFixed(3)),
    targetDurationSeconds: chunkDurationSeconds,
    overlapSeconds: TRANSCRIPTION_CHUNK_OVERLAP_SECONDS,
    silenceAware: true,
    chunks,
  };
  await writeFile(path.join(chunkDirectory, TRANSCRIPTION_CHUNK_MANIFEST_NAME), JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

function isTranscriptionChunkManifest(value: unknown): value is TranscriptionChunkManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<TranscriptionChunkManifest>;
  return (
    manifest.version === TRANSCRIPTION_CHUNK_MANIFEST_VERSION &&
    typeof manifest.sourceBytes === "number" &&
    typeof manifest.sourceDurationSeconds === "number" &&
    typeof manifest.targetDurationSeconds === "number" &&
    typeof manifest.overlapSeconds === "number" &&
    manifest.silenceAware === true &&
    Array.isArray(manifest.chunks) &&
    manifest.chunks.every((chunk) => (
      typeof chunk?.fileName === "string" &&
      typeof chunk.startTimeSeconds === "number" &&
      typeof chunk.endTimeSeconds === "number" &&
      chunk.endTimeSeconds > chunk.startTimeSeconds
    ))
  );
}

async function readReusableChunkManifest(input: {
  chunkDir: string;
  sourceAudioPath: string;
  targetDurationSeconds: number;
}): Promise<TranscriptionChunkManifest | null> {
  const manifestPath = path.join(input.chunkDir, TRANSCRIPTION_CHUNK_MANIFEST_NAME);
  const parsed = await readFile(manifestPath, "utf8").then((value) => JSON.parse(value) as unknown).catch(() => null);
  if (!isTranscriptionChunkManifest(parsed)) return null;
  const sourceInfo = await stat(input.sourceAudioPath);
  const sourceDurationSeconds = await getMediaDurationSeconds(input.sourceAudioPath);
  if (
    parsed.sourceBytes !== sourceInfo.size ||
    Math.abs(parsed.sourceDurationSeconds - sourceDurationSeconds) > 0.75 ||
    parsed.targetDurationSeconds !== input.targetDurationSeconds ||
    parsed.overlapSeconds !== TRANSCRIPTION_CHUNK_OVERLAP_SECONDS
  ) {
    return null;
  }
  const filesExist = await Promise.all(parsed.chunks.map((chunk) => fileExists(path.join(input.chunkDir, chunk.fileName))));
  return filesExist.every(Boolean) ? parsed : null;
}

async function runFfmpegSpeechEnhancement(
  sermonId: string,
  sourceAudioPath: string,
  outputAudioPath: string,
  binaryPath?: string,
): Promise<void> {
  const command = ffmpegCommand(binaryPath);
  const args = buildSpeechEnhancedAudioArgs(sourceAudioPath, outputAudioPath);

  await appendPipelineLog(sermonId, `Preparing speech-enhanced transcription audio: ${outputAudioPath}.`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      void appendPipelineLog(sermonId, `[ffmpeg speech enhancement] ${text.trimEnd()}`);
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to start FFmpeg for speech-enhanced audio: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const details = stderr.trim().slice(-1500);
      reject(new Error(`FFmpeg speech enhancement failed with code ${code ?? "unknown"}. ${details}`.trim()));
    });
  });
}

async function runFfmpegWindowedAudio(
  sermonId: string,
  sourceAudioPath: string,
  outputAudioPath: string,
  window: ManualTranscriptionWindow,
  binaryPath?: string,
): Promise<void> {
  const command = ffmpegCommand(binaryPath);
  const args = [
    "-y",
    "-ss",
    String(window.startTimeSeconds),
    "-t",
    String(window.durationSeconds),
    "-i",
    sourceAudioPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "96k",
    outputAudioPath,
  ];

  await appendPipelineLog(
    sermonId,
    `Preparing windowed transcription audio ${Math.round(window.startTimeSeconds)}-${Math.round(window.endTimeSeconds)}s: ${outputAudioPath}.`,
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      void appendPipelineLog(sermonId, `[ffmpeg transcription window] ${text.trimEnd()}`);
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to start FFmpeg for transcription window: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const details = stderr.trim().slice(-1500);
      reject(new Error(`FFmpeg transcription window failed with code ${code ?? "unknown"}. ${details}`.trim()));
    });
  });
}

function buildSpeechEnhancedAudioArgs(sourceAudioPath: string, outputAudioPath: string): string[] {
  return [
    "-y",
    "-i",
    sourceAudioPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-af",
    "highpass=f=80,lowpass=f=8000,dynaudnorm=f=150:g=15",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "96k",
    outputAudioPath,
  ];
}

function transcriptQualityScore(quality: TranscriptQualityAssessment): number {
  const readinessBonus = quality.ready ? 1000 : 0;
  const coverageScore = Math.min(200, quality.coverageRatio * 200);
  const wordScore = Math.min(200, quality.wordCount / 3);
  const segmentScore = Math.min(120, quality.meaningfulSegmentCount * 5);
  const densityPenalty = quality.wordsPerMinute > 0 && quality.wordsPerMinute < 35 ? 80 : 0;
  const timestampDensityPenalty = quality.meaningfulSegmentsPerMinute > 0 && quality.meaningfulSegmentsPerMinute < 1.8
    ? Math.min(140, (1.8 - quality.meaningfulSegmentsPerMinute) * 120)
    : 0;
  const gapPenalty = Math.min(220, quality.maxGapSeconds * 1.2 + quality.largeGapCount * 30);
  const repetitionPenalty = quality.repeatedSegmentRatio * 220;
  const phraseRepetitionPenalty = quality.repeatedPhraseRatio * 260;
  const coarseTimingPenalty = Math.min(180, quality.maxSegmentDurationSeconds * 1.6 + quality.averageSegmentDurationSeconds * 2.2);

  return Number((
    readinessBonus +
    coverageScore +
    wordScore +
    segmentScore -
    densityPenalty -
    timestampDensityPenalty -
    gapPenalty -
    repetitionPenalty -
    phraseRepetitionPenalty -
    coarseTimingPenalty
  ).toFixed(2));
}

function expectedTranscriptCoverageIssue(
  quality: TranscriptQualityAssessment,
  expectedDurationSeconds?: number | null,
): string | null {
  if (
    typeof expectedDurationSeconds !== "number" ||
    !Number.isFinite(expectedDurationSeconds) ||
    expectedDurationSeconds < MIN_EXPECTED_DURATION_FOR_COVERAGE_CHECK_SECONDS
  ) {
    return null;
  }

  const expectedCoverageRatio = quality.durationSeconds / expectedDurationSeconds;
  if (expectedCoverageRatio < MIN_EXPECTED_TRANSCRIPT_COVERAGE_RATIO) {
    return `Transcript only covers ${Math.round(expectedCoverageRatio * 100)}% of the expected sermon duration (${Math.round(quality.durationSeconds)} of ${Math.round(expectedDurationSeconds)} seconds).`;
  }

  return null;
}

function finalTranscriptReliabilityIssue(
  quality: TranscriptQualityAssessment,
  context?: TranscriptReliabilityContext,
): string | null {
  if (!quality.ready) {
    return quality.reason ?? "Transcript is not ready for clipping.";
  }

  const expectedCoverageIssue = expectedTranscriptCoverageIssue(quality, context?.expectedDurationSeconds);
  if (expectedCoverageIssue) {
    return expectedCoverageIssue;
  }

  if (quality.coverageRatio < 0.36) {
    return `Transcript coverage remains too sparse for confident clipping (${Math.round(quality.coverageRatio * 100)}% coverage).`;
  }

  if (quality.largeGapCount > 1 || quality.maxGapSeconds >= 90) {
    return `Transcript still has unexplained timing gaps (${quality.largeGapCount} gap(s), max ${Math.round(quality.maxGapSeconds)} seconds).`;
  }

  if (quality.repeatedSegmentRatio >= 0.12) {
    return `Transcript still appears repetitive (${Math.round(quality.repeatedSegmentRatio * 100)}% repeated segments).`;
  }

  if (quality.repeatedPhraseRatio >= 0.1) {
    return `Transcript still repeats the same sermon phrases too often (${Math.round(quality.repeatedPhraseRatio * 100)}% repeated phrases).`;
  }

  if (quality.maxSegmentDurationSeconds >= 60 || quality.averageSegmentDurationSeconds >= 30 || quality.coarseSegmentRatio >= 0.2) {
    return `Transcript timestamps are too coarse for confident clipping (max segment ${Math.round(quality.maxSegmentDurationSeconds)} seconds, average ${Math.round(quality.averageSegmentDurationSeconds)} seconds).`;
  }

  if (quality.meaningfulSegmentsPerMinute < 1.6) {
    return `Transcript timestamp density remains too thin for confident clipping (${quality.meaningfulSegmentsPerMinute} meaningful segments per minute).`;
  }

  if (quality.durationSeconds >= 10 * 60 && quality.wordsPerMinute < 35) {
    return `Transcript word density remains too low for confident clipping (${quality.wordsPerMinute} words per minute).`;
  }

  return null;
}

function isTranscriptReliableEnoughForClipping(
  quality: TranscriptQualityAssessment,
  context?: TranscriptReliabilityContext,
): boolean {
  return finalTranscriptReliabilityIssue(quality, context) === null;
}

function isDegradedTranscriptUsableForLocalMultilingualClipping(
  quality: TranscriptQualityAssessment,
  languageHint: TranscriptionLanguageHint | null,
): boolean {
  if (!usesLocalMultilingualLanguageHint(languageHint)) {
    return false;
  }

  if (quality.wordCount < 220 || quality.meaningfulSegmentCount < 10 || quality.durationSeconds < 180) {
    return false;
  }

  if (quality.distinctSermonTokenCount < DEGRADED_MULTILINGUAL_MIN_DISTINCT_SERMON_TOKENS) {
    return false;
  }

  if (
    quality.repeatedSegmentRatio > DEGRADED_MULTILINGUAL_MAX_REPEATED_SEGMENT_RATIO ||
    quality.repeatedPhraseRatio > DEGRADED_MULTILINGUAL_MAX_REPEATED_PHRASE_RATIO
  ) {
    return false;
  }

  if (
    quality.maxSegmentDurationSeconds >= 120 ||
    quality.averageSegmentDurationSeconds >= 60 ||
    quality.coarseSegmentRatio > 0.55
  ) {
    return false;
  }

  return true;
}

function shouldRetryWithSpeechEnhancedAudio(
  quality: TranscriptQualityAssessment,
  context?: TranscriptReliabilityContext,
): boolean {
  if (!quality.ready) {
    return true;
  }

  if (!isTranscriptReliableEnoughForClipping(quality, context)) {
    return true;
  }

  const warnings = new Set(quality.warnings);
  if (warnings.has("LOW_TRANSCRIPT_COVERAGE") && quality.coverageRatio < 0.5) {
    return true;
  }

  if (warnings.has("LARGE_TRANSCRIPT_GAPS") && quality.largeGapCount > 0) {
    return true;
  }

  if (warnings.has("REPEATED_TRANSCRIPT_SEGMENTS") && quality.repeatedSegmentRatio >= 0.05) {
    return true;
  }

  if (warnings.has("REPEATED_TRANSCRIPT_PHRASES") && quality.repeatedPhraseRatio >= 0.1) {
    return true;
  }

  if (warnings.has("COARSE_TRANSCRIPT_TIMING")) {
    return true;
  }

  if (warnings.has("LOW_TIMESTAMP_DENSITY")) {
    return true;
  }

  if (warnings.has("LOW_WORD_DENSITY") && quality.durationSeconds >= 10 * 60 && quality.wordsPerMinute < 45) {
    return true;
  }

  return false;
}

function speechEnhancedRetryEnabled(): boolean {
  const configured = process.env.OPENAI_TRANSCRIPTION_SPEECH_ENHANCEMENT_ENABLED?.trim().toLowerCase();
  return configured ? ["1", "true", "yes", "on"].includes(configured) : false;
}

function selectBestTranscriptAttempt(
  attempts: AssessedTranscriptAttempt[],
  context?: TranscriptReliabilityContext,
): AssessedTranscriptAttempt {
  if (attempts.length === 0) {
    throw new Error("No transcription attempts were available.");
  }

  return [...attempts].sort((left, right) => {
    const leftReliable = isTranscriptReliableEnoughForClipping(left.quality, {
      expectedDurationSeconds: left.expectedDurationSeconds ?? context?.expectedDurationSeconds,
    });
    const rightReliable = isTranscriptReliableEnoughForClipping(right.quality, {
      expectedDurationSeconds: right.expectedDurationSeconds ?? context?.expectedDurationSeconds,
    });
    if (leftReliable !== rightReliable) {
      return Number(rightReliable) - Number(leftReliable);
    }

    return transcriptQualityScore(right.quality) - transcriptQualityScore(left.quality);
  })[0];
}

async function transcribeAudioWithChunking(
  sermonId: string,
  audioPath: string,
  languageHint: TranscriptionLanguageHint | null,
  timelineBaseOffsetSeconds = 0,
): Promise<NormalizedTranscript> {
  const transcriptDir = path.join(getSermonStoragePath(sermonId), "transcript");
  const { chunkDir, chunkTranscriptCacheDir, legacyRootChunkDirectory } = await resolveChunkWorkingDirectories({
    transcriptDir,
    audioPath,
  });
  const chunkDurationSeconds = resolveTranscriptionChunkDurationSeconds(languageHint);
  await mkdir(chunkDir, { recursive: true });
  await mkdir(chunkTranscriptCacheDir, { recursive: true });

  await checkFfmpegInstalled();

  let chunkManifest = await readReusableChunkManifest({
    chunkDir,
    sourceAudioPath: audioPath,
    targetDurationSeconds: chunkDurationSeconds,
  });
  const existingBeforeChunking = (await readdir(chunkDir).catch(() => []))
    .filter((entry) => entry.endsWith(".mp3"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (chunkManifest && existingBeforeChunking.length > 0) {
    await appendPipelineLog(
      sermonId,
      `Reusing ${existingBeforeChunking.length} silence-aware overlapping transcription chunk file(s) for resume${legacyRootChunkDirectory ? " from the legacy chunk folder" : ""}.`,
    );
  } else {
    for (const fileName of existingBeforeChunking) {
      await unlink(path.join(chunkDir, fileName)).catch(() => undefined);
    }
    chunkManifest = await runFfmpegChunking(sermonId, audioPath, chunkDir, chunkDurationSeconds);
  }

  const files = await readdir(chunkDir);
  const chunkFiles = files
    .filter((entry) => entry.endsWith(".mp3"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((entry) => path.join(chunkDir, entry));

  const existingChunkFiles: string[] = [];
  for (const chunkPath of chunkFiles) {
    let chunkStat;

    try {
      chunkStat = await stat(chunkPath);
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        await appendPipelineLog(sermonId, `Skipping missing transcription chunk file ${chunkPath}.`);
        continue;
      }

      throw error;
    }

    if (chunkStat.size === 0) {
      await appendPipelineLog(sermonId, `Skipping empty transcription chunk file ${chunkPath}.`);
      continue;
    }

    if (chunkStat.size < MIN_TRANSCRIPTION_CHUNK_BYTES) {
      await appendPipelineLog(
        sermonId,
        `Skipping tiny transcription chunk file ${chunkPath} (${chunkStat.size} bytes).`,
      );
      continue;
    }

    existingChunkFiles.push(chunkPath);
  }

  if (existingChunkFiles.length === 0) {
    throw new Error("Chunking produced no audio files for transcription.");
  }

  const chunkDurationsSeconds: Array<number | null> = [];
  for (const [index, chunkPath] of existingChunkFiles.entries()) {
    try {
      chunkDurationsSeconds.push(Number((await getMediaDurationSeconds(chunkPath)).toFixed(3)));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown duration probe error.";
      chunkDurationsSeconds.push(null);
      await appendPipelineLog(
        sermonId,
        `Could not measure transcription chunk ${index + 1} duration; using nominal ${chunkDurationSeconds}s offset fallback. Reason: ${reason}`,
      );
    }
  }

  const legacyChunkTimeline = buildCumulativeChunkTimelineOffsets(chunkDurationsSeconds, chunkDurationSeconds);
  if (!chunkManifest && legacyChunkTimeline.fallbackCount > 0) {
    await appendPipelineLog(
      sermonId,
      `Used nominal chunk duration fallback for ${legacyChunkTimeline.fallbackCount} transcription chunk offset(s).`,
    );
  }

  let mergedSegments: NormalizedTranscript["segments"] = [];
  const chunkSummaries: ChunkTimelineSummary[] = [];
  const chunkModels = new Set<string>();
  let language: string | undefined;
  let previousTranscriptTail: string | null = null;

  for (let index = 0; index < existingChunkFiles.length; index += 1) {
    const chunkPath = existingChunkFiles[index];
    const chunkStat = await stat(chunkPath);
    if (chunkStat.size > OPENAI_UPLOAD_LIMIT_BYTES) {
      throw new Error(
        `Chunk ${index + 1} still exceeds OpenAI upload limit (${chunkStat.size} bytes). Reduce chunk duration before retrying.`,
      );
    }

    if (chunkStat.size > CHUNK_TARGET_BYTES) {
      await appendPipelineLog(
        sermonId,
        `Chunk ${index + 1} is larger than target (${chunkStat.size} bytes > ${CHUNK_TARGET_BYTES} bytes) but still within upload limit.`,
      );
    }

    const cachePath = buildChunkTranscriptCachePath(chunkTranscriptCacheDir, chunkPath);
    const durationSeconds = chunkDurationsSeconds[index] ?? chunkDurationSeconds;
    let cacheHit = false;
    let chunkTranscript = await readCachedChunkTranscript({
      cachePath,
      chunkPath,
      bytes: chunkStat.size,
      durationSeconds: chunkDurationsSeconds[index],
      languageCode: languageHint?.openAiLanguage,
    }).catch(async (error) => {
      const reason = error instanceof Error ? error.message : "Unknown chunk cache read error.";
      await appendPipelineLog(
        sermonId,
        `Ignoring cached transcript for chunk ${index + 1}/${existingChunkFiles.length}; cache could not be read: ${reason}`,
      );
      return null;
    });

    if (chunkTranscript) {
      cacheHit = true;
      await appendPipelineLog(
        sermonId,
        `Reused cached transcript for chunk ${index + 1}/${existingChunkFiles.length} (${chunkStat.size} bytes).`,
      );
    } else {
      await appendPipelineLog(
        sermonId,
        `Transcribing chunk ${index + 1}/${existingChunkFiles.length} (${chunkStat.size} bytes).`,
      );

      chunkTranscript = validateNormalizedTranscript(
        await transcribeAudioWithOpenAI(chunkPath, {
          language: languageHint?.openAiLanguage,
          prompt: buildChunkTranscriptionPrompt(languageHint, previousTranscriptTail),
          onRetry: buildOpenAITranscriptionRetryLogger(
            sermonId,
            `chunk ${index + 1}/${existingChunkFiles.length}`,
          ),
        }),
      );

      await writeCachedChunkTranscript(
        cachePath,
        buildChunkTranscriptCachePayload({
          chunkPath,
          bytes: chunkStat.size,
          durationSeconds: chunkDurationsSeconds[index],
          languageCode: languageHint?.openAiLanguage,
          transcript: chunkTranscript,
        }),
      );
      await appendPipelineLog(sermonId, `Saved transcript cache for chunk ${index + 1}/${existingChunkFiles.length}.`);
    }

    if (!language && chunkTranscript.language) {
      language = chunkTranscript.language;
    }
    chunkModels.add(chunkTranscript.model);

    const manifestChunk = chunkManifest?.chunks.find((chunk) => chunk.fileName === path.basename(chunkPath));
    const timelineOffsetSeconds = timelineBaseOffsetSeconds + (
      manifestChunk?.startTimeSeconds ??
      legacyChunkTimeline.offsets[index] ??
      getChunkTimelineOffsetSeconds(index, chunkDurationSeconds)
    );
    const shiftedSegments = offsetChunkTranscriptSegments(chunkTranscript.segments, timelineOffsetSeconds);
    const merged = mergeChunkTranscriptSegments(mergedSegments, shiftedSegments);
    if (merged.removedDuplicateCount > 0) {
      await appendPipelineLog(
        sermonId,
        `Removed ${merged.removedDuplicateCount} repeated transcript segment(s) at chunk ${index + 1} seam.`,
      );
    }
    mergedSegments = merged.segments;
    previousTranscriptTail = getTranscriptTail(mergedSegments.map((segment) => segment.text).join(" "));

    chunkSummaries.push({
      index: index + 1,
      path: chunkPath,
      bytes: chunkStat.size,
      durationSeconds,
      durationMeasured: chunkDurationsSeconds[index] !== null,
      segmentCount: chunkTranscript.segments.length,
      timelineOffsetSeconds,
      cacheHit,
    });
  }

  return {
    fullText: mergedSegments.map((segment) => segment.text.trim()).join(" ").trim(),
    language,
    provider: "openai",
    model: chunkModels.size > 0 ? `chunked:${Array.from(chunkModels).join(",")}` : "chunked-openai",
    segments: mergedSegments,
    raw: {
      chunking: {
        implemented: true,
        used: true,
        chunkDurationSeconds: CHUNK_DURATION_SECONDS,
        effectiveChunkDurationSeconds: chunkDurationSeconds,
        silenceAware: chunkManifest?.silenceAware ?? false,
        overlapSeconds: chunkManifest?.overlapSeconds ?? 0,
        chunkCount: existingChunkFiles.length,
        cacheHitCount: chunkSummaries.filter((chunk) => chunk.cacheHit).length,
        timelineBaseOffsetSeconds,
        chunks: chunkSummaries,
      },
    },
  };
}

export async function transcribeSermonAudio(
  sermonId: string,
  options?: TranscribeOptions,
): Promise<{ transcriptJsonPath: string; reusedExistingTranscript: boolean }> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      title: true,
      speakerName: true,
      churchName: true,
      transcriptJsonPath: true,
      sermonStartSeconds: true,
      sermonEndSeconds: true,
      analyzeFullRecording: true,
      sourceDurationSeconds: true,
      language: true,
    },
  });

  if (!sermon) {
    throw new Error(`Sermon ${sermonId} was not found.`);
  }

  await ensureSermonFolders(sermon.id, sermon.title);

  const audioPath = getAudioPath(sermon.id);
  const transcriptJsonPath = getTranscriptJsonPath(sermon.id);
  const job = await resolveProcessingJob(sermon.id, "TRANSCRIBE_AUDIO", options?.processingJobId);

  try {
    await ensureProcessingJobRunning(job);
    await appendJobLog(job.id, "Transcription job started.");
    await appendPipelineLog(sermon.id, "Transcription requested.");

    const reusableTranscript = options?.force
      ? { reusable: false, reason: "Force transcription requested." }
      : await getReusableTranscriptDecision(sermon.id, transcriptJsonPath);
    if (reusableTranscript.reusable) {
      await prisma.sermon.update({
        where: { id: sermon.id },
        data: { transcriptJsonPath },
      });
      await markSermonTranscribedUnlessAdvanced(sermon.id);
      await markJobSucceeded(job.id, `Existing transcript and segments reused; skipped API call. ${reusableTranscript.reason}`);
      await appendPipelineLog(sermon.id, `Existing transcript and segments reused; skipped API call. ${reusableTranscript.reason}`);

      return { transcriptJsonPath, reusedExistingTranscript: true };
    }

    if (!options?.force) {
      await appendJobLog(job.id, `Saved transcript will not be reused. ${reusableTranscript.reason}`);
      await appendPipelineLog(sermon.id, `Saved transcript will not be reused. ${reusableTranscript.reason}`);
    }

	    const audioReadiness = await assessAudioFileReadinessForTranscription(audioPath);
	    if (!audioReadiness.ready) {
	      throw new Error(`Cannot transcribe sermon because audio file is not usable: ${audioReadiness.reason}`);
	    }
	    await appendPipelineLog(sermon.id, `Audio ready for transcription: ${audioReadiness.durationSeconds.toFixed(2)} seconds.`);

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is missing. Add it to your environment before transcribing.");
    }

    await updateSermonStatus(sermon.id, "TRANSCRIBING");

	    const languageHint = buildTranscriptionLanguageHint(sermon.language, {
	      sermonTitle: sermon.title,
	      speakerName: sermon.speakerName,
	      churchName: sermon.churchName,
	    });
    if (languageHint) {
      await appendPipelineLog(
        sermon.id,
        `Using sermon language hint for transcription: ${languageHint.intendedLanguage}${languageHint.openAiLanguage ? ` (${languageHint.openAiLanguage})` : ""}.`,
      );
    }

	    const sermonWindow = {
	      sermonStartSeconds: sermon.sermonStartSeconds,
	      sermonEndSeconds: sermon.sermonEndSeconds,
	      analyzeFullRecording: sermon.analyzeFullRecording,
	      knownDurationSeconds: sermon.sourceDurationSeconds,
	    };
	    const expectedTranscriptDurationSeconds = resolveExpectedTranscriptDurationSeconds(
	      sermonWindow,
	      audioReadiness.durationSeconds,
	    );
	    const manualTranscriptionWindow = resolveManualTranscriptionWindow(sermonWindow, audioReadiness.durationSeconds);
	    const transcriptionInput: TranscriptionAudioInput = manualTranscriptionWindow
	      ? await (async () => {
	          await checkFfmpegInstalled();
	          const transcriptDir = path.join(getSermonStoragePath(sermon.id), "transcript");
	          await mkdir(transcriptDir, { recursive: true });
	          const windowedAudioPath = path.join(transcriptDir, "sermon-window-audio.mp3");
	          await runFfmpegWindowedAudio(sermon.id, audioPath, windowedAudioPath, manualTranscriptionWindow);
	          const windowedReadiness = await assessAudioFileReadinessForTranscription(windowedAudioPath);
	          if (!windowedReadiness.ready) {
	            throw new Error(`Windowed transcription audio is not usable: ${windowedReadiness.reason}`);
	          }
	          await appendPipelineLog(
	            sermon.id,
	            `Using selected sermon window for transcription (${Math.round(manualTranscriptionWindow.durationSeconds / 60)} minutes instead of ${Math.round(audioReadiness.durationSeconds / 60)} minutes).`,
	          );
	          return {
	            audioPath: windowedAudioPath,
	            timelineOffsetSeconds: manualTranscriptionWindow.startTimeSeconds,
	            description: "selected sermon window",
	          };
	        })()
	      : {
	          audioPath,
	          timelineOffsetSeconds: 0,
	          description: "full recording",
	        };
	    const fileInfo = await stat(transcriptionInput.audioPath);
	    const shouldUseChunking = fileInfo.size > OPENAI_UPLOAD_LIMIT_BYTES;

	    if (shouldUseChunking) {
	      await appendPipelineLog(
	        sermon.id,
	        `${transcriptionInput.description} audio size ${fileInfo.size} bytes exceeds direct upload limit ${OPENAI_UPLOAD_LIMIT_BYTES} bytes. Using chunked transcription.`,
	      );
	    }
	    const attempts: AssessedTranscriptAttempt[] = [];

	    const originalRawTranscript = validateNormalizedTranscript(
	      shouldUseChunking
	        ? await transcribeAudioWithChunking(
	            sermon.id,
	            transcriptionInput.audioPath,
	            languageHint,
	            transcriptionInput.timelineOffsetSeconds,
	          )
	        : offsetTranscriptTimeline(
	            await transcribeAudioWithOpenAI(transcriptionInput.audioPath, {
	              language: languageHint?.openAiLanguage,
	              prompt: languageHint?.prompt,
	              onRetry: buildOpenAITranscriptionRetryLogger(sermon.id, transcriptionInput.description),
	            }),
	            transcriptionInput.timelineOffsetSeconds,
	          ),
	    );
    const originalTranscript = cleanupTranscriptForClipping(originalRawTranscript);
    const originalRemovedSegments = originalRawTranscript.segments.length - originalTranscript.segments.length;
    if (originalRemovedSegments > 0) {
      await appendJobLog(job.id, `Cleaned ${originalRemovedSegments} noisy or duplicate transcript segment(s) from the original transcription attempt.`);
    }
    const originalWindowed = applyClippingWindowToTranscript(originalTranscript, sermonWindow);
    const originalExpectedDurationSeconds = originalWindowed.inferredWindow
      ? originalWindowed.inferredWindow.durationSeconds
      : expectedTranscriptDurationSeconds;
    if (originalWindowed.inferredWindow) {
      await appendJobLog(
        job.id,
        `Auto-detected sermon window for transcription quality: ${Math.round(originalWindowed.inferredWindow.startTimeSeconds)}-${Math.round(originalWindowed.inferredWindow.endTimeSeconds)}s. ${originalWindowed.inferredWindow.reason}`,
      );
    }
    const originalQuality = assessTranscriptQualityForClipping(originalWindowed.transcript.segments);
    attempts.push({
      source: "original",
      audioPath,
      transcript: originalTranscript,
      windowed: originalWindowed,
      quality: originalQuality,
      expectedDurationSeconds: originalExpectedDurationSeconds,
    });

    if (
      speechEnhancedRetryEnabled() &&
      shouldRetryWithSpeechEnhancedAudio(originalQuality, { expectedDurationSeconds: originalExpectedDurationSeconds })
    ) {
	      const enhancedAudioPath = path.join(getSermonStoragePath(sermon.id), "transcript", SPEECH_ENHANCED_AUDIO_NAME);
	      await appendJobLog(
	        job.id,
	        originalQuality.ready
	          ? `Initial transcript is clipping-ready but has quality warning(s) (${originalQuality.warnings.join(", ")}). Retrying once with speech-enhanced audio for a better transcript.`
          : `Initial transcript was not ready for clipping (${originalQuality.reason}). Retrying once with speech-enhanced audio.`,
      );

	      try {
	        await checkFfmpegInstalled();
	        await runFfmpegSpeechEnhancement(sermon.id, transcriptionInput.audioPath, enhancedAudioPath);
	        const enhancedInfo = await stat(enhancedAudioPath);
	        const enhancedRawTranscript = validateNormalizedTranscript(
	          enhancedInfo.size > OPENAI_UPLOAD_LIMIT_BYTES
	            ? await transcribeAudioWithChunking(
	                sermon.id,
	                enhancedAudioPath,
	                languageHint,
	                transcriptionInput.timelineOffsetSeconds,
	              )
	            : offsetTranscriptTimeline(
	                await transcribeAudioWithOpenAI(enhancedAudioPath, {
	                  language: languageHint?.openAiLanguage,
	                  prompt: languageHint?.prompt,
	                  onRetry: buildOpenAITranscriptionRetryLogger(
	                    sermon.id,
	                    `speech-enhanced ${transcriptionInput.description}`,
	                  ),
	                }),
	                transcriptionInput.timelineOffsetSeconds,
	              ),
	        );
        const enhancedTranscript = cleanupTranscriptForClipping(enhancedRawTranscript);
        const enhancedRemovedSegments = enhancedRawTranscript.segments.length - enhancedTranscript.segments.length;
        if (enhancedRemovedSegments > 0) {
          await appendJobLog(job.id, `Cleaned ${enhancedRemovedSegments} noisy or duplicate transcript segment(s) from the speech-enhanced transcription attempt.`);
        }
        const enhancedWindowed = applyClippingWindowToTranscript(enhancedTranscript, sermonWindow);
        const enhancedExpectedDurationSeconds = enhancedWindowed.inferredWindow
          ? enhancedWindowed.inferredWindow.durationSeconds
          : expectedTranscriptDurationSeconds;
        if (enhancedWindowed.inferredWindow) {
          await appendJobLog(
            job.id,
            `Auto-detected sermon window for speech-enhanced transcript: ${Math.round(enhancedWindowed.inferredWindow.startTimeSeconds)}-${Math.round(enhancedWindowed.inferredWindow.endTimeSeconds)}s. ${enhancedWindowed.inferredWindow.reason}`,
          );
        }
        const enhancedQuality = assessTranscriptQualityForClipping(enhancedWindowed.transcript.segments);
        attempts.push({
          source: "speech_enhanced",
          audioPath: enhancedAudioPath,
          transcript: enhancedTranscript,
          windowed: enhancedWindowed,
          quality: enhancedQuality,
          expectedDurationSeconds: enhancedExpectedDurationSeconds,
        });
        await appendJobLog(
          job.id,
          `Speech-enhanced transcript readiness: ${enhancedQuality.ready ? "ready" : enhancedQuality.reason}.`,
        );
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : "Unknown speech-enhanced transcription retry error.";
        await appendJobLog(job.id, `Speech-enhanced transcription retry failed: ${retryMessage}`);
        await appendPipelineLog(sermon.id, `Speech-enhanced transcription retry failed: ${retryMessage}`);
      }
    }

    const selectedAttempt = selectBestTranscriptAttempt(attempts, {
      expectedDurationSeconds: expectedTranscriptDurationSeconds,
    });
    const normalizedTranscript = selectedAttempt.transcript;
    const transcriptWindowed = selectedAttempt.windowed;
    const transcriptQuality = selectedAttempt.quality;
    const selectedExpectedDurationSeconds = selectedAttempt.expectedDurationSeconds ?? expectedTranscriptDurationSeconds;
    const degradedTranscriptUsable = isDegradedTranscriptUsableForLocalMultilingualClipping(transcriptQuality, languageHint);

    if (!transcriptQuality.ready && !degradedTranscriptUsable) {
      throw new Error(
        `Transcript is not reliable enough for pastor-grade clip selection: ${transcriptQuality.reason}`,
      );
    }

    const reliabilityIssue = finalTranscriptReliabilityIssue(transcriptQuality, {
      expectedDurationSeconds: selectedExpectedDurationSeconds,
    });
    if (reliabilityIssue && !degradedTranscriptUsable) {
      throw new Error(
        `Transcript is not reliable enough for pastor-grade clip selection: ${reliabilityIssue}`,
      );
    }

    if (degradedTranscriptUsable) {
      await appendJobLog(
        job.id,
        `Saving degraded multilingual transcript for reviewable clipping: ${transcriptQuality.reason ?? reliabilityIssue ?? "quality warnings remain"}.`,
      );
      await appendPipelineLog(
        sermon.id,
        `Saving degraded multilingual transcript with ${transcriptQuality.wordCount} words and ${transcriptQuality.meaningfulSegmentCount} meaningful segments.`,
      );
    }

    const storedTranscriptLanguage = languageHint && usesLocalMultilingualLanguageHint(languageHint)
      ? languageHint.intendedLanguage
      : transcriptWindowed.transcript.language ?? "unknown";

    const rawPayload = {
      transcriptionConfigurationKey: transcriptionConfigurationKey(),
      provider: normalizedTranscript.provider,
      model: normalizedTranscript.model,
      language: storedTranscriptLanguage,
      providerDetectedLanguage: transcriptWindowed.transcript.language ?? null,
      fullText: transcriptWindowed.transcript.fullText,
      segmentCount: transcriptWindowed.transcript.segments.length,
      chunking: {
        implemented: true,
        used: shouldUseChunking,
      },
      selectedTranscriptionAttempt: selectedAttempt.source,
      transcriptionAttempts: attempts.map((attempt) => ({
        source: attempt.source,
        audioPath: attempt.audioPath,
        readyForClipping: attempt.quality.ready,
        reason: attempt.quality.reason,
        wordCount: attempt.quality.wordCount,
        meaningfulSegmentCount: attempt.quality.meaningfulSegmentCount,
        durationSeconds: attempt.quality.durationSeconds,
        coverageRatio: attempt.quality.coverageRatio,
        wordsPerMinute: attempt.quality.wordsPerMinute,
        maxGapSeconds: attempt.quality.maxGapSeconds,
        largeGapCount: attempt.quality.largeGapCount,
        repeatedSegmentRatio: attempt.quality.repeatedSegmentRatio,
        repeatedPhraseRatio: attempt.quality.repeatedPhraseRatio,
        maxSegmentDurationSeconds: attempt.quality.maxSegmentDurationSeconds,
        averageSegmentDurationSeconds: attempt.quality.averageSegmentDurationSeconds,
        coarseSegmentRatio: attempt.quality.coarseSegmentRatio,
        sermonTokenCoverageRatio: attempt.quality.sermonTokenCoverageRatio,
        distinctSermonTokenCount: attempt.quality.distinctSermonTokenCount,
        distinctSermonTokenRatio: attempt.quality.distinctSermonTokenRatio,
        qualityScore: transcriptQualityScore(attempt.quality),
        inferredSermonWindow: attempt.windowed.inferredWindow ?? null,
        expectedDurationSeconds: attempt.expectedDurationSeconds ?? expectedTranscriptDurationSeconds,
        expectedDurationCoverageRatio: (attempt.expectedDurationSeconds ?? expectedTranscriptDurationSeconds)
          ? Number((attempt.quality.durationSeconds / (attempt.expectedDurationSeconds ?? expectedTranscriptDurationSeconds)!).toFixed(3))
          : null,
      })),
      languageHint: languageHint
        ? {
            intendedLanguage: languageHint.intendedLanguage,
            openAiLanguage: languageHint.openAiLanguage ?? null,
          }
        : null,
      sermonSegmentWindowApplied: transcriptWindowed.applied,
      inferredSermonSegmentWindow: transcriptWindowed.inferredWindow ?? null,
      quality: {
        readyForClipping: transcriptQuality.ready,
        degradedButUsable: degradedTranscriptUsable,
        reason: transcriptQuality.reason,
        reliabilityIssue,
        warnings: transcriptQuality.warnings,
        wordCount: transcriptQuality.wordCount,
        meaningfulSegmentCount: transcriptQuality.meaningfulSegmentCount,
        durationSeconds: transcriptQuality.durationSeconds,
        coverageRatio: transcriptQuality.coverageRatio,
        wordsPerMinute: transcriptQuality.wordsPerMinute,
        maxGapSeconds: transcriptQuality.maxGapSeconds,
        largeGapCount: transcriptQuality.largeGapCount,
        repeatedSegmentRatio: transcriptQuality.repeatedSegmentRatio,
        repeatedPhraseRatio: transcriptQuality.repeatedPhraseRatio,
        maxSegmentDurationSeconds: transcriptQuality.maxSegmentDurationSeconds,
        averageSegmentDurationSeconds: transcriptQuality.averageSegmentDurationSeconds,
        coarseSegmentRatio: transcriptQuality.coarseSegmentRatio,
        sermonTokenCoverageRatio: transcriptQuality.sermonTokenCoverageRatio,
        distinctSermonTokenCount: transcriptQuality.distinctSermonTokenCount,
        distinctSermonTokenRatio: transcriptQuality.distinctSermonTokenRatio,
        expectedDurationSeconds: selectedExpectedDurationSeconds,
        expectedDurationCoverageRatio: selectedExpectedDurationSeconds
          ? Number((transcriptQuality.durationSeconds / selectedExpectedDurationSeconds).toFixed(3))
          : null,
      },
      raw: normalizedTranscript.raw,
    };

    await writeTranscriptJsonAtomically(transcriptJsonPath, rawPayload);

    await replaceTranscriptRecords({
      sermonId: sermon.id,
      fullText: transcriptWindowed.transcript.fullText,
      provider: normalizedTranscript.provider,
      language: storedTranscriptLanguage,
      transcriptJsonPath,
      segments: transcriptWindowed.transcript.segments,
    });

    await markSermonTranscribedUnlessAdvanced(sermon.id);
    await markJobSucceeded(
      job.id,
      `Transcription saved with ${transcriptWindowed.transcript.segments.length} timestamped segments. Readiness: ${
        degradedTranscriptUsable ? "degraded multilingual transcript saved for review" : transcriptQuality.ready ? "ready for clipping" : transcriptQuality.reason
      }.`,
    );
    await appendPipelineLog(
      sermon.id,
      `Transcription completed with ${transcriptWindowed.transcript.segments.length} segments, ${transcriptQuality.wordCount} words, ${Math.round(transcriptQuality.durationSeconds)} seconds, ${Math.round(transcriptQuality.coverageRatio * 100)}% coverage.`,
    );

    return { transcriptJsonPath, reusedExistingTranscript: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown transcription error.";
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    await markJobFailed(job.id, message, "Transcription failed.", {
      error,
      code: code || "TRANSCRIPTION_FAILED",
      stage: code === "INVALID_SERMON_STATUS_TRANSITION"
        ? "sermon_status_transition"
        : "transcription",
      retryable: code !== "INVALID_SERMON_STATUS_TRANSITION",
      details: {
        forceRequested: options?.force === true,
      },
    });

    try {
      await updateSermonStatus(sermon.id, "FAILED");
    } catch (statusError) {
      const statusMessage = statusError instanceof Error ? statusError.message : "Unknown status error.";
      await appendPipelineLog(sermon.id, `Status update to FAILED skipped: ${statusMessage}`);
    }

    await appendPipelineLog(sermon.id, `Transcription failed: ${message}`);
    throw error instanceof Error ? error : new Error(message);
  }
}

export const __transcriptionTestUtils = {
  applySermonSegmentWindowToTranscript,
  applyClippingWindowToTranscript,
  assessAudioFileReadinessForTranscription,
  assessTranscriptQualityForClipping,
  assessReusableTranscriptForClipping,
  buildTranscriptionLanguageHint,
  buildChunkTranscriptionPrompt,
  buildChunkTranscriptCachePath,
  buildChunkTranscriptCachePayload,
  buildTranscriptSegmentRecord,
  buildSpeechEnhancedAudioArgs,
  buildCumulativeChunkTimelineOffsets,
  buildSilenceAwareChunkSpecs,
  cleanupTranscriptForClipping,
  getChunkTimelineOffsetSeconds,
  getTranscriptTail,
  mergeChunkTranscriptSegments,
  normalizeTranscriptTextForCleanup,
  offsetChunkTranscriptSegments,
  offsetTranscriptTimeline,
  readCachedChunkTranscript,
  resolveChunkWorkingDirectories,
  resolveExpectedTranscriptDurationSeconds,
  resolveTranscriptionChunkDurationSeconds,
  resolveManualTranscriptionWindow,
  selectBestTranscriptAttempt,
  finalTranscriptReliabilityIssue,
  isDegradedTranscriptUsableForLocalMultilingualClipping,
  isTranscriptReliableEnoughForClipping,
  shouldRetryWithSpeechEnhancedAudio,
  speechEnhancedRetryEnabled,
  transcriptQualityScore,
  replaceTranscriptRecords,
  writeCachedChunkTranscript,
  writeTranscriptJsonAtomically,
};
