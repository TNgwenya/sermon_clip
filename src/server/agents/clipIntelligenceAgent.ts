import type { Prisma } from "@prisma/client";
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
  validateFinalClipBoundary,
  type BoundaryRefinedFields,
} from "@/server/agents/clipBoundaryRefinement";
import {
  evaluateReviewableClipPolicy,
  hasHardQualityWarning,
  isHardQualityWarning,
  isRepairableQualityWarning,
  transcriptGroundingSnapshot,
} from "@/server/agents/clipCandidatePolicy";
import { semanticDedupeCandidates } from "@/server/agents/semanticDedupe";
import {
  analyzeClipCoherence,
  firstCoherenceSentence,
  hasCallingGiftStewardshipPayoff,
} from "@/server/agents/clipCoherenceAnalysis";
import {
  resolveClipVolumeTarget,
  shouldReuseClipSuggestionsForTarget,
  type ClipVolumeTarget,
} from "@/lib/clipVolumeTargets";
import { type MinistryMomentRecord as PromptMinistryMomentRecord } from "@/server/ai/ministryMomentSchema";
import { createLoggedChatCompletion } from "@/server/ai/aiGateway";
import { resolveOpenAIChatModel } from "@/server/ai/modelConfig";
import { appendPipelineLog } from "@/server/agents/storage";
import { updateSermonStatus } from "@/server/status/sermonStatus";
import { refreshVideoSubjectTracking } from "@/server/agents/videoSubjectTrackingService";
import {
  decideClipTranscriptSafety,
  mergeTranscriptSafetyBlocker,
  usesLocalSouthernAfricanLanguage,
} from "@/server/agents/localLanguageTranscriptSafety";
import { detectClipArc } from "@/server/agents/clipArcDetection";
import {
  analyzeMultilingualTranscript,
  type MultilingualTranscriptAnalysis,
} from "@/server/agents/multilingualTranscriptAnalysis";
import {
  classifySermonSegment,
  deriveLikelyThoughtStartAnchors,
} from "@/server/agents/sermonThoughtSegmentation";

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
  windowEligibility?: "CLEAN" | "REPAIRABLE";
  repairableWarnings?: string[];
  landingContextAvailable?: boolean;
  suggestedExtendedEndTimeSeconds?: number;
  transcriptEvidence?: MultilingualTranscriptAnalysis;
};

type GenerateClipOptions = {
  force?: boolean;
  append?: boolean;
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
  confidence?: number | null;
  speakerLabel?: string | null;
};

const WINDOW_STEP_SECONDS = 60;
const MIN_WINDOW_SECONDS = 30;
const MAX_WINDOW_SECONDS = 90;
const BATCH_SIZE = 4;
const MAX_BATCH_CLIPS = 4;
const WINDOW_TARGET_DURATIONS_SECONDS = [40, 60, 90] as const;
const SEMANTIC_ANCHOR_MIN_SPACING_SECONDS = 24;
const INLINE_VIDEO_SUBJECT_TRACKING_LIMIT = 6;
const MAX_TRANSCRIPT_ISLAND_GAP_SECONDS = 12;
const MAX_REPAIR_EXTENSION_SECONDS = 72;
const MIN_WINDOW_WORDS = 35;
const MIN_WINDOW_SERMON_TOKENS = 12;
const MIN_POST_READY_SCORE = 8;
const MIN_REVIEW_SCORE = 7.5;
const MIN_EDITING_REVIEW_SCORE = 7.2;
const MAX_FINAL_SELECTIONS = 6;
const REPLACEABLE_SUGGESTION_STATUSES: Array<"SUGGESTED" | "REJECTED"> = ["SUGGESTED", "REJECTED"];

type ClipQualityLabel = "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT";

type LooseClipCandidate = Partial<ClipJsonCandidate> & {
  id?: string;
  qualityLabel?: ClipQualityLabel | null;
  postReadyStatus?: ClipQualityLabel | null;
  finalQualityScore?: number | null;
  overallPostScore?: number | null;
  rankingCategory?: string | null;
  recommendedAction?: string | null;
  recommendedNextAction?: string | null;
  hookScore?: number | null;
  standaloneClarityScore?: number | null;
  arcCompletenessScore?: number | null;
  completenessScore?: number | null;
  completenessAction?: string | null;
  boundaryQuality?: "GOOD" | "NEEDS_REVIEW" | "BAD" | null;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | null;
  riskReasons?: string[] | null;
  qualityWarnings?: string[] | null;
  qualityDebugSnapshot?: unknown;
  transcriptGroundingScore?: number | null;
  transcriptGroundingOrderedFlowRatio?: number | null;
  canonicalizationWarnings?: string[] | null;
};

type TranscriptReadinessResult = {
  ready: boolean;
  reason: string;
  warnings: string[];
  wordCount: number;
  durationSeconds: number;
  coveredSeconds: number;
  coverageRatio: number;
  maxGapSeconds: number;
  largeGapCount: number;
  repeatedSegmentRatio: number;
  distinctSermonTokenCount: number;
  distinctSermonTokenRatio: number;
  averageSegmentDurationSeconds: number;
  meaningfulSegmentCount: number;
};

type WindowQualityResult = {
  accepted: boolean;
  windowEligibility: "CLEAN" | "REPAIRABLE" | "REJECTED";
  wordCount: number;
  meaningfulSegmentCount: number;
  distinctSermonTokenCount: number;
  repeatedSegmentRatio: number;
  openingHookScore: number;
  ministryPayoffScore: number;
  windowQualityScore: number;
  windowQualityWarnings: string[];
  repairableWarnings: string[];
};

type ExistingSuggestionReuseDecision = {
  reuse: boolean;
  reusableCount: number;
  totalCount: number;
  reason: string;
};

const TOKEN_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "he",
  "her",
  "him",
  "his",
  "i",
  "in",
  "is",
  "it",
  "its",
  "let",
  "me",
  "not",
  "of",
  "on",
  "or",
  "our",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "there",
  "this",
  "to",
  "us",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "will",
  "with",
  "you",
  "your",
]);

const FILLER_TOKENS = new Set([
  "amen",
  "hallelujah",
  "okay",
  "yes",
  "yeah",
  "come",
  "church",
]);

const REPAIRABLE_WINDOW_WARNINGS = new Set([
  "WINDOW_NO_CLEAR_LANDING",
  "WINDOW_SETUP_WITHOUT_LANDING",
  "WINDOW_DEPENDENT_OPENING",
  "WINDOW_LOCAL_LANGUAGE_SEMANTICS_REVIEW",
]);

function normalizePlainText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{M}\p{N}'’\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function transcriptTokens(text: string): string[] {
  return normalizePlainText(text)
    .split(/\s+/)
    .filter(Boolean);
}

function sermonSubstanceTokens(text: string): string[] {
  return transcriptTokens(text)
    .map((token) => {
      if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
      return token;
    })
    .filter((token) => (token.length > 2 || /^\d+$/.test(token)) && !TOKEN_STOP_WORDS.has(token) && !FILLER_TOKENS.has(token));
}

function uniqueSubstanceTokenCount(text: string): number {
  return new Set(sermonSubstanceTokens(text)).size;
}

function segmentTranscriptText(segments: TranscriptSegmentRecord[]): string {
  return segments.map((segment) => segment.text.trim()).filter(Boolean).join(" ");
}

function segmentDuration(segments: TranscriptSegmentRecord[]): number {
  if (segments.length === 0) return 0;
  return Number((segments[segments.length - 1].endTimeSeconds - segments[0].startTimeSeconds).toFixed(2));
}

function normalizedSegmentSignature(text: string): string {
  return normalizePlainText(text);
}

