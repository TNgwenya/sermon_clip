import OpenAI from "openai";
import { ZodError } from "zod";

import { prisma } from "@/lib/prisma";
import {
  appendJobLog,
  createProcessingJob,
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
} from "@/server/agents/processing";
import {
  buildClipRepairPrompt,
  buildClipSelectionSystemPrompt,
  buildClipSelectionUserPrompt,
} from "@/server/ai/clipPrompt";
import {
  clipJsonCandidateSchema,
  clipJsonResponseSchema,
  type ClipJsonCandidate,
} from "@/server/ai/clipJsonSchema";
import { generateMinistryMoments } from "@/server/agents/ministryMomentService";
import {
  refineClipBoundaries,
  TARGET_MAX_DURATION_SECONDS,
  TARGET_MIN_DURATION_SECONDS,
  type BoundaryRefinedFields,
} from "@/server/agents/clipBoundaryRefinement";
import { type MinistryMomentRecord as PromptMinistryMomentRecord } from "@/server/ai/ministryMomentSchema";
import { appendPipelineLog } from "@/server/agents/storage";
import { updateSermonStatus } from "@/server/status/sermonStatus";

export type ClipWindow = {
  windowId: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  transcriptText: string;
  segments: Array<TranscriptSegmentRecord & { segmentIndex: number }>;
  segmentLines: string[];
  wordCount: number;
  meaningfulSegmentCount: number;
  openingHookScore?: number;
  ministryPayoffScore?: number;
  windowQualityScore: number;
  windowQualityWarnings: string[];
};

type GenerateClipOptions = {
  force?: boolean;
  targetCategory?: string;
  responseOverride?: string;
  repairResponseOverride?: string;
};

type SermonContext = {
  id: string;
  title: string;
  speakerName: string;
  churchName: string;
  language: string;
};

type ClipPromptIntelligenceContext = {
  title?: string | null;
  summary?: string | null;
  centralTheme?: string | null;
  shortOverview?: string | null;
  keyTakeaways?: string[] | null;
  scriptures?: Array<{ reference: string; usageType: string; isPrimary?: boolean }>;
  topics?: Array<{ topic: string }>;
  structureSections?: Array<{ sectionType: string; title?: string | null; description?: string | null }>;
};

type MinistryMomentRecord = {
  id: string;
  momentType: string;
  title: string;
  description: string;
  startTimeSeconds: number | null;
  endTimeSeconds: number | null;
  confidenceScore: number;
  transcriptExcerpt: string | null;
  whyDetected: string | null;
  suggestedAudience: string | null;
  suggestedUsage: string | null;
  clipCategory: string | null;
};

type TranscriptSegmentRecord = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

const MODEL_NAME = "gpt-4o-mini";
const WINDOW_STEP_SECONDS = 60;
const MIN_WINDOW_SECONDS = 30;
const MAX_WINDOW_SECONDS = 90;
const BATCH_SIZE = 4;
const MAX_BATCH_CLIPS = 3;

type ValidatedClipBatch = {
  candidates: ClipJsonCandidate[];
  repairUsed: boolean;
  rejectedReasons: string[];
};

type CandidateScopeResult = {
  candidates: ClipJsonCandidate[];
  rejectedReasons: string[];
  formatWarnings: string[];
};

type BoundaryAdjustedCandidate = ClipJsonCandidate & BoundaryRefinedFields;

type EnrichedClipCandidate = BoundaryAdjustedCandidate & {
  ministryMomentId?: string | null;
  smartClipCategory: string;
  intendedAudience: string;
  ministryValue: string;
  socialValue: string;
  suggestedHook?: string;
  suggestedCaption?: string;
  recommendationConfidence?: number;
};

function getOpenAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing. Add it to your environment before generating clips.");
  }

  return new OpenAI({ apiKey });
}

function formatSegmentLine(segment: TranscriptSegmentRecord): string {
  return `[${segment.startTimeSeconds.toFixed(1)} - ${segment.endTimeSeconds.toFixed(1)}] ${segment.text.trim()}`;
}