function repeatedSegmentRatio(segments: TranscriptSegmentRecord[]): number {
  if (segments.length === 0) return 0;

  const signatures = segments
    .map((segment) => normalizedSegmentSignature(segment.text))
    .filter(Boolean);
  if (signatures.length === 0) return 1;

  const counts = new Map<string, number>();
  for (const signature of signatures) {
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }

  const repeated = [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  return repeated / signatures.length;
}

function hasSetupLanguage(text: string): boolean {
  return /\b(today i want to|i want to|we are going to|we're going to|let me|before we can|the question is|we will look at|background|foundation|context|framework|define|prepares us|prepares the congregation)\b/i.test(text);
}

function pointsToFutureLanding(text: string): boolean {
  return /\b(next|later|will|going to|about to)\b.{0,100}\b(explain|show|bring|teach|look|understand)\b.{0,120}\b(respond|apply|obey|believe|pray|serve|trust|answer)\b/i.test(text);
}

function hasActionLanding(text: string): boolean {
  const normalized = normalizePlainText(text);
  return (
    /\b(so today|so this week|this week|today|right now|from here|therefore|that means|the point is|here is the point)\b.{0,140}\b(choose|trust|believe|pray|respond|obey|repent|forgive|serve|surrender|receive|take|start|stop|stir|use|encourage|strengthen|honor|lead|care)\b/i.test(normalized) ||
    /\b(choose|trust|believe|pray|respond|obey|repent|forgive|serve|surrender|receive|take one|take the|stir up|use what|serve with|lead with|care for|honor one another|strengthen someone|strengthen somebody)\b/i.test(normalized)
  );
}

function hasTeachingLanding(text: string): boolean {
  const normalized = normalizePlainText(text);
  return (
    /\b(this truth is important|this truth matters|scripture teaches|the scripture teaches|the bible teaches)\b.{0,140}\b(believers|discipleship|church|faith|service|obedience|ministry|calling|gift)\b/i.test(normalized) ||
    /\b(god|grace|mercy|jesus|scripture|gospel|spirit)\b.{0,100}\b(strengthens|encourages|reminds|teaches|helps|forms|gives)\b.{0,100}\b(church|believers|families|neighbors|people|heart|faith|obedience|service)\b/i.test(normalized) ||
    /\b(freedom|grace|mercy|faith|prayer|obedience|forgiveness)\b.{0,100}\b(lets|helps|keeps|strengthens|encourages|reminds)\b.{0,100}\b(families|neighbors|church|people|believers|heart)\b/i.test(normalized)
  );
}

function hasSpokenMinistryLanding(text: string): boolean {
  if (!text.trim()) return false;
  if (pointsToFutureLanding(text)) return false;
  return (
    hasActionLanding(text) ||
    hasTeachingLanding(text) ||
    hasCallingGiftStewardshipPayoff(text) ||
    analyzeClipCoherence(text).landingStatus !== "NONE"
  );
}

function hasSparseOrGenericTranscript(text: string): boolean {
  const wordCount = countTranscriptWords(text);
  if (wordCount < 18) return true;
  if (uniqueSubstanceTokenCount(text) < 12) return true;

  const normalized = normalizePlainText(text);
  if (/^(this is important|remember that|amen|yes)[\s.!?]+/i.test(text.trim()) && wordCount < 35) {
    return true;
  }

  return (
    /\b(topic|subject|worth studying|appears in several|different views|several observations|wider argument)\b/i.test(normalized) &&
    !hasSpokenMinistryLanding(text)
  );
}

function openingHookScore(text: string): number {
  const opening = firstCoherenceSentence(text);
  if (!opening) return 1;
  if (/\?/.test(opening) && /\b(what if|why|how|when)\b/i.test(opening)) return 9;
  if (hasSetupLanguage(opening)) return 4.2;
  if (/^(and|so|but|that means|this means|therefore)\b/i.test(opening.trim())) return 4.8;
  if (/\b(god|jesus|grace|faith|fear|gift|calling|church|scripture|prayer|forgiveness|leadership)\b/i.test(opening)) return 7.4;
  if (analyzeClipCoherence(opening).hasSpiritualAnchor) return 7.1;
  return 6.2;
}

function ministryPayoffScore(text: string): number {
  if (hasCallingGiftStewardshipPayoff(text)) return 9;
  if (hasActionLanding(text)) return 8.2;
  if (hasTeachingLanding(text)) return 6.2;
  if (analyzeClipCoherence(text).landingStatus !== "NONE") return 5.7;
  return 2.4;
}

function assessClipWindowQuality(
  segments: TranscriptSegmentRecord[],
  durationSeconds = segmentDuration(segments),
  options: { sermonLanguage?: string | null } = {},
): WindowQualityResult {
  const transcriptText = segmentTranscriptText(segments);
  const wordCount = countTranscriptWords(transcriptText);
  const meaningfulSegmentCount = segments.filter((segment) => countTranscriptWords(segment.text) >= 4).length;
  const distinctSermonTokenCount = uniqueSubstanceTokenCount(transcriptText);
  const repeatRatio = repeatedSegmentRatio(segments);
  const coherence = analyzeClipCoherence(transcriptText);
  const transcriptEvidence = analyzeMultilingualTranscript(segments);
  const labeledSegments = segments.filter((segment) => Boolean(segment.speakerLabel));
  const labeledDuration = labeledSegments.reduce(
    (total, segment) => total + Math.max(0, segment.endTimeSeconds - segment.startTimeSeconds),
    0,
  );
  const primarySpeakerDuration = labeledSegments
    .filter((segment) => segment.speakerLabel === "PRIMARY")
    .reduce((total, segment) => total + Math.max(0, segment.endTimeSeconds - segment.startTimeSeconds), 0);
  const primarySpeakerRatio = labeledDuration > 0 ? primarySpeakerDuration / labeledDuration : 1;
  const speakerTransitionCount = labeledSegments.slice(1).reduce((count, segment, index) => (
    segment.speakerLabel !== labeledSegments[index].speakerLabel ? count + 1 : count
  ), 0);
  const localLanguageSemanticsNeedReview =
    transcriptEvidence.languageProfile === "NGUNI_LOCAL" ||
    transcriptEvidence.languageProfile === "SOTHO_TSWANA" ||
    transcriptEvidence.languageProfile === "MIXED" ||
    usesLocalSouthernAfricanLanguage(options.sermonLanguage);
  const openingScore = openingHookScore(transcriptText);
  const payoffScore = ministryPayoffScore(transcriptText);
  const warnings: string[] = [];

  if (wordCount < MIN_WINDOW_WORDS) warnings.push("LOW_WINDOW_WORD_COUNT");
  if (meaningfulSegmentCount < 3) warnings.push("LOW_WINDOW_SUBSTANCE");
  if (distinctSermonTokenCount < MIN_WINDOW_SERMON_TOKENS) warnings.push("LOW_WINDOW_DISTINCT_SERMON_SUBSTANCE");
  if (repeatRatio > 0.28) warnings.push("REPETITIVE_WINDOW");
  if (durationSeconds < MIN_WINDOW_SECONDS || durationSeconds > 150) warnings.push("WINDOW_DURATION_OUT_OF_RANGE");
  if (labeledDuration > 0 && (primarySpeakerRatio < 0.6 || speakerTransitionCount >= 3)) {
    warnings.push("WINDOW_MULTI_SPEAKER_DOMINANT");
  }

  const hasLanding = hasSpokenMinistryLanding(transcriptText);
  const setupOnly = hasSetupLanguage(transcriptText) || coherence.setupOnly;
  const futureOnly = pointsToFutureLanding(transcriptText) || coherence.pointsToFutureResponse;
  const earlyDependentSegment = segments
    .slice(1, 3)
    .some((segment) => segment.startTimeSeconds - segments[0].startTimeSeconds <= 12 && /^(that means|this means|and that|therefore|so then)\b/i.test(segment.text.trim()));

  if ((setupOnly || futureOnly) && !hasLanding) {
    warnings.push("WINDOW_SETUP_WITHOUT_LANDING");
  }
  if (!hasLanding) {
    warnings.push(
      localLanguageSemanticsNeedReview
        ? "WINDOW_LOCAL_LANGUAGE_SEMANTICS_REVIEW"
        : "WINDOW_NO_CLEAR_LANDING",
    );
  }
  if (coherence.openingStatus === "DEPENDENT" || earlyDependentSegment) {
    warnings.push("WINDOW_DEPENDENT_OPENING");
  }

  const uniqueWarnings = [...new Set(warnings)];
  const repairableWarnings = uniqueWarnings.filter((warning) => REPAIRABLE_WINDOW_WARNINGS.has(warning));
  const hardWarnings = uniqueWarnings.filter((warning) => !REPAIRABLE_WINDOW_WARNINGS.has(warning));
  const windowEligibility: WindowQualityResult["windowEligibility"] =
    uniqueWarnings.length === 0
      ? "CLEAN"
      : hardWarnings.length === 0 && repairableWarnings.length > 0 && wordCount >= MIN_WINDOW_WORDS && distinctSermonTokenCount >= MIN_WINDOW_SERMON_TOKENS
        ? "REPAIRABLE"
        : "REJECTED";
  const accepted = windowEligibility === "CLEAN";
  const densityScore = Math.min(10, Math.max(1, wordCount / 10));
  const distinctScore = Math.min(10, Math.max(1, distinctSermonTokenCount / 3));
  const repairPenalty = windowEligibility === "REPAIRABLE" ? 0.6 : windowEligibility === "REJECTED" ? 2.2 : 0;
  const confidencePenalty = transcriptEvidence.confidenceBand === "LOW"
    ? 1.1
    : transcriptEvidence.confidenceBand === "REVIEW"
      ? 0.35
      : 0;
  const speakerPenalty = labeledDuration > 0
    ? Math.min(1.4, (1 - primarySpeakerRatio) * 1.8 + speakerTransitionCount * 0.18)
    : 0;
  const windowQualityScore = Number(Math.max(1, Math.min(10, (
    densityScore * 0.18 +
    distinctScore * 0.18 +
    openingScore * 0.24 +
    payoffScore * 0.4 -
    repairPenalty -
    confidencePenalty -
    speakerPenalty
  ))).toFixed(2));

  return {
    accepted,
    windowEligibility,
    wordCount,
    meaningfulSegmentCount,
    distinctSermonTokenCount,
    repeatedSegmentRatio: repeatRatio,
    openingHookScore: openingScore,
    ministryPayoffScore: payoffScore,
    windowQualityScore,
    windowQualityWarnings: uniqueWarnings,
    repairableWarnings,
  };
}

function makeClipWindow(
  segments: TranscriptSegmentRecord[],
  startIndex: number,
  endIndex: number,
  windowNumber: number,
  quality: WindowQualityResult,
  options: {
    sourceStartIndex?: number;
    windowEligibility?: "CLEAN" | "REPAIRABLE";
    repairableWarnings?: string[];
    landingContextAvailable?: boolean;
    suggestedExtendedEndTimeSeconds?: number;
  } = {},
): ClipWindow {
  const windowSegments = segments
    .slice(startIndex, endIndex + 1)
    .map((segment, index) => ({ ...segment, segmentIndex: index }));
  const startSegment = segments[startIndex];
  const endSegment = segments[endIndex];
  const transcriptText = segmentTranscriptText(windowSegments);
  const durationSeconds = Number((endSegment.endTimeSeconds - startSegment.startTimeSeconds).toFixed(2));

  return {
    windowId: `window-${windowNumber}-${Math.round(startSegment.startTimeSeconds)}-${Math.round(endSegment.endTimeSeconds)}`,
    startTimeSeconds: startSegment.startTimeSeconds,
    endTimeSeconds: endSegment.endTimeSeconds,
    durationSeconds,
    transcriptText,
    segments: windowSegments,
    segmentLines: windowSegments.map((segment) => `${segment.segmentIndex}: ${formatSegmentLine(segment)}`),
    wordCount: quality.wordCount,
    meaningfulSegmentCount: quality.meaningfulSegmentCount,
    openingHookScore: quality.openingHookScore,
    ministryPayoffScore: quality.ministryPayoffScore,
    windowQualityScore: quality.windowQualityScore,
    windowQualityWarnings: quality.windowQualityWarnings,
    windowEligibility: options.windowEligibility ?? (quality.windowEligibility === "REPAIRABLE" ? "REPAIRABLE" : "CLEAN"),
    repairableWarnings: options.repairableWarnings ?? quality.repairableWarnings,
    landingContextAvailable: options.landingContextAvailable,
    suggestedExtendedEndTimeSeconds: options.suggestedExtendedEndTimeSeconds,
    transcriptEvidence: analyzeMultilingualTranscript(windowSegments),
  };
}

function findRepairableEndIndex(
  segments: TranscriptSegmentRecord[],
  startIndex: number,
  endIndex: number,
): { endIndex: number; landingContextAvailable: boolean; suggestedExtendedEndTimeSeconds?: number } | null {
  const originalEnd = segments[endIndex].endTimeSeconds;
  let candidateEndIndex = endIndex;

  for (let index = endIndex + 1; index < segments.length; index += 1) {
    const segment = segments[index];
    const projectedDuration = segment.endTimeSeconds - segments[startIndex].startTimeSeconds;
    const extensionSeconds = segment.endTimeSeconds - originalEnd;
    if (projectedDuration > 150 || extensionSeconds > MAX_REPAIR_EXTENSION_SECONDS) {
      break;
    }

    candidateEndIndex = index;
    if (hasSpokenMinistryLanding(segment.text) || hasSpokenMinistryLanding(segmentTranscriptText(segments.slice(startIndex, index + 1)))) {
      return {
        endIndex: candidateEndIndex,
        landingContextAvailable: true,
        suggestedExtendedEndTimeSeconds: segment.endTimeSeconds,
      };
    }
  }

  return null;
}

function splitTranscriptIslands(segments: TranscriptSegmentRecord[]): Array<{ startIndex: number; endIndex: number }> {
  if (segments.length === 0) return [];

  const islands: Array<{ startIndex: number; endIndex: number }> = [];
  let startIndex = 0;
  for (let index = 1; index < segments.length; index += 1) {
    const gapSeconds = segments[index].startTimeSeconds - segments[index - 1].endTimeSeconds;
    if (gapSeconds > MAX_TRANSCRIPT_ISLAND_GAP_SECONDS) {
      islands.push({ startIndex, endIndex: index - 1 });
      startIndex = index;
    }
  }
  islands.push({ startIndex, endIndex: segments.length - 1 });
  return islands;
}

function buildWindowAnchors(
  segments: TranscriptSegmentRecord[],
  ministryMoments: MinistryMomentRecord[] = [],
): number[] {
  const anchors = new Set<number>();
  for (const island of splitTranscriptIslands(segments)) {
    const islandStart = segments[island.startIndex].startTimeSeconds;
    anchors.add(island.startIndex);

    let nextAnchorTime = islandStart + WINDOW_STEP_SECONDS;
    while (nextAnchorTime <= segments[island.endIndex].startTimeSeconds) {
      const index = segments.findIndex((segment, segmentIndex) => (
        segmentIndex >= island.startIndex &&
        segmentIndex <= island.endIndex &&
        segment.startTimeSeconds >= nextAnchorTime
      ));
      if (index === -1) break;
      anchors.add(index);
      nextAnchorTime = segments[index].startTimeSeconds + WINDOW_STEP_SECONDS;
    }
  }

  for (const moment of ministryMoments) {
    if (typeof moment.startTimeSeconds !== "number") continue;
    const anchorTime = Math.max(0, moment.startTimeSeconds - 15);
    const index = segments.findIndex((segment) => segment.startTimeSeconds >= anchorTime);
    if (index !== -1) anchors.add(index);
  }

  let lastSemanticAnchorTime = Number.NEGATIVE_INFINITY;
  for (const anchor of deriveLikelyThoughtStartAnchors(segments)) {
    if (anchor.segmentIndex === 0 || anchor.strength === "WEAK") continue;
    const hasStructureSignal = anchor.signals.length > 0;
    if (!hasStructureSignal && anchor.timeSeconds - lastSemanticAnchorTime < SEMANTIC_ANCHOR_MIN_SPACING_SECONDS) {
      continue;
    }
    anchors.add(anchor.segmentIndex);
    lastSemanticAnchorTime = anchor.timeSeconds;
  }

  return [...anchors].sort((left, right) => left - right);
}

function findEndIndexForTargetDuration(
  segments: TranscriptSegmentRecord[],
  startIndex: number,
  targetDurationSeconds: number,
): number | null {
  const start = segments[startIndex].startTimeSeconds;
  let endIndex: number | null = null;

  for (let index = startIndex; index < segments.length; index += 1) {
    const gapSeconds = index > startIndex ? segments[index].startTimeSeconds - segments[index - 1].endTimeSeconds : 0;
    if (gapSeconds > MAX_TRANSCRIPT_ISLAND_GAP_SECONDS) break;

    const duration = segments[index].endTimeSeconds - start;
    if (duration <= targetDurationSeconds + 0.5) {
      endIndex = index;
      continue;
    }
    break;
  }

  if (endIndex === null) return null;
  const duration = segments[endIndex].endTimeSeconds - start;
  return duration >= MIN_WINDOW_SECONDS ? endIndex : null;
}

function rankClipWindowsForSelection<T extends ClipWindow | (Partial<ClipWindow> & { startTimeSeconds: number; windowQualityScore: number })>(windows: T[]): T[] {
  if (windows.length <= 2) {
    return [...windows].sort(compareWindowsForQuality);
  }

  const sortedByStart = [...windows].sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
  const minStart = sortedByStart[0].startTimeSeconds;
  const maxStart = sortedByStart[sortedByStart.length - 1].startTimeSeconds;
  const span = Math.max(1, maxStart - minStart);
  const buckets = new Map<number, T[]>();

  for (const window of sortedByStart) {
    const bucket = Math.min(2, Math.floor(((window.startTimeSeconds - minStart) / span) * 3));
    const items = buckets.get(bucket) ?? [];
    items.push(window);
    buckets.set(bucket, items);
  }

  const selected = new Set<T>();
  const ranked: T[] = [];
  for (const bucket of [0, 1, 2]) {
    const best = (buckets.get(bucket) ?? []).sort(compareWindowsForQuality)[0];
    if (best) {
      ranked.push(best);
      selected.add(best);
    }
  }

  ranked.push(...windows.filter((window) => !selected.has(window)).sort(compareWindowsForQuality));
  return ranked;
}

function compareWindowsForQuality<T extends Partial<ClipWindow> & { startTimeSeconds: number; windowQualityScore: number }>(left: T, right: T): number {
  const eligibilityDiff = windowEligibilityRank(left.windowEligibility) - windowEligibilityRank(right.windowEligibility);
  if (eligibilityDiff !== 0) return eligibilityDiff;

  const scoreDiff = right.windowQualityScore - left.windowQualityScore;
  if (scoreDiff !== 0) return scoreDiff;

  const openingDiff = (right.openingHookScore ?? 0) - (left.openingHookScore ?? 0);
  if (openingDiff !== 0) return openingDiff;

  return left.startTimeSeconds - right.startTimeSeconds;
}

function windowEligibilityRank(value: ClipWindow["windowEligibility"] | undefined): number {
  if (value === "CLEAN" || value === undefined) return 0;
  return 1;
}

function scoreForClip(candidate: LooseClipCandidate): number {
  return candidate.finalQualityScore ?? candidate.overallPostScore ?? candidate.score ?? 0;
}

function qualityLabelRank(candidate: LooseClipCandidate): number {
  const label = candidate.qualityLabel ?? candidate.postReadyStatus;
  if (label === "POST_READY") return 0;
  if (label === "GOOD_NEEDS_REVIEW") return 1;
  if (label === "NEEDS_EDITING") return 2;
  if (label === "REJECT") return 4;
  return 3;
}

function hasContextRisk(candidate: LooseClipCandidate): boolean {
  const reasons = candidate.riskReasons ?? [];
  return (
    candidate.riskLevel === "HIGH" ||
    reasons.some((reason) => /\b(missing setup|additional context|without additional context|not make sense|context)\b/i.test(reason)) ||
    (candidate.contextWarning === true && (candidate.standaloneClarityScore ?? 0) < 6.8)
  );
}

function transcriptGroundingIsStrong(candidate: LooseClipCandidate, required = false): boolean {
  const grounding = transcriptGroundingSnapshot(candidate);
  if (!grounding || grounding.score === null) {
    return !required;
  }

  return grounding.score >= 0.72 && (grounding.orderedFlowRatio === null || grounding.orderedFlowRatio >= 0.82);
}

function hasPastorGradeTranscript(candidate: LooseClipCandidate): boolean {
  if (!("transcriptText" in candidate)) {
    return true;
  }

  const transcriptText = candidate.transcriptText?.trim() ?? "";
  if (!transcriptText || hasSparseOrGenericTranscript(transcriptText)) {
    return false;
  }

  const coherence = analyzeClipCoherence(transcriptText);
  if ((coherence.setupOnly || pointsToFutureLanding(transcriptText)) && !hasSpokenMinistryLanding(transcriptText)) {
    return false;
  }

  return hasCandidateMinistryLanding(transcriptText);
}

function hasCandidateMinistryLanding(text: string): boolean {
  if (pointsToFutureLanding(text)) return false;
  return (
    hasActionLanding(text) ||
    hasCallingGiftStewardshipPayoff(text) ||
    analyzeClipCoherence(text).landingStatus !== "NONE" ||
    /\b(freedom|grace|mercy|faith|prayer|obedience|forgiveness)\b.{0,100}\b(lets|helps|keeps|strengthens|encourages|reminds)\b.{0,100}\b(families|neighbors|church|people|believers|heart)\b/i.test(normalizePlainText(text))
  );
}

function hasRescueTranscript(candidate: LooseClipCandidate): boolean {
  const transcriptText = candidate.transcriptText?.trim() ?? "";
  return (
    countTranscriptWords(transcriptText) >= 18 &&
    uniqueSubstanceTokenCount(transcriptText) >= 8 &&
    hasCandidateMinistryLanding(transcriptText)
  );
}

function hasPastorGradeSignals(candidate: LooseClipCandidate, options: { allowReview?: boolean; requireGrounding?: boolean } = {}): boolean {
  const warnings = candidate.qualityWarnings ?? [];
  const label = candidate.qualityLabel ?? candidate.postReadyStatus;
  const postReadyStatus = candidate.postReadyStatus;
  const score = scoreForClip(candidate);

  if (label === "REJECT" || postReadyStatus === "REJECT") return false;
  if (label === "POST_READY" && postReadyStatus && postReadyStatus !== "POST_READY") return false;
  if (hasContextRisk(candidate)) return false;
  if (hasHardQualityWarning(warnings) || warnings.some(isHardQualityWarning)) return false;
  if (candidate.boundaryQuality && candidate.boundaryQuality !== "GOOD") return false;
  if (typeof candidate.hookScore === "number" && candidate.hookScore < 5.8) return false;
  if (typeof candidate.standaloneClarityScore === "number" && candidate.standaloneClarityScore < 7) return false;
  if (typeof candidate.arcCompletenessScore === "number" && candidate.arcCompletenessScore < 6.2) return false;
  if (typeof candidate.completenessScore === "number" && candidate.completenessScore < 5.5) return false;
  if (candidate.completenessAction === "REJECT_INCOMPLETE") return false;
  if (!transcriptGroundingIsStrong(candidate, options.requireGrounding ?? false)) return false;
  if (!hasPastorGradeTranscript(candidate)) return false;

  if (label === "POST_READY") return score >= MIN_POST_READY_SCORE;
  if (label === "GOOD_NEEDS_REVIEW") return options.allowReview !== false && score >= MIN_REVIEW_SCORE;
  return false;
}

function isReviewableEditingCandidate(candidate: LooseClipCandidate): boolean {
  const warnings = candidate.qualityWarnings ?? [];
  const score = scoreForClip(candidate);
  if ((candidate.qualityLabel ?? candidate.postReadyStatus) !== "NEEDS_EDITING") return false;
  if (score < MIN_EDITING_REVIEW_SCORE) return false;
  if (hasContextRisk(candidate)) return false;
  if (hasHardQualityWarning(warnings) || warnings.some(isHardQualityWarning)) return false;
  if (!hasPastorGradeTranscript(candidate)) return false;
  if (!transcriptGroundingIsStrong(candidate, false)) return false;

  return (
    warnings.some((warning) => warning === "DEGRADED_TRANSCRIPT_REVIEW_REQUIRED" || warning === "NEEDS_CONTEXT_EXTENSION" || isRepairableQualityWarning(warning)) ||
    candidate.boundaryQuality === "NEEDS_REVIEW"
  );
}

function overlapRatio(left: LooseClipCandidate, right: LooseClipCandidate): number {
  if (
    typeof left.startTimeSeconds !== "number" ||
    typeof left.endTimeSeconds !== "number" ||
    typeof right.startTimeSeconds !== "number" ||
    typeof right.endTimeSeconds !== "number"
  ) {
    return 0;
  }

  const overlapStart = Math.max(left.startTimeSeconds, right.startTimeSeconds);
  const overlapEnd = Math.min(left.endTimeSeconds, right.endTimeSeconds);
  const overlap = Math.max(0, overlapEnd - overlapStart);
  const shorter = Math.min(left.endTimeSeconds - left.startTimeSeconds, right.endTimeSeconds - right.startTimeSeconds);
  return shorter > 0 ? overlap / shorter : 0;
}

function tokenContainment(leftText: string, rightText: string): number {
  const left = new Set(sermonSubstanceTokens(leftText));
  const right = new Set(sermonSubstanceTokens(rightText));
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / Math.min(left.size, right.size);
}

function candidateIdeaText(candidate: LooseClipCandidate): string {
  return [
    candidate.title ?? "",
    candidate.hook ?? "",
    candidate.landingSentence ?? "",
    candidate.smartClipCategory ?? "",
    candidate.clipType ?? "",
    candidate.transcriptText ?? "",
  ].join(" ");
}

function isNearDuplicateCandidate(left: LooseClipCandidate, right: LooseClipCandidate): boolean {
  const startDelta = typeof left.startTimeSeconds === "number" && typeof right.startTimeSeconds === "number"
    ? Math.abs(left.startTimeSeconds - right.startTimeSeconds)
    : Number.POSITIVE_INFINITY;
  const titleMatch = normalizePlainText(left.title ?? "") && normalizePlainText(left.title ?? "") === normalizePlainText(right.title ?? "");
  const sameCategory = normalizeMomentText(left.smartClipCategory) === normalizeMomentText(right.smartClipCategory);
  const leftIdeaText = candidateIdeaText(left);
  const rightIdeaText = candidateIdeaText(right);
  const ideaSimilarity = tokenContainment(leftIdeaText, rightIdeaText);
  const ideaTokenCount = Math.min(sermonSubstanceTokens(leftIdeaText).length, sermonSubstanceTokens(rightIdeaText).length);

  return (
    overlapRatio(left, right) >= 0.5 ||
    (startDelta < 140 && titleMatch) ||
    (startDelta < 180 && sameCategory && ideaTokenCount >= 8 && ideaSimilarity >= 0.72)
  );
}

function diversifyClipCandidates<T extends LooseClipCandidate>(candidates: T[], options: { maxSelections?: number; allowEditing?: boolean } = {}): T[] {
  const maxSelections = options.maxSelections ?? MAX_FINAL_SELECTIONS;
  const perCategoryCounts = new Map<string, number>();
  const selected: T[] = [];

  for (const candidate of candidates) {
    if (selected.some((kept) => isNearDuplicateCandidate(kept, candidate))) {
      continue;
    }

    const category = candidate.smartClipCategory ?? candidate.clipType ?? "uncategorized";
    const categoryCount = perCategoryCounts.get(category) ?? 0;
    if (categoryCount >= 4) {
      continue;
    }

    selected.push(candidate);
    perCategoryCounts.set(category, categoryCount + 1);
    if (selected.length >= maxSelections) break;
  }

  return selected;
}

function sortClipCandidates<T extends LooseClipCandidate>(candidates: T[]): T[] {
  return [...candidates].sort((left, right) => {
    const labelDiff = qualityLabelRank(left) - qualityLabelRank(right);
    if (labelDiff !== 0) return labelDiff;

    const scoreDiff = scoreForClip(right) - scoreForClip(left);
    if (scoreDiff !== 0) return scoreDiff;

    return (left.startTimeSeconds ?? 0) - (right.startTimeSeconds ?? 0);
  });
}

function selectBestClipCandidates<T extends LooseClipCandidate>(candidates: T[]): T[] {
  const strong = sortClipCandidates(candidates.filter((candidate) => hasPastorGradeSignals(candidate)));
  if (strong.length > 0) {
    const hasExplicitCategories = strong.some((candidate) => candidate.smartClipCategory || candidate.clipType);
    const selected = diversifyClipCandidates(strong, { maxSelections: hasExplicitCategories ? MAX_FINAL_SELECTIONS : 4 });
    return selected;
  }

  const editing = sortClipCandidates(candidates.filter(isReviewableEditingCandidate));
  return diversifyClipCandidates(editing, { maxSelections: MAX_FINAL_SELECTIONS, allowEditing: true });
}

function selectStrongReviewOnlyClipCandidates<T extends LooseClipCandidate>(candidates: T[]): T[] {
  return sortClipCandidates(candidates.filter((candidate) => (
    (candidate.qualityLabel ?? candidate.postReadyStatus) === "GOOD_NEEDS_REVIEW" &&
    hasPastorGradeSignals(candidate, { requireGrounding: true })
  )));
}

function selectBoundaryReviewClipCandidates<T extends LooseClipCandidate>(candidates: T[]): T[] {
  return sortClipCandidates(candidates.filter((candidate) => {
    const warnings = candidate.qualityWarnings ?? [];
    return (
      candidate.boundaryQuality === "BAD" &&
      warnings.includes("PASTOR_GRADE_BAD_BOUNDARY") &&
      !hasHardQualityWarning(warnings.filter((warning) => warning !== "PASTOR_GRADE_BAD_BOUNDARY")) &&
      candidate.riskLevel !== "HIGH" &&
      transcriptGroundingIsStrong(candidate, true) &&
      hasPastorGradeTranscript(candidate)
    );
  }));
}

function selectRescueClipCandidates<T extends LooseClipCandidate>(
  candidates: T[],
  existing: T[] = [],
  limit = 12,
  maxSource = 24,
): T[] {
  const eligible = sortClipCandidates(candidates)
    .filter((candidate) => {
      const warnings = candidate.qualityWarnings ?? [];
      return (
        candidate.riskLevel !== "HIGH" &&
        transcriptGroundingIsStrong(candidate, true) &&
        hasRescueTranscript(candidate) &&
        !hasHardQualityWarning(warnings.filter((warning) => warning !== "PASTOR_GRADE_BAD_BOUNDARY")) &&
        !warnings.includes("PASTOR_GRADE_NO_SPIRITUAL_ANCHOR") &&
        !warnings.includes("PASTOR_GRADE_HIGH_CONTEXT_RISK")
      );
    })
    .slice(0, maxSource)
    .map((candidate) => ({
      ...candidate,
      qualityLabel: "NEEDS_EDITING" as const,
      postReadyStatus: "NEEDS_EDITING" as const,
    }));

  const selected: typeof eligible = [];
  for (const candidate of eligible) {
    if (existing.some((item) => isNearDuplicateCandidate(item, candidate))) continue;
    if (selected.some((item) => isNearDuplicateCandidate(item, candidate))) continue;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }

  return selected as unknown as T[];
}

function buildStructuredGenerationSummary(input: {
  totalCandidatesGenerated: number;
  validCandidates: number;
  boundaryRejectedCount: number;
  validationRejectedCount: number;
  semanticDuplicateCount: number;
  savedClips: LooseClipCandidate[];
}) {
  const selected = selectBestClipCandidates(input.savedClips);
  const topClipIds = selected
    .filter((clip) => typeof clip.id === "string")
    .map((clip) => clip.id as string);

  return {
    totalCandidatesGenerated: input.totalCandidatesGenerated,
    validCandidates: input.validCandidates,
    rejectedCandidates: input.boundaryRejectedCount + input.validationRejectedCount,
    boundaryRejectedCount: input.boundaryRejectedCount,
    validationRejectedCount: input.validationRejectedCount,
    semanticDuplicateCount: input.semanticDuplicateCount,
    savedClipCount: input.savedClips.length,
    postReadyCount: input.savedClips.filter((clip) => hasPastorGradeSignals(clip, { allowReview: false })).length,
    needsReviewCount: input.savedClips.filter((clip) => (clip.qualityLabel ?? clip.postReadyStatus) === "GOOD_NEEDS_REVIEW").length,
    needsEditingCount: input.savedClips.filter((clip) => (clip.qualityLabel ?? clip.postReadyStatus) === "NEEDS_EDITING").length,
    bestOverallClipId: topClipIds[0] ?? null,
    topClipIds,
  };
}

function isAiQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|quota|rate limit|insufficient_quota)\b/i.test(message);
}

function titleCase(words: string[]): string {
  const smallWords = new Set(["a", "an", "and", "as", "at", "but", "for", "in", "of", "on", "or", "the", "to", "with"]);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && smallWords.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function deterministicPastorTitle(input: { transcriptText: string; landingSentence?: string | null; hook?: string | null }): string {
  const text = `${input.hook ?? ""} ${input.landingSentence ?? ""} ${input.transcriptText}`.toLowerCase();

  if (/\bchoose one faithful act of service\b/i.test(text)) return "Choose One Faithful Act of Service";
  if (/\bequal before god\b|\ball equal before god\b|\bmen and women\b.{0,80}\bequal\b/i.test(text)) return "Equal Before God";
  if (/\bcreated humanity in his image\b|\bcarry the image of god\b|\bimage of god\b/i.test(text)) return "Created in God's Image";
  if (/\bcreated\b.{0,80}\blikeness\b|\blet us create\b.{0,80}\blikeness\b/i.test(text)) return "Created in God's Likeness";
  if (/\bchurch leader\b|\boverseer\b|\babove reproach\b|\bfaithful to his family\b/i.test(text)) return "Faithful Church Leadership";
  if (/\blead with integrity\b|\blead honestly\b/i.test(text)) return "Lead With Integrity";
  if (/\bscripture gives us learning\b|\blearning about leadership\b/i.test(text)) return "Learning From Scripture";
  if (/\btake care of god's church\b|\bcare of god's church\b/i.test(text)) return "Care for God's Church";
  if (/\bwork hard\b.{0,80}\bfamily\b|\btake care of the family\b/i.test(text)) return "Work Hard for the Family";
  if (/\bstir up\b|\bstir it up\b|\bgift\b.{0,100}\bserve\b|\bwhat god placed\b/i.test(text)) return "Stir Up the Gift";

  const landing = input.landingSentence?.trim() || firstCoherenceSentence(input.transcriptText);
  const words = sermonSubstanceTokens(landing)
    .filter((word) => !["god", "jesus", "lord"].includes(word))
    .slice(0, 5);
  return words.length >= 2 ? titleCase(words) : "Sermon Moment for Review";
}

function validatePastorTitle(title: string, transcriptText: string): { valid: boolean; reason: string | null } {
  const trimmed = title.trim();
  const normalized = normalizePlainText(trimmed);
  const wordCount = transcriptTokens(trimmed).length;
  const transcriptTokenSet = new Set(sermonSubstanceTokens(transcriptText));
  const titleTokens = sermonSubstanceTokens(trimmed);
  const groundedTokenCount = titleTokens.filter((token) => transcriptTokenSet.has(token)).length;

  if (wordCount < 3) {
    return { valid: false, reason: "Title is too short for a pastor-facing clip label." };
  }
  if (/^(and|however|neither|ruling|with|our|see|he|i)\b/i.test(trimmed) || /\b(of|for|to|at|with|and|if|upon)\s*$/i.test(trimmed)) {
    return { valid: false, reason: "Title reads like a dangling transcript fragment." };
  }
  if (/\b(a labor pains|has designed to function|i sit can i stand|greater access|if i believe let us create|outside family|give us a learning|see that his well)\b/i.test(normalized)) {
    return { valid: false, reason: "Title reads like a dangling ASR fragment." };
  }
  if (/\b(financial breakthrough|secret|miracle unlock|sermon moment for review)\b/i.test(normalized)) {
    return { valid: false, reason: "Title is generic or unsupported by the spoken sermon." };
  }
  if (titleTokens.length > 0 && groundedTokenCount / titleTokens.length < 0.35) {
    return { valid: false, reason: "Title is not grounded strongly enough in the transcript." };
  }

  return { valid: true, reason: null };
}

function normalizePastorTitle(input: {
  title: string;
  transcriptText: string;
  landingSentence?: string | null;
  hook?: string | null;
}): string {
  const validation = validatePastorTitle(input.title, input.transcriptText);
  if (validation.valid) {
    return input.title.trim();
  }

  return deterministicPastorTitle(input);
}

function buildHeuristicClipCandidatesFromWindows(
  windows: ClipWindow[],
  options: {
    limit?: number;
    excludeRanges?: ExistingClipRange[];
    minWindowQualityScore?: number;
    scoreCap?: number;
    reasonSelected?: string;
    contextWarning?: boolean;
  } = {},
): ClipJsonCandidate[] {
  const limit = Math.max(0, options.limit ?? MAX_BATCH_CLIPS);
  const minWindowQualityScore = options.minWindowQualityScore ?? 6.8;
  return windows
    .filter((window) => window.windowQualityScore >= minWindowQualityScore)
    .filter((window) => !options.excludeRanges?.some((range) => hasSignificantClipOverlap(range, window)))
    .slice(0, limit)
    .map((window) => {
      const transcriptEvidence = window.transcriptEvidence ?? analyzeMultilingualTranscript(window.segments);
      const transcriptNeedsReview = transcriptEvidence.requiresHumanReview;
      const landingSentence = analyzeClipCoherence(window.transcriptText).evidence.landingText ?? firstCoherenceSentence(window.transcriptText);
      const title = deterministicPastorTitle({ transcriptText: window.transcriptText, landingSentence });
      const score = options.scoreCap === undefined
        ? window.windowQualityScore
        : Math.min(options.scoreCap, window.windowQualityScore);
      return {
        startTimeSeconds: window.startTimeSeconds,
        endTimeSeconds: window.endTimeSeconds,
        durationSeconds: window.durationSeconds,
        transcriptText: window.transcriptText,
        title,
        hook: firstCoherenceSentence(window.transcriptText) || title,
        caption: landingSentence || title,
        hashtags: ["#Faith", "#Church"],
        score,
        reasonSelected: options.reasonSelected ?? (transcriptNeedsReview
          ? "Deterministic fallback found a structurally complete sermon section; the original local or uncertain wording still needs a human transcript check."
          : "Deterministic fallback selected this clip because the spoken transcript lands with a clear ministry payoff."),
        landingSentence: landingSentence || window.transcriptText,
        clipType: "teaching",
        smartClipCategory: hasCallingGiftStewardshipPayoff(window.transcriptText) ? "Best Discipleship Clip" : "Best Faith Clip",
        intendedAudience: "Believers ready to apply the sermon.",
        ministryValue: "Grounded sermon application for pastor review.",
        socialValue: "Short, clear spoken moment with a usable takeaway.",
        riskLevel: transcriptNeedsReview ? "MEDIUM" : "LOW",
        riskReasons: transcriptNeedsReview
          ? transcriptEvidence.reviewReasons.map((reason) => reason.code)
          : [],
        contextWarning: options.contextWarning ?? transcriptNeedsReview,
        arcType: "PROBLEM_TRUTH_APPLICATION",
        arcSummary: "Deterministic fallback arc from spoken transcript.",
        setupStartTime: window.startTimeSeconds,
        mainPointTime: window.startTimeSeconds,
        payoffTime: window.endTimeSeconds,
        applicationTime: window.endTimeSeconds,
        whyThisClipFeelsComplete: "The selected transcript includes a spoken landing.",
        whatContextMightBeMissing: null,
      };
    });
}

function findCoverageWindowEndIndex(
  segments: TranscriptSegmentRecord[],
  startIndex: number,
  targetDurationSeconds = 60,
): number | null {
  const startSegment = segments[startIndex];
  if (!startSegment) return null;

  let bestIndex: number | null = null;
  for (let index = startIndex; index < segments.length; index += 1) {
    const gapSeconds = index > startIndex ? segments[index].startTimeSeconds - segments[index - 1].endTimeSeconds : 0;
    if (gapSeconds > MAX_TRANSCRIPT_ISLAND_GAP_SECONDS) break;

    const durationSeconds = segments[index].endTimeSeconds - startSegment.startTimeSeconds;
    if (durationSeconds > MAX_WINDOW_SECONDS) break;
    if (durationSeconds >= 45) {
      bestIndex = index;
    }
    if (durationSeconds >= targetDurationSeconds) {
      return index;
    }
  }

  return bestIndex;
}

function buildCoverageTopUpClipCandidates(
  segments: TranscriptSegmentRecord[],
  options: {
    limit: number;
    desiredReviewSuggestions: number;
    excludeRanges?: ExistingClipRange[];
  },
): ClipJsonCandidate[] {
  if (segments.length === 0 || options.limit <= 0) {
    return [];
  }

  const candidates: ClipJsonCandidate[] = [];
  const transcriptDurationSeconds = segmentDuration(segments);
  const coverageStepSeconds = Math.max(75, Math.floor(transcriptDurationSeconds / Math.max(1, options.desiredReviewSuggestions)));
  const firstStartTime = segments[0].startTimeSeconds;
  const lastEndTime = segments[segments.length - 1].endTimeSeconds;

  for (let anchorTime = firstStartTime; anchorTime <= lastEndTime && candidates.length < options.limit; anchorTime += coverageStepSeconds) {
    const startIndex = segments.findIndex((segment) => segment.startTimeSeconds >= anchorTime);
    if (startIndex === -1) break;

    const endIndex = findCoverageWindowEndIndex(segments, startIndex);
    if (endIndex === null || endIndex <= startIndex) continue;

    const selectedSegments = segments.slice(startIndex, endIndex + 1);
    const transcriptText = segmentTranscriptText(selectedSegments);
    if (countTranscriptWords(transcriptText) < MIN_WINDOW_WORDS || uniqueSubstanceTokenCount(transcriptText) < MIN_WINDOW_SERMON_TOKENS) {
      continue;
    }

    const startTimeSeconds = selectedSegments[0].startTimeSeconds;
    const endTimeSeconds = selectedSegments[selectedSegments.length - 1].endTimeSeconds;
    const durationSeconds = Number((endTimeSeconds - startTimeSeconds).toFixed(2));
    const range = { startTimeSeconds, endTimeSeconds, durationSeconds };
    if (options.excludeRanges?.some((existing) => hasSignificantClipOverlap(existing, range))) {
      continue;
    }
    if (candidates.some((existing) => hasSignificantClipOverlap(existing, range))) {
      continue;
    }

    const quality = assessClipWindowQuality(selectedSegments, durationSeconds);
    const transcriptEvidence = analyzeMultilingualTranscript(selectedSegments);
    const landingSentence = analyzeClipCoherence(transcriptText).evidence.landingText ?? firstCoherenceSentence(transcriptText);
    const title = deterministicPastorTitle({ transcriptText, landingSentence });

    candidates.push({
      startTimeSeconds,
      endTimeSeconds,
      durationSeconds,
      transcriptText,
      title,
      hook: firstCoherenceSentence(transcriptText) || title,
      caption: landingSentence || title,
      hashtags: ["#Faith", "#Church"],
      score: Number(Math.min(6.9, Math.max(6.1, quality.windowQualityScore)).toFixed(2)),
      reasonSelected: "Coverage top-up selected this distinct sermon section so the pastor has enough review options across the full message.",
      landingSentence: landingSentence || transcriptText,
      clipType: "teaching",
      smartClipCategory: hasCallingGiftStewardshipPayoff(transcriptText) ? "Best Discipleship Clip" : "Best Faith Clip",
      intendedAudience: "Pastor review queue",
      ministryValue: "Additional grounded sermon section for review coverage.",
      socialValue: "Potential short-form teaching moment; review before posting.",
      riskLevel: transcriptEvidence.requiresHumanReview ? "MEDIUM" : "LOW",
      riskReasons: Array.from(new Set([
        ...quality.windowQualityWarnings,
        ...transcriptEvidence.reviewReasons.map((reason) => reason.code),
      ])),
      contextWarning: true,
      arcType: "PROBLEM_TRUTH_APPLICATION",
      arcSummary: "Coverage top-up arc from the spoken transcript.",
      setupStartTime: startTimeSeconds,
      mainPointTime: startTimeSeconds,
      payoffTime: endTimeSeconds,
      applicationTime: endTimeSeconds,
      whyThisClipFeelsComplete: landingSentence
        ? "The selected transcript includes a spoken landing."
        : "The selected transcript is a distinct sermon section for pastor review.",
      whatContextMightBeMissing: quality.windowQualityWarnings.length > 0
        ? `Needs pastor review: ${quality.windowQualityWarnings.join(", ")}.`
        : null,
    });
  }

  return candidates;
}

function assessTranscriptReadinessForClipping(segments: TranscriptSegmentRecord[]): TranscriptReadinessResult {
  const ordered = [...segments].sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
  const transcriptText = segmentTranscriptText(ordered);
  const wordCount = countTranscriptWords(transcriptText);
  const durationSeconds = segmentDuration(ordered);
  const coveredSeconds = ordered.reduce((sum, segment) => sum + Math.max(0, segment.endTimeSeconds - segment.startTimeSeconds), 0);
  const coverageRatio = durationSeconds > 0 ? coveredSeconds / durationSeconds : 0;
  const gaps = ordered.slice(1).map((segment, index) => Math.max(0, segment.startTimeSeconds - ordered[index].endTimeSeconds));
  const maxGapSeconds = gaps.length > 0 ? Math.max(...gaps) : 0;
  const largeGapCount = gaps.filter((gap) => gap > 60).length;
  const repeatRatio = repeatedSegmentRatio(ordered);
  const distinctSermonTokenCount = uniqueSubstanceTokenCount(transcriptText);
  const totalSubstanceTokenCount = sermonSubstanceTokens(transcriptText).length;
  const distinctSermonTokenRatio = totalSubstanceTokenCount > 0 ? distinctSermonTokenCount / totalSubstanceTokenCount : 0;
  const averageSegmentDurationSeconds = ordered.length > 0 ? coveredSeconds / ordered.length : 0;
  const meaningfulSegmentCount = ordered.filter((segment) => countTranscriptWords(segment.text) >= 8).length;
  const warnings: string[] = [];
  let ready = true;
  let reason = "Transcript is ready for clip generation.";

  if (wordCount < 120 || durationSeconds < 90) {
    ready = false;
    reason = "Transcript is too short for reliable clip generation.";
  }
  if (ready && (coverageRatio < 0.2 || maxGapSeconds > 150)) {
    ready = false;
    reason = "Transcript coverage has large gaps that make automatic clipping unreliable.";
  }
  if (ready && repeatRatio > 0.28) {
    ready = false;
    reason = "Transcript output appears repetitive.";
  }
  if (ready && distinctSermonTokenRatio < 0.38) {
    ready = false;
    reason = "Transcript has too little distinct sermon substance for reliable clip generation.";
  }
  if (ready && averageSegmentDurationSeconds >= 38) {
    ready = false;
    reason = "Transcript timestamps are too coarse for precise clipping.";
  }

  if (averageSegmentDurationSeconds >= 38) warnings.push("COARSE_TRANSCRIPT_TIMING");
  if (coverageRatio < 0.2 || maxGapSeconds > 150) warnings.push("LOW_TRANSCRIPT_COVERAGE");
  if (repeatRatio > 0.28) warnings.push("REPETITIVE_TRANSCRIPT");
  if (distinctSermonTokenRatio < 0.38) warnings.push("LOW_DISTINCT_SERMON_SUBSTANCE");

  return {
    ready,
    reason,
    warnings,
    wordCount,
    durationSeconds,
    coveredSeconds,
    coverageRatio,
    maxGapSeconds,
    largeGapCount,
    repeatedSegmentRatio: repeatRatio,
    distinctSermonTokenCount,
    distinctSermonTokenRatio,
    averageSegmentDurationSeconds,
    meaningfulSegmentCount,
  };
}

function isReviewOnlyTranscriptUsableForClipGeneration(readiness: TranscriptReadinessResult): boolean {
  return (
    !readiness.ready &&
    readiness.wordCount >= 140 &&
    readiness.meaningfulSegmentCount >= 10 &&
    readiness.distinctSermonTokenCount >= 55 &&
    readiness.repeatedSegmentRatio <= 0.2 &&
    readiness.distinctSermonTokenRatio >= 0.38
  );
}

function isManualRescueTranscriptUsableForClipGeneration(readiness: TranscriptReadinessResult): boolean {
  return (
    !readiness.ready &&
    !isReviewOnlyTranscriptUsableForClipGeneration(readiness) &&
    readiness.wordCount >= 55 &&
    readiness.meaningfulSegmentCount >= 4 &&
    readiness.distinctSermonTokenCount >= 32 &&
    readiness.repeatedSegmentRatio <= 0.2 &&
    readiness.distinctSermonTokenRatio >= 0.55
  );
}

function classifyTranscriptQualityForClipGeneration(readiness: TranscriptReadinessResult): "READY" | "LOW_RESCUE" | "MANUAL_RESCUE" | "UNUSABLE" {
  if (readiness.ready) return "READY";
  if (isReviewOnlyTranscriptUsableForClipGeneration(readiness)) return "LOW_RESCUE";
  if (isManualRescueTranscriptUsableForClipGeneration(readiness)) return "MANUAL_RESCUE";
  return "UNUSABLE";
}

function buildLowTranscriptTimedFallbackCandidates(
  segments: TranscriptSegmentRecord[],
  bounds?: { startTimeSeconds?: number; endTimeSeconds?: number },
): ClipJsonCandidateWithRuntimeMetadata[] {
  const scoped = segments.filter((segment) => (
    (bounds?.startTimeSeconds === undefined || segment.endTimeSeconds >= bounds.startTimeSeconds) &&
    (bounds?.endTimeSeconds === undefined || segment.startTimeSeconds <= bounds.endTimeSeconds)
  ));
  const candidates: ClipJsonCandidateWithRuntimeMetadata[] = [];

  for (const island of splitTranscriptIslands(scoped)) {
    const islandSegments = scoped.slice(island.startIndex, island.endIndex + 1);
    if (countTranscriptWords(segmentTranscriptText(islandSegments)) < 18) continue;

    const start = islandSegments[0].startTimeSeconds;
    let endIndex = islandSegments.length - 1;
    while (endIndex > 0 && islandSegments[endIndex].endTimeSeconds - start > MAX_WINDOW_SECONDS) {
      endIndex -= 1;
    }

    const selectedSegments = islandSegments.slice(0, endIndex + 1);
    const transcriptText = segmentTranscriptText(selectedSegments);
    const end = selectedSegments[selectedSegments.length - 1].endTimeSeconds;
    const landingSentence = analyzeClipCoherence(transcriptText).evidence.landingText ?? firstCoherenceSentence(transcriptText);

    candidates.push({
      startTimeSeconds: start,
      endTimeSeconds: end,
      durationSeconds: Number((end - start).toFixed(2)),
      transcriptText,
      title: deterministicPastorTitle({ transcriptText, landingSentence }),
      hook: firstCoherenceSentence(transcriptText),
      caption: landingSentence || transcriptText,
      hashtags: ["#Faith"],
      score: 6.9,
      reasonSelected: "This transcript-rescue timed option uses the best available low-confidence transcript island for pastor review.",
      landingSentence: landingSentence || transcriptText,
      clipType: "teaching",
      smartClipCategory: "Best Faith Clip",
      intendedAudience: "Pastor review queue",
      ministryValue: "A grounded timed option from sparse transcript evidence.",
      socialValue: "Needs review before posting.",
      riskLevel: "MEDIUM",
      riskReasons: ["LOW_TRANSCRIPT_TIMED_FALLBACK"],
      contextWarning: true,
      arcType: "PROBLEM_TRUTH_APPLICATION",
      arcSummary: "Low-transcript rescue candidate.",
      setupStartTime: start,
      mainPointTime: start,
      payoffTime: end,
      applicationTime: end,
      whyThisClipFeelsComplete: "The timed range contains the strongest available transcript island.",
      whatContextMightBeMissing: "Transcript confidence is low; pastor should review before posting.",
      canonicalizationWarnings: ["LOW_TRANSCRIPT_TIMED_FALLBACK"],
    });
  }

  return candidates;
}

function tokenPositionsByValue(tokens: string[]): Map<string, number[]> {
  const positions = new Map<string, number[]>();
  tokens.forEach((token, index) => {
    const items = positions.get(token) ?? [];
    items.push(index);
    positions.set(token, items);
  });
  return positions;
}

function longestIncreasingSubsequenceLength(values: number[]): number {
  const tails: number[] = [];
  for (const value of values) {
    let left = 0;
    let right = tails.length;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      if (tails[middle] < value) left = middle + 1;
      else right = middle;
    }
    tails[left] = value;
  }
  return tails.length;
}