function countTranscriptWords(text: string): number {
  return (text.match(/[A-Za-z0-9']+/g) ?? []).length;
}

function normalizeMomentText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function overlapDuration(
  startA: number | null,
  endA: number | null,
  startB: number,
  endB: number,
): number {
  if (startA === null || endA === null) {
    return 0;
  }

  const overlapStart = Math.max(startA, startB);
  const overlapEnd = Math.min(endA, endB);
  return Math.max(0, overlapEnd - overlapStart);
}

export function matchMinistryMoment(candidate: ClipJsonCandidate, moments: MinistryMomentRecord[]): MinistryMomentRecord | null {
  if (moments.length === 0) {
    return null;
  }

  const categoryMatch = moments.find((moment) => normalizeMomentText(moment.clipCategory) === normalizeMomentText(candidate.smartClipCategory));
  if (categoryMatch) {
    return categoryMatch;
  }

  const typeMatch = moments.find((moment) => normalizeMomentText(moment.momentType) === normalizeMomentText(candidate.ministryMomentType));
  if (typeMatch) {
    return typeMatch;
  }

  const scored = moments
    .map((moment) => ({
      moment,
      overlap: overlapDuration(moment.startTimeSeconds, moment.endTimeSeconds, candidate.startTimeSeconds, candidate.endTimeSeconds),
    }))
    .sort((left, right) => right.overlap - left.overlap);

  return scored[0]?.overlap ? scored[0].moment : null;
}

export function enrichCandidate(candidate: BoundaryAdjustedCandidate, moments: MinistryMomentRecord[]): EnrichedClipCandidate {
  const matchedMoment = matchMinistryMoment(candidate, moments);

  return {
    ...candidate,
    ministryMomentId: matchedMoment?.id ?? null,
    smartClipCategory: candidate.smartClipCategory,
    intendedAudience: candidate.intendedAudience,
    ministryValue: candidate.ministryValue,
    socialValue: candidate.socialValue,
    suggestedHook: candidate.suggestedHook,
    suggestedCaption: candidate.suggestedCaption,
    recommendationConfidence: candidate.score / 10,
  };
}

function buildRollingWindows(segments: TranscriptSegmentRecord[]): ClipWindow[] {
  if (segments.length === 0) {
    return [];
  }

  const windows: ClipWindow[] = [];
  let startIndex = 0;

  while (startIndex < segments.length) {
    const startSegment = segments[startIndex];
    let endIndex = startIndex;

    while (
      endIndex < segments.length - 1 &&
      segments[endIndex + 1].endTimeSeconds - startSegment.startTimeSeconds <= MAX_WINDOW_SECONDS
    ) {
      endIndex += 1;
    }

    while (
      endIndex > startIndex &&
      segments[endIndex].endTimeSeconds - startSegment.startTimeSeconds > MAX_WINDOW_SECONDS
    ) {
      endIndex -= 1;
    }

    const durationSeconds = segments[endIndex].endTimeSeconds - startSegment.startTimeSeconds;
    if (durationSeconds >= MIN_WINDOW_SECONDS && durationSeconds <= MAX_WINDOW_SECONDS) {
      const windowSegments = segments
        .slice(startIndex, endIndex + 1)
        .map((segment, segmentIndex) => ({ ...segment, segmentIndex }));
      const transcriptText = windowSegments.map((segment) => segment.text.trim()).join(" ");
      const wordCount = countTranscriptWords(transcriptText);
      windows.push({
        windowId: `window-${windows.length + 1}-${Math.round(startSegment.startTimeSeconds)}-${Math.round(segments[endIndex].endTimeSeconds)}`,
        startTimeSeconds: startSegment.startTimeSeconds,
        endTimeSeconds: segments[endIndex].endTimeSeconds,
        durationSeconds,
        transcriptText,
        segments: windowSegments,
        segmentLines: windowSegments.map((segment) => `${segment.segmentIndex}: ${formatSegmentLine(segment)}`),
        wordCount,
        meaningfulSegmentCount: windowSegments.filter((segment) => countTranscriptWords(segment.text) >= 4).length,
        windowQualityScore: Math.min(10, Math.max(1, Math.round(wordCount / 12))),
        windowQualityWarnings: [],
      });
    }

    const nextStartTime = startSegment.startTimeSeconds + WINDOW_STEP_SECONDS;
    const nextIndex = segments.findIndex(
      (segment, index) => index > startIndex && segment.startTimeSeconds >= nextStartTime,
    );

    if (nextIndex === -1) {
      break;
    }

    startIndex = nextIndex;
  }

  return windows;
}

function chunkWindows(windows: ClipWindow[]): ClipWindow[][] {
  const batches: ClipWindow[][] = [];
  for (let index = 0; index < windows.length; index += BATCH_SIZE) {
    batches.push(windows.slice(index, index + BATCH_SIZE));
  }
  return batches;
}

function extractJsonObject(rawResponse: string): string {
  const trimmed = rawResponse.trim();
  if (!trimmed) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function formatClipParseError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "root";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown clip response validation error.";
}

function tryParseClipResponse(rawResponse: string): ClipJsonCandidate[] {
  const parsed = JSON.parse(extractJsonObject(rawResponse)) as unknown;
  return clipJsonResponseSchema.parse(parsed).clips;
}

function parseCandidateArray(rawResponse: string): unknown[] {
  const parsed = JSON.parse(extractJsonObject(rawResponse)) as unknown;
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { clips?: unknown }).clips)) {
    throw new Error("Response must be a JSON object with a clips array.");
  }

  return (parsed as { clips: unknown[] }).clips;
}