function assessCandidateTranscriptGrounding(input: {
  candidateTranscriptText: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  segments: TranscriptSegmentRecord[];
}) {
  const rangeText = segmentTranscriptText(input.segments.filter((segment) => (
    segment.endTimeSeconds > input.startTimeSeconds &&
    segment.startTimeSeconds < input.endTimeSeconds
  )));
  const candidateTokens = sermonSubstanceTokens(input.candidateTranscriptText);
  const rangeTokens = sermonSubstanceTokens(rangeText);
  const rangeTokenSet = new Set(rangeTokens);
  const matchedTokens = candidateTokens.filter((token) => rangeTokenSet.has(token)).length;
  const tokenCount = candidateTokens.length;
  const score = tokenCount > 0 ? matchedTokens / tokenCount : 0;
  const candidateBigrams = candidateTokens.slice(0, -1).map((token, index) => `${token} ${candidateTokens[index + 1]}`);
  const rangeBigramSet = new Set(rangeTokens.slice(0, -1).map((token, index) => `${token} ${rangeTokens[index + 1]}`));
  const matchedBigrams = candidateBigrams.filter((bigram) => rangeBigramSet.has(bigram)).length;
  const bigramCount = candidateBigrams.length;
  const positions = tokenPositionsByValue(rangeTokens);
  const orderedPositions: number[] = [];
  const cursors = new Map<string, number>();
  for (const token of candidateTokens) {
    const tokenPositions = positions.get(token);
    if (!tokenPositions) continue;
    const cursor = cursors.get(token) ?? 0;
    const position = tokenPositions[Math.min(cursor, tokenPositions.length - 1)];
    cursors.set(token, cursor + 1);
    orderedPositions.push(position);
  }
  const orderedFlowRatio = tokenCount > 0 ? longestIncreasingSubsequenceLength(orderedPositions) / tokenCount : 0;
  const bigramRatio = bigramCount > 0 ? matchedBigrams / bigramCount : 1;
  const accepted = score >= 0.72 && orderedFlowRatio >= 0.82 && bigramRatio >= 0.5;
  const reason = accepted
    ? "Candidate transcript is grounded in the selected range."
    : score < 0.5
      ? "Candidate transcript is not sufficiently grounded in the selected range."
      : orderedFlowRatio < 0.82
      ? "Candidate transcript does not preserve the sermon ordered flow."
      : "Candidate transcript is not sufficiently grounded in the selected range.";

  return {
    accepted,
    reason,
    score,
    tokenCount,
    matchedTokens,
    bigramCount,
    matchedBigrams,
    orderedFlowRatio,
  };
}

function assessCandidateLandingEvidence(input: {
  candidate: {
    payoffTime?: number | null;
    applicationTime?: number | null;
    landingSentence?: string | null;
    reasonSelected?: string | null;
    whyThisClipFeelsComplete?: string | null;
  };
  startTimeSeconds: number;
  endTimeSeconds: number;
  segments: TranscriptSegmentRecord[];
}) {
  const checkedArcTimes = [input.candidate.payoffTime, input.candidate.applicationTime]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  for (const [label, time] of [
    ["payoffTime", input.candidate.payoffTime],
    ["applicationTime", input.candidate.applicationTime],
  ] as const) {
    if (typeof time === "number" && (time < input.startTimeSeconds || time > input.endTimeSeconds)) {
      return {
        accepted: false,
        hasLanding: false,
        checkedArcTimes: checkedArcTimes.length,
        landingClaimGrounded: false,
        landingClaimMatchedTokens: 0,
        reason: `${label} sits outside the selected clip range.`,
      };
    }
  }

  const rangeSegments = input.segments.filter((segment) => (
    segment.endTimeSeconds > input.startTimeSeconds &&
    segment.startTimeSeconds < input.endTimeSeconds
  ));
  const rangeText = segmentTranscriptText(rangeSegments);
  const hasLanding = hasSpokenMinistryLanding(rangeText);
  if (!hasLanding) {
    return {
      accepted: false,
      hasLanding: false,
      checkedArcTimes: checkedArcTimes.length,
      landingClaimGrounded: false,
      landingClaimMatchedTokens: 0,
      reason: "Selected range does not include a clear spoken landing.",
    };
  }

  const landingSentence = input.candidate.landingSentence?.trim() ?? "";
  const grounding = assessCandidateTranscriptGrounding({
    candidateTranscriptText: landingSentence,
    startTimeSeconds: input.startTimeSeconds,
    endTimeSeconds: input.endTimeSeconds,
    segments: rangeSegments,
  });
  const landingClaimMatchedTokens = grounding.matchedTokens;
  const landingClaimGrounded = landingSentence.length > 0 && grounding.score >= 0.55 && grounding.orderedFlowRatio >= 0.7;

  if (!landingClaimGrounded) {
    return {
      accepted: false,
      hasLanding: true,
      checkedArcTimes: checkedArcTimes.length,
      landingClaimGrounded: false,
      landingClaimMatchedTokens,
      reason: "Landing sentence is not grounded in the selected transcript.",
    };
  }

  return {
    accepted: true,
    hasLanding: true,
    checkedArcTimes: checkedArcTimes.length,
    landingClaimGrounded: true,
    landingClaimMatchedTokens,
    reason: "Candidate includes a grounded spoken landing.",
  };
}

type GeneratedClipEvidence = {
  rawAiCandidate: Prisma.InputJsonValue;
  qualityDebugSnapshot: Prisma.InputJsonValue;
  captionData?: Prisma.InputJsonValue;
  hookStrengthScore?: number;
  standaloneClarityScore?: number;
  emotionalImpactScore?: number;
  ministryValueScore?: number;
  shareabilityScore?: number;
  bestPlatform?: string;
  arcCompletenessScore: number;
  clipArcType: ReturnType<typeof detectClipArc>["clipArcType"];
  arcSummary: string;
  setupStartTime: number | null;
  mainPointTime: number | null;
  payoffTime: number | null;
  applicationTime: number | null;
  whyThisClipFeelsComplete: string;
  whatContextMightBeMissing: string | null;
};

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function resolveCandidateGenerationSource(
  candidate: ClipJsonCandidateWithRuntimeMetadata,
): "AI_MODEL" | "DETERMINISTIC_TRANSCRIPT" | "TRANSCRIPT_RESCUE" {
  if (candidate.canonicalizationWarnings?.includes("LOW_TRANSCRIPT_TIMED_FALLBACK")) {
    return "TRANSCRIPT_RESCUE";
  }

  if (!candidate.responseFormat || /(?:deterministic|coverage) top-up/i.test(candidate.reasonSelected)) {
    return "DETERMINISTIC_TRANSCRIPT";
  }

  return "AI_MODEL";
}

/**
 * Builds the durable content evidence saved with every generated suggestion.
 * Curation deliberately relies on this snapshot instead of treating an AI
 * score as proof that the excerpt came from the selected sermon range.
 */
function buildGeneratedClipEvidence(
  candidate: ClipJsonCandidateWithRuntimeMetadata,
  segments: TranscriptSegmentRecord[],
  providedTranscriptEvidence?: MultilingualTranscriptAnalysis,
): GeneratedClipEvidence {
  const selectedSegments = segments.filter((segment) => (
    segment.endTimeSeconds > candidate.startTimeSeconds &&
    segment.startTimeSeconds < candidate.endTimeSeconds
  ));
  const transcriptEvidence = providedTranscriptEvidence ?? analyzeMultilingualTranscript(selectedSegments);
  const transcriptGrounding = assessCandidateTranscriptGrounding({
    candidateTranscriptText: candidate.transcriptText,
    startTimeSeconds: candidate.startTimeSeconds,
    endTimeSeconds: candidate.endTimeSeconds,
    segments,
  });
  const landingEvidence = assessCandidateLandingEvidence({
    candidate,
    startTimeSeconds: candidate.startTimeSeconds,
    endTimeSeconds: candidate.endTimeSeconds,
    segments,
  });
  const arc = detectClipArc(candidate, selectedSegments);
  const inSelectedRange = (value: number | null): number | null => (
    typeof value === "number" &&
    value >= candidate.startTimeSeconds &&
    value <= candidate.endTimeSeconds
      ? value
      : null
  );
  const source = resolveCandidateGenerationSource(candidate);
  const hasContentPackage = Boolean(
    candidate.captionPackage || candidate.socialPotential || candidate.selectionReasoning || candidate.languageHints,
  );
  const captionData = hasContentPackage
    ? toInputJson({
        schemaVersion: 1,
        ...(candidate.captionPackage ? { captionPackage: candidate.captionPackage } : {}),
        ...(candidate.languageHints ? { languageHints: candidate.languageHints } : {}),
        contentIntelligence: {
          schemaVersion: 1,
          source,
          socialPotential: candidate.socialPotential ?? null,
          selectionReasoning: candidate.selectionReasoning ?? null,
        },
      })
    : undefined;

  return {
    rawAiCandidate: toInputJson(candidate),
    qualityDebugSnapshot: toInputJson({
      schemaVersion: 1,
      provenance: {
        source,
        responseFormat: candidate.responseFormat ?? null,
        canonicalizationWarnings: candidate.canonicalizationWarnings ?? [],
      },
      transcriptGrounding,
      transcriptEvidence,
      landingEvidence,
      arcEvidence: {
        clipArcType: arc.clipArcType,
        arcCompletenessScore: arc.arcCompletenessScore,
        whyThisClipFeelsComplete: arc.whyThisClipFeelsComplete,
        whatContextMightBeMissing: arc.whatContextMightBeMissing,
      },
    }),
    captionData,
    hookStrengthScore: candidate.socialPotential?.hookStrength,
    standaloneClarityScore:
      candidate.socialPotential?.standaloneUsefulnessScore ?? candidate.socialPotential?.clarityScore,
    emotionalImpactScore: candidate.socialPotential?.emotionalImpactScore,
    ministryValueScore: candidate.socialPotential?.ministryValueScore,
    shareabilityScore:
      candidate.socialPotential?.shareabilityScore ?? candidate.socialPotential?.socialMediaPotentialScore,
    bestPlatform: candidate.socialPotential?.recommendedPlatforms[0],
    arcCompletenessScore: arc.arcCompletenessScore,
    clipArcType: arc.clipArcType,
    arcSummary: arc.arcSummary,
    setupStartTime: inSelectedRange(arc.setupStartTime),
    mainPointTime: inSelectedRange(arc.mainPointTime),
    payoffTime: inSelectedRange(arc.payoffTime),
    applicationTime: inSelectedRange(arc.applicationTime),
    whyThisClipFeelsComplete: arc.whyThisClipFeelsComplete,
    whatContextMightBeMissing: arc.whatContextMightBeMissing,
  };
}