function validateCandidatesIndividually(rawResponse: string): ValidatedClipBatch {
  const rawCandidates = parseCandidateArray(rawResponse);
  const candidates: ClipJsonCandidate[] = [];
  const rejectedReasons: string[] = [];

  for (const [index, candidate] of rawCandidates.entries()) {
    const result = clipJsonCandidateSchema.safeParse(candidate);
    if (result.success) {
      candidates.push(result.data);
      continue;
    }

    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "root";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    rejectedReasons.push(`clips.${index}: ${details}`);
  }

  return {
    candidates,
    repairUsed: false,
    rejectedReasons,
  };
}

async function callClipModel(
  sermon: SermonContext,
  batch: ClipWindow[],
  options?: {
    rawResponseOverride?: string;
    repairResponseOverride?: string;
    context?: {
      intelligence?: ClipPromptIntelligenceContext;
      ministryMoments?: PromptMinistryMomentRecord[];
    };
  },
): Promise<ValidatedClipBatch> {
  const systemPrompt = buildClipSelectionSystemPrompt();
  const userPrompt = buildClipSelectionUserPrompt(sermon, batch, MAX_BATCH_CLIPS, options?.context);

  const rawResponse = options?.rawResponseOverride ?? (await (async () => {
    const client = getOpenAiClient();
    const completion = await client.chat.completions.create({
      model: MODEL_NAME,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    return completion.choices[0]?.message?.content ?? "";
  })());

  try {
    const candidates = tryParseClipResponse(rawResponse);
    return {
      candidates,
      repairUsed: false,
      rejectedReasons: [],
    };
  } catch (error) {
    const validationError = formatClipParseError(error);
    const repaired = options?.repairResponseOverride ?? (await (async () => {
      const client = getOpenAiClient();
      const repairCompletion = await client.chat.completions.create({
        model: MODEL_NAME,
        response_format: { type: "json_object" },
        temperature: 0,
        messages: [
          { role: "system", content: buildClipSelectionSystemPrompt() },
          { role: "user", content: buildClipRepairPrompt(rawResponse, validationError, batch) },
        ],
      });

      return repairCompletion.choices[0]?.message?.content ?? "";
    })());

    try {
      const candidates = tryParseClipResponse(repaired);
      return {
        candidates,
        repairUsed: true,
        rejectedReasons: [],
      };
    } catch (repairError) {
      const fallback = validateCandidatesIndividually(repaired);
      if (fallback.candidates.length > 0) {
        return {
          ...fallback,
          repairUsed: true,
        };
      }

      const repairDetails = formatClipParseError(repairError);
      throw new Error(`Clip AI response was invalid after one repair attempt. Initial issue: ${validationError}. Repair issue: ${repairDetails}`);
    }
  }
}

function dedupeCandidates<T extends ClipJsonCandidate>(candidates: T[]): T[] {
  const sorted = [...candidates].sort((left, right) => right.score - left.score);
  const deduped: T[] = [];

  for (const candidate of sorted) {
    const overlapsExisting = deduped.some((existing) => {
      const overlapStart = Math.max(existing.startTimeSeconds, candidate.startTimeSeconds);
      const overlapEnd = Math.min(existing.endTimeSeconds, candidate.endTimeSeconds);
      const overlap = Math.max(0, overlapEnd - overlapStart);
      const shorter = Math.min(existing.durationSeconds, candidate.durationSeconds);
      return shorter > 0 && overlap / shorter >= 0.5;
    });

    if (!overlapsExisting) {
      deduped.push(candidate);
    }
  }

  return deduped;
}

function candidateHasIndexedBoundary(candidate: ClipJsonCandidate): candidate is ClipJsonCandidate & {
  windowId: string;
  startSegmentIndex: number;
  endSegmentIndex: number;
} {
  return (
    typeof candidate.windowId === "string" &&
    typeof candidate.startSegmentIndex === "number" &&
    typeof candidate.endSegmentIndex === "number"
  );
}

function candidateHasLegacyBoundary(candidate: ClipJsonCandidate): boolean {
  return (
    typeof candidate.startTimeSeconds === "number" &&
    typeof candidate.endTimeSeconds === "number" &&
    typeof candidate.durationSeconds === "number" &&
    typeof candidate.transcriptText === "string" &&
    candidate.transcriptText.trim().length > 0
  );
}

function isCandidateInsideBatch(candidate: ClipJsonCandidate, windows: ClipWindow[]): boolean {
  const toleranceSeconds = 0.5;
  return windows.some((window) => (
    candidate.startTimeSeconds >= window.startTimeSeconds - toleranceSeconds &&
    candidate.endTimeSeconds <= window.endTimeSeconds + toleranceSeconds
  ));
}

function filterCandidatesToPromptWindows(
  candidates: ClipJsonCandidate[],
  windows: ClipWindow[],
): CandidateScopeResult {
  const scoped: ClipJsonCandidate[] = [];
  const rejectedReasons: string[] = [];
  const formatWarnings: string[] = [];

  for (const [index, candidate] of candidates.entries()) {
    if (candidateHasIndexedBoundary(candidate)) {
      const window = windows.find((item) => item.windowId === candidate.windowId);
      if (!window) {
        rejectedReasons.push(`OUTSIDE_BATCH clips.${index}: unknown or cross-batch windowId ${candidate.windowId}.`);
        continue;
      }

      const startSegment = window.segments[candidate.startSegmentIndex];
      const endSegment = window.segments[candidate.endSegmentIndex];
      if (!startSegment || !endSegment || endSegment.segmentIndex < startSegment.segmentIndex) {
        rejectedReasons.push(
          `INVALID_SEGMENT_INDEX clips.${index}: segment indexes ${candidate.startSegmentIndex}-${candidate.endSegmentIndex} are outside ${window.windowId}.`,
        );
        continue;
      }

      if (candidateHasLegacyBoundary(candidate)) {
        if (
          Math.abs(candidate.startTimeSeconds - startSegment.startTimeSeconds) > 1 ||
          Math.abs(candidate.endTimeSeconds - endSegment.endTimeSeconds) > 1
        ) {
          formatWarnings.push(`INDEX_TIMESTAMP_DISAGREEMENT clips.${index}: indexes won over supplied timestamps.`);
        }

        const indexedText = window.segments
          .slice(candidate.startSegmentIndex, candidate.endSegmentIndex + 1)
          .map((segment) => segment.text.trim())
          .join(" ");
        if (indexedText.trim() && indexedText.trim() !== candidate.transcriptText.trim()) {
          formatWarnings.push(`INDEX_TRANSCRIPT_DISAGREEMENT clips.${index}: indexes won over supplied transcriptText.`);
        }
      }

      const selectedSegments = window.segments.slice(candidate.startSegmentIndex, candidate.endSegmentIndex + 1);
      const startTimeSeconds = startSegment.startTimeSeconds;
      const endTimeSeconds = endSegment.endTimeSeconds;
      scoped.push({
        ...candidate,
        startTimeSeconds,
        endTimeSeconds,
        durationSeconds: Number((endTimeSeconds - startTimeSeconds).toFixed(2)),
        transcriptText: selectedSegments.map((segment) => segment.text.trim()).join(" "),
      });
      continue;
    }

    if (!candidateHasLegacyBoundary(candidate)) {
      rejectedReasons.push(`MISSING_BOUNDARY clips.${index}: candidate has no usable indexed or timestamp boundary.`);
      continue;
    }

    if (!isCandidateInsideBatch(candidate, windows)) {
      rejectedReasons.push(
        `OUTSIDE_BATCH clips.${index}: timestamps ${candidate.startTimeSeconds}-${candidate.endTimeSeconds}s sit outside the transcript windows provided to this AI batch.`,
      );
      continue;
    }

    scoped.push(candidate);
  }

  return { candidates: scoped, rejectedReasons, formatWarnings };
}

export function shouldPreserveClipDuringRegeneration(clip: { status: string; isManuallyEdited?: boolean }): boolean {
  return clip.status !== "SUGGESTED" || clip.isManuallyEdited === true;
}

export function shouldReuseExistingSuggestions(existingSuggestionCount: number, force?: boolean): boolean {
  return existingSuggestionCount > 0 && !force;
}

export function buildSuggestionDeleteWhere(sermonId: string, targetCategory?: string) {
  return {
    sermonId,
    status: "SUGGESTED" as const,
    isAiGenerated: true,
    isManuallyEdited: false,
    ...(targetCategory ? { smartClipCategory: targetCategory } : {}),
  };
}

function normalizeCandidate(candidate: ClipJsonCandidate): ClipJsonCandidate {
  const durationSeconds = Number((candidate.endTimeSeconds - candidate.startTimeSeconds).toFixed(2));
  return {
    ...candidate,
    durationSeconds,
    transcriptText: (candidate.transcriptText ?? "").trim(),
    title: (candidate.title ?? "").trim(),
    hook: (candidate.hook ?? "").trim(),
    caption: (candidate.caption ?? "").trim(),
    reasonSelected: (candidate.reasonSelected ?? "").trim(),
    hashtags: Array.isArray(candidate.hashtags) ? candidate.hashtags.map((tag) => tag.trim()).filter(Boolean) : [],
    riskReasons: Array.isArray(candidate.riskReasons)
      ? candidate.riskReasons.map((reason) => reason.trim()).filter(Boolean)
      : [],
  };
}

export async function generateClipSuggestions(
  sermonId: string,
  options?: GenerateClipOptions,
): Promise<{ clipCount: number; reusedExistingSuggestions: boolean }> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      title: true,
      speakerName: true,
      churchName: true,
      language: true,
    },
  });

  if (!sermon) {
    throw new Error(`Sermon ${sermonId} was not found.`);
  }

  const job = await createProcessingJob(sermon.id, "GENERATE_CLIPS");

  try {
    await markJobRunning(job.id);
    await appendJobLog(job.id, "Clip suggestion job started.");
    await appendPipelineLog(sermon.id, "Clip suggestion generation requested.");
    await updateSermonStatus(sermon.id, "GENERATING_CLIPS");

    const segments = await prisma.transcriptSegment.findMany({
      where: { sermonId: sermon.id },
      orderBy: { startTimeSeconds: "asc" },
      select: {
        startTimeSeconds: true,
        endTimeSeconds: true,
        text: true,
      },
    });

    if (segments.length === 0) {
      throw new Error("Cannot generate clip suggestions because no transcript segments exist.");
    }

    const momentsCount = await prisma.ministryMoment.count({ where: { sermonId: sermon.id, isAiGenerated: true } });
    if (momentsCount === 0 || options?.force) {
      try {
        const momentResult = await generateMinistryMoments(sermon.id, { force: options?.force });
        await appendJobLog(job.id, `Ministry moments ${momentResult.reusedExistingMoments ? "reused" : "refreshed"}: ${momentResult.momentCount}.`);
      } catch (momentError) {
        const momentMessage = momentError instanceof Error ? momentError.message : "Unknown ministry moment error.";
        await appendJobLog(job.id, `Ministry moment detection failed: ${momentMessage}`);
      }
    }

    const clipContext = await prisma.sermon.findUnique({
      where: { id: sermon.id },
      select: {
        intelligence: {
          select: {
            generatedTitle: true,
            summary: true,
            centralTheme: true,
            shortOverview: true,
            keyTakeaways: true,
          },
        },
        scriptureRefs: {
          select: { reference: true, usageType: true, isPrimary: true },
        },
        structureSections: {
          select: { sectionType: true, title: true, description: true },
          orderBy: { orderIndex: "asc" },
        },
        topicTags: {
          select: { topic: true },
        },
      },
    });

    const ministryMoments = await prisma.ministryMoment.findMany({
      where: { sermonId: sermon.id, isAiGenerated: true },
      orderBy: [{ confidenceScore: "desc" }, { startTimeSeconds: "asc" }],
      select: {
        id: true,
        momentType: true,
        title: true,
        description: true,
        startTimeSeconds: true,
        endTimeSeconds: true,
        confidenceScore: true,
        transcriptExcerpt: true,
        whyDetected: true,
        suggestedAudience: true,
        suggestedUsage: true,
        clipCategory: true,
      },
    });

    const existingSuggestionCount = await prisma.clipCandidate.count({
      where: {
        sermonId: sermon.id,
        status: "SUGGESTED",
        isAiGenerated: true,
        isManuallyEdited: false,
        ...(options?.targetCategory ? { smartClipCategory: options.targetCategory } : {}),
      },
    });

    if (shouldReuseExistingSuggestions(existingSuggestionCount, options?.force)) {
      await updateSermonStatus(sermon.id, "CLIPS_GENERATED");
      await markJobSucceeded(job.id, "Existing clip suggestions reused; skipped AI call.");
      await appendPipelineLog(sermon.id, "Existing clip suggestions reused; skipped AI call.");
      return { clipCount: existingSuggestionCount, reusedExistingSuggestions: true };
    }

    const windows = buildRollingWindows(segments);
    if (windows.length === 0) {
      throw new Error("Unable to build transcript windows suitable for clip generation.");
    }

    const sermonContext: SermonContext = {
      id: sermon.id,
      title: sermon.title,
      speakerName: sermon.speakerName,
      churchName: sermon.churchName,
      language: sermon.language,
    };

    const batches = chunkWindows(windows);
    const collected: ClipJsonCandidate[] = [];
    let repairUsedCount = 0;
    const rejectedReasons: string[] = [];

    for (const [index, batch] of batches.entries()) {
      await appendJobLog(job.id, `Generating clip suggestions for batch ${index + 1}/${batches.length}.`);
      const batchResult = await callClipModel(sermonContext, batch, {
        rawResponseOverride: index === 0 ? options?.responseOverride : undefined,
        repairResponseOverride: index === 0 ? options?.repairResponseOverride : undefined,
        context: clipContext
          ? {
              intelligence: {
                title: clipContext.intelligence?.generatedTitle,
                summary: clipContext.intelligence?.summary,
                centralTheme: clipContext.intelligence?.centralTheme,
                shortOverview: clipContext.intelligence?.shortOverview,
                keyTakeaways: Array.isArray(clipContext.intelligence?.keyTakeaways)
                  ? (clipContext.intelligence?.keyTakeaways as string[])
                  : [],
                scriptures: clipContext.scriptureRefs,
                topics: clipContext.topicTags,
                structureSections: clipContext.structureSections,
              },
              ministryMoments: ministryMoments.map((moment) => ({
                momentType: moment.momentType as PromptMinistryMomentRecord["momentType"],
                title: moment.title,
                description: moment.description,
                startTimeSeconds: moment.startTimeSeconds,
                endTimeSeconds: moment.endTimeSeconds,
                confidenceScore: moment.confidenceScore,
                transcriptExcerpt: moment.transcriptExcerpt ?? moment.description,
                whyDetected: moment.whyDetected ?? moment.description,
                suggestedAudience: moment.suggestedAudience ?? "General congregation",
                suggestedUsage: moment.suggestedUsage ?? "Use for sermon highlight",
                clipCategory: (moment.clipCategory ?? undefined) as PromptMinistryMomentRecord["clipCategory"],
              })),
            }
          : undefined,
      });

      if (batchResult.repairUsed) {
        repairUsedCount += 1;
      }

      if (batchResult.rejectedReasons.length > 0) {
        rejectedReasons.push(...batchResult.rejectedReasons.map((reason) => `batch ${index + 1}: ${reason}`));
        await appendJobLog(
          job.id,
          `Batch ${index + 1} rejected ${batchResult.rejectedReasons.length} invalid candidates: ${batchResult.rejectedReasons.join(" | ")}`,
        );
      }

      const scopedResult = filterCandidatesToPromptWindows(batchResult.candidates, batch);
      if (scopedResult.rejectedReasons.length > 0) {
        rejectedReasons.push(...scopedResult.rejectedReasons.map((reason) => `batch ${index + 1}: ${reason}`));
        await appendJobLog(
          job.id,
          `Batch ${index + 1} rejected ${scopedResult.rejectedReasons.length} out-of-scope candidates: ${scopedResult.rejectedReasons.join(" | ")}`,
        );
      }

      if (scopedResult.formatWarnings.length > 0) {
        await appendJobLog(
          job.id,
          `Batch ${index + 1} normalized indexed candidates: ${scopedResult.formatWarnings.join(" | ")}`,
        );
      }

      collected.push(...scopedResult.candidates.map(normalizeCandidate));
    }

    const boundaryAdjusted: EnrichedClipCandidate[] = [];
    const boundaryRejected: string[] = [];
    let boundaryAdjustedCount = 0;

    for (const [index, candidate] of collected.entries()) {
      const adjustedResult = refineClipBoundaries(candidate, segments);
      if (!adjustedResult.accepted) {
        boundaryRejected.push(`candidate ${index + 1}: ${adjustedResult.reason}`);
        continue;
      }

      if (adjustedResult.adjusted) {
        boundaryAdjustedCount += 1;
      }

      boundaryAdjusted.push(enrichCandidate(adjustedResult.candidate, ministryMoments));
    }

    const dedupedWithBoundaryFields = dedupeCandidates(boundaryAdjusted)
      .sort((left, right) => right.score - left.score);

    if (dedupedWithBoundaryFields.length === 0) {
      throw new Error("Clip generation produced no valid candidates after boundary alignment and deduplication.");
    }

    await prisma.$transaction(async (tx) => {
      if (options?.force) {
        await tx.clipCandidate.deleteMany({
          where: buildSuggestionDeleteWhere(sermon.id, options.targetCategory),
        });
      }

      await tx.clipCandidate.createMany({
        data: dedupedWithBoundaryFields.map((candidate) => ({
          sermonId: sermon.id,
          ministryMomentId: candidate.ministryMomentId ?? null,
          smartClipCategory: candidate.smartClipCategory,
          recommendationReason: candidate.reasonSelected,
          intendedAudience: candidate.intendedAudience,
          ministryValue: candidate.ministryValue,
          socialValue: candidate.socialValue,
          suggestedHook: candidate.suggestedHook ?? candidate.hook,
          suggestedCaption: candidate.suggestedCaption ?? candidate.caption,
          recommendationConfidence: candidate.recommendationConfidence ?? candidate.score / 10,
          isAiGenerated: true,
          isManuallyEdited: false,
          startTimeSeconds: candidate.startTimeSeconds,
          endTimeSeconds: candidate.endTimeSeconds,
          durationSeconds: candidate.durationSeconds,
          originalStartTimeSeconds: candidate.originalStartTimeSeconds,
          originalEndTimeSeconds: candidate.originalEndTimeSeconds,
          adjustedStartTimeSeconds: candidate.adjustedStartTimeSeconds,
          adjustedEndTimeSeconds: candidate.adjustedEndTimeSeconds,
          boundaryAdjustmentReason: candidate.boundaryAdjustmentReason,
          boundaryQuality: candidate.boundaryQuality,
          exportLayoutStrategy: "SMART_CROP",
          transcriptText: candidate.transcriptText,
          title: candidate.title,
          hook: candidate.hook,
          caption: candidate.caption,
          hashtags: candidate.hashtags,
          score: candidate.score,
          reasonSelected: candidate.reasonSelected,
          clipType: candidate.clipType,
          riskLevel: candidate.riskLevel,
          riskReasons: candidate.riskReasons,
          contextWarning: candidate.contextWarning,
          status: "SUGGESTED",
        })),
      });
    });

    await updateSermonStatus(sermon.id, "CLIPS_GENERATED");
    const successMessage = [
      `Saved ${dedupedWithBoundaryFields.length} clip suggestions.`,
      "Preview rendering is handled by the review asset preparation step.",
      `Repair used in ${repairUsedCount} batch(es).`,
      `Target duration guidance ${TARGET_MIN_DURATION_SECONDS}-${TARGET_MAX_DURATION_SECONDS}s applied.`,
      `Boundary adjustments applied to ${boundaryAdjustedCount} candidate(s).`,
      boundaryRejected.length > 0
        ? `Rejected ${boundaryRejected.length} candidate(s) due to boundary checks: ${boundaryRejected.join(" | ")}`
        : "No candidates were rejected by boundary checks.",
      rejectedReasons.length > 0
        ? `Rejected ${rejectedReasons.length} invalid candidate(s): ${rejectedReasons.join(" | ")}`
        : "No candidates were rejected by validation.",
    ].join(" ");
    await markJobSucceeded(job.id, successMessage);
    await appendPipelineLog(sermon.id, `Clip suggestions generated successfully (${dedupedWithBoundaryFields.length} saved).`);

    return { clipCount: dedupedWithBoundaryFields.length, reusedExistingSuggestions: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown clip generation error.";
    await markJobFailed(job.id, message, "Clip generation failed.");

    try {
      await updateSermonStatus(sermon.id, "FAILED");
    } catch (statusError) {
      const statusMessage = statusError instanceof Error ? statusError.message : "Unknown status error.";
      await appendPipelineLog(sermon.id, `Status update to FAILED skipped: ${statusMessage}`);
    }

    await appendPipelineLog(sermon.id, `Clip generation failed: ${message}`);
    throw new Error(message);
  }
}

export const __clipIntelligenceTestUtils = {
  shouldReuseExistingSuggestions,
  buildSuggestionDeleteWhere,
  shouldPreserveClipDuringRegeneration,
  buildRollingWindows,
  filterCandidatesToPromptWindows,
};