function repairMissingLanding<T extends LooseClipCandidate>(
  candidate: T,
  segments: TranscriptSegmentRecord[],
) {
  const rangeStart = candidate.startTimeSeconds ?? 0;
  const rangeEnd = candidate.endTimeSeconds ?? rangeStart;
  const startIndex = segments.findIndex((segment) => segment.endTimeSeconds > rangeStart);
  const endIndex = startIndex === -1
    ? -1
    : segments.findIndex((segment, index) => index >= startIndex && segment.endTimeSeconds >= rangeEnd);

  if (startIndex === -1 || endIndex === -1) {
    return {
      adjusted: false,
      candidate: { ...candidate, boundaryQuality: "NEEDS_REVIEW" as const },
      warnings: ["TRANSCRIPT_LIMITED_ENDING"],
      coverage: { transcriptLimitedEnding: true },
    };
  }

  const repair = findRepairableEndIndex(segments, startIndex, endIndex);
  if (!repair) {
    return {
      adjusted: false,
      candidate: { ...candidate, boundaryQuality: "NEEDS_REVIEW" as const },
      warnings: ["TRANSCRIPT_LIMITED_ENDING"],
      coverage: { transcriptLimitedEnding: true },
    };
  }

  const selectedSegments = segments.slice(startIndex, repair.endIndex + 1);
  const endTimeSeconds = segments[repair.endIndex].endTimeSeconds;
  return {
    adjusted: true,
    candidate: {
      ...candidate,
      endTimeSeconds,
      adjustedEndTimeSeconds: endTimeSeconds,
      durationSeconds: Number((endTimeSeconds - rangeStart).toFixed(2)),
      transcriptText: segmentTranscriptText(selectedSegments),
      boundaryQuality: "GOOD" as const,
    },
    warnings: ["LANDING_REPAIRED"],
    coverage: { transcriptLimitedEnding: false },
  };
}

function repairWeakOpening<T extends LooseClipCandidate>(
  candidate: T,
  segments: TranscriptSegmentRecord[],
) {
  const startTimeSeconds = candidate.startTimeSeconds ?? 0;
  const endTimeSeconds = candidate.endTimeSeconds ?? startTimeSeconds;
  const startIndex = segments.findIndex((segment) => segment.endTimeSeconds > startTimeSeconds);
  const endIndex = startIndex === -1
    ? -1
    : segments.findIndex((segment, index) => index >= startIndex && segment.endTimeSeconds >= endTimeSeconds);
  const previous = startIndex > 0 ? segments[startIndex - 1] : null;

  if (!previous || startIndex === -1 || endIndex === -1 || startTimeSeconds - previous.endTimeSeconds > 20) {
    return {
      adjusted: false,
      candidate: { ...candidate, boundaryQuality: "NEEDS_REVIEW" as const },
      warnings: ["NEEDS_START_TRIM"],
      details: { succeeded: false, reason: "no stronger setup segment was available inside the repair window." },
    };
  }

  const selectedSegments = segments.slice(startIndex - 1, endIndex + 1);
  const newStart = previous.startTimeSeconds;
  return {
    adjusted: true,
    candidate: {
      ...candidate,
      startTimeSeconds: newStart,
      adjustedStartTimeSeconds: newStart,
      durationSeconds: Number((endTimeSeconds - newStart).toFixed(2)),
      transcriptText: segmentTranscriptText(selectedSegments),
      boundaryQuality: "GOOD" as const,
    },
    warnings: ["OPENING_REPAIRED"],
    details: {
      succeeded: true,
      searchDistanceSeconds: Number((startTimeSeconds - previous.startTimeSeconds).toFixed(2)),
      reason: "Opening repaired with nearby setup.",
    },
  };
}

function clampCandidateToBounds<T extends LooseClipCandidate>(
  candidate: T,
  segments: TranscriptSegmentRecord[],
  bounds: { startTimeSeconds?: number; endTimeSeconds?: number },
) {
  const startTimeSeconds = Math.max(bounds.startTimeSeconds ?? candidate.startTimeSeconds ?? 0, candidate.startTimeSeconds ?? 0);
  const endTimeSeconds = Math.min(bounds.endTimeSeconds ?? candidate.endTimeSeconds ?? startTimeSeconds, candidate.endTimeSeconds ?? startTimeSeconds);
  const adjusted = startTimeSeconds !== candidate.startTimeSeconds || endTimeSeconds !== candidate.endTimeSeconds;
  const transcriptText = segmentTranscriptText(segments.filter((segment) => (
    segment.endTimeSeconds > startTimeSeconds &&
    segment.startTimeSeconds < endTimeSeconds
  )));

  return {
    adjusted,
    candidate: {
      ...candidate,
      startTimeSeconds,
      endTimeSeconds,
      durationSeconds: Number((endTimeSeconds - startTimeSeconds).toFixed(2)),
      transcriptText: transcriptText || candidate.transcriptText,
      boundaryQuality: endTimeSeconds > startTimeSeconds ? "GOOD" as const : "BAD" as const,
    },
    warnings: adjusted ? ["SERMON_BOUNDARY_CLAMPED"] : [],
  };
}

function trimCandidateToShortSubrange<T extends LooseClipCandidate>(
  candidate: T,
  segments: TranscriptSegmentRecord[],
) {
  const duration = candidate.durationSeconds ?? ((candidate.endTimeSeconds ?? 0) - (candidate.startTimeSeconds ?? 0));
  if (duration <= MAX_WINDOW_SECONDS) {
    return { adjusted: false, candidate };
  }

  let best: { startIndex: number; endIndex: number; quality: WindowQualityResult } | null = null;
  for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
    for (let endIndex = startIndex; endIndex < segments.length; endIndex += 1) {
      const subDuration = segments[endIndex].endTimeSeconds - segments[startIndex].startTimeSeconds;
      if (subDuration > MAX_WINDOW_SECONDS) break;
      if (subDuration < 45) continue;
      const quality = assessClipWindowQuality(segments.slice(startIndex, endIndex + 1), subDuration);
      if (quality.windowEligibility === "REJECTED") continue;
      if (!best || compareWindowsForQuality(
        {
          startTimeSeconds: segments[startIndex].startTimeSeconds,
          windowQualityScore: quality.windowQualityScore,
          openingHookScore: quality.openingHookScore,
          windowEligibility: quality.windowEligibility === "REPAIRABLE" ? "REPAIRABLE" : "CLEAN",
        },
        {
          startTimeSeconds: segments[best.startIndex].startTimeSeconds,
          windowQualityScore: best.quality.windowQualityScore,
          openingHookScore: best.quality.openingHookScore,
          windowEligibility: best.quality.windowEligibility === "REPAIRABLE" ? "REPAIRABLE" : "CLEAN",
        },
      ) < 0) {
        best = { startIndex, endIndex, quality };
      }
    }
  }

  if (!best) {
    return { adjusted: false, candidate: { ...candidate, boundaryQuality: "NEEDS_REVIEW" as const } };
  }

  const selectedSegments = segments.slice(best.startIndex, best.endIndex + 1);
  const transcriptText = segmentTranscriptText(selectedSegments);
  const startTimeSeconds = selectedSegments[0].startTimeSeconds;
  const endTimeSeconds = selectedSegments[selectedSegments.length - 1].endTimeSeconds;
  const landingSentence = analyzeClipCoherence(transcriptText).evidence.landingText ?? firstCoherenceSentence(transcriptText);
  return {
    adjusted: true,
    candidate: {
      ...candidate,
      startTimeSeconds,
      endTimeSeconds,
      durationSeconds: Number((endTimeSeconds - startTimeSeconds).toFixed(2)),
      transcriptText,
      title: normalizePastorTitle({
        title: candidate.title ?? "",
        transcriptText,
        landingSentence,
        hook: candidate.hook,
      }),
      boundaryQuality: "GOOD" as const,
    },
  };
}

function revalidateCandidateBoundary<T extends LooseClipCandidate>(
  candidate: T,
  segments: TranscriptSegmentRecord[],
) {
  const validation = validateFinalClipBoundary({
    startTimeSeconds: candidate.startTimeSeconds ?? 0,
    endTimeSeconds: candidate.endTimeSeconds ?? 0,
    transcriptText: candidate.transcriptText ?? "",
    segments,
  });
  const unresolvedWarnings = validation.reasons.map((reason) => (
    reason.code === "INVALID_TIMING" ? "INVALID_BOUNDARY" : reason.code
  ));

  return {
    candidate: {
      ...candidate,
      boundaryQuality: validation.quality,
    },
    unresolvedWarnings,
  };
}

function scoreMomentForWindows(moment: MinistryMomentRecord, windows: Array<Pick<ClipWindow, "startTimeSeconds" | "endTimeSeconds" | "transcriptText">>): number {
  const overlapScore = windows.reduce((maxScore, window) => {
    const overlap = overlapDuration(moment.startTimeSeconds, moment.endTimeSeconds, window.startTimeSeconds, window.endTimeSeconds);
    const momentDuration = typeof moment.startTimeSeconds === "number" && typeof moment.endTimeSeconds === "number"
      ? Math.max(1, moment.endTimeSeconds - moment.startTimeSeconds)
      : 1;
    return Math.max(maxScore, overlap / momentDuration);
  }, 0);
  const textScore = moment.transcriptExcerpt
    ? Math.max(...windows.map((window) => tokenContainment(moment.transcriptExcerpt ?? "", window.transcriptText)), 0)
    : 0;

  return Number((overlapScore * 0.7 + textScore * 0.2 + moment.confidenceScore * 0.1).toFixed(4));
}

function selectPromptMinistryMomentsForWindows<T extends MinistryMomentRecord>(windows: ClipWindow[], moments: T[]): T[] {
  return moments
    .map((moment) => ({ moment, score: scoreMomentForWindows(moment, windows) }))
    .filter((item) => item.score >= 0.35)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((item) => item.moment);
}

function getExistingSuggestionReuseDecision(candidates: LooseClipCandidate[]): ExistingSuggestionReuseDecision {
  const reusable: LooseClipCandidate[] = [];
  let duplicateFound = false;

  for (const candidate of sortClipCandidates(candidates)) {
    const policy = evaluateReviewableClipPolicy(candidate, {
      minTranscriptWords: 18,
      minGroundingScore: 0.72,
      minOrderedFlowRatio: 0.82,
      allowBadBoundaryWhenRepairable: true,
      requireActionableEditingSignal: true,
    });
    const pastorGrade =
      hasPastorGradeSignals(candidate, { requireGrounding: true }) ||
      (
        isReviewableEditingCandidate(candidate) &&
        policy.reviewable
      );

    if (!policy.reviewable && !pastorGrade) {
      continue;
    }
    if (!hasPastorGradeTranscript(candidate)) {
      continue;
    }
    if (reusable.some((existing) => isNearDuplicateCandidate(existing, candidate))) {
      duplicateFound = true;
      continue;
    }
    reusable.push(candidate);
  }

  if (reusable.length === candidates.length && candidates.length > 0) {
    return {
      reuse: true,
      reusableCount: reusable.length,
      totalCount: candidates.length,
      reason: candidates.some((candidate) => (candidate.qualityLabel ?? candidate.postReadyStatus) === "NEEDS_EDITING")
        ? "Existing suggestions pass pastor-review reuse checks."
        : "Existing suggestions still pass pastor-grade selection.",
    };
  }

  if (duplicateFound) {
    return {
      reuse: false,
      reusableCount: reusable.length,
      totalCount: candidates.length,
      reason: "Regenerate to remove duplicate saved suggestions from the same sermon section.",
    };
  }

  if (reusable.length > 0) {
    return {
      reuse: false,
      reusableCount: reusable.length,
      totalCount: candidates.length,
      reason: "Regenerate to remove weak saved suggestions while preserving pastor-grade clips.",
    };
  }

  return {
    reuse: false,
    reusableCount: 0,
    totalCount: candidates.length,
    reason: "Existing suggestions are not pastor-grade enough to reuse.",
  };
}

function shouldReplaceExistingSuggestionsBeforeSave(decision: ExistingSuggestionReuseDecision): boolean {
  return !decision.reuse;
}

type ValidatedClipBatch = {
  candidates: ClipJsonCandidate[];
  repairUsed: boolean;
  rejectedReasons: string[];
};

type ClipCandidateRuntimeMetadata = {
  canonicalizationWarnings?: string[] | null;
  responseFormat?: "INDEXED" | "LEGACY_TIMESTAMPS";
};

type ClipJsonCandidateWithRuntimeMetadata = ClipJsonCandidate & ClipCandidateRuntimeMetadata;

type CandidateScopeResult = {
  candidates: ClipJsonCandidateWithRuntimeMetadata[];
  rejectedReasons: string[];
  formatWarnings: string[];
};

type BoundaryAdjustedCandidate = ClipJsonCandidate & ClipCandidateRuntimeMetadata & BoundaryRefinedFields;

type EnrichedClipCandidate = BoundaryAdjustedCandidate & ClipCandidateRuntimeMetadata & {
  ministryMomentId?: string | null;
  smartClipCategory: string;
  intendedAudience: string;
  ministryValue: string;
  socialValue: string;
  suggestedHook?: string;
  suggestedCaption?: string;
  recommendationConfidence?: number;
};

type ExistingClipRange = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
};

function formatSegmentLine(segment: TranscriptSegmentRecord): string {
  const confidenceNote = typeof segment.confidence === "number" && segment.confidence < 0.78
    ? " [wording confidence needs review]"
    : "";
  const speakerNote = segment.speakerLabel ? ` [speaker: ${segment.speakerLabel}]` : "";
  return `[${segment.startTimeSeconds.toFixed(1)} - ${segment.endTimeSeconds.toFixed(1)}]${speakerNote}${confidenceNote} ${segment.text.trim()}`;
}

function countTranscriptWords(text: string): number {
  return (text.normalize("NFKC").match(/[\p{L}\p{M}\p{N}]+(?:[’'][\p{L}\p{M}\p{N}]+)*/gu) ?? []).length;
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

  const scored = moments
    .map((moment) => {
      const categoryMatch = normalizeMomentText(moment.clipCategory) === normalizeMomentText(candidate.smartClipCategory);
      const typeMatch = Boolean(candidate.ministryMomentType) && normalizeMomentText(moment.momentType) === normalizeMomentText(candidate.ministryMomentType);
      const overlap = overlapDuration(moment.startTimeSeconds, moment.endTimeSeconds, candidate.startTimeSeconds, candidate.endTimeSeconds);
      const candidateDuration = Math.max(1, candidate.endTimeSeconds - candidate.startTimeSeconds);
      const overlapRatio = overlap / candidateDuration;
      const excerptText = [
        moment.transcriptExcerpt ?? "",
        moment.description,
        moment.title,
      ].join(" ");
      const candidateText = [
        candidate.transcriptText,
        candidate.reasonSelected,
        candidate.landingSentence,
        candidate.title,
      ].join(" ");
      const evidenceScore = tokenContainment(excerptText, candidateText);
      const score =
        (categoryMatch ? 0.3 : 0) +
        (typeMatch ? 0.2 : 0) +
        Math.min(0.4, overlapRatio * 0.4) +
        Math.min(0.25, evidenceScore * 0.25) +
        Math.min(0.1, moment.confidenceScore * 0.1);

      return { moment, score, overlapRatio, evidenceScore, categoryMatch, typeMatch };
    })
    .sort((left, right) => {
      const scoreDiff = right.score - left.score;
      if (scoreDiff !== 0) return scoreDiff;
      return right.moment.confidenceScore - left.moment.confidenceScore;
    });

  const best = scored[0];
  if (!best || best.score < 0.32) {
    return null;
  }

  return best.moment;
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
    recommendationConfidence: matchedMoment?.confidenceScore ?? candidate.score / 10,
  };
}

function buildRollingWindows(
  segments: TranscriptSegmentRecord[],
  ministryMoments: MinistryMomentRecord[] = [],
  options: { sermonLanguage?: string | null } = {},
): ClipWindow[] {
  if (segments.length === 0) {
    return [];
  }

  const windows: ClipWindow[] = [];

  for (const startIndex of buildWindowAnchors(segments, ministryMoments)) {
    const startSignals = classifySermonSegment(segments[startIndex].text).signals;
    const targetDurations: readonly number[] = startSignals.includes("STORY")
      ? [...WINDOW_TARGET_DURATIONS_SECONDS, 120, 150]
      : startSignals.includes("SCRIPTURE_REFERENCE") || startSignals.includes("PRAYER")
        ? [...WINDOW_TARGET_DURATIONS_SECONDS, 120]
        : WINDOW_TARGET_DURATIONS_SECONDS;
    for (const targetDuration of targetDurations) {
      const endIndex = findEndIndexForTargetDuration(segments, startIndex, targetDuration);
      if (endIndex === null) continue;

      const windowSegments = segments.slice(startIndex, endIndex + 1);
      const quality = assessClipWindowQuality(
        windowSegments,
        segments[endIndex].endTimeSeconds - segments[startIndex].startTimeSeconds,
        options,
      );

      if (quality.accepted) {
        windows.push(makeClipWindow(segments, startIndex, endIndex, windows.length + 1, quality));
        continue;
      }

      if (quality.windowEligibility === "REPAIRABLE") {
        const repair = findRepairableEndIndex(segments, startIndex, endIndex);
        if (repair) {
          const repairedSegments = segments.slice(startIndex, repair.endIndex + 1);
          const repairedQuality = assessClipWindowQuality(
            repairedSegments,
            segments[repair.endIndex].endTimeSeconds - segments[startIndex].startTimeSeconds,
            options,
          );
          windows.push(makeClipWindow(segments, startIndex, repair.endIndex, windows.length + 1, repairedQuality, {
            windowEligibility: "REPAIRABLE",
            repairableWarnings: quality.repairableWarnings,
            landingContextAvailable: repair.landingContextAvailable,
            suggestedExtendedEndTimeSeconds: repair.suggestedExtendedEndTimeSeconds,
          }));
        } else if (!quality.windowQualityWarnings.includes("WINDOW_NO_CLEAR_LANDING")) {
          windows.push(makeClipWindow(segments, startIndex, endIndex, windows.length + 1, quality, {
            windowEligibility: "REPAIRABLE",
            repairableWarnings: quality.repairableWarnings,
          }));
        }
      }
    }
  }

  const unique = new Map<string, ClipWindow>();
  for (const window of windows) {
    const key = `${window.startTimeSeconds}:${window.endTimeSeconds}:${window.windowEligibility ?? "CLEAN"}`;
    const previous = unique.get(key);
    if (!previous || window.windowQualityScore > previous.windowQualityScore) {
      unique.set(key, window);
    }
  }

  return rankClipWindowsForSelection([...unique.values()]).map((window, index) => ({
    ...window,
    windowId: `window-${index + 1}-${Math.round(window.startTimeSeconds)}-${Math.round(window.endTimeSeconds)}`,
  }));
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
      volumeTarget?: ClipVolumeTarget;
    };
    requestedCount?: number;
  },
): Promise<ValidatedClipBatch> {
  const systemPrompt = buildClipSelectionSystemPrompt();
  const userPrompt = buildClipSelectionUserPrompt(
    sermon,
    batch,
    options?.requestedCount ?? MAX_BATCH_CLIPS,
    options?.context,
  );

  const rawResponse = options?.rawResponseOverride ?? (await (async () => {
    const model = resolveOpenAIChatModel("clipSelection");
    const completion = await createLoggedChatCompletion({
      operation: "clip_selection",
      sermonId: sermon.id,
      model,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      promptVersion: "clip-selection-v1",
      metadata: {
        batchWindowCount: batch.length,
        requestedCount: options?.requestedCount ?? MAX_BATCH_CLIPS,
        transcriptCharacters: batch.reduce((total, window) => total + window.transcriptText.length, 0),
      },
      missingKeyMessage: "OPENAI_API_KEY is missing. Add it to your environment before generating clips.",
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
      const model = resolveOpenAIChatModel("clipRepair");
      const repairCompletion = await createLoggedChatCompletion({
        operation: "clip_selection_repair",
        sermonId: sermon.id,
        model,
        response_format: { type: "json_object" },
        temperature: 0,
        messages: [
          { role: "system", content: buildClipSelectionSystemPrompt() },
          { role: "user", content: buildClipRepairPrompt(rawResponse, validationError, batch) },
        ],
        promptVersion: "clip-selection-repair-v1",
        metadata: {
          validationError: validationError.slice(0, 1000),
          batchWindowCount: batch.length,
          rawResponseCharacters: rawResponse.length,
        },
        missingKeyMessage: "OPENAI_API_KEY is missing. Add it to your environment before repairing generated clips.",
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
    const overlapsExisting = deduped.some((existing) => hasSignificantClipOverlap(existing, candidate));

    if (!overlapsExisting) {
      deduped.push(candidate);
    }
  }

  return deduped;
}

function hasSignificantClipOverlap(
  existing: ExistingClipRange,
  candidate: ExistingClipRange,
): boolean {
  const overlapStart = Math.max(existing.startTimeSeconds, candidate.startTimeSeconds);
  const overlapEnd = Math.min(existing.endTimeSeconds, candidate.endTimeSeconds);
  const overlap = Math.max(0, overlapEnd - overlapStart);
  const shorter = Math.min(existing.durationSeconds, candidate.durationSeconds);
  return shorter > 0 && overlap / shorter >= 0.5;
}

function excludeCandidatesOverlappingExisting<T extends ExistingClipRange>(
  candidates: T[],
  existingRanges: ExistingClipRange[],
): T[] {
  if (existingRanges.length === 0) {
    return candidates;
  }

  return candidates.filter((candidate) => (
    !existingRanges.some((existing) => hasSignificantClipOverlap(existing, candidate))
  ));
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

function findCandidateWindow(windowId: string, windows: ClipWindow[]): ClipWindow | undefined {
  const exact = windows.find((item) => item.windowId === windowId);
  if (exact) {
    return exact;
  }

  const localWindowMatch = windowId.trim().match(/^window\s*-?\s*(\d+)$/i);
  const localWindowIndex = localWindowMatch ? Number(localWindowMatch[1]) - 1 : -1;
  return localWindowIndex >= 0 ? windows[localWindowIndex] : undefined;
}

function filterCandidatesToPromptWindows(
  candidates: ClipJsonCandidate[],
  windows: ClipWindow[],
): CandidateScopeResult {
  const scoped: ClipJsonCandidateWithRuntimeMetadata[] = [];
  const rejectedReasons: string[] = [];
  const formatWarnings: string[] = [];

  for (const [index, candidate] of candidates.entries()) {
    if (candidateHasIndexedBoundary(candidate)) {
      const window = findCandidateWindow(candidate.windowId, windows);
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

      if (
        typeof candidate.landingSegmentIndex === "number" &&
        (candidate.landingSegmentIndex < candidate.startSegmentIndex || candidate.landingSegmentIndex > candidate.endSegmentIndex)
      ) {
        rejectedReasons.push(
          `LANDING_SEGMENT_OUTSIDE_RANGE clips.${index}: landingSegmentIndex ${candidate.landingSegmentIndex} is outside selected segment indexes ${candidate.startSegmentIndex}-${candidate.endSegmentIndex}.`,
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
        responseFormat: "INDEXED",
      } as ClipJsonCandidate);
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

    scoped.push({
      ...candidate,
      responseFormat: "LEGACY_TIMESTAMPS",
    } as ClipJsonCandidate);
  }

  return { candidates: scoped, rejectedReasons, formatWarnings };
}

export function shouldPreserveClipDuringRegeneration(clip: { status: string; isManuallyEdited?: boolean }): boolean {
  return clip.status !== "SUGGESTED" || clip.isManuallyEdited === true;
}

export function shouldReuseExistingSuggestions(
  existingSuggestionCount: number,
  force?: boolean,
  target?: Pick<ClipVolumeTarget, "minReviewSuggestions"> | null,
): boolean {
  return shouldReuseClipSuggestionsForTarget({
    existingSuggestionCount,
    force,
    target,
  });
}

export function buildSuggestionDeleteWhere(sermonId: string, targetCategory?: string, includeRejected = false) {
  return {
    sermonId,
    status: includeRejected ? { in: REPLACEABLE_SUGGESTION_STATUSES } : "SUGGESTED" as const,
    isAiGenerated: true,
    isManuallyEdited: false,
    ...(targetCategory ? { smartClipCategory: targetCategory } : {}),
  };
}

function normalizeCandidate<T extends ClipJsonCandidate>(candidate: T): T {
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
        confidence: true,
        speakerLabel: true,
      },
    });

    if (segments.length === 0) {
      throw new Error("Cannot generate clip suggestions because no transcript segments exist.");
    }
    const clipVolumeTarget = resolveClipVolumeTarget(segmentDuration(segments));
    await appendJobLog(
      job.id,
      `Clip volume target for transcript duration: ${clipVolumeTarget.rangeLabel} pastor-review options (target ${clipVolumeTarget.targetReviewSuggestions}).`,
    );

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

    const appendMode = options?.append === true;

    if (!appendMode && shouldReuseExistingSuggestions(
      existingSuggestionCount,
      options?.force,
      options?.targetCategory ? null : clipVolumeTarget,
    )) {
      await updateSermonStatus(sermon.id, "CLIPS_GENERATED");
      await markJobSucceeded(
        job.id,
        `Existing clip suggestions reused (${existingSuggestionCount} available; target range ${clipVolumeTarget.rangeLabel}); skipped AI call.`,
      );
      await appendPipelineLog(
        sermon.id,
        `Existing clip suggestions reused (${existingSuggestionCount} available; target range ${clipVolumeTarget.rangeLabel}); skipped AI call.`,
      );
      return { clipCount: existingSuggestionCount, reusedExistingSuggestions: true };
    }

    const existingClipRanges = appendMode
      ? await prisma.clipCandidate.findMany({
          where: { sermonId: sermon.id },
          select: {
            startTimeSeconds: true,
            endTimeSeconds: true,
            durationSeconds: true,
          },
        })
      : [];

    const transcriptReadiness = assessTranscriptReadinessForClipping(segments);
    const transcriptQualityMode = classifyTranscriptQualityForClipGeneration(transcriptReadiness);
    await appendJobLog(
      job.id,
      `Transcript clip-generation mode: ${transcriptQualityMode}. ${transcriptReadiness.reason} Words: ${transcriptReadiness.wordCount}, meaningful segments: ${transcriptReadiness.meaningfulSegmentCount}.`,
    );

    const windows = buildRollingWindows(segments, ministryMoments, { sermonLanguage: sermon.language });
    const transcriptRescueCandidates = transcriptQualityMode === "READY"
      ? []
      : buildLowTranscriptTimedFallbackCandidates(segments);

    if (windows.length === 0 && transcriptRescueCandidates.length === 0) {
      throw new Error("Unable to build transcript windows suitable for clip generation.");
    }

    if (windows.length === 0) {
      await appendJobLog(
        job.id,
        `Transcript windows were unavailable, but ${transcriptRescueCandidates.length} low-transcript rescue candidate(s) will be saved for pastor review.`,
      );
    }

    const sermonContext: SermonContext = {
      id: sermon.id,
      title: sermon.title,
      speakerName: sermon.speakerName,
      churchName: sermon.churchName,
      language: sermon.language,
    };

    const batches = chunkWindows(windows);
    const collected: ClipJsonCandidateWithRuntimeMetadata[] = [];
    let repairUsedCount = 0;
    const rejectedReasons: string[] = [];

    for (const [index, batch] of batches.entries()) {
      await appendJobLog(job.id, `Generating clip suggestions for batch ${index + 1}/${batches.length}.`);
      const batchMinistryMoments = selectPromptMinistryMomentsForWindows(batch, ministryMoments);
      const batchClipLimit = options?.targetCategory ? Math.min(3, MAX_BATCH_CLIPS) : clipVolumeTarget.batchClipLimit;
      const batchResult = await callClipModel(sermonContext, batch, {
        rawResponseOverride: index === 0 ? options?.responseOverride : undefined,
        repairResponseOverride: index === 0 ? options?.repairResponseOverride : undefined,
        requestedCount: batchClipLimit,
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
              ministryMoments: batchMinistryMoments.map((moment) => ({
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
              volumeTarget: clipVolumeTarget,
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

    if (transcriptRescueCandidates.length > 0) {
      collected.push(...transcriptRescueCandidates.map(normalizeCandidate));
      await appendJobLog(
        job.id,
        `Added ${transcriptRescueCandidates.length} low-transcript rescue candidate(s) to protect recall for uncertain transcript sections.`,
      );
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

    const overlapDeduped = dedupeCandidates(boundaryAdjusted);
    const semanticDedupeResult = semanticDedupeCandidates(overlapDeduped);
    const overlapDuplicateCount = Math.max(0, boundaryAdjusted.length - overlapDeduped.length);
    const semanticDuplicateCount = semanticDedupeResult.duplicates.length;
    const dedupedNewCandidates = semanticDedupeResult.kept
      .sort((left, right) => right.score - left.score);
    const existingOverlapDuplicateCount = appendMode
      ? dedupedNewCandidates.length - excludeCandidatesOverlappingExisting(dedupedNewCandidates, existingClipRanges).length
      : 0;
    let dedupedWithBoundaryFields = excludeCandidatesOverlappingExisting(
      dedupedNewCandidates,
      existingClipRanges,
    );

    if (dedupedWithBoundaryFields.length === 0) {
      throw new Error(appendMode
        ? "Clip generation did not find any new non-overlapping candidates. Try redoing clips from transcript if you want to replace the current set."
        : "Clip generation produced no valid candidates after boundary alignment and deduplication.");
    }

    let totalReviewableSuggestions = appendMode
      ? existingSuggestionCount + dedupedWithBoundaryFields.length
      : dedupedWithBoundaryFields.length;
    let topUpCandidateCount = 0;
    let topUpSavedCount = 0;
    let topUpBoundaryRejectedCount = 0;
    let topUpDuplicateCount = 0;

    if (!options?.targetCategory && totalReviewableSuggestions < clipVolumeTarget.targetReviewSuggestions) {
      const desiredNewClipCount = appendMode
        ? Math.max(0, clipVolumeTarget.targetReviewSuggestions - existingSuggestionCount)
        : clipVolumeTarget.targetReviewSuggestions;
      const topUpNeeded = Math.max(0, desiredNewClipCount - dedupedWithBoundaryFields.length);
      const topUpExcludeRanges = [...existingClipRanges, ...dedupedWithBoundaryFields];
      const topUpSourceCandidates = buildHeuristicClipCandidatesFromWindows(windows, {
        limit: Math.max(topUpNeeded * 3, topUpNeeded + 8),
        excludeRanges: topUpExcludeRanges,
        minWindowQualityScore: 5.8,
        scoreCap: 7.4,
        contextWarning: true,
        reasonSelected: "Deterministic top-up selected this pastor-review option because the first AI pass came in below the sermon volume target and this transcript window has a clear ministry payoff.",
      });
      topUpCandidateCount = topUpSourceCandidates.length;

      const topUpBoundaryAdjusted: EnrichedClipCandidate[] = [];
      for (const [index, candidate] of topUpSourceCandidates.entries()) {
        const adjustedResult = refineClipBoundaries(candidate, segments);
        if (!adjustedResult.accepted) {
          topUpBoundaryRejectedCount += 1;
          boundaryRejected.push(`top-up candidate ${index + 1}: ${adjustedResult.reason}`);
          continue;
        }

        if (adjustedResult.adjusted) {
          boundaryAdjustedCount += 1;
        }

        topUpBoundaryAdjusted.push(enrichCandidate(adjustedResult.candidate, ministryMoments));
      }

      const topUpTimingDeduped = excludeCandidatesOverlappingExisting(
        dedupeCandidates(topUpBoundaryAdjusted),
        topUpExcludeRanges,
      );
      const combinedTimingDedupe = excludeCandidatesOverlappingExisting(
        dedupeCandidates([...dedupedWithBoundaryFields, ...topUpTimingDeduped]),
        existingClipRanges,
      );
      topUpDuplicateCount = Math.max(
        0,
        topUpBoundaryAdjusted.length - Math.max(0, combinedTimingDedupe.length - dedupedWithBoundaryFields.length),
      );

      const beforeTopUpCount = dedupedWithBoundaryFields.length;
      dedupedWithBoundaryFields = combinedTimingDedupe;
      topUpSavedCount = Math.max(0, dedupedWithBoundaryFields.length - beforeTopUpCount);
      totalReviewableSuggestions = appendMode
        ? existingSuggestionCount + dedupedWithBoundaryFields.length
        : dedupedWithBoundaryFields.length;

      if (totalReviewableSuggestions < clipVolumeTarget.targetReviewSuggestions) {
        const coverageNeeded = Math.max(
          0,
          (appendMode ? clipVolumeTarget.targetReviewSuggestions - existingSuggestionCount : clipVolumeTarget.targetReviewSuggestions)
            - dedupedWithBoundaryFields.length,
        );
        const coverageCandidates = buildCoverageTopUpClipCandidates(segments, {
          limit: Math.max(coverageNeeded * 2, coverageNeeded + 8),
          desiredReviewSuggestions: clipVolumeTarget.targetReviewSuggestions,
          excludeRanges: [...existingClipRanges, ...dedupedWithBoundaryFields],
        });
        topUpCandidateCount += coverageCandidates.length;

        const coverageBoundaryAdjusted: EnrichedClipCandidate[] = [];
        for (const [index, candidate] of coverageCandidates.entries()) {
          const adjustedResult = refineClipBoundaries(candidate, segments);
          if (!adjustedResult.accepted) {
            topUpBoundaryRejectedCount += 1;
            boundaryRejected.push(`coverage top-up candidate ${index + 1}: ${adjustedResult.reason}`);
            continue;
          }

          if (adjustedResult.adjusted) {
            boundaryAdjustedCount += 1;
          }

          coverageBoundaryAdjusted.push(enrichCandidate(adjustedResult.candidate, ministryMoments));
        }

        const coverageTimingDeduped = excludeCandidatesOverlappingExisting(
          dedupeCandidates(coverageBoundaryAdjusted),
          [...existingClipRanges, ...dedupedWithBoundaryFields],
        );
        const combinedCoverageTimingDedupe = excludeCandidatesOverlappingExisting(
          dedupeCandidates([...dedupedWithBoundaryFields, ...coverageTimingDeduped]),
          existingClipRanges,
        );
        const beforeCoverageTopUpCount = dedupedWithBoundaryFields.length;
        dedupedWithBoundaryFields = combinedCoverageTimingDedupe;
        const coverageSavedCount = Math.max(0, dedupedWithBoundaryFields.length - beforeCoverageTopUpCount);
        topUpSavedCount += coverageSavedCount;
        topUpDuplicateCount += Math.max(0, coverageBoundaryAdjusted.length - coverageSavedCount);
        totalReviewableSuggestions = appendMode
          ? existingSuggestionCount + dedupedWithBoundaryFields.length
          : dedupedWithBoundaryFields.length;
      }

      await appendJobLog(
        job.id,
        `Deterministic clip top-up considered ${topUpCandidateCount} window candidate(s), added ${topUpSavedCount}, rejected ${topUpBoundaryRejectedCount} by boundary checks, and removed ${topUpDuplicateCount} duplicate/overlapping option(s).`,
      );
    }

    if (!options?.targetCategory && totalReviewableSuggestions < clipVolumeTarget.minReviewSuggestions) {
      throw new Error([
        `Clip generation produced ${totalReviewableSuggestions} pastor-review option(s), below the ${clipVolumeTarget.rangeLabel} target minimum of ${clipVolumeTarget.minReviewSuggestions} for this transcript.`,
        appendMode
          ? `${existingSuggestionCount} existing option(s) plus ${dedupedWithBoundaryFields.length} new non-overlapping option(s) were found.`
          : `${dedupedWithBoundaryFields.length} distinct option(s) were found.`,
        `Top-up considered ${topUpCandidateCount} window candidate(s) and added ${topUpSavedCount}.`,
        `Rejected ${rejectedReasons.length} validation/scope candidate(s), ${boundaryRejected.length} boundary candidate(s), and removed ${overlapDuplicateCount + semanticDuplicateCount + existingOverlapDuplicateCount + topUpDuplicateCount} duplicate/overlapping candidate(s).`,
        "The job was stopped before replacing/saving the low-count result so the review board does not quietly regress.",
      ].join(" "));
    }

    await prisma.$transaction(async (tx) => {
      if (options?.force) {
        await tx.clipCandidate.deleteMany({
          where: buildSuggestionDeleteWhere(sermon.id, options.targetCategory),
        });
      }

      await tx.clipCandidate.createMany({
        data: dedupedWithBoundaryFields.map((candidate) => {
          const candidateSegments = segments.filter((segment) => (
            segment.endTimeSeconds > candidate.startTimeSeconds &&
            segment.startTimeSeconds < candidate.endTimeSeconds
          ));
          const transcriptEvidence = analyzeMultilingualTranscript(candidateSegments);
          const transcriptSafety = decideClipTranscriptSafety({
            sermonLanguage: sermon.language,
            transcriptQualityMode,
            candidate,
            transcriptEvidence,
          });
          const safetyRequiresReview = transcriptSafety.status === "REVIEW_REQUIRED";
          const generatedEvidence = buildGeneratedClipEvidence(candidate, segments, transcriptEvidence);

          return {
            sermonId: sermon.id,
            ministryMomentId: candidate.ministryMomentId ?? null,
            smartClipCategory: candidate.smartClipCategory,
            recommendationReason: candidate.reasonSelected,
            intendedAudience: candidate.intendedAudience,
            ministryValue: candidate.ministryValue,
            socialValue: candidate.socialValue,
            suggestedHook: candidate.suggestedHook ?? candidate.hook,
            suggestedCaption: candidate.suggestedCaption ?? candidate.caption,
            recommendationConfidence: safetyRequiresReview
              ? null
              : candidate.recommendationConfidence ?? candidate.score / 10,
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
            transcriptSafetyStatus: transcriptSafety.status,
            transcriptSafetyReasons: transcriptSafety.reasons,
            title: candidate.title,
            hook: candidate.hook,
            caption: candidate.caption,
            hashtags: candidate.hashtags,
            score: candidate.score,
            reasonSelected: candidate.reasonSelected,
            clipType: candidate.clipType,
            riskLevel: candidate.riskLevel,
            riskReasons: candidate.riskReasons,
            contextWarning: safetyRequiresReview ? true : candidate.contextWarning,
            ...generatedEvidence,
            qualityLabel: safetyRequiresReview ? "NEEDS_EDITING" : undefined,
            postReadyStatus: safetyRequiresReview ? "NEEDS_EDITING" : undefined,
            postReadyBlockers: safetyRequiresReview ? mergeTranscriptSafetyBlocker([]) : undefined,
            recommendedNextAction: safetyRequiresReview ? "REVIEW_CLIP" : undefined,
            pastorFriendlyReason: safetyRequiresReview
              ? "Review the local-language transcript before captions, export, or posting."
              : undefined,
            qualityWarnings: safetyRequiresReview
              ? ["LOCAL_LANGUAGE_TRANSCRIPT_REVIEW_REQUIRED"]
              : undefined,
            status: "SUGGESTED",
          };
        }),
      });
    });

    const savedClips = await prisma.clipCandidate.findMany({
      where: {
        sermonId: sermon.id,
        status: "SUGGESTED",
        isAiGenerated: true,
        isManuallyEdited: false,
        createdAt: { gte: job.createdAt },
        ...(options?.targetCategory ? { smartClipCategory: options.targetCategory } : {}),
      },
      orderBy: [
        { overallPostScore: "desc" },
        { score: "desc" },
        { createdAt: "asc" },
      ],
      select: { id: true },
    });

    let trackedClipCount = 0;
    const clipsToTrack = savedClips.slice(0, INLINE_VIDEO_SUBJECT_TRACKING_LIMIT);
    for (const clip of clipsToTrack) {
      try {
        const trackingResult = await refreshVideoSubjectTracking(clip.id);
        trackedClipCount += 1;
        await appendJobLog(job.id, `Video subject tracking prepared for clip ${clip.id} using ${trackingResult.source}.`);
      } catch (trackingError) {
        const trackingMessage = trackingError instanceof Error ? trackingError.message : "Unknown video subject tracking error.";
        await appendJobLog(job.id, `Video subject tracking skipped for clip ${clip.id}: ${trackingMessage}`);
      }
    }
    if (savedClips.length > clipsToTrack.length) {
      await appendJobLog(
        job.id,
        `Video subject tracking deferred for ${savedClips.length - clipsToTrack.length} clip(s) to keep clip generation responsive.`,
      );
    }

    await updateSermonStatus(sermon.id, "CLIPS_GENERATED");
    const successMessage = [
      `Saved ${dedupedWithBoundaryFields.length} clip suggestions.`,
      `Video subject tracking prepared for ${trackedClipCount}/${savedClips.length} new clip(s).`,
      `Repair used in ${repairUsedCount} batch(es).`,
      `Target duration guidance ${TARGET_MIN_DURATION_SECONDS}-${TARGET_MAX_DURATION_SECONDS}s applied.`,
      `Clip volume target was ${clipVolumeTarget.rangeLabel}; review board has ${totalReviewableSuggestions} option(s).`,
      topUpCandidateCount > 0
        ? `Deterministic top-up considered ${topUpCandidateCount} candidate(s) and added ${topUpSavedCount}.`
        : "Deterministic top-up was not needed.",
      `Boundary adjustments applied to ${boundaryAdjustedCount} candidate(s).`,
      overlapDuplicateCount + semanticDuplicateCount + existingOverlapDuplicateCount + topUpDuplicateCount > 0
        ? `Removed ${overlapDuplicateCount + semanticDuplicateCount + existingOverlapDuplicateCount + topUpDuplicateCount} duplicate candidate(s) before saving (${overlapDuplicateCount} timing, ${semanticDuplicateCount} semantic, ${existingOverlapDuplicateCount} existing overlap, ${topUpDuplicateCount} top-up).`
        : "No duplicate candidates were removed before saving.",
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
  excludeCandidatesOverlappingExisting,
  hasSignificantClipOverlap,
  buildCoverageTopUpClipCandidates,
  buildStructuredGenerationSummary,
  selectBestClipCandidates,
  buildHeuristicClipCandidatesFromWindows,
  isAiQuotaError,
  validatePastorTitle,
  deterministicPastorTitle,
  normalizePastorTitle,
  getExistingSuggestionReuseDecision,
  shouldReplaceExistingSuggestionsBeforeSave,
  selectStrongReviewOnlyClipCandidates,
  selectBoundaryReviewClipCandidates,
  assessTranscriptReadinessForClipping,
  rankClipWindowsForSelection,
  assessClipWindowQuality,
  isReviewOnlyTranscriptUsableForClipGeneration,
  classifyTranscriptQualityForClipGeneration,
  buildLowTranscriptTimedFallbackCandidates,
  isManualRescueTranscriptUsableForClipGeneration,
  selectPromptMinistryMomentsForWindows,
  scoreMomentForWindows,
  assessCandidateTranscriptGrounding,
  assessCandidateLandingEvidence,
  buildGeneratedClipEvidence,
  repairMissingLanding,
  repairWeakOpening,
  clampCandidateToBounds,
  trimCandidateToShortSubrange,
  revalidateCandidateBoundary,
  selectRescueClipCandidates,
};
