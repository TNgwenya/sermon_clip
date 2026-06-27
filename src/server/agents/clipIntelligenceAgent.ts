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
  type ClipJsonCandidate,
  type RawClipJsonCandidate,
  rawClipJsonCandidateSchema,
  rawClipJsonResponseSchema,
} from "@/server/ai/clipJsonSchema";
import { generateMinistryMoments } from "@/server/agents/ministryMomentService";
import {
  refineClipBoundaries,
  validateFinalClipBoundary,
  HARD_MAX_DURATION_SECONDS,
  PREFERRED_MIN_DURATION_SECONDS,
  TARGET_MAX_DURATION_SECONDS,
  TARGET_MIN_DURATION_SECONDS,
  type BoundaryQuality,
  type BoundaryRevalidationResult,
  type BoundaryRefinedFields,
} from "@/server/agents/clipBoundaryRefinement";
import {
  applyHookBoundaryAdjustment,
  type ClipHookAnalysis,
} from "@/server/agents/clipHookAnalysisService";
import {
  reviewClipCompletenessCandidates,
  type ClipCompletenessFields,
} from "@/server/agents/clipCompletenessService";
import { type MinistryMomentRecord as PromptMinistryMomentRecord } from "@/server/ai/ministryMomentSchema";
import { appendPipelineLog } from "@/server/agents/storage";
import { updateSermonStatus } from "@/server/status/sermonStatus";
import { refreshVideoSubjectTracking } from "@/server/agents/videoSubjectTrackingService";
import {
  reviewClipQualityCandidates,
  type ClipQualityReview,
} from "@/server/agents/clipQualityReviewService";
import { refreshClipVisualQuality } from "@/server/agents/clipVisualQualityService";
import {
  scoreProfessionalClipQuality,
  sortByProfessionalQuality,
  type ProfessionalQualityFields,
} from "@/server/agents/clipQualityScoringService";
import {
  semanticDedupeCandidates,
  semanticSimilarity,
  type SemanticDedupeCandidate,
} from "@/server/agents/semanticDedupe";
import {
  analyzeClipCoherence,
  hasCallingGiftStewardshipPayoff,
} from "@/server/agents/clipCoherenceAnalysis";
import {
  countReasonCodes,
  evaluateReviewableClipPolicy,
  isHardQualityWarning,
  nextActionsForWarnings,
} from "@/server/agents/clipCandidatePolicy";
import { assessTranscriptQualityForClipping, type TranscriptQualityAssessment } from "@/server/agents/transcriptQuality";
import {
  applyInferredSermonWindowToSegments,
  inferSermonWindowFromTranscript,
} from "@/server/agents/sermonWindowInference";

export type ClipWindow = {
  windowId: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  transcriptText: string;
  segments?: Array<TranscriptSegmentRecord & { segmentIndex: number }>;
  segmentLines: string[];
  wordCount: number;
  meaningfulSegmentCount: number;
  openingHookScore?: number;
  ministryPayoffScore?: number;
  windowQualityScore: number;
  windowQualityWarnings: string[];
  windowEligibility?: "CLEAN" | "REPAIRABLE" | "REJECT";
  repairableWarnings?: string[];
  landingContextAvailable?: boolean;
  suggestedExtendedEndTimeSeconds?: number | null;
};

type GenerateClipOptions = {
  force?: boolean;
  targetCategory?: string;
  responseOverride?: string;
  repairResponseOverride?: string;
  qualityReviewResponseOverride?: string;
  completenessReviewResponseOverride?: string;
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

type CandidateFunnelDiagnostics = {
  transcriptSegmentsLoaded: number;
  windowsPrepared: number;
  cleanWindows: number;
  repairableWindows: number;
  ministryWindowsPrepared: number;
  aiCandidatesReturned: number;
  indexedAiCandidates: number;
  legacyAiCandidates: number;
  aiCandidatesSchemaValid: number;
  aiCandidatesOutsideWindow: number;
  deterministicCandidatesAdded: number;
  boundaryRepairAttempted: number;
  boundaryRepairSucceeded: number;
  durationTrimAttempted: number;
  durationTrimSucceeded: number;
  landingRepairAttempted: number;
  landingRepairSucceeded: number;
  repairedCleanCount: number;
  unresolvedBoundaryReviewCount: number;
  groundingPassed: number;
  groundingRejected: number;
  hardValidCandidates: number;
  completenessReviewed: number;
  professionallyScored: number;
  dedupeClusters: number;
  duplicatesRemoved: number;
  postReadyCount: number;
  goodNeedsReviewCount: number;
  needsEditingCount: number;
  hardRejectedCount: number;
  rescueCandidatesAdded: number;
  savedCount: number;
  rejectionReasons: Record<string, number>;
  warningReasons: Record<string, number>;
  mismatchCounters: Record<string, number>;
  candidateDiagnosticSamples: Array<{
    title: string;
    responseFormat: CandidateResponseFormat | null;
    startTimeSeconds: number;
    endTimeSeconds: number;
    boundaryQuality: BoundaryQuality;
    openingStatus: string;
    endingStatus: string;
    landingStatus: string;
    completenessAction: string | null;
    completenessSource: string | null;
    completenessWarnings: string[];
    qualityWarnings: string[];
    postReadyStatus: string | null;
    recommendedNextAction: string | null;
  }>;
  openingRepairSamples: Array<{
    attempted: boolean;
    succeeded: boolean;
    originalStartTimeSeconds: number;
    originalEndTimeSeconds: number;
    adjustedStartTimeSeconds: number;
    adjustedEndTimeSeconds: number;
    searchDistanceSeconds: number;
    reason: string;
    finalBoundaryQuality: BoundaryQuality;
    unresolvedWarnings: string[];
  }>;
  landingRepairSamples: Array<{
    attempted: boolean;
    succeeded: boolean;
    originalStartTimeSeconds: number;
    originalEndTimeSeconds: number;
    adjustedStartTimeSeconds: number;
    adjustedEndTimeSeconds: number;
    extendedSeconds: number;
    durationAfterRepairSeconds: number;
    reasonCode: string;
    finalBoundaryQuality: BoundaryQuality;
    unresolvedWarnings: string[];
    selectedEndSegmentStartTimeSeconds: number | null;
    selectedEndSegmentEndTimeSeconds: number | null;
  }>;
  clampRepairSamples: Array<{
    attempted: boolean;
    succeeded: boolean;
    originalStartTimeSeconds: number;
    originalEndTimeSeconds: number;
    adjustedStartTimeSeconds: number;
    adjustedEndTimeSeconds: number;
    finalBoundaryQuality: BoundaryQuality;
    unresolvedWarnings: string[];
  }>;
};

const MODEL_NAME = "gpt-4o-mini";
const WINDOW_STEP_SECONDS = 30;
const MIN_WINDOW_SECONDS = 30;
const QUICK_WINDOW_SECONDS = 45;
const SHORT_WINDOW_SECONDS = 60;
const FOCUSED_WINDOW_SECONDS = 90;
const MAX_WINDOW_SECONDS = 90;
const BATCH_SIZE = 4;
const MAX_BATCH_CLIPS = 8;
const MAX_SERMON_CLIP_SUGGESTIONS = 25;
const MIN_PASTOR_REVIEW_BOARD_OPTIONS = 15;
const MIN_REVIEWABLE_CLIP_SUGGESTIONS = Number(process.env.CLIP_GENERATION_MIN_REVIEWABLE_RESULTS ?? MIN_PASTOR_REVIEW_BOARD_OPTIONS);
const MAX_REVIEWABLE_CLIP_SUGGESTIONS = Number(process.env.CLIP_GENERATION_MAX_REVIEWABLE_RESULTS ?? MAX_SERMON_CLIP_SUGGESTIONS);
const MIN_SELECTION_POST_READY_SCORE = 8.0;
const MIN_GOOD_CLIP_SCORE = 7.6;
const MIN_EDITING_CLIP_SCORE = 7.0;
const MIN_REVIEW_BOARD_SUPPLEMENT_SCORE = 5.8;
const MAX_SELECTED_CLIPS_PER_THEME = 4;
const MAX_SELECTED_GOOD_NEEDS_REVIEW_CLIPS = 18;
const MIN_SELECTION_HOOK_SCORE = 5.8;
const MIN_SELECTION_STANDALONE_SCORE = 6.2;
const MIN_CONTEXT_WARNING_STANDALONE_SCORE = 6.8;
const MIN_SELECTION_ARC_COMPLETENESS_SCORE = 6.2;
const MIN_SELECTION_COMPLETENESS_SCORE = 5.5;
const MIN_SELECTION_TRANSCRIPT_WORDS = 28;
const MIN_SELECTION_WORDS_PER_MINUTE = 32;
const MIN_SELECTION_MINISTRY_PAYOFF_SCORE = 5.0;
const TIME_CLUSTER_SECONDS = 4 * 60;
const MAX_SELECTED_CLIPS_PER_TIME_CLUSTER = 5;
const PASTOR_GRADE_RISK_REASON_PATTERN = /\b(missing setup|unclear reference|does not stand alone|not make sense|need surrounding sermon context|may need surrounding sermon context|end before the thought lands|starts with a connector|incomplete|context risk|transcript text is missing|clip starts mid sentence|clip ends before)\b/i;
const FINAL_SELECTION_SEMANTIC_DUPLICATE_THRESHOLD = 0.62;
const MIN_WINDOW_WORDS_FOR_CLIPPING = 35;
const MIN_WINDOW_MEANINGFUL_SEGMENTS = 3;
const MIN_WINDOW_WORDS_PER_MINUTE = 24;
const MIN_WINDOW_DISTINCT_SERMON_TOKENS = 12;
const MIN_WINDOW_SERMON_TOKEN_COVERAGE_RATIO = 0.28;
const MAX_WINDOW_INTERNAL_GAP_SECONDS = 55;
const MAX_WINDOW_REPEATED_SEGMENT_RATIO = 0.4;
const MINISTRY_MOMENT_WINDOW_CONTEXT_SECONDS = 12;
const MAX_MINISTRY_MOMENT_WINDOW_ANCHORS = 20;
const MAX_PROMPT_MINISTRY_MOMENTS_PER_BATCH = 8;
const MIN_TRANSCRIPT_GROUNDING_TOKENS = 8;
const MIN_TRANSCRIPT_GROUNDING_TOKEN_RATIO = 0.72;
const MIN_TRANSCRIPT_GROUNDING_BIGRAM_RATIO = 0.35;
const MIN_TRANSCRIPT_GROUNDING_ORDERED_RATIO = 0.82;
const STRONG_TRANSCRIPT_GROUNDING_TOKEN_RATIO = 0.86;
const MIN_LANDING_CLAIM_TOKENS = 2;
const MIN_LANDING_CLAIM_MATCHED_TOKENS = 2;
const MIN_LANDING_CLAIM_MATCH_RATIO = 0.45;
const MAX_LANDING_REPAIR_SEARCH_SECONDS = Number(process.env.CLIP_GENERATION_LANDING_REPAIR_SEARCH_SECONDS ?? 36);
const MAX_OPENING_REPAIR_SEARCH_SECONDS = Number(process.env.CLIP_GENERATION_OPENING_REPAIR_SEARCH_SECONDS ?? 18);
const MAX_TRANSCRIPT_GAP_FOR_BOUNDARY_CONFIDENCE_SECONDS = 8;
const DEGRADED_TRANSCRIPT_REVIEW_WARNING = "DEGRADED_TRANSCRIPT_REVIEW_REQUIRED";
const MIN_REVIEW_ONLY_TRANSCRIPT_WORDS = 220;
const MIN_REVIEW_ONLY_MEANINGFUL_SEGMENTS = 10;
const MIN_REVIEW_ONLY_TRANSCRIPT_DURATION_SECONDS = 180;
const MIN_REVIEW_ONLY_COVERAGE_RATIO = 0.05;
const MAX_REVIEW_ONLY_REPEATED_SEGMENT_RATIO = 0.28;
const MAX_REVIEW_ONLY_REPEATED_PHRASE_RATIO = 0.13;
const MAX_REVIEW_ONLY_COARSE_SEGMENT_RATIO = 0.55;
const MAX_REVIEW_ONLY_SEGMENT_DURATION_SECONDS = 120;
const MAX_REVIEW_ONLY_AVERAGE_SEGMENT_DURATION_SECONDS = 60;
const MIN_MANUAL_RESCUE_TRANSCRIPT_WORDS = 70;
const MIN_MANUAL_RESCUE_MEANINGFUL_SEGMENTS = 4;
const MIN_MANUAL_RESCUE_TRANSCRIPT_DURATION_SECONDS = 45;
const MIN_MANUAL_RESCUE_DISTINCT_SERMON_TOKENS = 8;
const MAX_MANUAL_RESCUE_REPEATED_SEGMENT_RATIO = 0.4;
const MAX_MANUAL_RESCUE_REPEATED_PHRASE_RATIO = 0.2;
const MAX_MANUAL_RESCUE_SEGMENT_DURATION_SECONDS = 180;
const MAX_MANUAL_RESCUE_AVERAGE_SEGMENT_DURATION_SECONDS = 95;
const HARD_WINDOW_FAILURE_CODES = new Set([
  "LOW_WINDOW_WORD_COUNT",
  "LOW_WINDOW_SUBSTANCE",
  "LOW_WINDOW_WORD_DENSITY",
  "LOW_WINDOW_DISTINCT_SERMON_SUBSTANCE",
  "LARGE_WINDOW_GAP",
  "REPETITIVE_WINDOW",
]);
const REPAIRABLE_WINDOW_WARNING_CODES = new Set([
  "WINDOW_NO_CLEAR_LANDING",
  "WINDOW_SETUP_WITHOUT_LANDING",
  "WINDOW_DEPENDENT_OPENING",
  "WINDOW_WEAK_OPENING",
]);
const WINDOW_DISTINCT_TOKEN_STOP_WORDS = new Set([
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
type ValidatedClipBatch = {
  candidates: CanonicalClipCandidate[];
  repairUsed: boolean;
  rejectedReasons: string[];
  formatWarnings: string[];
};

type CandidateResponseFormat = "INDEXED" | "LEGACY_TIMESTAMPS";

type CanonicalClipCandidate = Omit<RawClipJsonCandidate, "startTimeSeconds" | "endTimeSeconds" | "durationSeconds" | "transcriptText"> & {
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  transcriptText: string;
  responseFormat?: CandidateResponseFormat;
  canonicalizationWarnings?: string[];
};

type NormalizedClipCandidate = CanonicalClipCandidate & { rawAiCandidate?: RawClipJsonCandidate };
type BoundaryAdjustedCandidate = NormalizedClipCandidate & BoundaryRefinedFields & Partial<ClipHookAnalysis>;

type TranscriptReadiness = TranscriptQualityAssessment;

type TranscriptQualityBand = "READY" | "DEGRADED_USABLE" | "LOW_RESCUE" | "MANUAL_RESCUE" | "UNUSABLE";

type CandidateTranscriptCoverage = {
  transcriptGapInsideSeconds: number;
  endNearFinalTranscriptSegment: boolean;
  transcriptLimitedEnding: boolean;
  startBoundaryCoverageConfidence: number;
  endBoundaryCoverageConfidence: number;
};

type CandidateBoundaryRepairDetails = {
  openingRepair?: {
    attempted: boolean;
    succeeded: boolean;
    originalStartTimeSeconds: number;
    originalEndTimeSeconds: number;
    adjustedStartTimeSeconds: number;
    adjustedEndTimeSeconds: number;
    searchDistanceSeconds: number;
    reason: string;
    finalBoundaryQuality: BoundaryQuality;
    unresolvedWarnings: string[];
  };
};

type TranscriptGroundingFields = {
  transcriptGroundingScore?: number;
  transcriptGroundingReason?: string;
  transcriptGroundingMatchedTokens?: number;
  transcriptGroundingTokenCount?: number;
  transcriptGroundingMatchedBigrams?: number;
  transcriptGroundingBigramCount?: number;
  transcriptGroundingOrderedFlowRatio?: number;
};

type TranscriptGroundedCandidate = BoundaryAdjustedCandidate & TranscriptGroundingFields;

type EnrichedClipCandidate = TranscriptGroundedCandidate & {
  ministryMomentId?: string | null;
  smartClipCategory: string;
  intendedAudience: string;
  ministryValue: string;
  socialValue: string;
  suggestedHook?: string;
  suggestedCaption?: string;
  recommendationConfidence?: number;
  repairWarnings?: string[];
  transcriptCoverage?: CandidateTranscriptCoverage;
  boundaryRepairDetails?: CandidateBoundaryRepairDetails;
};

type CompletenessReviewedClipCandidate = EnrichedClipCandidate & ClipCompletenessFields;
type QualityReviewedClipCandidate = CompletenessReviewedClipCandidate & ClipQualityReview;
type ProfessionalReviewedClipCandidate = Omit<QualityReviewedClipCandidate, "qualityWarnings"> & ProfessionalQualityFields;

type SavedClipSummaryInput = {
  id: string;
  qualityLabel: "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT" | null;
  postReadyStatus?: "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT" | null;
  boundaryQuality?: "GOOD" | "NEEDS_REVIEW" | "BAD" | null;
  rankingCategory: string | null;
  finalQualityScore: number | null;
};

type SelectableClipCandidate = {
  title?: string | null;
  hook?: string | null;
  landingSentence?: string | null;
  ministryValue?: string | null;
  arcType?: string | null;
  selectionReasoning?: {
    clipSummary?: string;
  } | null;
  qualityLabel: "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT" | null;
  finalQualityScore: number | null;
  score: number;
  startTimeSeconds: number;
  endTimeSeconds?: number | null;
  durationSeconds?: number | null;
  transcriptText?: string | null;
  smartClipCategory?: string | null;
  clipType?: string | null;
  hookScore?: number | null;
  standaloneClarityScore?: number | null;
  arcCompletenessScore?: number | null;
  completenessScore?: number | null;
  completenessAction?: string | null;
  boundaryQuality?: "GOOD" | "NEEDS_REVIEW" | "BAD" | null;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | null;
  riskReasons?: string[] | null;
  postReadyStatus?: "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT" | null;
  contextWarning?: boolean | null;
  qualityWarnings?: string[] | null;
  qualityDebugSnapshot?: unknown;
};

type ExistingSuggestionReuseDecision = {
  reuse: boolean;
  reusableCount: number;
  totalCount: number;
  reason: string;
};

const MIN_REUSABLE_TRANSCRIPT_GROUNDING_SCORE = 0.72;

function normalizeThemeKey(candidate: SelectableClipCandidate): string {
  return (candidate.smartClipCategory ?? candidate.clipType ?? "uncategorized")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function hasTimeClusterLimit(candidate: SelectableClipCandidate): boolean {
  return typeof candidate.endTimeSeconds === "number" && candidate.endTimeSeconds > candidate.startTimeSeconds;
}

function isInSameTimeCluster(left: SelectableClipCandidate, right: SelectableClipCandidate): boolean {
  if (!hasTimeClusterLimit(left) || !hasTimeClusterLimit(right)) {
    return false;
  }

  const leftMidpoint = (left.startTimeSeconds + (left.endTimeSeconds ?? left.startTimeSeconds)) / 2;
  const rightMidpoint = (right.startTimeSeconds + (right.endTimeSeconds ?? right.startTimeSeconds)) / 2;
  return Math.abs(leftMidpoint - rightMidpoint) < TIME_CLUSTER_SECONDS;
}

function countSelectionWords(text: string): number {
  return (text.match(/[A-Za-z0-9']+/g) ?? []).length;
}

function resolveSelectionDurationSeconds(candidate: SelectableClipCandidate): number | null {
  if (typeof candidate.durationSeconds === "number" && Number.isFinite(candidate.durationSeconds)) {
    return candidate.durationSeconds;
  }

  if (typeof candidate.endTimeSeconds === "number" && Number.isFinite(candidate.endTimeSeconds)) {
    return Math.max(0, candidate.endTimeSeconds - candidate.startTimeSeconds);
  }

  return null;
}

function readNumberProperty(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object" || !(key in value)) {
    return null;
  }

  const rawValue = (value as Record<string, unknown>)[key];
  return typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
}

function transcriptGroundingSnapshot(candidate: SelectableClipCandidate): {
  score: number | null;
  orderedFlowRatio: number | null;
} | null {
  const snapshot = candidate.qualityDebugSnapshot;
  if (!snapshot || typeof snapshot !== "object" || !("transcriptGrounding" in snapshot)) {
    return null;
  }

  const grounding = (snapshot as { transcriptGrounding?: unknown }).transcriptGrounding;
  if (!grounding || typeof grounding !== "object") {
    return null;
  }

  return {
    score: readNumberProperty(grounding, "score"),
    orderedFlowRatio: readNumberProperty(grounding, "orderedFlowRatio"),
  };
}

function hasReusableReviewBoardSuggestion(candidate: SelectableClipCandidate): boolean {
  const policy = evaluateReviewableClipPolicy(candidate, {
    minTranscriptWords: Math.max(18, Math.floor(MIN_SELECTION_TRANSCRIPT_WORDS * 0.65)),
    minGroundingScore: MIN_REUSABLE_TRANSCRIPT_GROUNDING_SCORE,
    minOrderedFlowRatio: MIN_TRANSCRIPT_GROUNDING_ORDERED_RATIO,
    maxDurationSeconds: HARD_MAX_DURATION_SECONDS,
    allowBadBoundaryWhenRepairable: false,
  });
  if (!policy.reviewable) {
    return false;
  }

  const transcriptText = candidate.transcriptText?.trim() ?? "";
  const qualityWarnings = candidate.qualityWarnings ?? [];
  if (scoreWindowMinistryPayoff(transcriptText) < 4) {
    const isSavedEditingOption = candidate.qualityLabel === "NEEDS_EDITING" || candidate.postReadyStatus === "NEEDS_EDITING";
    const hasActionablePayoffWarning = qualityWarnings.some((warning) => (
      warning === "PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION" ||
      warning === "REVIEW_ENDING" ||
      warning === "NEEDS_CONTEXT_EXTENSION" ||
      warning === "TRANSCRIPT_LIMITED_ENDING"
    ));
    if (!isSavedEditingOption || !hasActionablePayoffWarning) {
      return false;
    }
  }

  return true;
}

function selectReusableReviewBoardSuggestions<T extends SelectableClipCandidate>(candidates: T[]): T[] {
  const selected: T[] = [];
  for (const candidate of candidates.filter(hasReusableReviewBoardSuggestion)) {
    if (isSemanticallyRedundantSelection(candidate, selected)) {
      continue;
    }
    selected.push(candidate);
  }

  return selected;
}

function toSelectionSemanticCandidate(candidate: SelectableClipCandidate): SemanticDedupeCandidate | null {
  const transcriptText = candidate.transcriptText?.trim();
  if (!transcriptText || countSelectionWords(transcriptText) < MIN_SELECTION_TRANSCRIPT_WORDS) {
    return null;
  }

  const durationSeconds = resolveSelectionDurationSeconds(candidate);
  const endTimeSeconds = typeof candidate.endTimeSeconds === "number"
    ? candidate.endTimeSeconds
    : durationSeconds !== null
      ? candidate.startTimeSeconds + durationSeconds
      : candidate.startTimeSeconds;

  return {
    title: candidate.title ?? "",
    hook: candidate.hook ?? "",
    transcriptText,
    startTimeSeconds: candidate.startTimeSeconds,
    endTimeSeconds,
    durationSeconds: durationSeconds ?? Math.max(0, endTimeSeconds - candidate.startTimeSeconds),
    score: candidate.score,
    finalQualityScore: candidate.finalQualityScore,
    hookScore: candidate.hookScore,
    boundaryQualityScore: candidate.boundaryQuality === "GOOD" ? 8 : candidate.boundaryQuality === "NEEDS_REVIEW" ? 6 : null,
    arcCompletenessScore: candidate.arcCompletenessScore,
    smartClipCategory: candidate.smartClipCategory,
    clipType: candidate.clipType,
    landingSentence: candidate.landingSentence,
    ministryValue: candidate.ministryValue,
    arcType: candidate.arcType,
    selectionReasoning: candidate.selectionReasoning,
  };
}

function tokenOverlapStats(leftTokens: string[], rightTokens: string[]): {
  jaccard: number;
  containment: number;
} {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  if (left.size === 0 || right.size === 0) {
    return { jaccard: 0, containment: 0 };
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  return {
    jaccard: intersection / (left.size + right.size - intersection),
    containment: intersection / Math.min(left.size, right.size),
  };
}

function hasSharedSelectionTranscriptSubstance(
  candidate: SemanticDedupeCandidate,
  selectedCandidate: SemanticDedupeCandidate,
): boolean {
  const candidateTokens = transcriptGroundingTokens(candidate.transcriptText);
  const selectedTokens = transcriptGroundingTokens(selectedCandidate.transcriptText);
  const tokenOverlap = tokenOverlapStats(candidateTokens, selectedTokens);
  const bigramOverlap = tokenOverlapStats(
    transcriptGroundingBigrams(candidateTokens),
    transcriptGroundingBigrams(selectedTokens),
  );

  return (
    tokenOverlap.jaccard >= 0.22 ||
    tokenOverlap.containment >= 0.5 ||
    bigramOverlap.jaccard >= 0.1 ||
    bigramOverlap.containment >= 0.35
  );
}

function selectionOverlapRatio(
  candidate: SemanticDedupeCandidate,
  selectedCandidate: SemanticDedupeCandidate,
): number {
  const overlapStart = Math.max(candidate.startTimeSeconds, selectedCandidate.startTimeSeconds);
  const overlapEnd = Math.min(candidate.endTimeSeconds, selectedCandidate.endTimeSeconds);
  const overlapSeconds = Math.max(0, overlapEnd - overlapStart);
  const shorterDuration = Math.min(candidate.durationSeconds, selectedCandidate.durationSeconds);

  return shorterDuration > 0 ? overlapSeconds / shorterDuration : 0;
}

function isSemanticallyRedundantSelection(
  candidate: SelectableClipCandidate,
  selectedCandidates: SelectableClipCandidate[],
): boolean {
  const semanticCandidate = toSelectionSemanticCandidate(candidate);
  if (!semanticCandidate) {
    return false;
  }

  return selectedCandidates.some((selectedCandidate) => {
    const semanticSelected = toSelectionSemanticCandidate(selectedCandidate);
    if (!semanticSelected) {
      return false;
    }

    const candidateMidpoint = (semanticCandidate.startTimeSeconds + semanticCandidate.endTimeSeconds) / 2;
    const selectedMidpoint = (semanticSelected.startTimeSeconds + semanticSelected.endTimeSeconds) / 2;
    if (Math.abs(candidateMidpoint - selectedMidpoint) > TIME_CLUSTER_SECONDS * 1.5) {
      return false;
    }

    const semanticScore = semanticSimilarity(semanticCandidate, semanticSelected);
    const overlapScore = selectionOverlapRatio(semanticCandidate, semanticSelected);
    const hasSharedSubstance = hasSharedSelectionTranscriptSubstance(semanticCandidate, semanticSelected);
    const sameGeneratedLabel = (
      Boolean(semanticCandidate.title.trim()) &&
      semanticCandidate.title.trim().toLowerCase() === semanticSelected.title.trim().toLowerCase()
    ) || (
      Boolean(semanticCandidate.hook.trim()) &&
      semanticCandidate.hook.trim().toLowerCase() === semanticSelected.hook.trim().toLowerCase()
    );

    return (
      (semanticScore >= FINAL_SELECTION_SEMANTIC_DUPLICATE_THRESHOLD && hasSharedSubstance) ||
      (overlapScore >= 0.72 && hasSharedSubstance) ||
      (overlapScore >= 0.58 && sameGeneratedLabel)
    );
  });
}

export function selectBestClipCandidates<T extends SelectableClipCandidate>(candidates: T[]): T[] {
  const sorted = sortByProfessionalQuality(candidates);
  const strongCandidates = sorted.filter((candidate) => {
    if (candidate.qualityLabel === "REJECT") return false;
    if (candidate.qualityLabel === "POST_READY") {
      if (hasPastorGradeSelectionBlocker(candidate)) return false;
      return (candidate.finalQualityScore ?? candidate.score) >= MIN_SELECTION_POST_READY_SCORE;
    }
    if (candidate.qualityLabel === "GOOD_NEEDS_REVIEW") {
      if (hasReviewableSelectionBlocker(candidate)) return false;
      return (candidate.finalQualityScore ?? candidate.score) >= MIN_GOOD_CLIP_SCORE;
    }
    if (candidate.qualityLabel === "NEEDS_EDITING") {
      if (hasEditableSelectionBlocker(candidate)) return false;
      return (candidate.finalQualityScore ?? candidate.score) >= MIN_EDITING_CLIP_SCORE;
    }
    return false;
  });

  const selected: T[] = [];
  const themeCounts = new Map<string, number>();
  let needsReviewCount = 0;

  for (const candidate of strongCandidates) {
    if (candidate.qualityLabel === "GOOD_NEEDS_REVIEW" && needsReviewCount >= MAX_SELECTED_GOOD_NEEDS_REVIEW_CLIPS) {
      continue;
    }

    const theme = normalizeThemeKey(candidate);
    const count = themeCounts.get(theme) ?? 0;
    if (count >= MAX_SELECTED_CLIPS_PER_THEME) {
      continue;
    }
    const nearbySelectedCount = selected.filter((selectedCandidate) => isInSameTimeCluster(candidate, selectedCandidate)).length;
    if (nearbySelectedCount >= MAX_SELECTED_CLIPS_PER_TIME_CLUSTER) {
      continue;
    }
    if (isSemanticallyRedundantSelection(candidate, selected)) {
      continue;
    }

    selected.push(candidate);
    themeCounts.set(theme, count + 1);
    if (candidate.qualityLabel === "GOOD_NEEDS_REVIEW") {
      needsReviewCount += 1;
    }

    if (selected.length >= MAX_SERMON_CLIP_SUGGESTIONS) {
      break;
    }
  }

  return selected;
}

function hasReviewableSelectionBlocker(candidate: SelectableClipCandidate): boolean {
  const transcriptText = candidate.transcriptText?.trim();
  if ("transcriptText" in candidate && !transcriptText) {
    return true;
  }

  if (transcriptText && countSelectionWords(transcriptText) < MIN_SELECTION_TRANSCRIPT_WORDS) {
    return true;
  }

  if (candidate.riskLevel === "HIGH") {
    return true;
  }
  if ((resolveSelectionDurationSeconds(candidate) ?? 0) > TARGET_MAX_DURATION_SECONDS) {
    return true;
  }
  if ((candidate.riskReasons ?? []).some((reason) => PASTOR_GRADE_RISK_REASON_PATTERN.test(reason) && /\b(private|controversial|unsafe|misleading)\b/i.test(reason))) {
    return true;
  }
  if (candidate.qualityLabel === "REJECT" || candidate.qualityLabel === "NEEDS_EDITING") {
    return true;
  }
  if (candidate.postReadyStatus === "NEEDS_EDITING" || candidate.postReadyStatus === "REJECT") {
    return true;
  }
  if ((candidate.qualityWarnings ?? []).some(isHardQualityWarning)) {
    return true;
  }

  return false;
}

function hasEditableSelectionBlocker(candidate: SelectableClipCandidate): boolean {
  const transcriptText = candidate.transcriptText?.trim();
  if ("transcriptText" in candidate && !transcriptText) {
    return true;
  }

  if (transcriptText && countSelectionWords(transcriptText) < MIN_SELECTION_TRANSCRIPT_WORDS) {
    return true;
  }

  if (candidate.riskLevel === "HIGH") {
    return true;
  }
  if ((resolveSelectionDurationSeconds(candidate) ?? 0) > TARGET_MAX_DURATION_SECONDS) {
    return true;
  }
  if (candidate.qualityLabel === "REJECT" || candidate.postReadyStatus === "REJECT") {
    return true;
  }
  if ((candidate.qualityWarnings ?? []).some(isHardQualityWarning)) {
    return true;
  }

  return false;
}

function hasPastorReviewBoardSupplementBlocker(candidate: SelectableClipCandidate): boolean {
  const transcriptText = candidate.transcriptText?.trim();
  if (!transcriptText || countSelectionWords(transcriptText) < MIN_SELECTION_TRANSCRIPT_WORDS) {
    return true;
  }

  if (candidate.riskLevel === "HIGH") {
    return true;
  }

  const directGroundingScore = readNumberProperty(candidate, "transcriptGroundingScore");
  const directOrderedFlowRatio = readNumberProperty(candidate, "transcriptGroundingOrderedFlowRatio");
  const grounding = directGroundingScore !== null
    ? { score: directGroundingScore, orderedFlowRatio: directOrderedFlowRatio }
    : transcriptGroundingSnapshot(candidate);
  if (!grounding || grounding.score === null || grounding.score < 0.72) {
    return true;
  }
  if (grounding.orderedFlowRatio !== null && grounding.orderedFlowRatio < 0.82) {
    return true;
  }

  const durationSeconds = resolveSelectionDurationSeconds(candidate);
  if (durationSeconds !== null && durationSeconds > TARGET_MAX_DURATION_SECONDS) {
    return true;
  }
  const wordCount = countSelectionWords(transcriptText);
  const wordsPerMinute = durationSeconds && durationSeconds > 0 ? (wordCount / durationSeconds) * 60 : null;
  if (
    durationSeconds !== null &&
    durationSeconds >= 45 &&
    wordsPerMinute !== null &&
    wordsPerMinute < MIN_SELECTION_WORDS_PER_MINUTE
  ) {
    return true;
  }

  const warnings = candidate.qualityWarnings ?? [];
  if (warnings.some(isHardQualityWarning)) {
    return true;
  }

  if (warnings.includes("PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION") && scoreWindowMinistryPayoff(transcriptText) < 4) {
    return true;
  }

  return false;
}

function sameCandidateTiming(left: SelectableClipCandidate, right: SelectableClipCandidate): boolean {
  const leftEnd = left.endTimeSeconds ?? left.startTimeSeconds + (left.durationSeconds ?? 0);
  const rightEnd = right.endTimeSeconds ?? right.startTimeSeconds + (right.durationSeconds ?? 0);
  return Math.abs(left.startTimeSeconds - right.startTimeSeconds) < 3 && Math.abs(leftEnd - rightEnd) < 3;
}

function toPastorReviewBoardCandidate<T extends ProfessionalReviewedClipCandidate>(candidate: T): T {
  if (
    candidate.qualityLabel === "POST_READY" &&
    candidate.postReadyStatus === "POST_READY" &&
    (candidate.postReadyBlockers ?? []).length === 0
  ) {
    return candidate;
  }

  const currentScore = candidate.finalQualityScore ?? candidate.score;
  const label = currentScore >= MIN_GOOD_CLIP_SCORE && candidate.boundaryQuality !== "BAD" ? "GOOD_NEEDS_REVIEW" : "NEEDS_EDITING";
  const nextActions = nextActionsForWarnings(candidate.qualityWarnings);
  const reviewNote = label === "GOOD_NEEDS_REVIEW"
    ? "Kept for pastor review because it is grounded, safe, and has a usable sermon moment, even though automated publish gates were conservative."
    : "Kept as an editing option because it is grounded and safe, but needs pastor trimming or caption support before posting.";

  return {
    ...candidate,
    qualityLabel: label,
    postReadyStatus: label,
    recommendedNextAction: nextActions.includes("EXTEND_CONTEXT")
      ? "EXTEND_CONTEXT"
      : nextActions.includes("REVIEW_ENDING")
        ? "TRIM_CLIP"
        : candidate.recommendedNextAction === "REJECT"
          ? "REVIEW_CLIP"
          : candidate.recommendedNextAction ?? (label === "GOOD_NEEDS_REVIEW" ? "REVIEW_CLIP" : "TRIM_CLIP"),
    finalQualityScore: Math.max(currentScore, label === "GOOD_NEEDS_REVIEW" ? 7.6 : 7.05),
    overallPostScore: Math.max(candidate.overallPostScore ?? currentScore, label === "GOOD_NEEDS_REVIEW" ? 7.2 : 6.8),
    qualitySummary: candidate.qualitySummary ? `${candidate.qualitySummary} ${reviewNote}` : reviewNote,
    pastorFriendlyReason: candidate.pastorFriendlyReason
      ? `${candidate.pastorFriendlyReason} ${reviewNote}`
      : reviewNote,
    postReadyBlockers: [
      ...new Set([
        ...(candidate.postReadyBlockers ?? []),
        ...nextActions.map((action) => `Next action: ${action}.`),
        "Needs pastor review because this option was included to broaden the review board before final publishing.",
      ]),
    ],
  };
}

function selectStrongReviewOnlyClipCandidates<T extends SelectableClipCandidate & {
  transcriptGroundingScore?: number | null;
  transcriptGroundingOrderedFlowRatio?: number | null;
}>(candidates: T[]): T[] {
  const sorted = sortByProfessionalQuality(candidates);
  const reviewableCandidates = sorted.filter((candidate) => (
    candidate.qualityLabel === "GOOD_NEEDS_REVIEW" &&
    candidate.riskLevel !== "HIGH" &&
    candidate.boundaryQuality !== "BAD" &&
    (candidate.finalQualityScore ?? candidate.score) >= MIN_GOOD_CLIP_SCORE &&
    (candidate.transcriptGroundingScore ?? 0) >= 0.72 &&
    (candidate.transcriptGroundingOrderedFlowRatio ?? 0) >= 0.82 &&
    Boolean(candidate.transcriptText?.trim()) &&
    countSelectionWords(candidate.transcriptText ?? "") >= MIN_SELECTION_TRANSCRIPT_WORDS &&
    candidate.postReadyStatus !== "NEEDS_EDITING" &&
    candidate.postReadyStatus !== "REJECT"
  ));

  const selected: T[] = [];
  const themeCounts = new Map<string, number>();

  for (const candidate of reviewableCandidates) {
    const theme = normalizeThemeKey(candidate);
    const count = themeCounts.get(theme) ?? 0;
    if (count >= MAX_SELECTED_CLIPS_PER_THEME) {
      continue;
    }
    const nearbySelectedCount = selected.filter((selectedCandidate) => isInSameTimeCluster(candidate, selectedCandidate)).length;
    if (nearbySelectedCount >= MAX_SELECTED_CLIPS_PER_TIME_CLUSTER) {
      continue;
    }
    if (isSemanticallyRedundantSelection(candidate, selected)) {
      continue;
    }

    selected.push(candidate);
    themeCounts.set(theme, count + 1);

    if (selected.length >= MAX_SERMON_CLIP_SUGGESTIONS) {
      break;
    }
  }

  return selected;
}

function selectBoundaryReviewClipCandidates<T extends SelectableClipCandidate & {
  transcriptGroundingScore?: number | null;
  transcriptGroundingOrderedFlowRatio?: number | null;
}>(candidates: T[]): T[] {
  const reviewableCandidates = sortByProfessionalQuality(candidates).filter((candidate) => {
    const transcriptText = candidate.transcriptText?.trim() ?? "";
    const directGroundingScore = readNumberProperty(candidate, "transcriptGroundingScore");
    const directOrderedFlowRatio = readNumberProperty(candidate, "transcriptGroundingOrderedFlowRatio");
    const grounding = directGroundingScore !== null
      ? { score: directGroundingScore, orderedFlowRatio: directOrderedFlowRatio }
      : transcriptGroundingSnapshot(candidate);
    const transcriptWordCount = countSelectionWords(transcriptText);

    return (
      transcriptText.length > 0 &&
      transcriptWordCount >= Math.max(18, Math.floor(MIN_SELECTION_TRANSCRIPT_WORDS * 0.65)) &&
      (resolveSelectionDurationSeconds(candidate) ?? Number.POSITIVE_INFINITY) <= TARGET_MAX_DURATION_SECONDS &&
      candidate.riskLevel !== "HIGH" &&
      (grounding?.score ?? 0) >= 0.85 &&
      (grounding?.orderedFlowRatio ?? 1) >= 0.85
    );
  });

  const selected: T[] = [];
  const themeCounts = new Map<string, number>();

  for (const candidate of reviewableCandidates) {
    const theme = normalizeThemeKey(candidate);
    const themeCount = themeCounts.get(theme) ?? 0;
    if (themeCount >= MAX_SELECTED_CLIPS_PER_THEME) {
      continue;
    }
    if (selected.filter((selectedCandidate) => isInSameTimeCluster(candidate, selectedCandidate)).length >= MAX_SELECTED_CLIPS_PER_TIME_CLUSTER) {
      continue;
    }
    if (isSemanticallyRedundantSelection(candidate, selected)) {
      continue;
    }

    selected.push(candidate);
    themeCounts.set(theme, themeCount + 1);

    if (selected.length >= MIN_PASTOR_REVIEW_BOARD_OPTIONS) {
      break;
    }
  }

  return selected;
}

function selectRescueClipCandidates<T extends ProfessionalReviewedClipCandidate>(
  candidates: T[],
  existingSelected: T[],
  minimumCount = MIN_REVIEWABLE_CLIP_SUGGESTIONS,
  maximumCount = MAX_REVIEWABLE_CLIP_SUGGESTIONS,
): T[] {
  const selected = [...existingSelected];
  const sorted = sortByProfessionalQuality(candidates)
    .filter((candidate) => (
      !selected.some((selectedCandidate) => sameCandidateTiming(candidate, selectedCandidate)) &&
      candidate.riskLevel !== "HIGH" &&
      !(candidate.qualityWarnings ?? []).some(isHardQualityWarning) &&
      (candidate.transcriptGroundingScore ?? 0) >= 0.72 &&
      (candidate.transcriptGroundingOrderedFlowRatio ?? 0) >= 0.82 &&
      candidate.durationSeconds <= TARGET_MAX_DURATION_SECONDS &&
      countSelectionWords(candidate.transcriptText) >= Math.max(18, Math.floor(MIN_SELECTION_TRANSCRIPT_WORDS * 0.65))
    ));

  for (const candidate of sorted) {
    const reviewCandidate = toPastorReviewBoardCandidate(candidate);
    const nearbySelectedCount = selected.filter((selectedCandidate) => isInSameTimeCluster(reviewCandidate, selectedCandidate)).length;
    if (nearbySelectedCount >= MAX_SELECTED_CLIPS_PER_TIME_CLUSTER) {
      continue;
    }
    if (isSemanticallyRedundantSelection(reviewCandidate, selected)) {
      continue;
    }

    selected.push(reviewCandidate);
    if (selected.length >= minimumCount || selected.length >= maximumCount) {
      break;
    }
  }

  if (selected.length < minimumCount) {
    for (const candidate of sorted) {
      if (selected.some((selectedCandidate) => sameCandidateTiming(candidate, selectedCandidate))) {
        continue;
      }
      selected.push(toPastorReviewBoardCandidate(candidate));
      if (selected.length >= minimumCount || selected.length >= maximumCount) {
        break;
      }
    }
  }

  return selected.slice(0, maximumCount);
}

function hasPastorGradeSelectionBlocker(candidate: SelectableClipCandidate): boolean {
  const transcriptText = candidate.transcriptText?.trim();
  if ("transcriptText" in candidate && !transcriptText) {
    return true;
  }

  if (transcriptText) {
    const wordCount = countSelectionWords(transcriptText);
    const durationSeconds = resolveSelectionDurationSeconds(candidate);
    const wordsPerMinute = durationSeconds && durationSeconds > 0 ? (wordCount / durationSeconds) * 60 : null;

    if (wordCount < MIN_SELECTION_TRANSCRIPT_WORDS) {
      return true;
    }

    if (
      durationSeconds !== null &&
      durationSeconds >= 45 &&
      wordsPerMinute !== null &&
      wordsPerMinute < MIN_SELECTION_WORDS_PER_MINUTE
    ) {
      return true;
    }

    if (!hasWindowLanding(transcriptText)) {
      return true;
    }

    if (scoreWindowMinistryPayoff(transcriptText) < MIN_SELECTION_MINISTRY_PAYOFF_SCORE) {
      return true;
    }
  }

  if (candidate.boundaryQuality === "BAD") {
    return true;
  }
  if (
    candidate.qualityLabel === "POST_READY" &&
    candidate.boundaryQuality &&
    candidate.boundaryQuality !== "GOOD"
  ) {
    return true;
  }
  if (candidate.riskLevel === "HIGH") {
    return true;
  }
  if ((candidate.riskReasons ?? []).some((reason) => PASTOR_GRADE_RISK_REASON_PATTERN.test(reason))) {
    return true;
  }
  if (typeof candidate.hookScore === "number" && candidate.hookScore < MIN_SELECTION_HOOK_SCORE) {
    return true;
  }
  if (
    typeof candidate.standaloneClarityScore === "number" &&
    candidate.standaloneClarityScore < MIN_SELECTION_STANDALONE_SCORE
  ) {
    return true;
  }
  if (
    candidate.contextWarning &&
    typeof candidate.standaloneClarityScore === "number" &&
    candidate.standaloneClarityScore < MIN_CONTEXT_WARNING_STANDALONE_SCORE
  ) {
    return true;
  }
  if (
    typeof candidate.arcCompletenessScore === "number" &&
    candidate.arcCompletenessScore < MIN_SELECTION_ARC_COMPLETENESS_SCORE
  ) {
    return true;
  }
  if (
    typeof candidate.completenessScore === "number" &&
    candidate.completenessScore < MIN_SELECTION_COMPLETENESS_SCORE
  ) {
    return true;
  }
  if (candidate.completenessAction === "REJECT_INCOMPLETE") {
    return true;
  }
  if (
    candidate.qualityLabel === "POST_READY" &&
    candidate.postReadyStatus &&
    candidate.postReadyStatus !== "POST_READY"
  ) {
    return true;
  }
  if (candidate.postReadyStatus === "NEEDS_EDITING" || candidate.postReadyStatus === "REJECT") {
    return true;
  }
  if ((candidate.qualityWarnings ?? []).some(isHardQualityWarning)) {
    return true;
  }

  return false;
}

export function buildStructuredGenerationSummary(input: {
  totalCandidatesGenerated: number;
  validCandidates: number;
  boundaryRejectedCount: number;
  validationRejectedCount: number;
  semanticDuplicateCount: number;
  savedClips: SavedClipSummaryInput[];
}) {
  const savedClipLabelOrder = { POST_READY: 0, GOOD_NEEDS_REVIEW: 1, NEEDS_EDITING: 2, REJECT: 3 } as const;
  const rankedSavedClips = [...input.savedClips].sort((left, right) => {
    const leftLabel = getSavedClipRankingLabel(left);
    const rightLabel = getSavedClipRankingLabel(right);
    const labelDiff = savedClipLabelOrder[leftLabel] - savedClipLabelOrder[rightLabel];
    if (labelDiff !== 0) return labelDiff;
    return (right.finalQualityScore ?? 0) - (left.finalQualityScore ?? 0);
  });

  return {
    totalCandidatesGenerated: input.totalCandidatesGenerated,
    validCandidates: input.validCandidates,
    rejectedCandidates: input.boundaryRejectedCount + input.validationRejectedCount,
    postReadyCount: input.savedClips.filter(isSavedPostReadyClip).length,
    needsReviewCount: input.savedClips.filter((clip) => clip.qualityLabel === "GOOD_NEEDS_REVIEW" || (clip.qualityLabel === "POST_READY" && !isSavedPostReadyClip(clip))).length,
    needsEditingCount: input.savedClips.filter((clip) => clip.qualityLabel === "NEEDS_EDITING").length,
    rejectedQualityCount: input.savedClips.filter((clip) => clip.qualityLabel === "REJECT").length,
    bestOverallClipId:
      rankedSavedClips.find((clip) => clip.rankingCategory === "BEST_OVERALL" && isSavedPostReadyClip(clip))?.id ??
      rankedSavedClips[0]?.id ??
      null,
    topClipIds: rankedSavedClips.slice(0, 5).map((clip) => clip.id),
    semanticDuplicateCount: input.semanticDuplicateCount,
  };
}

function isSavedPostReadyClip(clip: SavedClipSummaryInput): boolean {
  return (
    clip.qualityLabel === "POST_READY" &&
    (clip.postReadyStatus === undefined || clip.postReadyStatus === null || clip.postReadyStatus === "POST_READY") &&
    (clip.boundaryQuality === undefined || clip.boundaryQuality === null || clip.boundaryQuality === "GOOD") &&
    (clip.finalQualityScore ?? 0) >= MIN_SELECTION_POST_READY_SCORE
  );
}

function getSavedClipRankingLabel(
  clip: SavedClipSummaryInput,
): NonNullable<SavedClipSummaryInput["qualityLabel"]> {
  if (isSavedPostReadyClip(clip)) {
    return "POST_READY";
  }
  if (clip.qualityLabel === "POST_READY") {
    return "GOOD_NEEDS_REVIEW";
  }
  return clip.qualityLabel ?? "NEEDS_EDITING";
}

function getOpenAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing. Add it to your environment before generating clips.");
  }

  return new OpenAI({ apiKey });
}

function formatSegmentLine(segment: TranscriptSegmentRecord, segmentIndex?: number): string {
  const prefix = typeof segmentIndex === "number" ? `${segmentIndex}: ` : "";
  return `${prefix}[${segment.startTimeSeconds.toFixed(1)} - ${segment.endTimeSeconds.toFixed(1)}] ${segment.text.trim()}`;
}

export function assessTranscriptReadinessForClipping(segments: TranscriptSegmentRecord[]): TranscriptReadiness {
  return assessTranscriptQualityForClipping(segments);
}

function isReviewOnlyTranscriptUsableForClipGeneration(readiness: TranscriptReadiness): boolean {
  if (readiness.ready) {
    return true;
  }

  return (
    readiness.wordCount >= MIN_REVIEW_ONLY_TRANSCRIPT_WORDS &&
    readiness.meaningfulSegmentCount >= MIN_REVIEW_ONLY_MEANINGFUL_SEGMENTS &&
    readiness.durationSeconds >= MIN_REVIEW_ONLY_TRANSCRIPT_DURATION_SECONDS &&
    readiness.coverageRatio >= MIN_REVIEW_ONLY_COVERAGE_RATIO &&
    readiness.distinctSermonTokenCount >= MIN_WINDOW_DISTINCT_SERMON_TOKENS &&
    readiness.repeatedSegmentRatio <= MAX_REVIEW_ONLY_REPEATED_SEGMENT_RATIO &&
    readiness.repeatedPhraseRatio <= MAX_REVIEW_ONLY_REPEATED_PHRASE_RATIO &&
    readiness.coarseSegmentRatio <= MAX_REVIEW_ONLY_COARSE_SEGMENT_RATIO &&
    readiness.maxSegmentDurationSeconds <= MAX_REVIEW_ONLY_SEGMENT_DURATION_SECONDS &&
    readiness.averageSegmentDurationSeconds <= MAX_REVIEW_ONLY_AVERAGE_SEGMENT_DURATION_SECONDS
  );
}

function isManualRescueTranscriptUsableForClipGeneration(readiness: TranscriptReadiness): boolean {
  if (readiness.ready || isReviewOnlyTranscriptUsableForClipGeneration(readiness)) {
    return true;
  }

  return (
    readiness.wordCount >= MIN_MANUAL_RESCUE_TRANSCRIPT_WORDS &&
    readiness.meaningfulSegmentCount >= MIN_MANUAL_RESCUE_MEANINGFUL_SEGMENTS &&
    readiness.durationSeconds >= MIN_MANUAL_RESCUE_TRANSCRIPT_DURATION_SECONDS &&
    readiness.distinctSermonTokenCount >= MIN_MANUAL_RESCUE_DISTINCT_SERMON_TOKENS &&
    readiness.repeatedSegmentRatio <= MAX_MANUAL_RESCUE_REPEATED_SEGMENT_RATIO &&
    readiness.repeatedPhraseRatio <= MAX_MANUAL_RESCUE_REPEATED_PHRASE_RATIO &&
    readiness.maxSegmentDurationSeconds <= MAX_MANUAL_RESCUE_SEGMENT_DURATION_SECONDS &&
    readiness.averageSegmentDurationSeconds <= MAX_MANUAL_RESCUE_AVERAGE_SEGMENT_DURATION_SECONDS
  );
}

function classifyTranscriptQualityForClipGeneration(readiness: TranscriptReadiness): TranscriptQualityBand {
  if (readiness.ready) {
    return "READY";
  }

  if (isReviewOnlyTranscriptUsableForClipGeneration(readiness)) {
    return readiness.coverageRatio >= 0.12 && readiness.meaningfulSegmentCount >= MIN_REVIEW_ONLY_MEANINGFUL_SEGMENTS + 4
      ? "DEGRADED_USABLE"
      : "LOW_RESCUE";
  }

  if (isManualRescueTranscriptUsableForClipGeneration(readiness)) {
    return "MANUAL_RESCUE";
  }

  return "UNUSABLE";
}

function formatTranscriptReadinessSummary(readiness: TranscriptReadiness): string {
  return [
    `${readiness.wordCount} words`,
    `${readiness.meaningfulSegmentCount} meaningful segments`,
    `${Math.round(readiness.durationSeconds)} seconds`,
    `${Math.round(readiness.coverageRatio * 100)}% coverage`,
    `${readiness.wordsPerMinute} words/minute`,
    `max gap ${Math.round(readiness.maxGapSeconds)}s`,
    `max segment ${Math.round(readiness.maxSegmentDurationSeconds)}s`,
    `average segment ${Math.round(readiness.averageSegmentDurationSeconds)}s`,
    `repetition ${Math.round(readiness.repeatedSegmentRatio * 100)}%`,
  ].join(", ");
}

function normalizeMomentText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function textTokens(value: string | null | undefined): Set<string> {
  return new Set(
    normalizeMomentText(value)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/g)
      .filter((token) => token.length > 3),
  );
}

function tokenOverlapScore(left: string | null | undefined, right: string | null | undefined): number {
  const leftTokens = textTokens(left);
  const rightTokens = textTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.min(leftTokens.size, rightTokens.size);
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

function ministryMomentMatchScore(candidate: ClipJsonCandidate, moment: MinistryMomentRecord): number {
  const candidateDuration = Math.max(1, candidate.endTimeSeconds - candidate.startTimeSeconds);
  const momentDuration = typeof moment.startTimeSeconds === "number" && typeof moment.endTimeSeconds === "number"
    ? Math.max(1, moment.endTimeSeconds - moment.startTimeSeconds)
    : candidateDuration;
  const overlap = overlapDuration(moment.startTimeSeconds, moment.endTimeSeconds, candidate.startTimeSeconds, candidate.endTimeSeconds);
  const overlapRatio = overlap / Math.min(candidateDuration, momentDuration);
  const categoryMatch = normalizeMomentText(moment.clipCategory) === normalizeMomentText(candidate.smartClipCategory);
  const typeMatch = normalizeMomentText(moment.momentType) === normalizeMomentText(candidate.ministryMomentType);
  const titleMatch = tokenOverlapScore(candidate.title, moment.title);
  const evidenceMatch = Math.max(
    tokenOverlapScore(candidate.transcriptText, moment.transcriptExcerpt),
    tokenOverlapScore(candidate.reasonSelected, moment.description),
  );
  const hasMomentTiming = typeof moment.startTimeSeconds === "number" && typeof moment.endTimeSeconds === "number";
  const candidateCenter = (candidate.startTimeSeconds + candidate.endTimeSeconds) / 2;
  const momentCenter = hasMomentTiming ? ((moment.startTimeSeconds ?? 0) + (moment.endTimeSeconds ?? 0)) / 2 : null;
  const centerDistance = momentCenter === null ? null : Math.abs(candidateCenter - momentCenter);
  const proximityScore = centerDistance === null ? 0 : Math.max(0, 1 - centerDistance / 180);

  return (
    overlapRatio * 4 +
    (categoryMatch ? 1.6 : 0) +
    (typeMatch ? 1.2 : 0) +
    titleMatch * 0.8 +
    evidenceMatch * 1.4 +
    proximityScore * 0.8 +
    moment.confidenceScore * 0.7
  );
}

export function matchMinistryMoment(candidate: ClipJsonCandidate, moments: MinistryMomentRecord[]): MinistryMomentRecord | null {
  if (moments.length === 0) {
    return null;
  }

  const scored = moments
    .map((moment) => ({
      moment,
      score: ministryMomentMatchScore(candidate, moment),
    }))
    .sort((left, right) => right.score - left.score);
  const best = scored[0];

  return best && best.score >= 1.6 ? best.moment : null;
}

export function enrichCandidate(
  candidate: TranscriptGroundedCandidate & {
    repairWarnings?: string[];
    transcriptCoverage?: CandidateTranscriptCoverage;
    boundaryRepairDetails?: CandidateBoundaryRepairDetails;
  },
  moments: MinistryMomentRecord[],
): EnrichedClipCandidate {
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

function toPromptMinistryMoment(moment: MinistryMomentRecord): PromptMinistryMomentRecord {
  return {
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
  };
}

function scoreMomentForWindows(moment: MinistryMomentRecord, windows: ClipWindow[]): number {
  if (windows.length === 0) {
    return 0;
  }

  if (typeof moment.startTimeSeconds !== "number" || typeof moment.endTimeSeconds !== "number") {
    return moment.confidenceScore * 0.35;
  }

  const scores = windows.map((window) => {
    const overlapStart = Math.max(window.startTimeSeconds, moment.startTimeSeconds ?? 0);
    const overlapEnd = Math.min(window.endTimeSeconds, moment.endTimeSeconds ?? 0);
    const overlapSeconds = Math.max(0, overlapEnd - overlapStart);
    const momentDuration = Math.max(1, (moment.endTimeSeconds ?? 0) - (moment.startTimeSeconds ?? 0));
    const windowDuration = Math.max(1, window.endTimeSeconds - window.startTimeSeconds);
    const overlapRatio = Math.max(overlapSeconds / momentDuration, overlapSeconds / windowDuration);
    if (overlapSeconds === 0) {
      return 0;
    }

    return Number((overlapRatio * 3.2 + moment.confidenceScore).toFixed(3));
  });

  return Math.max(0, ...scores);
}

function selectPromptMinistryMomentsForWindows(
  windows: ClipWindow[],
  moments: MinistryMomentRecord[],
): PromptMinistryMomentRecord[] {
  return moments
    .map((moment) => ({
      moment,
      score: scoreMomentForWindows(moment, windows),
    }))
    .filter(({ score }) => score >= 0.45)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_PROMPT_MINISTRY_MOMENTS_PER_BATCH)
    .map(({ moment }) => toPromptMinistryMoment(moment));
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/g)
    .filter(Boolean)
    .length;
}

function normalizeTranscriptSnippet(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sermonSubstanceTokens(text: string): string[] {
  return normalizeTranscriptSnippet(text)
    .split(/\s+/g)
    .filter((token) => token.length >= 4 && !WINDOW_DISTINCT_TOKEN_STOP_WORDS.has(token));
}

function distinctSermonTokenStats(text: string, wordCount: number): {
  tokenCount: number;
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
    tokenCount: tokens.length,
    tokenCoverageRatio,
    distinctTokenCount,
    distinctTokenRatio,
  };
}

function looksLikeSetupOnlyWindow(text: string): boolean {
  return analyzeClipCoherence(text).setupOnly;
}

function pointsToFutureResponse(text: string): boolean {
  return analyzeClipCoherence(text).pointsToFutureResponse;
}

function hasWindowLanding(text: string): boolean {
  return analyzeClipCoherence(text).landingStatus !== "NONE";
}

function hasCallingGiftPayoff(normalizedText: string): boolean {
  return hasCallingGiftStewardshipPayoff(normalizedText);
}

function openingWindowText(windowSegments: TranscriptSegmentRecord[]): string {
  if (windowSegments.length === 0) {
    return "";
  }

  const firstStart = windowSegments[0].startTimeSeconds;
  const openingSegments = windowSegments.filter((segment, index) => (
    index < 2 ||
    segment.startTimeSeconds - firstStart <= 14
  ));

  return openingSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function scoreWindowOpeningHook(windowSegments: TranscriptSegmentRecord[]): number {
  const openingText = openingWindowText(windowSegments);
  const normalized = normalizeTranscriptSnippet(openingText);
  const openingWordCount = countWords(openingText);

  if (!normalized || openingWordCount < 4) {
    return 2;
  }

  if (looksLikeSetupOnlyWindow(openingText)) {
    return 4.4;
  }

  if (/[?]/.test(openingText) || /\b(what if|why is it|how do you|have you ever|can i tell you|let me ask you|do you know)\b/.test(normalized)) {
    return 8.8;
  }

  if (/\b(you|your|we|the church|believers)\b.{0,70}\b(need|must|cannot|can|will|are called|have to|get to|choose|trust|pray|serve|obey|forgive|surrender|remember|stir up)\b/.test(normalized)) {
    return 8.2;
  }

  if (/\b(fear|pressure|pain|grief|calling|gift|obedience|faith|mercy|grace|hope|forgiveness|purpose|courage)\b.{0,80}\b(god|jesus|christ|lord|spirit|scripture|gospel|church|believer|faith)\b/.test(normalized)) {
    return 7.6;
  }

  if (/\b(god|jesus|christ|lord|holy spirit|scripture|gospel|grace|faith|mercy|hope)\s+(is|has|will|can|does|gives|calls|teaches|reminds|restores|forgives|saves|changes|strengthens|keeps|leads|meets)\b/.test(normalized)) {
    return 7.4;
  }

  const distinctStats = distinctSermonTokenStats(openingText, openingWordCount);
  if (openingWordCount >= 12 && distinctStats.distinctTokenCount >= 6) {
    return 6.2;
  }

  return 5;
}

function scoreWindowMinistryPayoff(windowText: string): number {
  const normalized = normalizeTranscriptSnippet(windowText);
  if (!normalized) {
    return 0;
  }

  let score = hasWindowLanding(windowText) ? 4 : 0;
  if (/\b(today|this week|right now|from here|in this season)\b.{0,90}\b(choose|trust|believe|pray|respond|obey|repent|forgive|serve|surrender|receive|walk|apply|come|give|take|start|stop|remember)\b/.test(normalized)) {
    score += 2.2;
  }
  if (/\b(pray|prayer|altar|come to jesus|give your life|surrender|repent|receive|salvation)\b/.test(normalized)) {
    score += 1.4;
  }
  if (/\b(testimony|i remember|i have seen|god has done|god brought|god healed|god restored|god provided)\b/.test(normalized)) {
    score += 1.2;
  }
  if (/\b(remember this|hear me|never forget|the point is|here is the point|i want you to know)\b/.test(normalized)) {
    score += 1.4;
  }
  if (/\b(fear|pressure|pain|grief|tears|weary|tired|broken|healing|mercy|grace|hope|forgiveness|courage)\b/.test(normalized)) {
    score += 1.1;
  }
  if (/\b(the church|believers|body of christ|somebody|family|neighbor)\b.{0,90}\b(strengthen|serve|encourage|carry|build|heal|help|need|receive)\b/.test(normalized)) {
    score += 1.1;
  }
  if (hasCallingGiftPayoff(normalized)) {
    score += 2;
  }
  if (looksLikeSetupOnlyWindow(windowText)) {
    score -= 1.5;
  }

  return Number(Math.max(0, Math.min(10, score)).toFixed(2));
}

const TRANSCRIPT_GROUNDING_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "being",
  "between",
  "church",
  "could",
  "every",
  "from",
  "have",
  "into",
  "just",
  "like",
  "more",
  "must",
  "pastor",
  "said",
  "says",
  "sermon",
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
  "today",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);
const LANDING_CLAIM_STOP_WORDS = new Set([
  ...TRANSCRIPT_GROUNDING_STOP_WORDS,
  "application",
  "call",
  "candidate",
  "clear",
  "clip",
  "complete",
  "completes",
  "evidence",
  "feels",
  "good",
  "great",
  "landing",
  "lands",
  "moment",
  "pastor",
  "pastoral",
  "powerful",
  "practical",
  "selected",
  "selection",
  "strong",
  "teaching",
  "thought",
  "worth",
]);

function transcriptGroundingTokens(text: string): string[] {
  return normalizeTranscriptSnippet(text)
    .split(/\s+/g)
    .map((token) => token.replace(/'s$/i, ""))
    .map((token) => (token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token))
    .filter((token) => token.length >= 3 && !TRANSCRIPT_GROUNDING_STOP_WORDS.has(token));
}

function landingClaimTokens(text: string): string[] {
  return normalizeTranscriptSnippet(text)
    .split(/\s+/g)
    .map((token) => token.replace(/'s$/i, ""))
    .map((token) => (token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token))
    .filter((token) => token.length >= 3 && !LANDING_CLAIM_STOP_WORDS.has(token));
}

function assessLandingClaimGrounding(input: {
  reasonSelected: string;
  landingSentence?: string | null;
  whyThisClipFeelsComplete?: string | null;
  sourceTranscript: string;
}): {
  accepted: boolean;
  matchedTokens: number;
  tokenCount: number;
  matchRatio: number;
  reason: string;
} {
  const landingSentence = input.landingSentence?.trim();
  const sourceTranscript = input.sourceTranscript;
  if (landingSentence) {
    const landingSnippet = normalizeTranscriptSnippet(landingSentence);
    const sourceSnippet = normalizeTranscriptSnippet(sourceTranscript);
    const landingTokens = landingClaimTokens(landingSentence);
    const sourceTokens = new Set(transcriptGroundingTokens(sourceTranscript));
    const matchedLandingTokens = landingTokens.filter((token) => sourceTokens.has(token)).length;
    const landingMatchRatio = landingTokens.length > 0 ? matchedLandingTokens / landingTokens.length : 0;
    const landingOrderedRatio = transcriptOrderedTokenRatio(landingTokens, transcriptGroundingTokens(sourceTranscript));
    const landingAccepted =
      (landingSnippet.length >= 18 && sourceSnippet.includes(landingSnippet)) ||
      (
        landingTokens.length >= MIN_LANDING_CLAIM_TOKENS &&
        matchedLandingTokens >= MIN_LANDING_CLAIM_MATCHED_TOKENS &&
        landingMatchRatio >= MIN_LANDING_CLAIM_MATCH_RATIO &&
        landingOrderedRatio >= MIN_TRANSCRIPT_GROUNDING_ORDERED_RATIO
      );

    if (!landingAccepted) {
      return {
        accepted: false,
        matchedTokens: matchedLandingTokens,
        tokenCount: landingTokens.length,
        matchRatio: landingMatchRatio,
        reason: `Landing sentence is not grounded in the selected transcript (${matchedLandingTokens}/${landingTokens.length} distinctive tokens, ${Math.round(landingOrderedRatio * 100)}% ordered flow).`,
      };
    }

    return {
      accepted: true,
      matchedTokens: matchedLandingTokens,
      tokenCount: landingTokens.length,
      matchRatio: landingMatchRatio,
      reason: `Landing sentence is grounded in the selected transcript (${matchedLandingTokens}/${landingTokens.length} distinctive tokens, ${Math.round(landingOrderedRatio * 100)}% ordered flow).`,
    };
  }

  const claimTokens = Array.from(new Set(landingClaimTokens([
    landingSentence ?? "",
    input.reasonSelected,
    input.whyThisClipFeelsComplete ?? "",
  ].join(" "))));
  const sourceTokens = new Set(transcriptGroundingTokens(sourceTranscript));
  const matchedTokens = claimTokens.filter((token) => sourceTokens.has(token)).length;
  const matchRatio = claimTokens.length > 0 ? matchedTokens / claimTokens.length : 0;
  const accepted =
    claimTokens.length >= MIN_LANDING_CLAIM_TOKENS &&
    matchedTokens >= MIN_LANDING_CLAIM_MATCHED_TOKENS &&
    matchRatio >= MIN_LANDING_CLAIM_MATCH_RATIO;

  return {
    accepted,
    matchedTokens,
    tokenCount: claimTokens.length,
    matchRatio,
    reason: accepted
      ? `Claimed landing evidence is grounded in the selected transcript (${matchedTokens}/${claimTokens.length} distinctive tokens).`
      : `Claimed landing evidence is too generic or not grounded in the selected transcript (${matchedTokens}/${claimTokens.length} distinctive tokens).`,
  };
}

function transcriptGroundingBigrams(tokens: string[]): string[] {
  const bigrams: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    bigrams.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return bigrams;
}

function transcriptOrderedTokenRatio(candidateTokens: string[], sourceTokens: string[]): number {
  if (candidateTokens.length === 0 || sourceTokens.length === 0) {
    return 0;
  }

  const previousRow = new Array(sourceTokens.length + 1).fill(0) as number[];
  const currentRow = new Array(sourceTokens.length + 1).fill(0) as number[];

  for (let candidateIndex = 1; candidateIndex <= candidateTokens.length; candidateIndex += 1) {
    for (let sourceIndex = 1; sourceIndex <= sourceTokens.length; sourceIndex += 1) {
      currentRow[sourceIndex] = candidateTokens[candidateIndex - 1] === sourceTokens[sourceIndex - 1]
        ? previousRow[sourceIndex - 1] + 1
        : Math.max(previousRow[sourceIndex], currentRow[sourceIndex - 1]);
    }

    for (let sourceIndex = 0; sourceIndex <= sourceTokens.length; sourceIndex += 1) {
      previousRow[sourceIndex] = currentRow[sourceIndex];
      currentRow[sourceIndex] = 0;
    }
  }

  return previousRow[sourceTokens.length] / candidateTokens.length;
}

function transcriptTextForRange(
  segments: TranscriptSegmentRecord[],
  startTimeSeconds: number,
  endTimeSeconds: number,
): string {
  return segments
    .filter((segment) => segment.endTimeSeconds > startTimeSeconds && segment.startTimeSeconds < endTimeSeconds)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
}

function assessCandidateTranscriptGrounding(input: {
  candidateTranscriptText: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  segments: TranscriptSegmentRecord[];
}): {
  accepted: boolean;
  score: number;
  reason: string;
  matchedTokens: number;
  tokenCount: number;
  matchedBigrams: number;
  bigramCount: number;
  orderedFlowRatio: number;
} {
  const sourceTranscript = transcriptTextForRange(input.segments, input.startTimeSeconds, input.endTimeSeconds);
  const candidateSnippet = normalizeTranscriptSnippet(input.candidateTranscriptText);
  const sourceSnippet = normalizeTranscriptSnippet(sourceTranscript);

  if (!sourceSnippet) {
    return {
      accepted: false,
      score: 0,
      reason: "No transcript segments overlap the selected timestamps.",
      matchedTokens: 0,
      tokenCount: 0,
      matchedBigrams: 0,
      bigramCount: 0,
      orderedFlowRatio: 0,
    };
  }

  if (candidateSnippet.length >= 24 && sourceSnippet.includes(candidateSnippet)) {
    const tokenCount = transcriptGroundingTokens(input.candidateTranscriptText).length;
    const bigramCount = Math.max(0, tokenCount - 1);
    return {
      accepted: true,
      score: 1,
      reason: "AI excerpt appears verbatim in the transcript range.",
      matchedTokens: tokenCount,
      tokenCount,
      matchedBigrams: bigramCount,
      bigramCount,
      orderedFlowRatio: 1,
    };
  }

  const candidateTokens = transcriptGroundingTokens(input.candidateTranscriptText);
  const orderedSourceTokens = transcriptGroundingTokens(sourceTranscript);
  const sourceTokens = new Set(orderedSourceTokens);
  const matchedTokens = candidateTokens.filter((token) => sourceTokens.has(token)).length;
  const tokenRatio = candidateTokens.length > 0 ? matchedTokens / candidateTokens.length : 0;

  const candidateBigrams = transcriptGroundingBigrams(candidateTokens);
  const sourceBigrams = new Set(transcriptGroundingBigrams(orderedSourceTokens));
  const matchedBigrams = candidateBigrams.filter((bigram) => sourceBigrams.has(bigram)).length;
  const bigramRatio = candidateBigrams.length > 0 ? matchedBigrams / candidateBigrams.length : 0;
  const orderedRatio = transcriptOrderedTokenRatio(candidateTokens, orderedSourceTokens);
  const score = Number((tokenRatio * 0.55 + bigramRatio * 0.25 + orderedRatio * 0.2).toFixed(3));

  const accepted = candidateTokens.length < MIN_TRANSCRIPT_GROUNDING_TOKENS
    ? tokenRatio >= STRONG_TRANSCRIPT_GROUNDING_TOKEN_RATIO
    : tokenRatio >= MIN_TRANSCRIPT_GROUNDING_TOKEN_RATIO &&
      bigramRatio >= MIN_TRANSCRIPT_GROUNDING_BIGRAM_RATIO &&
      orderedRatio >= MIN_TRANSCRIPT_GROUNDING_ORDERED_RATIO;

  const reason = accepted
    ? `AI excerpt is grounded in transcript range (${matchedTokens}/${candidateTokens.length} tokens, ${matchedBigrams}/${candidateBigrams.length} phrase pairs, ${Math.round(orderedRatio * 100)}% ordered flow).`
    : `AI excerpt is not sufficiently grounded in transcript range (${matchedTokens}/${candidateTokens.length} tokens, ${matchedBigrams}/${candidateBigrams.length} phrase pairs, ${Math.round(orderedRatio * 100)}% ordered flow).`;

  return {
    accepted,
    score,
    reason,
    matchedTokens,
    tokenCount: candidateTokens.length,
    matchedBigrams,
    bigramCount: candidateBigrams.length,
    orderedFlowRatio: orderedRatio,
  };
}

function isLikelyPlaceholderArcTime(value: number, startTimeSeconds: number): boolean {
  return value === 0 && startTimeSeconds > 5;
}

function assessCandidateLandingEvidence(input: {
  candidate: Pick<ClipJsonCandidate,
    | "payoffTime"
    | "applicationTime"
    | "reasonSelected"
    | "landingSentence"
    | "whyThisClipFeelsComplete"
  >;
  startTimeSeconds: number;
  endTimeSeconds: number;
  segments: TranscriptSegmentRecord[];
}): {
  accepted: boolean;
  reason: string;
  hasLanding: boolean;
  checkedArcTimes: number;
  landingClaimGrounded: boolean;
  landingClaimMatchedTokens: number;
  landingClaimTokenCount: number;
  landingClaimMatchRatio: number;
} {
  const sourceTranscript = transcriptTextForRange(input.segments, input.startTimeSeconds, input.endTimeSeconds);
  const hasLanding = hasWindowLanding(sourceTranscript);

  if (!sourceTranscript.trim()) {
    return {
      accepted: false,
      reason: "No transcript text exists in the selected range to prove the clip payoff.",
      hasLanding: false,
      checkedArcTimes: 0,
      landingClaimGrounded: false,
      landingClaimMatchedTokens: 0,
      landingClaimTokenCount: 0,
      landingClaimMatchRatio: 0,
    };
  }

  const landingClaim = assessLandingClaimGrounding({
    reasonSelected: input.candidate.reasonSelected,
    landingSentence: input.candidate.landingSentence,
    whyThisClipFeelsComplete: input.candidate.whyThisClipFeelsComplete,
    sourceTranscript,
  });

  if (!hasLanding && landingClaim.accepted && !looksLikeSetupOnlyWindow(sourceTranscript) && !pointsToFutureResponse(sourceTranscript)) {
    return {
      accepted: true,
      reason: "Selected transcript range does not match landing heuristics, but the AI landing claim is grounded in the spoken transcript; keep for pastor review.",
      hasLanding: false,
      checkedArcTimes: 0,
      landingClaimGrounded: true,
      landingClaimMatchedTokens: landingClaim.matchedTokens,
      landingClaimTokenCount: landingClaim.tokenCount,
      landingClaimMatchRatio: landingClaim.matchRatio,
    };
  }

  if (!hasLanding) {
    return {
      accepted: false,
      reason: "Selected transcript range does not include a clear spoken landing, application, declaration, invitation, or punchline.",
      hasLanding: false,
      checkedArcTimes: 0,
      landingClaimGrounded: false,
      landingClaimMatchedTokens: landingClaim.matchedTokens,
      landingClaimTokenCount: landingClaim.tokenCount,
      landingClaimMatchRatio: landingClaim.matchRatio,
    };
  }

  if (!landingClaim.accepted) {
    return {
      accepted: false,
      reason: landingClaim.reason,
      hasLanding,
      checkedArcTimes: 0,
      landingClaimGrounded: false,
      landingClaimMatchedTokens: landingClaim.matchedTokens,
      landingClaimTokenCount: landingClaim.tokenCount,
      landingClaimMatchRatio: landingClaim.matchRatio,
    };
  }

  const arcTimes = [
    { label: "payoffTime", value: input.candidate.payoffTime },
    { label: "applicationTime", value: input.candidate.applicationTime },
  ].filter((item): item is { label: string; value: number } => (
    typeof item.value === "number" &&
    Number.isFinite(item.value) &&
    !isLikelyPlaceholderArcTime(item.value, input.startTimeSeconds)
  ));

  for (const item of arcTimes) {
    if (item.value < input.startTimeSeconds - 1 || item.value > input.endTimeSeconds + 1) {
      return {
        accepted: false,
        reason: `${item.label} (${item.value}s) is outside the selected clip range (${input.startTimeSeconds}-${input.endTimeSeconds}s).`,
        hasLanding,
        checkedArcTimes: arcTimes.length,
        landingClaimGrounded: true,
        landingClaimMatchedTokens: landingClaim.matchedTokens,
        landingClaimTokenCount: landingClaim.tokenCount,
        landingClaimMatchRatio: landingClaim.matchRatio,
      };
    }
  }

  return {
    accepted: true,
    reason: arcTimes.length > 0
      ? `Selected transcript range contains a spoken landing and ${arcTimes.length} payoff/application timestamp(s) are inside the clip.`
      : "Selected transcript range contains a spoken landing; payoff/application timestamps were not specific enough to check.",
    hasLanding,
    checkedArcTimes: arcTimes.length,
    landingClaimGrounded: true,
    landingClaimMatchedTokens: landingClaim.matchedTokens,
    landingClaimTokenCount: landingClaim.tokenCount,
    landingClaimMatchRatio: landingClaim.matchRatio,
  };
}

function findSegmentWindowForCandidate(
  segments: TranscriptSegmentRecord[],
  startTimeSeconds: number,
  endTimeSeconds: number,
): { startIndex: number; endIndex: number } | null {
  const startIndex = segments.findIndex((segment) => segment.endTimeSeconds > startTimeSeconds);
  if (startIndex === -1) {
    return null;
  }

  let endIndex = startIndex;
  for (let index = startIndex; index < segments.length; index += 1) {
    if (segments[index].startTimeSeconds >= endTimeSeconds) {
      break;
    }
    endIndex = index;
  }

  return { startIndex, endIndex };
}

function candidateTranscriptCoverage(
  segments: TranscriptSegmentRecord[],
  startTimeSeconds: number,
  endTimeSeconds: number,
): CandidateTranscriptCoverage {
  const window = findSegmentWindowForCandidate(segments, startTimeSeconds, endTimeSeconds);
  if (!window) {
    return {
      transcriptGapInsideSeconds: 0,
      endNearFinalTranscriptSegment: false,
      transcriptLimitedEnding: true,
      startBoundaryCoverageConfidence: 0,
      endBoundaryCoverageConfidence: 0,
    };
  }

  const coveredSegments = segments.slice(window.startIndex, window.endIndex + 1);
  const gaps = coveredSegments.slice(1).map((segment, index) => Math.max(0, segment.startTimeSeconds - coveredSegments[index].endTimeSeconds));
  const transcriptGapInsideSeconds = gaps.length > 0 ? Math.max(...gaps) : 0;
  const lastSegment = segments[segments.length - 1];
  const endNearFinalTranscriptSegment = Boolean(lastSegment && Math.abs(lastSegment.endTimeSeconds - coveredSegments[coveredSegments.length - 1].endTimeSeconds) <= 3);
  const transcriptLimitedEnding = endNearFinalTranscriptSegment || transcriptGapInsideSeconds > MAX_TRANSCRIPT_GAP_FOR_BOUNDARY_CONFIDENCE_SECONDS;
  const firstSegment = coveredSegments[0];
  const finalSegment = coveredSegments[coveredSegments.length - 1];

  return {
    transcriptGapInsideSeconds,
    endNearFinalTranscriptSegment,
    transcriptLimitedEnding,
    startBoundaryCoverageConfidence: firstSegment ? Math.max(0, Math.min(1, 1 - Math.abs(firstSegment.startTimeSeconds - startTimeSeconds) / MAX_TRANSCRIPT_GAP_FOR_BOUNDARY_CONFIDENCE_SECONDS)) : 0,
    endBoundaryCoverageConfidence: finalSegment ? Math.max(0, Math.min(1, 1 - Math.abs(finalSegment.endTimeSeconds - endTimeSeconds) / MAX_TRANSCRIPT_GAP_FOR_BOUNDARY_CONFIDENCE_SECONDS)) : 0,
  };
}

function warningsForBoundaryRevalidation(validation: BoundaryRevalidationResult): string[] {
  const warnings = new Set<string>();
  for (const reason of validation.reasons) {
    if (reason.severity === "BAD") {
      warnings.add("INVALID_BOUNDARY");
    }
    if (reason.code === "STARTS_MID_SENTENCE" || reason.code === "DEPENDENT_OPENING") {
      warnings.add("NEEDS_START_TRIM");
    }
    if (reason.code === "CONTEXT_DEPENDENT_OPENING") {
      warnings.add("NEEDS_CONTEXT_EXTENSION");
    }
    if (reason.code === "INCOMPLETE_ENDING") {
      warnings.add("REVIEW_ENDING");
    }
    if (reason.code === "MISSING_TRANSCRIPT" || reason.code === "MISSING_TRANSCRIPT_SEGMENT") {
      warnings.add("TRANSCRIPT_LIMITED_ENDING");
    }
  }

  return [...warnings];
}

function removeStaleStructuralWarnings<T extends CompletenessReviewedClipCandidate>(candidate: T): T {
  const coherence = analyzeClipCoherence(candidate.transcriptText);
  const staleCompletenessWarnings = new Set<string>();

  if (coherence.openingStatus === "CLEAN") {
    staleCompletenessWarnings.add("CONNECTOR_START");
    staleCompletenessWarnings.add("UNRESOLVED_PRONOUN_START");
    staleCompletenessWarnings.add("MISSING_SETUP");
  }
  if (coherence.endingStatus === "CLEAN" && (coherence.landingStatus !== "NONE" || coherence.hasClearTakeaway)) {
    staleCompletenessWarnings.add("INCOMPLETE_ENDING");
    staleCompletenessWarnings.add("MISSING_LANDING");
  }

  const completenessWarnings = candidate.completenessWarnings.filter((warning) => !staleCompletenessWarnings.has(warning));
  const structuralWarningsRemoved = completenessWarnings.length !== candidate.completenessWarnings.length;
  const completenessAction = structuralWarningsRemoved && completenessWarnings.length === 0 && candidate.completenessAction === "NEEDS_REVIEW"
    ? "KEEP_AS_IS"
    : candidate.completenessAction;

  return {
    ...candidate,
    completenessWarnings,
    completenessAction,
    boundaryQuality: structuralWarningsRemoved && completenessWarnings.length === 0 && candidate.boundaryQuality === "NEEDS_REVIEW"
      ? "GOOD"
      : candidate.boundaryQuality,
    contextWarning: structuralWarningsRemoved && completenessWarnings.length === 0 ? false : candidate.contextWarning,
  };
}

function trimCompletenessCandidateToShortSubrange<T extends CompletenessReviewedClipCandidate & BoundaryAdjustedCandidate>(
  candidate: T,
  segments: TranscriptSegmentRecord[],
): { candidate: T; adjusted: boolean } {
  if (candidate.durationSeconds <= TARGET_MAX_DURATION_SECONDS) {
    return { candidate, adjusted: false };
  }

  const trimmed = trimCandidateToShortSubrange(candidate, segments);
  if (!trimmed.adjusted || trimmed.validation.quality === "BAD") {
    return { candidate, adjusted: false };
  }

  return {
    candidate: {
      ...candidate,
      ...trimmed.candidate,
      completenessAction: trimmed.validation.quality === "GOOD" && candidate.completenessAction === "NEEDS_REVIEW"
        ? "KEEP_AS_IS"
        : candidate.completenessAction,
      completenessWarnings: trimmed.validation.quality === "GOOD"
        ? candidate.completenessWarnings.filter((warning) => warning !== "INCOMPLETE_ENDING" && warning !== "MISSING_LANDING")
        : candidate.completenessWarnings,
      repairWarnings: trimmed.validation.quality === "GOOD"
        ? (candidate.repairWarnings ?? []).filter((warning) => warning !== "REVIEW_ENDING" && warning !== "NEEDS_END_TRIM" && warning !== "TRANSCRIPT_LIMITED_ENDING")
        : candidate.repairWarnings,
      contextWarning: trimmed.validation.quality === "GOOD" ? false : candidate.contextWarning,
    },
    adjusted: true,
  };
}

function removeStaleQualityReviewWarnings<T extends QualityReviewedClipCandidate>(candidate: T): T {
  const coherence = analyzeClipCoherence(candidate.transcriptText);
  if (coherence.openingStatus !== "CLEAN" || coherence.endingStatus !== "CLEAN") {
    return candidate;
  }

  const staleWarnings = new Set<string>(["INCOMPLETE_THOUGHT", "AWKWARD_BOUNDARY"]);
  const qualityWarnings = candidate.qualityWarnings.filter((warning) => !staleWarnings.has(warning));

  return {
    ...candidate,
    qualityWarnings,
    boundaryQuality: candidate.boundaryQuality === "NEEDS_REVIEW" && qualityWarnings.length < candidate.qualityWarnings.length
      ? "GOOD"
      : candidate.boundaryQuality,
  };
}

function removeRepairWarnings(warnings: string[], staleWarnings: string[]): string[] {
  const stale = new Set(staleWarnings);
  return warnings.filter((warning) => !stale.has(warning));
}

function revalidateCandidateBoundary<T extends BoundaryAdjustedCandidate>(
  candidate: T,
  segments: TranscriptSegmentRecord[],
  bounds?: { startTimeSeconds?: number | null; endTimeSeconds?: number | null },
): { candidate: T; validation: BoundaryRevalidationResult; unresolvedWarnings: string[] } {
  const validation = validateFinalClipBoundary({
    startTimeSeconds: candidate.startTimeSeconds,
    endTimeSeconds: candidate.endTimeSeconds,
    transcriptText: candidate.transcriptText,
    segments,
    sermonStartSeconds: bounds?.startTimeSeconds,
    sermonEndSeconds: bounds?.endTimeSeconds,
  });

  return {
    candidate: {
      ...candidate,
      durationSeconds: validation.durationSeconds,
      boundaryQuality: validation.quality,
      boundaryAdjustmentReason: validation.reasons.length > 0
        ? `${candidate.boundaryAdjustmentReason} Final boundary validation ${validation.quality}: ${validation.reasons.map((reason) => reason.message).join(" ")}`
        : `${candidate.boundaryAdjustmentReason} Final boundary validation GOOD.`,
    },
    validation,
    unresolvedWarnings: warningsForBoundaryRevalidation(validation),
  };
}

function trimCandidateToShortSubrange<T extends BoundaryAdjustedCandidate>(
  candidate: T,
  segments: TranscriptSegmentRecord[],
): { candidate: T; adjusted: boolean; validation: BoundaryRevalidationResult; unresolvedWarnings: string[] } {
  if (candidate.durationSeconds <= TARGET_MAX_DURATION_SECONDS) {
    const revalidated = revalidateCandidateBoundary(candidate, segments);
    return { ...revalidated, adjusted: false };
  }

  const window = findSegmentWindowForCandidate(segments, candidate.startTimeSeconds, candidate.endTimeSeconds);
  if (!window) {
    const revalidated = revalidateCandidateBoundary(candidate, segments);
    return { ...revalidated, adjusted: false };
  }

  const endSegment = segments[window.endIndex];
  const cleanStartCandidates: number[] = [];
  const fallbackStartCandidates: number[] = [];

  for (let index = window.startIndex; index <= window.endIndex; index += 1) {
    const segment = segments[index];
    const durationSeconds = endSegment.endTimeSeconds - segment.startTimeSeconds;
    if (durationSeconds < PREFERRED_MIN_DURATION_SECONDS || durationSeconds > TARGET_MAX_DURATION_SECONDS) {
      continue;
    }

    fallbackStartCandidates.push(index);
    if (analyzeClipCoherence(segment.text).openingStatus === "CLEAN" && countWords(segment.text) >= 4) {
      cleanStartCandidates.push(index);
    }
  }

  const selectedStartIndex = cleanStartCandidates[0] ?? fallbackStartCandidates[0] ?? null;
  if (selectedStartIndex === null || selectedStartIndex === window.startIndex) {
    const revalidated = revalidateCandidateBoundary(candidate, segments);
    return { ...revalidated, adjusted: false };
  }

  const selectedStartSegment = segments[selectedStartIndex];
  const transcriptText = segments.slice(selectedStartIndex, window.endIndex + 1).map((segment) => segment.text.trim()).filter(Boolean).join(" ");
  const trimmedCandidate = {
    ...candidate,
    startTimeSeconds: selectedStartSegment.startTimeSeconds,
    durationSeconds: Number((endSegment.endTimeSeconds - selectedStartSegment.startTimeSeconds).toFixed(2)),
    adjustedStartTimeSeconds: selectedStartSegment.startTimeSeconds,
    transcriptText,
    title: normalizePastorTitle({
      title: candidate.title,
      transcriptText,
      landingSentence: candidate.landingSentence,
      hook: candidate.hook,
    }),
    boundaryAdjustmentReason: `${candidate.boundaryAdjustmentReason} Trimmed to a ${PREFERRED_MIN_DURATION_SECONDS}-${TARGET_MAX_DURATION_SECONDS}s short-form subrange while preserving the landing.`,
  };
  const revalidated = revalidateCandidateBoundary(trimmedCandidate, segments);

  if (revalidated.validation.quality === "BAD") {
    const originalRevalidation = revalidateCandidateBoundary(candidate, segments);
    return { ...originalRevalidation, adjusted: false };
  }

  return {
    ...revalidated,
    adjusted: true,
  };
}

function repairMissingLanding<T extends BoundaryAdjustedCandidate>(
  candidate: T,
  segments: TranscriptSegmentRecord[],
): {
  candidate: T;
  adjusted: boolean;
  warnings: string[];
  coverage: CandidateTranscriptCoverage;
  validation: BoundaryRevalidationResult;
  unresolvedWarnings: string[];
  originalBoundary: { startTimeSeconds: number; endTimeSeconds: number };
} {
  const originalBoundary = {
    startTimeSeconds: candidate.startTimeSeconds,
    endTimeSeconds: candidate.endTimeSeconds,
  };
  const window = findSegmentWindowForCandidate(segments, candidate.startTimeSeconds, candidate.endTimeSeconds);
  const initialRevalidation = revalidateCandidateBoundary(candidate, segments);
  if (!window) {
    const unresolvedWarnings = Array.from(new Set([
      ...initialRevalidation.unresolvedWarnings,
      "TRANSCRIPT_LIMITED_ENDING",
    ]));
    return {
      candidate: {
        ...initialRevalidation.candidate,
        boundaryQuality: initialRevalidation.validation.quality === "BAD" ? "BAD" : "NEEDS_REVIEW",
      },
      adjusted: false,
      warnings: unresolvedWarnings,
      coverage: candidateTranscriptCoverage(segments, candidate.startTimeSeconds, candidate.endTimeSeconds),
      validation: initialRevalidation.validation,
      unresolvedWarnings,
      originalBoundary,
    };
  }

  const startSegment = segments[window.startIndex];
  let bestEndIndex = window.endIndex;
  let landingFound = hasWindowLanding(transcriptTextForRange(segments, candidate.startTimeSeconds, candidate.endTimeSeconds));

  while (!landingFound && bestEndIndex < segments.length - 1) {
    const next = segments[bestEndIndex + 1];
    const extensionSeconds = next.endTimeSeconds - candidate.endTimeSeconds;
    const projectedDuration = next.endTimeSeconds - startSegment.startTimeSeconds;
    if (extensionSeconds > MAX_LANDING_REPAIR_SEARCH_SECONDS || projectedDuration > HARD_MAX_DURATION_SECONDS) {
      break;
    }

    bestEndIndex += 1;
    landingFound = hasWindowLanding(segments.slice(window.startIndex, bestEndIndex + 1).map((segment) => segment.text).join(" "));
    if (landingFound) {
      break;
    }
  }

  if (!landingFound) {
    const coverage = candidateTranscriptCoverage(segments, candidate.startTimeSeconds, candidate.endTimeSeconds);
    const unresolvedValidation = revalidateCandidateBoundary(candidate, segments);
    const unresolvedWarnings = Array.from(new Set([
      ...unresolvedValidation.unresolvedWarnings.filter((warning) => warning !== "NEEDS_START_TRIM"),
      coverage.transcriptLimitedEnding ? "TRANSCRIPT_LIMITED_ENDING" : "REVIEW_ENDING",
    ]));
    return {
      candidate: {
        ...unresolvedValidation.candidate,
        boundaryQuality: unresolvedValidation.validation.quality === "BAD" ? "BAD" : "NEEDS_REVIEW",
      },
      adjusted: false,
      warnings: unresolvedWarnings,
      coverage,
      validation: unresolvedValidation.validation,
      unresolvedWarnings,
      originalBoundary,
    };
  }

  const repairedEnd = segments[bestEndIndex].endTimeSeconds;
  const transcriptText = segments.slice(window.startIndex, bestEndIndex + 1).map((segment) => segment.text.trim()).filter(Boolean).join(" ");
  const repairedCandidate = {
    ...candidate,
    endTimeSeconds: repairedEnd,
    durationSeconds: Number((repairedEnd - candidate.startTimeSeconds).toFixed(2)),
    adjustedEndTimeSeconds: repairedEnd,
    transcriptText,
    boundaryAdjustmentReason: `${candidate.boundaryAdjustmentReason} End extended to transcript segment boundary for landing repair.`,
  };
  const revalidated = revalidateCandidateBoundary(repairedCandidate, segments);
  const adjusted = repairedEnd !== candidate.endTimeSeconds;
  const unresolvedWarnings = adjusted && revalidated.validation.quality === "GOOD"
    ? removeRepairWarnings(revalidated.unresolvedWarnings, ["NEEDS_END_TRIM", "REVIEW_ENDING", "NEEDS_CONTEXT_EXTENSION"])
    : revalidated.unresolvedWarnings;

  return {
    candidate: revalidated.candidate,
    adjusted,
    warnings: adjusted
      ? Array.from(new Set(["LANDING_REPAIRED", ...unresolvedWarnings]))
      : unresolvedWarnings,
    coverage: candidateTranscriptCoverage(segments, repairedCandidate.startTimeSeconds, repairedCandidate.endTimeSeconds),
    validation: revalidated.validation,
    unresolvedWarnings,
    originalBoundary,
  };
}

function hasDependentOpening(text: string): boolean {
  return /^(and|so|but|because|then|now|therefore|also|well|okay|ok)\b[,\s]/i.test(text.trim());
}

function hasCompleteOpeningSetup(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || hasDependentOpening(normalized)) {
    return false;
  }

  const openingSentence = normalized.split(/[.!?]/)[0] ?? normalized;
  return countWords(openingSentence) >= 5;
}

function repairWeakOpening<T extends BoundaryAdjustedCandidate>(
  candidate: T,
  segments: TranscriptSegmentRecord[],
): { candidate: T; adjusted: boolean; warnings: string[]; details: NonNullable<CandidateBoundaryRepairDetails["openingRepair"]>; validation: BoundaryRevalidationResult } {
  const originalBoundary = {
    startTimeSeconds: candidate.startTimeSeconds,
    endTimeSeconds: candidate.endTimeSeconds,
  };
  if (!hasDependentOpening(candidate.transcriptText)) {
    const revalidated = revalidateCandidateBoundary(candidate, segments);
    return {
      candidate: revalidated.candidate,
      adjusted: false,
      warnings: revalidated.unresolvedWarnings,
      details: {
        attempted: false,
        succeeded: false,
        originalStartTimeSeconds: originalBoundary.startTimeSeconds,
        originalEndTimeSeconds: originalBoundary.endTimeSeconds,
        adjustedStartTimeSeconds: revalidated.candidate.startTimeSeconds,
        adjustedEndTimeSeconds: revalidated.candidate.endTimeSeconds,
        searchDistanceSeconds: 0,
        reason: "Opening already starts with an independent phrase.",
        finalBoundaryQuality: revalidated.validation.quality,
        unresolvedWarnings: revalidated.unresolvedWarnings,
      },
      validation: revalidated.validation,
    };
  }

  const window = findSegmentWindowForCandidate(segments, candidate.startTimeSeconds, candidate.endTimeSeconds);
  if (!window) {
    const revalidated = revalidateCandidateBoundary(candidate, segments);
    return {
      candidate: {
        ...revalidated.candidate,
        boundaryQuality: revalidated.validation.quality === "BAD" ? "BAD" : "NEEDS_REVIEW",
      },
      adjusted: false,
      warnings: ["NEEDS_START_TRIM"],
      details: {
        attempted: true,
        succeeded: false,
        originalStartTimeSeconds: originalBoundary.startTimeSeconds,
        originalEndTimeSeconds: originalBoundary.endTimeSeconds,
        adjustedStartTimeSeconds: revalidated.candidate.startTimeSeconds,
        adjustedEndTimeSeconds: revalidated.candidate.endTimeSeconds,
        searchDistanceSeconds: 0,
        reason: "Opening starts dependently, but transcript coverage was unavailable for backward repair.",
        finalBoundaryQuality: revalidated.validation.quality,
        unresolvedWarnings: ["NEEDS_START_TRIM"],
      },
      validation: revalidated.validation,
    };
  }

  for (let index = window.startIndex - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    const searchDistanceSeconds = candidate.startTimeSeconds - segment.startTimeSeconds;
    if (searchDistanceSeconds > MAX_OPENING_REPAIR_SEARCH_SECONDS) {
      break;
    }

    const projectedDurationSeconds = candidate.endTimeSeconds - segment.startTimeSeconds;
    if (projectedDurationSeconds > HARD_MAX_DURATION_SECONDS) {
      continue;
    }

    const transcriptText = segments
      .slice(index, window.endIndex + 1)
      .map((coveredSegment) => coveredSegment.text.trim())
      .filter(Boolean)
      .join(" ");

    if (!hasCompleteOpeningSetup(transcriptText)) {
      continue;
    }

    const repairedCandidate = {
      ...candidate,
      startTimeSeconds: segment.startTimeSeconds,
      durationSeconds: Number(projectedDurationSeconds.toFixed(2)),
      adjustedStartTimeSeconds: segment.startTimeSeconds,
      transcriptText,
      boundaryAdjustmentReason: `${candidate.boundaryAdjustmentReason} Start moved earlier by ${Number(searchDistanceSeconds.toFixed(2))}s to include a complete opening setup.`,
    };
    const revalidated = revalidateCandidateBoundary(repairedCandidate, segments);
    const unresolvedWarnings = revalidated.validation.quality === "GOOD"
      ? removeRepairWarnings(revalidated.unresolvedWarnings, ["NEEDS_START_TRIM", "NEEDS_CONTEXT_EXTENSION"])
      : revalidated.unresolvedWarnings;

    return {
      candidate: revalidated.candidate,
      adjusted: true,
      warnings: Array.from(new Set(["OPENING_REPAIRED", ...unresolvedWarnings])),
      details: {
        attempted: true,
        succeeded: revalidated.validation.quality === "GOOD",
        originalStartTimeSeconds: originalBoundary.startTimeSeconds,
        originalEndTimeSeconds: originalBoundary.endTimeSeconds,
        adjustedStartTimeSeconds: segment.startTimeSeconds,
        adjustedEndTimeSeconds: revalidated.candidate.endTimeSeconds,
        searchDistanceSeconds: Number(searchDistanceSeconds.toFixed(2)),
        reason: "Opening started with a dependent connector; repair found an earlier complete setup segment.",
        finalBoundaryQuality: revalidated.validation.quality,
        unresolvedWarnings,
      },
      validation: revalidated.validation,
    };
  }

  const revalidated = revalidateCandidateBoundary(candidate, segments);
  const unresolvedWarnings = Array.from(new Set([...revalidated.unresolvedWarnings, "NEEDS_START_TRIM"]));
  return {
    candidate: {
      ...revalidated.candidate,
      boundaryQuality: revalidated.validation.quality === "BAD" ? "BAD" : "NEEDS_REVIEW",
    },
    adjusted: false,
    warnings: unresolvedWarnings,
    details: {
      attempted: true,
      succeeded: false,
      originalStartTimeSeconds: originalBoundary.startTimeSeconds,
      originalEndTimeSeconds: originalBoundary.endTimeSeconds,
      adjustedStartTimeSeconds: revalidated.candidate.startTimeSeconds,
      adjustedEndTimeSeconds: revalidated.candidate.endTimeSeconds,
      searchDistanceSeconds: 0,
      reason: "Opening starts dependently and no stronger setup was found within the configured search window.",
      finalBoundaryQuality: revalidated.validation.quality === "BAD" ? "BAD" : "NEEDS_REVIEW",
      unresolvedWarnings,
    },
    validation: revalidated.validation,
  };
}

function clampCandidateToBounds<T extends BoundaryAdjustedCandidate>(
  candidate: T,
  segments: TranscriptSegmentRecord[],
  bounds: { startTimeSeconds?: number | null; endTimeSeconds?: number | null },
): {
  candidate: T;
  adjusted: boolean;
  warnings: string[];
  validation: BoundaryRevalidationResult;
  unresolvedWarnings: string[];
  originalBoundary: { startTimeSeconds: number; endTimeSeconds: number };
} {
  const originalBoundary = {
    startTimeSeconds: candidate.startTimeSeconds,
    endTimeSeconds: candidate.endTimeSeconds,
  };
  const boundedStart = typeof bounds.startTimeSeconds === "number"
    ? Math.max(candidate.startTimeSeconds, bounds.startTimeSeconds)
    : candidate.startTimeSeconds;
  const boundedEnd = typeof bounds.endTimeSeconds === "number"
    ? Math.min(candidate.endTimeSeconds, bounds.endTimeSeconds)
    : candidate.endTimeSeconds;

  if (boundedStart === candidate.startTimeSeconds && boundedEnd === candidate.endTimeSeconds) {
    const revalidated = revalidateCandidateBoundary(candidate, segments, bounds);
    return {
      candidate: revalidated.candidate,
      adjusted: false,
      warnings: revalidated.unresolvedWarnings,
      validation: revalidated.validation,
      unresolvedWarnings: revalidated.unresolvedWarnings,
      originalBoundary,
    };
  }

  const transcriptText = transcriptTextForRange(segments, boundedStart, boundedEnd) || candidate.transcriptText;
  const repairedCandidate = {
    ...candidate,
    startTimeSeconds: boundedStart,
    endTimeSeconds: boundedEnd,
    durationSeconds: Number((boundedEnd - boundedStart).toFixed(2)),
    adjustedStartTimeSeconds: boundedStart !== candidate.startTimeSeconds ? boundedStart : candidate.adjustedStartTimeSeconds,
    adjustedEndTimeSeconds: boundedEnd !== candidate.endTimeSeconds ? boundedEnd : candidate.adjustedEndTimeSeconds,
    transcriptText,
    boundaryAdjustmentReason: `${candidate.boundaryAdjustmentReason} Clamped to configured sermon/source bounds.`,
  };
  const revalidated = revalidateCandidateBoundary(repairedCandidate, segments, bounds);
  const unresolvedWarnings = revalidated.validation.quality === "GOOD"
    ? []
    : revalidated.unresolvedWarnings;

  return {
    candidate: revalidated.candidate,
    adjusted: true,
    warnings: Array.from(new Set(["SERMON_BOUNDARY_CLAMPED", ...unresolvedWarnings])),
    validation: revalidated.validation,
    unresolvedWarnings,
    originalBoundary,
  };
}

function assessClipWindowQuality(
  windowSegments: TranscriptSegmentRecord[],
  durationSeconds: number,
): {
  accepted: boolean;
  wordCount: number;
  meaningfulSegmentCount: number;
  sermonTokenCoverageRatio: number;
  distinctSermonTokenCount: number;
  distinctSermonTokenRatio: number;
  openingHookScore: number;
  ministryPayoffScore: number;
  windowQualityScore: number;
  windowQualityWarnings: string[];
  hardWindowFailures: string[];
  repairableWarnings: string[];
  windowEligibility: "CLEAN" | "REPAIRABLE" | "REJECT";
  landingContextAvailable: boolean;
  suggestedExtendedEndTimeSeconds: number | null;
} {
  const wordCount = windowSegments.reduce((total, segment) => total + countWords(segment.text), 0);
  const windowText = windowSegments.map((segment) => segment.text).join(" ");
  const distinctStats = distinctSermonTokenStats(windowText, wordCount);
  const hasLanding = hasWindowLanding(windowText);
  const openingStatus = analyzeClipCoherence(windowSegments[0]?.text ?? windowText).openingStatus;
  const openingHookScore = scoreWindowOpeningHook(windowSegments);
  const ministryPayoffScore = scoreWindowMinistryPayoff(windowText);
  const setupOnly = looksLikeSetupOnlyWindow(windowText) && !hasLanding;
  const meaningfulSegmentCount = windowSegments.filter((segment) => countWords(segment.text) >= 4).length;
  const wordsPerMinute = durationSeconds > 0 ? (wordCount / durationSeconds) * 60 : 0;
  const gaps = windowSegments.slice(1).map((segment, index) => Math.max(0, segment.startTimeSeconds - windowSegments[index].endTimeSeconds));
  const maxGapSeconds = gaps.length > 0 ? Math.max(...gaps) : 0;
  const normalizedSegments = windowSegments
    .map((segment) => normalizeTranscriptSnippet(segment.text))
    .filter((text) => countWords(text) >= 4);
  const seen = new Set<string>();
  let repeatedSegments = 0;
  for (const text of normalizedSegments) {
    if (seen.has(text)) {
      repeatedSegments += 1;
    } else {
      seen.add(text);
    }
  }
  const repeatedSegmentRatio = normalizedSegments.length > 0 ? repeatedSegments / normalizedSegments.length : 0;
  const windowQualityWarnings: string[] = [];

  if (wordCount < MIN_WINDOW_WORDS_FOR_CLIPPING) {
    windowQualityWarnings.push("LOW_WINDOW_WORD_COUNT");
  }
  if (meaningfulSegmentCount < MIN_WINDOW_MEANINGFUL_SEGMENTS) {
    windowQualityWarnings.push("LOW_WINDOW_SUBSTANCE");
  }
  if (wordsPerMinute < MIN_WINDOW_WORDS_PER_MINUTE) {
    windowQualityWarnings.push("LOW_WINDOW_WORD_DENSITY");
  }
  if (
    distinctStats.distinctTokenCount < MIN_WINDOW_DISTINCT_SERMON_TOKENS &&
    distinctStats.tokenCoverageRatio < MIN_WINDOW_SERMON_TOKEN_COVERAGE_RATIO
  ) {
    windowQualityWarnings.push("LOW_WINDOW_DISTINCT_SERMON_SUBSTANCE");
  }
  if (maxGapSeconds > MAX_WINDOW_INTERNAL_GAP_SECONDS) {
    windowQualityWarnings.push("LARGE_WINDOW_GAP");
  }
  if (repeatedSegmentRatio > MAX_WINDOW_REPEATED_SEGMENT_RATIO) {
    windowQualityWarnings.push("REPETITIVE_WINDOW");
  }
  if (setupOnly) {
    windowQualityWarnings.push("WINDOW_SETUP_WITHOUT_LANDING");
  }
  if (!hasLanding) {
    windowQualityWarnings.push("WINDOW_NO_CLEAR_LANDING");
  }
  if (openingStatus === "DEPENDENT" || openingStatus === "MID_SENTENCE") {
    windowQualityWarnings.push("WINDOW_DEPENDENT_OPENING");
  } else if (openingStatus === "SOFT_CONNECTOR") {
    windowQualityWarnings.push("WINDOW_WEAK_OPENING");
  }

  const hardWindowFailures = windowQualityWarnings.filter((warning) => HARD_WINDOW_FAILURE_CODES.has(warning));
  const repairableWarnings = windowQualityWarnings.filter((warning) => REPAIRABLE_WINDOW_WARNING_CODES.has(warning));
  const windowEligibility = hardWindowFailures.length > 0
    ? "REJECT"
    : repairableWarnings.length > 0
      ? "REPAIRABLE"
      : "CLEAN";

  const densityScore = Math.min(10, wordsPerMinute / 10);
  const substanceScore = Math.min(10, meaningfulSegmentCount * 1.6);
  const repetitionPenalty = repeatedSegmentRatio * 4;
  const gapPenalty = maxGapSeconds > MAX_WINDOW_INTERNAL_GAP_SECONDS ? 2 : 0;
  const landingBonus = hasLanding ? 0.8 : 0;
  const setupPenalty = setupOnly ? 1.5 : 0;
  const windowQualityScore = Number(Math.max(0, Math.min(10, densityScore * 0.3 + substanceScore * 0.28 + openingHookScore * 0.17 + ministryPayoffScore * 0.18 + 0.9 + landingBonus - repetitionPenalty - gapPenalty - setupPenalty)).toFixed(2));

  return {
    accepted: windowEligibility !== "REJECT" && repairableWarnings.length === 0,
    wordCount,
    meaningfulSegmentCount,
    sermonTokenCoverageRatio: distinctStats.tokenCoverageRatio,
    distinctSermonTokenCount: distinctStats.distinctTokenCount,
    distinctSermonTokenRatio: distinctStats.distinctTokenRatio,
    openingHookScore,
    ministryPayoffScore,
    windowQualityScore,
    windowQualityWarnings,
    hardWindowFailures,
    repairableWarnings,
    windowEligibility,
    landingContextAvailable: hasLanding,
    suggestedExtendedEndTimeSeconds: hasLanding ? windowSegments[windowSegments.length - 1]?.endTimeSeconds ?? null : null,
  };
}

function findSegmentIndexAtOrBeforeTime(segments: TranscriptSegmentRecord[], targetSeconds: number): number {
  if (segments.length === 0) {
    return -1;
  }

  let selectedIndex = 0;
  for (const [index, segment] of segments.entries()) {
    if (segment.startTimeSeconds > targetSeconds) {
      break;
    }
    selectedIndex = index;
  }

  return selectedIndex;
}

function collectMinistryMomentAnchorIndices(
  segments: TranscriptSegmentRecord[],
  ministryMoments: MinistryMomentRecord[],
): number[] {
  if (segments.length === 0 || ministryMoments.length === 0) {
    return [];
  }

  const anchors = new Set<number>();
  const momentsWithTiming = ministryMoments
    .filter((moment) => typeof moment.startTimeSeconds === "number" && typeof moment.endTimeSeconds === "number")
    .sort((left, right) => right.confidenceScore - left.confidenceScore)
    .slice(0, MAX_MINISTRY_MOMENT_WINDOW_ANCHORS);

  for (const moment of momentsWithTiming) {
    const momentStart = moment.startTimeSeconds ?? 0;
    const momentEnd = moment.endTimeSeconds ?? momentStart;
    const contextStart = Math.max(0, momentStart - MINISTRY_MOMENT_WINDOW_CONTEXT_SECONDS);
    const focusedStart = Math.max(0, momentEnd - FOCUSED_WINDOW_SECONDS);

    anchors.add(findSegmentIndexAtOrBeforeTime(segments, contextStart));
    anchors.add(findSegmentIndexAtOrBeforeTime(segments, momentStart));
    anchors.add(findSegmentIndexAtOrBeforeTime(segments, focusedStart));
  }

  return [...anchors].filter((index) => index >= 0).sort((left, right) => left - right);
}

function buildRollingWindows(
  segments: TranscriptSegmentRecord[],
  ministryMoments: MinistryMomentRecord[] = [],
): ClipWindow[] {
  if (segments.length === 0) {
    return [];
  }

  const windows: ClipWindow[] = [];
  const seenWindowKeys = new Set<string>();
  let startIndex = 0;

  function findForwardLandingEndIndex(startIndexForWindow: number, endIndexForWindow: number): number | null {
    const startSegment = segments[startIndexForWindow];
    const originalEndSegment = segments[endIndexForWindow];
    let candidateEndIndex = endIndexForWindow;

    while (candidateEndIndex < segments.length - 1) {
      const next = segments[candidateEndIndex + 1];
      if (next.startTimeSeconds - originalEndSegment.endTimeSeconds > MAX_LANDING_REPAIR_SEARCH_SECONDS) {
        break;
      }
      if (next.endTimeSeconds - startSegment.startTimeSeconds > HARD_MAX_DURATION_SECONDS) {
        break;
      }

      candidateEndIndex += 1;
      const transcriptText = segments.slice(startIndexForWindow, candidateEndIndex + 1).map((segment) => segment.text).join(" ");
      if (hasWindowLanding(transcriptText) && !pointsToFutureResponse(transcriptText)) {
        return candidateEndIndex;
      }
    }

    return null;
  }

  function findBackwardOpeningStartIndex(startIndexForWindow: number, endIndexForWindow: number): number | null {
    const endSegment = segments[endIndexForWindow];
    for (let index = startIndexForWindow - 1; index >= 0; index -= 1) {
      const segment = segments[index];
      if (segments[startIndexForWindow].startTimeSeconds - segment.startTimeSeconds > MAX_OPENING_REPAIR_SEARCH_SECONDS) {
        break;
      }
      if (endSegment.endTimeSeconds - segment.startTimeSeconds > HARD_MAX_DURATION_SECONDS) {
        break;
      }

      const openingStatus = analyzeClipCoherence(segment.text).openingStatus;
      if (openingStatus === "CLEAN" && countWords(segment.text) >= 4) {
        return index;
      }
    }

    return null;
  }

  function addWindow(startIndexForWindow: number, endIndexForWindow: number): void {
    let repairedStartIndex = startIndexForWindow;
    let repairedEndIndex = endIndexForWindow;
    let startSegment = segments[repairedStartIndex];
    let endSegment = segments[repairedEndIndex];
    const durationSeconds = Number((endSegment.endTimeSeconds - startSegment.startTimeSeconds).toFixed(3));
    if (durationSeconds < MIN_WINDOW_SECONDS || durationSeconds > MAX_WINDOW_SECONDS) {
      return;
    }

    const originalWindowSegments = segments.slice(startIndexForWindow, endIndexForWindow + 1);
    const originalWindowQuality = assessClipWindowQuality(originalWindowSegments, durationSeconds);
    if (originalWindowQuality.windowEligibility === "REJECT") {
      return;
    }

    const repairableWarnings = [...originalWindowQuality.repairableWarnings];
    let landingContextAvailable = originalWindowQuality.landingContextAvailable;
    let suggestedExtendedEndTimeSeconds: number | null = originalWindowQuality.suggestedExtendedEndTimeSeconds;
    let windowEligibility = originalWindowQuality.windowEligibility;

    if (
      repairableWarnings.includes("WINDOW_NO_CLEAR_LANDING") ||
      repairableWarnings.includes("WINDOW_SETUP_WITHOUT_LANDING")
    ) {
      const landingEndIndex = findForwardLandingEndIndex(startIndexForWindow, endIndexForWindow);
      if (landingEndIndex === null) {
        return;
      }

      repairedEndIndex = landingEndIndex;
      landingContextAvailable = true;
      suggestedExtendedEndTimeSeconds = segments[landingEndIndex].endTimeSeconds;
      windowEligibility = "REPAIRABLE";
    }

    if (
      repairableWarnings.includes("WINDOW_DEPENDENT_OPENING") ||
      repairableWarnings.includes("WINDOW_WEAK_OPENING")
    ) {
      const openingStartIndex = findBackwardOpeningStartIndex(startIndexForWindow, repairedEndIndex);
      if (openingStartIndex === null) {
        return;
      }

      repairedStartIndex = openingStartIndex;
      windowEligibility = "REPAIRABLE";
    }

    startSegment = segments[repairedStartIndex];
    endSegment = segments[repairedEndIndex];
    const repairedDurationSeconds = Number((endSegment.endTimeSeconds - startSegment.startTimeSeconds).toFixed(3));
    if (repairedDurationSeconds < MIN_WINDOW_SECONDS || repairedDurationSeconds > HARD_MAX_DURATION_SECONDS) {
      return;
    }

    const key = `${startSegment.startTimeSeconds}:${endSegment.endTimeSeconds}`;
    if (seenWindowKeys.has(key)) {
      return;
    }

    const windowSegments = segments.slice(repairedStartIndex, repairedEndIndex + 1);
    const windowQuality = assessClipWindowQuality(windowSegments, repairedDurationSeconds);
    const finalRepairableWarnings = Array.from(new Set([
      ...repairableWarnings,
      ...(windowEligibility === "REPAIRABLE" ? windowQuality.repairableWarnings : []),
    ]));

    seenWindowKeys.add(key);
    const indexedSegments = windowSegments.map((segment, segmentIndex) => ({
      ...segment,
      segmentIndex,
    }));
    windows.push({
      windowId: `window-${windows.length + 1}-${Math.round(startSegment.startTimeSeconds)}-${Math.round(endSegment.endTimeSeconds)}`,
      startTimeSeconds: startSegment.startTimeSeconds,
      endTimeSeconds: endSegment.endTimeSeconds,
      durationSeconds: repairedDurationSeconds,
      transcriptText: windowSegments.map((segment) => segment.text.trim()).join(" "),
      segments: indexedSegments,
      segmentLines: indexedSegments.map((segment) => formatSegmentLine(segment, segment.segmentIndex)),
      wordCount: windowQuality.wordCount,
      meaningfulSegmentCount: windowQuality.meaningfulSegmentCount,
      openingHookScore: windowQuality.openingHookScore,
      ministryPayoffScore: windowQuality.ministryPayoffScore,
      windowQualityScore: windowQuality.windowQualityScore,
      windowQualityWarnings: Array.from(new Set([
        ...windowQuality.windowQualityWarnings.filter((warning) => HARD_WINDOW_FAILURE_CODES.has(warning)),
        ...finalRepairableWarnings,
      ])),
      windowEligibility,
      repairableWarnings: finalRepairableWarnings,
      landingContextAvailable,
      suggestedExtendedEndTimeSeconds,
    });
  }

  function findEndIndexForMaxDuration(startIndexForWindow: number, maxDurationSeconds: number): number {
    const startSegment = segments[startIndexForWindow];
    let endIndex = startIndexForWindow;
    while (
      endIndex < segments.length - 1 &&
      segments[endIndex + 1].startTimeSeconds - segments[endIndex].endTimeSeconds <= MAX_WINDOW_INTERNAL_GAP_SECONDS &&
      segments[endIndex + 1].endTimeSeconds - startSegment.startTimeSeconds <= maxDurationSeconds
    ) {
      endIndex += 1;
    }

    while (
      endIndex > startIndexForWindow &&
      segments[endIndex].endTimeSeconds - startSegment.startTimeSeconds > maxDurationSeconds
    ) {
      endIndex -= 1;
    }

    return endIndex;
  }

  while (startIndex < segments.length) {
    const startSegment = segments[startIndex];
    addWindow(startIndex, findEndIndexForMaxDuration(startIndex, QUICK_WINDOW_SECONDS));
    addWindow(startIndex, findEndIndexForMaxDuration(startIndex, SHORT_WINDOW_SECONDS));
    addWindow(startIndex, findEndIndexForMaxDuration(startIndex, FOCUSED_WINDOW_SECONDS));

    const nextStartTime = startSegment.startTimeSeconds + WINDOW_STEP_SECONDS;
    const nextIndex = segments.findIndex(
      (segment, index) => index > startIndex && segment.startTimeSeconds >= nextStartTime,
    );

    if (nextIndex === -1) {
      break;
    }

    startIndex = nextIndex;
  }

  for (const anchorIndex of collectMinistryMomentAnchorIndices(segments, ministryMoments)) {
    addWindow(anchorIndex, findEndIndexForMaxDuration(anchorIndex, QUICK_WINDOW_SECONDS));
    addWindow(anchorIndex, findEndIndexForMaxDuration(anchorIndex, SHORT_WINDOW_SECONDS));
    addWindow(anchorIndex, findEndIndexForMaxDuration(anchorIndex, FOCUSED_WINDOW_SECONDS));
  }

  return windows.sort((left, right) => {
    if (left.startTimeSeconds !== right.startTimeSeconds) {
      return left.startTimeSeconds - right.startTimeSeconds;
    }

    return left.endTimeSeconds - right.endTimeSeconds;
  });
}

function compareWindowsForQuality(left: ClipWindow, right: ClipWindow): number {
  if (left.windowQualityScore !== right.windowQualityScore) {
    return right.windowQualityScore - left.windowQualityScore;
  }

  const eligibilityOrder = { CLEAN: 0, REPAIRABLE: 1, REJECT: 2 } as const;
  const leftEligibility = left.windowEligibility ?? (left.repairableWarnings && left.repairableWarnings.length > 0 ? "REPAIRABLE" : "CLEAN");
  const rightEligibility = right.windowEligibility ?? (right.repairableWarnings && right.repairableWarnings.length > 0 ? "REPAIRABLE" : "CLEAN");
  const eligibilityDiff = eligibilityOrder[leftEligibility] - eligibilityOrder[rightEligibility];
  if (eligibilityDiff !== 0) {
    return eligibilityDiff;
  }

  if (left.meaningfulSegmentCount !== right.meaningfulSegmentCount) {
    return right.meaningfulSegmentCount - left.meaningfulSegmentCount;
  }

  const ministryPayoffDiff = (right.ministryPayoffScore ?? 0) - (left.ministryPayoffScore ?? 0);
  if (ministryPayoffDiff !== 0) {
    return ministryPayoffDiff;
  }

  const openingHookDiff = (right.openingHookScore ?? 0) - (left.openingHookScore ?? 0);
  if (openingHookDiff !== 0) {
    return openingHookDiff;
  }

  if (left.wordCount !== right.wordCount) {
    return right.wordCount - left.wordCount;
  }

  const leftPreferredDurationDistance = Math.min(
    Math.abs(left.durationSeconds - TARGET_MIN_DURATION_SECONDS),
    Math.abs(left.durationSeconds - TARGET_MAX_DURATION_SECONDS),
  );
  const rightPreferredDurationDistance = Math.min(
    Math.abs(right.durationSeconds - TARGET_MIN_DURATION_SECONDS),
    Math.abs(right.durationSeconds - TARGET_MAX_DURATION_SECONDS),
  );
  if (leftPreferredDurationDistance !== rightPreferredDurationDistance) {
    return leftPreferredDurationDistance - rightPreferredDurationDistance;
  }

  return left.startTimeSeconds - right.startTimeSeconds;
}

function rankClipWindowsForSelection(windows: ClipWindow[]): ClipWindow[] {
  const clusterMap = new Map<number, ClipWindow[]>();

  for (const window of windows) {
    const cluster = Math.floor(window.startTimeSeconds / TIME_CLUSTER_SECONDS);
    const clusterWindows = clusterMap.get(cluster) ?? [];
    clusterWindows.push(window);
    clusterMap.set(cluster, clusterWindows);
  }

  const clusters = [...clusterMap.entries()]
    .map(([cluster, clusterWindows]) => ({
      cluster,
      windows: clusterWindows.sort(compareWindowsForQuality),
    }))
    .sort((left, right) => {
      const leftBest = left.windows[0];
      const rightBest = right.windows[0];
      if (leftBest && rightBest) {
        const qualityDifference = compareWindowsForQuality(leftBest, rightBest);
        return qualityDifference !== 0 ? qualityDifference : left.cluster - right.cluster;
      }

      return leftBest ? -1 : rightBest ? 1 : left.cluster - right.cluster;
    });

  const ranked: ClipWindow[] = [];
  let depth = 0;
  while (ranked.length < windows.length) {
    let addedAtDepth = false;

    for (const cluster of clusters) {
      const window = cluster.windows[depth];
      if (window) {
        ranked.push(window);
        addedAtDepth = true;
      }
    }

    if (!addedAtDepth) {
      break;
    }

    depth += 1;
  }

  return ranked;
}

function chunkWindows(windows: ClipWindow[]): ClipWindow[][] {
  const batches: ClipWindow[][] = [];
  for (let index = 0; index < windows.length; index += BATCH_SIZE) {
    batches.push(windows.slice(index, index + BATCH_SIZE));
  }
  return batches;
}

function isAiQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|quota|billing/i.test(message);
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function transcriptSentences(value: string): string[] {
  return compactWhitespace(value)
    .split(/(?<=[.!?])\s+/g)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function toTitleCase(value: string): string {
  const lowercaseWords = new Set(["a", "an", "and", "as", "at", "for", "in", "of", "on", "the", "to", "with"]);
  return compactWhitespace(value)
    .toLowerCase()
    .split(/\s+/g)
    .map((word, index) => {
      if (index > 0 && lowercaseWords.has(word)) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function removeTrailingWeakTitleWords(words: string[]): string[] {
  const weakTrailingWords = new Set(["a", "about", "after", "an", "and", "as", "at", "before", "but", "by", "for", "from", "in", "into", "no", "of", "on", "or", "over", "the", "this", "to", "under", "upon", "with"]);
  const trimmed = [...words];
  while (trimmed.length > 4 && weakTrailingWords.has((trimmed[trimmed.length - 1] ?? "").toLowerCase())) {
    trimmed.pop();
  }
  return trimmed;
}

const NEUTRAL_REVIEW_TITLE = "Sermon Moment for Review";
const TITLE_MIN_WORDS = 3;
const TITLE_MAX_WORDS = 9;
const TITLE_GROUNDING_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "be",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
  "you",
  "your",
]);
const DANGLING_TITLE_START_PATTERN = /^(?:and|as|because|but|for|however|if|so|then|therefore|this|that|these|those|when|where|while|which|who|with)\b/i;
const DANGLING_TITLE_END_PATTERN = /\b(?:about|after|and|as|at|because|before|but|by|for|from|if|in|into|of|on|or|over|so|that|the|to|under|upon|when|while|with)$/i;
const UNSUPPORTED_DRAMATIC_TITLE_PATTERN = /\b(?:breakthrough|miracle|prophetic|demon|deliverance|wealth|prosperity|secret|guaranteed|shocking|destroyed|exposed)\b/i;
const ASR_FRAGMENT_TITLE_PATTERN =
  /\b(?:neither|either)\s+(?:their|his|her|its|our)\b|\bbefore\s+to\b|\bwhat\s+you\s+have\s+been\s+built\b|\bgreater\s+access\b|\bif\s+i\b|\blet\s+us\s+create\b|\bruling\s+outside\s+family\b|\bit\s+is\s+reigning\b|\bgive us a learning\b|\bour bible scripture\b|\bsee that his well\b|\b(?:has|have|is|are|was|were)\s+\w+\s+if\b/i;

type PastorTitleValidation = {
  valid: boolean;
  reason: string;
};

type DeterministicTitleInput = {
  transcriptText: string;
  landingSentence?: string | null;
  hook?: string | null;
  index?: number;
};

function titleTokens(value: string): string[] {
  return value.match(/[A-Za-z0-9']+/g) ?? [];
}

function titleGroundingTokens(value: string): string[] {
  return titleTokens(value)
    .map((token) => token.toLowerCase().replace(/'s$/i, ""))
    .map((token) => (token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token))
    .filter((token) => token.length >= 3 && !TITLE_GROUNDING_STOP_WORDS.has(token));
}

function hasAdjacentDuplicateTitleWords(words: string[]): boolean {
  return words.some((word, index) => index > 0 && word.toLowerCase() === words[index - 1].toLowerCase());
}

function hasRepeatedDistinctiveTitleWord(words: string[]): boolean {
  const seen = new Map<string, number>();
  for (const word of words) {
    const normalized = word.toLowerCase().replace(/'s$/i, "");
    if (normalized.length < 5 || TITLE_GROUNDING_STOP_WORDS.has(normalized)) {
      continue;
    }

    const count = (seen.get(normalized) ?? 0) + 1;
    if (count > 1) {
      return true;
    }
    seen.set(normalized, count);
  }
  return false;
}

function cleanTitlePhrase(value: string): string {
  return compactWhitespace(value)
    .replace(/^[\s"'`.,:;!?-]+|[\s"'`.,:;!?-]+$/g, "")
    .replace(/^(?:therefore|that means|so then|the point is|remember this|never forget|hear me|i want you to know|can i tell you|let me tell you)\b[:,\s-]*/i, "")
    .replace(/^(?:so|then)\s+(?:this week|today|right now)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromPhrase(value: string, sourceTranscript: string): string | null {
  const cleaned = cleanTitlePhrase(value).replace(/[^A-Za-z0-9'\s-]/g, " ");
  const phraseBeforeSecondaryThought = cleaned
    .split(/\s+(?:and|but|because|so)\s+/i)
    .find((part) => countSelectionWords(part) >= TITLE_MIN_WORDS) ?? cleaned;
  const words = removeTrailingWeakTitleWords(
    titleTokens(phraseBeforeSecondaryThought).slice(0, TITLE_MAX_WORDS),
  );
  if (words.length < TITLE_MIN_WORDS) {
    return null;
  }

  const title = toTitleCase(words.join(" "));
  return validatePastorTitle(title, sourceTranscript).valid ? title : null;
}

function applicationPhraseFromSentence(sentence: string): string | null {
  const cleaned = cleanTitlePhrase(sentence);
  const match = cleaned.match(/\b(?:choose|trust|pray|respond|obey|serve|surrender|receive|walk|apply|remember|stir|use|forgive|repent|start|stop|take)\b[\s\S]{0,90}/i);
  if (!match) {
    return null;
  }

  return compactWhitespace(match[0])
    .split(/\s+(?:and|but|because|so)\s+/i)
    .find((part) => countSelectionWords(part) >= TITLE_MIN_WORDS) ?? match[0];
}

function scriptureTruthPhraseFromSentence(sentence: string): string | null {
  const cleaned = cleanTitlePhrase(sentence);
  const match = cleaned.match(/\b(?:god|jesus|christ|lord|holy spirit|scripture|the bible|grace|faith)\b\s+(?:is|has|will|can|does|gives|calls|teaches|reminds|restores|forgives|saves|changes|strengthens|keeps|leads|meets)\b[\s\S]{0,80}/i);
  return match ? compactWhitespace(match[0]) : null;
}

function subjectActionTitle(transcriptText: string): string | null {
  const normalized = normalizeTranscriptSnippet(transcriptText);
  const candidates: Array<[RegExp, string]> = [
    [/\bstir up (?:the )?gift\b|\bgift\b[\s\S]{0,80}\bstir (?:it )?up\b|\bstir (?:it )?up\b[\s\S]{0,80}\bgift\b/i, "Stir Up the Gift"],
    [/\buse what (?:god|grace|the lord|he) (?:gave|placed|entrusted)\b|\buse what is already in your hand\b/i, "Use What God Gave"],
    [/\bserve\b[\s\S]{0,60}\b(?:church|body|people|gift|calling)\b/i, "Serve With Your Gift"],
    [/\btrust\b[\s\S]{0,60}\b(?:god|lord|jesus)\b/i, "Trust God Today"],
    [/\bforgive\b[\s\S]{0,80}\b(?:again|mercy|grace)\b/i, "Forgive Again With Grace"],
    [/\bpray\b[\s\S]{0,60}\b(?:faith|boldness|today|now)\b/i, "Pray With Faith Today"],
    [/\ball equal before god\b|\bequal before god\b/i, "Equal Before God"],
    [/\bwill of god\b/i, "The Will of God"],
    [/\bwait upon the lord\b|\bwait on the lord\b/i, "Wait Upon the Lord"],
    [/\bfilled with the holy spirit\b|\bholy spirit\b.{0,80}\bfilled\b/i, "Be Filled With the Holy Spirit"],
    [/\bfamil(?:y|ies)\b.{0,80}\bpray|pray.{0,80}\bfamil(?:y|ies)\b/i, "Prayer for Families"],
    [/\bimage of god\b|\bcreated (?:by|in) god\b|\bgod created\b/i, "Created in God's Image"],
    [/\blet us create\b[\s\S]{0,100}\blikeness\b|\bcreated\b[\s\S]{0,100}\blikeness\b/i, "Created in God's Likeness"],
    [/\badam means humanity\b|\bhumanity\b[\s\S]{0,120}\bmale and female\b|\blet us create\b[\s\S]{0,120}\bmen and women\b/i, "Humanity in God's Likeness"],
    [/\bwork hard\b[\s\S]{0,120}\bfamily\b|\btake care\b[\s\S]{0,120}\bfamily\b|\bwork for the family\b/i, "Work Hard for the Family"],
    [/\blead\b[\s\S]{0,80}\bintegrity\b|\bintegrity\b[\s\S]{0,80}\blead\b/i, "Lead With Integrity"],
    [/\bleader\b[\s\S]{0,120}\bfaithful\b|\boverseer\b[\s\S]{0,120}\babove reproach\b|\bchurch leader\b/i, "Faithful Church Leadership"],
    [/\bwhat is leadership\b|\bleadership is\b|\bposition of influence\b/i, "Leadership That Serves"],
    [/\bbible scripture\b|\bscripture\b[\s\S]{0,80}\blearning\b|\blearning\b[\s\S]{0,80}\bscripture\b/i, "Learning From Scripture"],
    [/\btake care of god'?s church\b|\bmanage his own family\b|\bchildren obey him\b/i, "Care for God's Church"],
  ];

  for (const [pattern, title] of candidates) {
    if (pattern.test(normalized) && validatePastorTitle(title, transcriptText).valid) {
      return title;
    }
  }

  return null;
}

function validatePastorTitle(title: string, transcriptText: string): PastorTitleValidation {
  const cleaned = compactWhitespace(title);
  if (!cleaned) {
    return { valid: false, reason: "Title is empty." };
  }
  if (cleaned === NEUTRAL_REVIEW_TITLE) {
    return { valid: true, reason: "Neutral review fallback." };
  }

  const words = titleTokens(cleaned);
  if (words.length < TITLE_MIN_WORDS || words.length > TITLE_MAX_WORDS) {
    return { valid: false, reason: `Title must be ${TITLE_MIN_WORDS}-${TITLE_MAX_WORDS} words.` };
  }
  if (DANGLING_TITLE_START_PATTERN.test(cleaned)) {
    return { valid: false, reason: "Title begins with a dangling connector or dependent reference." };
  }
  if (DANGLING_TITLE_END_PATTERN.test(cleaned)) {
    return { valid: false, reason: "Title ends with a dangling connector." };
  }
  if (hasAdjacentDuplicateTitleWords(words)) {
    return { valid: false, reason: "Title repeats adjacent words." };
  }
  if (hasRepeatedDistinctiveTitleWord(words)) {
    return { valid: false, reason: "Title repeats a distinctive word and reads like a transcript fragment." };
  }
  const lowerWords = words.map((word) => word.toLowerCase());
  const pronounCount = lowerWords.filter((word) => ["i", "we", "it", "they", "he", "she"].includes(word)).length;
  const auxiliaryCount = lowerWords.filter((word) => ["can", "cannot", "could", "should", "would", "was", "were", "is", "are"].includes(word)).length;
  if (pronounCount >= 2 && auxiliaryCount >= 1) {
    return { valid: false, reason: "Title reads like a spoken pronoun fragment." };
  }
  if (
    /^(?:he|she|it|they|we|i)\b/i.test(cleaned) &&
    !/\b(?:god|jesus|christ|lord|spirit|scripture|church|faith|grace|mercy|leadership|integrity)\b/i.test(cleaned)
  ) {
    return { valid: false, reason: "Title begins with a weak pronoun and lacks a clear sermon subject." };
  }
  if (/\bcan\s+i\b/i.test(cleaned)) {
    return { valid: false, reason: "Title contains spoken question-order phrasing." };
  }
  if (/\b(?:in|to|of|with|by|for)\s+(?:is|are|was|were|becomes|become|cannot|can|will|would|should|we|it|they)\b/i.test(cleaned)) {
    return { valid: false, reason: "Title contains an incoherent connector phrase." };
  }
  if (/\b(?:a|an)\s+(?:[A-Za-z']+\s+)?[A-Za-z']+s\b/i.test(cleaned)) {
    return { valid: false, reason: "Title contains an awkward singular/plural phrase." };
  }
  if (ASR_FRAGMENT_TITLE_PATTERN.test(cleaned)) {
    return { valid: false, reason: "Title reads like an ASR transcript fragment." };
  }

  const normalizedTranscript = normalizeTranscriptSnippet(transcriptText);
  const titleClaimTokens = titleGroundingTokens(cleaned);
  const transcriptTokens = new Set(titleGroundingTokens(transcriptText));
  const matchedTokens = titleClaimTokens.filter((token) => transcriptTokens.has(token)).length;
  const matchRatio = titleClaimTokens.length > 0 ? matchedTokens / titleClaimTokens.length : 0;
  if (UNSUPPORTED_DRAMATIC_TITLE_PATTERN.test(cleaned) && !normalizedTranscript.includes(normalizeTranscriptSnippet(cleaned))) {
    return { valid: false, reason: "Title contains an unsupported dramatic claim." };
  }
  if (titleClaimTokens.length > 0 && matchedTokens < Math.max(1, titleClaimTokens.length - 1) && matchRatio < 0.8) {
    return {
      valid: false,
      reason: `Title is not grounded in transcript terms (${matchedTokens}/${titleClaimTokens.length}).`,
    };
  }

  return { valid: true, reason: "Title is grounded and complete." };
}

function deterministicPastorTitle(input: DeterministicTitleInput): string {
  const normalized = compactWhitespace(input.transcriptText);
  const phraseMatches: Array<[RegExp, string]> = [
    [/\b(?:no man|no woman|no one) can worship god for you\b/i, "No One Can Worship God for You"],
    [/\byour needs are not too expensive to worship god\b/i, "Your Need Is Not Too Big to Worship God"],
    [/\bhe remains god\b/i, "He Remains God"],
    [/\byou remain good and you remain faithful\b/i, "God Remains Good and Faithful"],
    [/\bstir up (?:the )?gift\b|\bgift\b[\s\S]{0,80}\bstir (?:it )?up\b|\bstir (?:it )?up\b[\s\S]{0,80}\bgift\b/i, "Stir Up the Gift"],
    [/\buse what is already in your hand\b/i, "Use What Is Already in Your Hand"],
    [/\ball equal before god\b|\bequal before god\b/i, "Equal Before God"],
    [/\bwill of god\b/i, "The Will of God"],
    [/\bwait upon the lord\b|\bwait on the lord\b/i, "Wait Upon the Lord"],
    [/\bfilled with the holy spirit\b|\bholy spirit\b.{0,80}\bfilled\b/i, "Be Filled With the Holy Spirit"],
    [/\bfamil(?:y|ies)\b.{0,80}\bpray|pray.{0,80}\bfamil(?:y|ies)\b/i, "Prayer for Families"],
    [/\bimage of god\b|\bcreated (?:by|in) god\b|\bgod created\b/i, "Created in God's Image"],
    [/\blet us create\b[\s\S]{0,100}\blikeness\b|\bcreated\b[\s\S]{0,100}\blikeness\b/i, "Created in God's Likeness"],
    [/\badam means humanity\b|\bhumanity\b[\s\S]{0,120}\bmale and female\b|\blet us create\b[\s\S]{0,120}\bmen and women\b/i, "Humanity in God's Likeness"],
    [/\bwork hard\b[\s\S]{0,120}\bfamily\b|\btake care\b[\s\S]{0,120}\bfamily\b|\bwork for the family\b/i, "Work Hard for the Family"],
    [/\blead\b[\s\S]{0,80}\bintegrity\b|\bintegrity\b[\s\S]{0,80}\blead\b/i, "Lead With Integrity"],
    [/\bleader\b[\s\S]{0,120}\bfaithful\b|\boverseer\b[\s\S]{0,120}\babove reproach\b|\bchurch leader\b/i, "Faithful Church Leadership"],
    [/\bwhat is leadership\b|\bleadership is\b|\bposition of influence\b/i, "Leadership That Serves"],
    [/\bbible scripture\b|\bscripture\b[\s\S]{0,80}\blearning\b|\blearning\b[\s\S]{0,80}\bscripture\b/i, "Learning From Scripture"],
    [/\btake care of god'?s church\b|\bmanage his own family\b|\bchildren obey him\b/i, "Care for God's Church"],
  ];

  for (const [pattern, title] of phraseMatches) {
    if (pattern.test(normalized) && validatePastorTitle(title, normalized).valid) {
      return title;
    }
  }

  const sentences = transcriptSentences(normalized);
  const rankedTakeaways = sentences
    .filter((sentence) => countSelectionWords(sentence) >= 5)
    .map((sentence, sentenceIndex) => ({
      sentence,
      score: scoreLandingChunk(sentence, sentenceIndex, Math.max(1, sentences.length)) +
        (analyzeClipCoherence(sentence).hasClearTakeaway ? 2 : 0),
    }))
    .sort((left, right) => right.score - left.score)
    .map((item) => item.sentence);
  const candidateSources = [
    input.landingSentence,
    ...rankedTakeaways,
    ...sentences.map(applicationPhraseFromSentence),
    ...sentences.map(scriptureTruthPhraseFromSentence),
    input.hook,
  ].filter((source): source is string => Boolean(source && compactWhitespace(source).length > 0));

  for (const source of candidateSources) {
    const applicationTitle = applicationPhraseFromSentence(source);
    const fromApplication = applicationTitle ? titleFromPhrase(applicationTitle, normalized) : null;
    if (fromApplication) {
      return fromApplication;
    }

    const scriptureTitle = scriptureTruthPhraseFromSentence(source);
    const fromScripture = scriptureTitle ? titleFromPhrase(scriptureTitle, normalized) : null;
    if (fromScripture) {
      return fromScripture;
    }

    const directTitle = titleFromPhrase(source, normalized);
    if (directTitle) {
      return directTitle;
    }
  }

  return subjectActionTitle(normalized) ?? NEUTRAL_REVIEW_TITLE;
}

function normalizePastorTitle(input: DeterministicTitleInput & { title: string }): string {
  const title = compactWhitespace(input.title);
  if (title === NEUTRAL_REVIEW_TITLE) {
    return deterministicPastorTitle(input);
  }

  return validatePastorTitle(title, input.transcriptText).valid
    ? title
    : deterministicPastorTitle(input);
}

function titleFromWindow(window: ClipWindow, index: number): string {
  return deterministicPastorTitle({
    transcriptText: window.transcriptText,
    landingSentence: landingSentenceFromWindow(window),
    index,
  });
}

function transcriptLandingChunks(value: string): string[] {
  const splitLongChunk = (chunk: string): string[] => {
    const words = compactWhitespace(chunk).split(/\s+/g).filter(Boolean);
    if (words.length <= 34) {
      return [compactWhitespace(chunk)];
    }

    const chunks: string[] = [];
    for (let index = 0; index < words.length; index += 26) {
      chunks.push(words.slice(index, index + 34).join(" "));
    }
    return chunks;
  };

  const sentences = transcriptSentences(value).flatMap(splitLongChunk);
  if (sentences.length > 1) {
    return sentences.filter((sentence) => sentence.length > 0);
  }

  const words = compactWhitespace(value).split(/\s+/g).filter(Boolean);
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += 26) {
    chunks.push(words.slice(index, index + 34).join(" "));
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function scoreLandingChunk(chunk: string, index: number, total: number): number {
  const normalized = normalizeTranscriptSnippet(chunk);
  let score = scoreWindowMinistryPayoff(chunk);

  if (hasWindowLanding(chunk)) {
    score += 3;
  }
  if (/\b(therefore|that means|so then|the point is|remember this|never forget|hear me|i want you to know)\b/.test(normalized)) {
    score += 2.2;
  }
  if (/\b(you|your|we|us|our|believers|church)\b.{0,100}\b(choose|trust|pray|respond|obey|serve|surrender|receive|walk|apply|remember|stir|use|strengthen)\b/.test(normalized)) {
    score += 2;
  }
  if (/\b(god|jesus|christ|lord|holy spirit|grace|faith|gift|calling|purpose|scripture)\b/.test(normalized)) {
    score += 1.1;
  }
  if (countSelectionWords(chunk) >= 8 && countSelectionWords(chunk) <= 38) {
    score += 1;
  }
  if (total > 1) {
    score += (index / Math.max(1, total - 1)) * 0.9;
  }

  return score;
}

function landingSentenceFromTranscript(transcriptText: string): string {
  const chunks = transcriptLandingChunks(transcriptText)
    .map((chunk) => compactWhitespace(chunk))
    .filter((chunk) => countSelectionWords(chunk) >= 5);

  const ranked = chunks
    .map((chunk, index) => ({
      chunk,
      score: scoreLandingChunk(chunk, index, chunks.length),
    }))
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.chunk
    ?? chunks.findLast((chunk) => countSelectionWords(chunk) >= 5)
    ?? compactWhitespace(transcriptText).slice(0, 220);
}

function landingSentenceFromWindow(window: ClipWindow): string {
  return landingSentenceFromTranscript(window.transcriptText);
}

function buildHeuristicClipCandidatesFromWindows(windows: ClipWindow[]): CanonicalClipCandidate[] {
  return windows.slice(0, MAX_SERMON_CLIP_SUGGESTIONS).map((window, index) => {
    const title = titleFromWindow(window, index);
    const landingSentence = landingSentenceFromWindow(window);
    const score = Math.max(8, Math.min(9.2, Number(window.windowQualityScore.toFixed(1))));

    return {
      startTimeSeconds: window.startTimeSeconds,
      endTimeSeconds: window.endTimeSeconds,
      durationSeconds: window.durationSeconds,
      transcriptText: window.transcriptText,
      title,
      hook: title,
      caption: landingSentence,
      suggestedHook: title,
      suggestedCaption: landingSentence,
      hashtags: ["#SermonClip", "#Faith", "#Church"],
      score,
      reasonSelected: [
        `Selected as a pastor review option because the spoken transcript lands with: "${landingSentence}".`,
        `Window quality ${window.windowQualityScore.toFixed(1)} with ministry payoff ${window.ministryPayoffScore ?? 0}.`,
      ].join(" "),
      landingSentence,
      clipType: "teaching",
      smartClipCategory: "Best Discipleship Clip",
      intendedAudience: "Church members and online viewers looking for a clear sermon takeaway.",
      ministryValue: "This section carries a focused sermon thought with enough context for pastor review.",
      socialValue: "The clip has a clear spoken idea that can be shaped for short-form posting.",
      riskLevel: "LOW",
      riskReasons: [],
      contextWarning: false,
      arcType: "PROBLEM_TRUTH_APPLICATION",
      arcSummary: "Deterministic fallback selected a high-substance sermon window for review.",
      setupStartTime: window.startTimeSeconds,
      mainPointTime: Number((window.startTimeSeconds + window.durationSeconds * 0.35).toFixed(3)),
      payoffTime: Number((window.startTimeSeconds + window.durationSeconds * 0.75).toFixed(3)),
      applicationTime: Number((window.startTimeSeconds + window.durationSeconds * 0.9).toFixed(3)),
      whyThisClipFeelsComplete: `The selected window passed transcript substance, timing, and ministry-payoff heuristics, and the spoken landing is grounded in this line: "${landingSentence}".`,
      whatContextMightBeMissing: "Pastor review should confirm the opening setup and final trim before posting.",
      responseFormat: "LEGACY_TIMESTAMPS",
      canonicalizationWarnings: [],
    };
  });
}

function buildLowTranscriptTimedFallbackCandidates(
  segments: TranscriptSegmentRecord[],
  bounds: { startTimeSeconds?: number | null; endTimeSeconds?: number | null },
): CanonicalClipCandidate[] {
  const selected: CanonicalClipCandidate[] = [];
  const seen = new Set<string>();
  const minWords = Math.max(18, Math.floor(MIN_SELECTION_TRANSCRIPT_WORDS * 0.65));
  const lowerBound = bounds.startTimeSeconds ?? segments[0]?.startTimeSeconds ?? 0;
  const upperBound = bounds.endTimeSeconds ?? segments[segments.length - 1]?.endTimeSeconds ?? lowerBound;
  const meaningfulAnchors = segments
    .map((segment, index) => ({ segment, index, words: countSelectionWords(segment.text) }))
    .filter(({ words }) => words >= 4)
    .sort((left, right) => left.segment.startTimeSeconds - right.segment.startTimeSeconds);

  for (const { segment, index } of meaningfulAnchors) {
    const starts = [
      Math.max(lowerBound, segment.startTimeSeconds - 8),
      Math.max(lowerBound, segment.startTimeSeconds),
    ];

    for (const startTimeSeconds of starts) {
      for (const durationTarget of [QUICK_WINDOW_SECONDS, SHORT_WINDOW_SECONDS, FOCUSED_WINDOW_SECONDS]) {
        const endTimeSeconds = Math.min(upperBound, startTimeSeconds + durationTarget);
        const durationSeconds = Number((endTimeSeconds - startTimeSeconds).toFixed(2));
        if (durationSeconds < MIN_WINDOW_SECONDS || durationSeconds > TARGET_MAX_DURATION_SECONDS) {
          continue;
        }

        const transcriptText = transcriptTextForRange(segments, startTimeSeconds, endTimeSeconds);
        const wordCount = countSelectionWords(transcriptText);
        if (wordCount < minWords) {
          continue;
        }

        const key = `${Math.round(startTimeSeconds)}:${Math.round(endTimeSeconds)}:${normalizeTranscriptSnippet(transcriptText).slice(0, 90)}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        const landingSentence = landingSentenceFromTranscript(transcriptText);
        const title = deterministicPastorTitle({
          transcriptText,
          landingSentence,
          index,
        });
        const payoffScore = scoreWindowMinistryPayoff(transcriptText);
        const score = Number(Math.max(6.8, Math.min(8.3, 6.8 + payoffScore * 0.12 + Math.min(1.0, wordCount / 90))).toFixed(1));

        selected.push({
          startTimeSeconds,
          endTimeSeconds,
          durationSeconds,
          transcriptText,
          title,
          hook: title,
          caption: landingSentence,
          suggestedHook: title,
          suggestedCaption: landingSentence,
          hashtags: ["#SermonClip", "#Faith", "#Church"],
          score,
          reasonSelected: [
            "Selected as a transcript-rescue timed option because the saved transcript quality is low.",
            `The partial transcript inside this ${Math.round(durationSeconds)}s range has ${wordCount} reviewable words.`,
            `Pastor should verify the spoken language, captions, and final trim before posting.`,
          ].join(" "),
          landingSentence,
          clipType: "teaching",
          smartClipCategory: "Best Discipleship Clip",
          intendedAudience: "Pastor review team checking usable moments from a low-confidence transcript.",
          ministryValue: "This is a timed rescue option built from the strongest available transcript island.",
          socialValue: "The moment may become a short-form clip after pastor verification and caption correction.",
          riskLevel: "LOW",
          riskReasons: ["Transcript quality is low; pastor must verify the spoken content before publishing."],
          contextWarning: true,
          arcType: "PROBLEM_TRUTH_APPLICATION",
          arcSummary: "Timed transcript-rescue candidate built when language transcription was too sparse for confident full-sermon selection.",
          setupStartTime: startTimeSeconds,
          mainPointTime: Number((startTimeSeconds + durationSeconds * 0.35).toFixed(3)),
          payoffTime: Number((startTimeSeconds + durationSeconds * 0.75).toFixed(3)),
          applicationTime: Number((startTimeSeconds + durationSeconds * 0.9).toFixed(3)),
          whyThisClipFeelsComplete: `This rescue candidate is grounded only in partial transcript evidence. The strongest available landing text is: "${landingSentence}".`,
          whatContextMightBeMissing: "Transcript quality is low, so the pastor should verify whether the clip starts and ends naturally.",
          responseFormat: "LEGACY_TIMESTAMPS",
          canonicalizationWarnings: ["LOW_TRANSCRIPT_TIMED_FALLBACK"],
        });

        if (selected.length >= MAX_SERMON_CLIP_SUGGESTIONS) {
          return selected;
        }
      }
    }
  }

  return selected;
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

function tryParseClipResponse(rawResponse: string): RawClipJsonCandidate[] {
  const parsed = JSON.parse(extractJsonObject(rawResponse)) as unknown;
  return rawClipJsonResponseSchema.parse(parsed).clips;
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
  const candidates: CanonicalClipCandidate[] = [];
  const rejectedReasons: string[] = [];

  for (const [index, candidate] of rawCandidates.entries()) {
    const result = rawClipJsonCandidateSchema.safeParse(candidate);
    if (result.success) {
      const legacy = canonicalizeLegacyCandidate(result.data);
      if (legacy.accepted) {
        candidates.push(legacy.candidate);
      } else {
        rejectedReasons.push(`clips.${index}: ${legacy.reason}`);
      }
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
    formatWarnings: [],
  };
}

function validateCandidatesIndividuallySafely(rawResponse: string, label: string): ValidatedClipBatch {
  try {
    return validateCandidatesIndividually(rawResponse);
  } catch (error) {
    return {
      candidates: [],
      repairUsed: false,
      rejectedReasons: [`${label}: ${formatClipParseError(error)}`],
      formatWarnings: [],
    };
  }
}

function canonicalizeLegacyCandidate(candidate: RawClipJsonCandidate): { accepted: true; candidate: CanonicalClipCandidate } | { accepted: false; reason: string } {
  if (
    typeof candidate.startTimeSeconds !== "number" ||
    typeof candidate.endTimeSeconds !== "number" ||
    typeof candidate.durationSeconds !== "number" ||
    typeof candidate.transcriptText !== "string"
  ) {
    return { accepted: false, reason: "MISSING_LEGACY_TIMESTAMPS: legacy candidate must include startTimeSeconds, endTimeSeconds, durationSeconds, and transcriptText." };
  }

  return {
    accepted: true,
    candidate: {
      ...candidate,
      startTimeSeconds: candidate.startTimeSeconds,
      endTimeSeconds: candidate.endTimeSeconds,
      durationSeconds: Number((candidate.endTimeSeconds - candidate.startTimeSeconds).toFixed(2)),
      transcriptText: candidate.transcriptText.trim(),
      responseFormat: "LEGACY_TIMESTAMPS",
      canonicalizationWarnings: [],
    },
  };
}

function canonicalizeIndexedCandidate(
  candidate: RawClipJsonCandidate,
  windows: ClipWindow[],
  candidateIndex: number,
): { accepted: true; candidate: CanonicalClipCandidate } | { accepted: false; reason: string } {
  if (!candidate.windowId || candidate.startSegmentIndex === undefined || candidate.endSegmentIndex === undefined) {
    return canonicalizeLegacyCandidate(candidate);
  }

  const window = windows.find((item) => item.windowId === candidate.windowId);
  if (!window) {
    return {
      accepted: false,
      reason: `OUTSIDE_BATCH clips.${candidateIndex}: unknown or cross-batch windowId ${candidate.windowId}.`,
    };
  }

  if (!window.segments || window.segments.length === 0) {
    return {
      accepted: false,
      reason: `MISSING_WINDOW_SEGMENTS clips.${candidateIndex}: ${window.windowId} has no structured segment data for indexed validation.`,
    };
  }

  const maxIndex = window.segments.length - 1;
  if (candidate.startSegmentIndex < 0 || candidate.endSegmentIndex < 0 || candidate.startSegmentIndex > maxIndex || candidate.endSegmentIndex > maxIndex) {
    return {
      accepted: false,
      reason: `INVALID_SEGMENT_INDEX clips.${candidateIndex}: segment indexes ${candidate.startSegmentIndex}-${candidate.endSegmentIndex} are outside ${window.windowId} range 0-${maxIndex}.`,
    };
  }

  if (candidate.endSegmentIndex < candidate.startSegmentIndex) {
    return {
      accepted: false,
      reason: `REVERSED_SEGMENT_INDEX clips.${candidateIndex}: endSegmentIndex must be greater than or equal to startSegmentIndex.`,
    };
  }

  if (
    candidate.landingSegmentIndex !== undefined &&
    (candidate.landingSegmentIndex < candidate.startSegmentIndex || candidate.landingSegmentIndex > candidate.endSegmentIndex)
  ) {
    return {
      accepted: false,
      reason: `LANDING_SEGMENT_OUTSIDE_RANGE clips.${candidateIndex}: landingSegmentIndex ${candidate.landingSegmentIndex} is outside selected range ${candidate.startSegmentIndex}-${candidate.endSegmentIndex}.`,
    };
  }

  if (
    candidate.hookSegmentIndex !== undefined &&
    (candidate.hookSegmentIndex < candidate.startSegmentIndex || candidate.hookSegmentIndex > candidate.endSegmentIndex)
  ) {
    return {
      accepted: false,
      reason: `HOOK_SEGMENT_OUTSIDE_RANGE clips.${candidateIndex}: hookSegmentIndex ${candidate.hookSegmentIndex} is outside selected range ${candidate.startSegmentIndex}-${candidate.endSegmentIndex}.`,
    };
  }

  const selectedSegments = window.segments.slice(candidate.startSegmentIndex, candidate.endSegmentIndex + 1);
  const firstSegment = selectedSegments[0];
  const lastSegment = selectedSegments[selectedSegments.length - 1];
  if (!firstSegment || !lastSegment) {
    return {
      accepted: false,
      reason: `INVALID_SEGMENT_INDEX clips.${candidateIndex}: selected segment range is empty.`,
    };
  }

  const startTimeSeconds = firstSegment.startTimeSeconds;
  const endTimeSeconds = lastSegment.endTimeSeconds;
  const durationSeconds = Number((endTimeSeconds - startTimeSeconds).toFixed(2));
  if (durationSeconds < 20 || durationSeconds > HARD_MAX_DURATION_SECONDS) {
    return {
      accepted: false,
      reason: `INVALID_SEGMENT_DURATION clips.${candidateIndex}: indexed segment range duration ${durationSeconds}s is outside allowed bounds.`,
    };
  }

  const warnings: string[] = [];
  if (
    typeof candidate.startTimeSeconds === "number" &&
    typeof candidate.endTimeSeconds === "number" &&
    (Math.abs(candidate.startTimeSeconds - startTimeSeconds) > 1 || Math.abs(candidate.endTimeSeconds - endTimeSeconds) > 1)
  ) {
    warnings.push(
      `INDEX_TIMESTAMP_DISAGREEMENT: AI timestamps ${candidate.startTimeSeconds}-${candidate.endTimeSeconds}s ignored; indexes resolve to ${startTimeSeconds}-${endTimeSeconds}s.`,
    );
  }
  if (typeof candidate.transcriptText === "string" && compactWhitespace(candidate.transcriptText) !== compactWhitespace(selectedSegments.map((segment) => segment.text).join(" "))) {
    warnings.push("INDEX_TRANSCRIPT_DISAGREEMENT: AI transcriptText ignored; authoritative transcript segments were used.");
  }

  return {
    accepted: true,
    candidate: {
      ...candidate,
      startTimeSeconds,
      endTimeSeconds,
      durationSeconds,
      transcriptText: selectedSegments.map((segment) => segment.text.trim()).join(" "),
      responseFormat: "INDEXED",
      canonicalizationWarnings: warnings,
    },
  };
}

function clipFitsPromptWindow(candidate: CanonicalClipCandidate, window: ClipWindow): boolean {
  const toleranceSeconds = 1;
  if (candidate.windowId && candidate.windowId !== window.windowId) {
    return false;
  }
  if (
    candidate.startSegmentIndex !== undefined &&
    candidate.endSegmentIndex !== undefined &&
    (
      candidate.startSegmentIndex >= window.segmentLines.length ||
      candidate.endSegmentIndex >= window.segmentLines.length ||
      candidate.endSegmentIndex < candidate.startSegmentIndex
    )
  ) {
    return false;
  }
  return (
    candidate.startTimeSeconds >= window.startTimeSeconds - toleranceSeconds &&
    candidate.endTimeSeconds <= window.endTimeSeconds + toleranceSeconds
  );
}

function filterCandidatesToPromptWindows(
  candidates: unknown[],
  windows: ClipWindow[],
): { candidates: CanonicalClipCandidate[]; rejectedReasons: string[]; formatWarnings: string[] } {
  const scopedCandidates: CanonicalClipCandidate[] = [];
  const rejectedReasons: string[] = [];
  const formatWarnings: string[] = [];

  for (const [index, candidate] of candidates.entries()) {
    const parsed = rawClipJsonCandidateSchema.safeParse(candidate);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "root";
          return `${path}: ${issue.message}`;
        })
        .join("; ");
      rejectedReasons.push(`SCHEMA_INVALID clips.${index}: ${details}`);
      continue;
    }

    const canonical = canonicalizeIndexedCandidate(parsed.data, windows, index);
    if (!canonical.accepted) {
      rejectedReasons.push(canonical.reason);
      continue;
    }

    const fitsPromptWindow = windows.some((window) => clipFitsPromptWindow(canonical.candidate, window));
    if (fitsPromptWindow) {
      scopedCandidates.push(canonical.candidate);
      formatWarnings.push(...(canonical.candidate.canonicalizationWarnings ?? []).map((warning) => `clips.${index}: ${warning}`));
      continue;
    }

    rejectedReasons.push(
      `OUTSIDE_BATCH clips.${index}: ${parsed.data.windowId ? `windowId ${parsed.data.windowId} or ` : ""}timestamps ${parsed.data.startTimeSeconds}-${parsed.data.endTimeSeconds}s sit outside the transcript windows provided to this AI batch.`,
    );
  }

  return {
    candidates: scopedCandidates,
    rejectedReasons,
    formatWarnings,
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
    const scoped = filterCandidatesToPromptWindows(candidates, batch);
    return {
      candidates: scoped.candidates,
      repairUsed: false,
      rejectedReasons: scoped.rejectedReasons,
      formatWarnings: scoped.formatWarnings,
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
      const scoped = filterCandidatesToPromptWindows(candidates, batch);
      return {
        candidates: scoped.candidates,
        repairUsed: true,
        rejectedReasons: scoped.rejectedReasons,
        formatWarnings: scoped.formatWarnings,
      };
    } catch (repairError) {
      const repairedFallback = validateCandidatesIndividuallySafely(repaired, "REPAIR_RESPONSE_UNPARSEABLE");
      const initialFallback = validateCandidatesIndividuallySafely(rawResponse, "INITIAL_RESPONSE_UNPARSEABLE");
      const fallback = repairedFallback.candidates.length > 0 ? repairedFallback : initialFallback;
      const repairDetails = formatClipParseError(repairError);
      const batchRejectedReasons = [
        `AI_RESPONSE_REPAIR_FAILED: Initial issue: ${validationError}. Repair issue: ${repairDetails}`,
        ...repairedFallback.rejectedReasons.map((reason) => `REPAIRED_${reason}`),
        ...(fallback === initialFallback ? initialFallback.rejectedReasons.map((reason) => `INITIAL_${reason}`) : []),
      ];

      if (fallback.candidates.length > 0) {
        const scoped = filterCandidatesToPromptWindows(fallback.candidates, batch);
        return {
          ...fallback,
          candidates: scoped.candidates,
          repairUsed: true,
          rejectedReasons: [...batchRejectedReasons, ...scoped.rejectedReasons],
          formatWarnings: [...fallback.formatWarnings, ...scoped.formatWarnings],
        };
      }

      return {
        candidates: [],
        repairUsed: true,
        rejectedReasons: batchRejectedReasons,
        formatWarnings: [],
      };
    }
  }
}

export function shouldPreserveClipDuringRegeneration(clip: { status: string; isManuallyEdited?: boolean }): boolean {
  return clip.status !== "SUGGESTED" || clip.isManuallyEdited === true;
}

export function getExistingSuggestionReuseDecision(
  existingSuggestions: SelectableClipCandidate[],
  force?: boolean,
): ExistingSuggestionReuseDecision {
  if (force) {
    return {
      reuse: false,
      reusableCount: 0,
      totalCount: existingSuggestions.length,
      reason: "Regeneration was forced.",
    };
  }

  if (existingSuggestions.length === 0) {
    return {
      reuse: false,
      reusableCount: 0,
      totalCount: 0,
      reason: "No existing AI suggestions were found.",
    };
  }

  const reusable = selectReusableReviewBoardSuggestions(existingSuggestions);
  if (reusable.length === 0) {
    return {
      reuse: false,
      reusableCount: 0,
      totalCount: existingSuggestions.length,
      reason: "Existing AI suggestions are not pastor-grade under the current selection rules.",
    };
  }

  if (reusable.length !== existingSuggestions.length) {
    return {
      reuse: false,
      reusableCount: reusable.length,
      totalCount: existingSuggestions.length,
      reason: `${reusable.length}/${existingSuggestions.length} existing AI suggestion(s) still pass pastor-review reuse checks; regenerating to remove weak, duplicate, or overflow suggestions.`,
    };
  }

  return {
    reuse: true,
    reusableCount: reusable.length,
    totalCount: existingSuggestions.length,
    reason: `${reusable.length}/${existingSuggestions.length} existing AI suggestion(s) still pass pastor-review reuse checks.`,
  };
}

export function shouldReuseExistingSuggestions(existingSuggestionCount: number, force?: boolean): boolean {
  const reusableFixtureTexts = [
    "God has placed a gift in you, and the church needs what is in your hand. Paul tells Timothy to stir up what was already given, so this week serve with courage and let faith move first.",
    "Forgiveness is not pretending the wound did not happen. It is choosing obedience before the feeling arrives, because grace has already met you and mercy keeps the heart free enough to love again. That freedom lets families heal and neighbors see Christ clearly.",
    "Scripture reminds the church that faith keeps walking when pressure comes. Today, choose prayer again, trust God with the next step, and let obedience answer fear with courage because the Spirit strengthens faithful people.",
  ];

  return getExistingSuggestionReuseDecision(
    // This helper is only used by tests, but it still models real reusable suggestions:
    // transcript-backed, distinct, and strong enough under current pastor-grade gates.
    Array.from({ length: existingSuggestionCount }, (_, index) => ({
      qualityLabel: index % 2 === 0 ? "POST_READY" as const : "GOOD_NEEDS_REVIEW" as const,
      postReadyStatus: index % 2 === 0 ? "POST_READY" as const : "GOOD_NEEDS_REVIEW" as const,
      finalQualityScore: index % 2 === 0 ? 8.5 : 7.8,
      score: index % 2 === 0 ? 8.5 : 7.8,
      startTimeSeconds: index * 420,
      endTimeSeconds: index * 420 + 65,
      durationSeconds: 65,
      transcriptText: reusableFixtureTexts[index % reusableFixtureTexts.length],
      qualityDebugSnapshot: {
        transcriptGrounding: {
          score: 0.92,
          orderedFlowRatio: 0.95,
        },
      },
      smartClipCategory: `Best Reusable Clip ${index + 1}`,
      clipType: "teaching",
      hookScore: 7.4,
      standaloneClarityScore: 7.4,
      arcCompletenessScore: 7.4,
      completenessScore: 7.2,
      boundaryQuality: "GOOD" as const,
      qualityWarnings: [],
    })),
    force,
  ).reuse;
}

export function buildSuggestionDeleteWhere(sermonId: string, targetCategory?: string, includeRejected = false) {
  return {
    sermonId,
    status: includeRejected ? { in: ["SUGGESTED", "REJECTED"] as Array<"SUGGESTED" | "REJECTED"> } : "SUGGESTED" as const,
    isAiGenerated: true,
    isManuallyEdited: false,
    ...(targetCategory ? { smartClipCategory: targetCategory } : {}),
  };
}

export function shouldReplaceExistingSuggestionsBeforeSave(decision: ExistingSuggestionReuseDecision): boolean {
  return !decision.reuse && decision.totalCount > 0;
}

function normalizeCandidate(candidate: CanonicalClipCandidate): NormalizedClipCandidate {
  const durationSeconds = Number((candidate.endTimeSeconds - candidate.startTimeSeconds).toFixed(2));
  const transcriptText = candidate.transcriptText.trim();
  return {
    ...candidate,
    rawAiCandidate: candidate,
    durationSeconds,
    transcriptText,
    title: normalizePastorTitle({
      title: candidate.title,
      transcriptText,
      landingSentence: candidate.landingSentence,
      hook: candidate.hook,
    }),
    hook: candidate.hook.trim(),
    caption: candidate.caption.trim(),
    reasonSelected: candidate.reasonSelected.trim(),
    hashtags: candidate.hashtags.map((tag) => tag.trim()),
    riskReasons: candidate.riskReasons.map((reason) => reason.trim()).filter(Boolean),
  };
}

function markCandidateForDegradedTranscriptReview(
  candidate: ProfessionalReviewedClipCandidate,
): ProfessionalReviewedClipCandidate {
  const qualityWarnings = Array.from(new Set([
    ...(candidate.qualityWarnings ?? []),
    DEGRADED_TRANSCRIPT_REVIEW_WARNING,
  ]));
  const postReadyBlockers = Array.from(new Set([
    ...(candidate.postReadyBlockers ?? []),
    "Transcript coverage is incomplete, so pastor review is required before posting.",
  ]));
  const postReadyReasons = Array.from(new Set([
    ...(candidate.postReadyReasons ?? []),
    "Generated from a degraded but usable transcript island.",
  ]));

  if (candidate.postReadyStatus !== "POST_READY" && candidate.qualityLabel !== "POST_READY") {
    return {
      ...candidate,
      qualityWarnings,
      postReadyBlockers,
      postReadyReasons,
      recommendedNextAction: candidate.recommendedNextAction === "REJECT"
        ? "REVIEW_CLIP"
        : candidate.recommendedNextAction,
      qualitySummary: candidate.qualitySummary
        ? `${candidate.qualitySummary} Transcript coverage is incomplete, so review captions and boundaries before posting.`
        : "Transcript coverage is incomplete, so review captions and boundaries before posting.",
      pastorFriendlyReason: candidate.pastorFriendlyReason
        ? `${candidate.pastorFriendlyReason} Review this option because the transcript was sparse.`
        : "Review this option because the transcript was sparse.",
    };
  }

  return {
    ...candidate,
    qualityLabel: "GOOD_NEEDS_REVIEW",
    postReadyStatus: "GOOD_NEEDS_REVIEW",
    recommendedNextAction: "REVIEW_CLIP",
    qualityWarnings,
    postReadyBlockers,
    postReadyReasons,
    qualitySummary: candidate.qualitySummary
      ? `${candidate.qualitySummary} It was downgraded from automatic post-ready because the sermon transcript is incomplete.`
      : "Downgraded from automatic post-ready because the sermon transcript is incomplete.",
    pastorFriendlyReason: candidate.pastorFriendlyReason
      ? `${candidate.pastorFriendlyReason} Review captions and boundaries before posting because transcription coverage was incomplete.`
      : "Review captions and boundaries before posting because transcription coverage was incomplete.",
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
      sermonStartSeconds: true,
      sermonEndSeconds: true,
      analyzeFullRecording: true,
      sourceDurationSeconds: true,
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

    const allSegments = await prisma.transcriptSegment.findMany({
      where: { sermonId: sermon.id },
      orderBy: { startTimeSeconds: "asc" },
      select: {
        startTimeSeconds: true,
        endTimeSeconds: true,
        text: true,
      },
    });

    if (allSegments.length === 0) {
      throw new Error("Cannot generate clip suggestions because no transcript segments exist.");
    }
    const funnel: CandidateFunnelDiagnostics = {
      transcriptSegmentsLoaded: allSegments.length,
      windowsPrepared: 0,
      cleanWindows: 0,
      repairableWindows: 0,
      ministryWindowsPrepared: 0,
      aiCandidatesReturned: 0,
      indexedAiCandidates: 0,
      legacyAiCandidates: 0,
      aiCandidatesSchemaValid: 0,
      aiCandidatesOutsideWindow: 0,
      deterministicCandidatesAdded: 0,
      boundaryRepairAttempted: 0,
      boundaryRepairSucceeded: 0,
      durationTrimAttempted: 0,
      durationTrimSucceeded: 0,
      landingRepairAttempted: 0,
      landingRepairSucceeded: 0,
      repairedCleanCount: 0,
      unresolvedBoundaryReviewCount: 0,
      groundingPassed: 0,
      groundingRejected: 0,
      hardValidCandidates: 0,
      completenessReviewed: 0,
      professionallyScored: 0,
      dedupeClusters: 0,
      duplicatesRemoved: 0,
      postReadyCount: 0,
      goodNeedsReviewCount: 0,
      needsEditingCount: 0,
      hardRejectedCount: 0,
      rescueCandidatesAdded: 0,
      savedCount: 0,
      rejectionReasons: {},
      warningReasons: {},
      mismatchCounters: {
        FINAL_OPENING_WARNING_WITHOUT_REPAIR_ATTEMPT: 0,
        FINAL_ENDING_WARNING_WITHOUT_REPAIR_ATTEMPT: 0,
        COMPLETENESS_DISAGREES_WITH_COHERENCE: 0,
        QUALITY_REVIEW_DISAGREES_WITH_COHERENCE: 0,
        CAPTION_NOT_EVALUATED_TREATED_AS_FAILURE: 0,
        FALLBACK_SCORE_USED: 0,
        AI_SCORE_USED: 0,
      },
      candidateDiagnosticSamples: [],
      openingRepairSamples: [],
      landingRepairSamples: [],
      clampRepairSamples: [],
    };
    const inferredSermonWindow = inferSermonWindowFromTranscript(allSegments, {
      sermonStartSeconds: sermon.sermonStartSeconds,
      sermonEndSeconds: sermon.sermonEndSeconds,
      analyzeFullRecording: sermon.analyzeFullRecording,
      knownDurationSeconds: sermon.sourceDurationSeconds,
    });
    const configuredClipBounds = {
      startTimeSeconds: sermon.analyzeFullRecording ? null : sermon.sermonStartSeconds,
      endTimeSeconds: sermon.analyzeFullRecording ? sermon.sourceDurationSeconds : sermon.sermonEndSeconds ?? sermon.sourceDurationSeconds,
    };
    const segments = applyInferredSermonWindowToSegments(allSegments, inferredSermonWindow);
    if (inferredSermonWindow) {
      await appendJobLog(
        job.id,
        `Auto-detected sermon window for clip generation: ${Math.round(inferredSermonWindow.startTimeSeconds)}-${Math.round(inferredSermonWindow.endTimeSeconds)}s. ${inferredSermonWindow.reason}`,
      );
      await appendPipelineLog(
        sermon.id,
        `Auto-detected sermon window for clip generation: ${Math.round(inferredSermonWindow.startTimeSeconds)}-${Math.round(inferredSermonWindow.endTimeSeconds)}s.`,
      );
    }
    const transcriptReadiness = assessTranscriptReadinessForClipping(segments);
    const transcriptQualityBand = classifyTranscriptQualityForClipGeneration(transcriptReadiness);
    const degradedTranscriptMode = !transcriptReadiness.ready;
    if (!transcriptReadiness.ready) {
      if (!isManualRescueTranscriptUsableForClipGeneration(transcriptReadiness)) {
        throw new Error(
          `Cannot generate pastor-grade clip suggestions because the transcript is not ready: ${transcriptReadiness.reason}`,
        );
      }
      await appendJobLog(
        job.id,
        [
          transcriptQualityBand === "MANUAL_RESCUE"
            ? "Transcript is very limited but has enough timestamped speech for manual-review rescue clips."
            : "Transcript is degraded but usable for review-first clip generation.",
          `Transcript quality band: ${transcriptQualityBand}.`,
          transcriptReadiness.reason ? `Reason: ${transcriptReadiness.reason}` : "",
          transcriptQualityBand === "MANUAL_RESCUE"
            ? "The app will build timed source-video rescue clips only. Pastor must verify language, captions, and boundaries before posting."
            : "The app will build dense transcript-island clips plus timed transcript-rescue clips and keep generated clips out of automatic post-ready.",
          `Readiness metrics: ${formatTranscriptReadinessSummary(transcriptReadiness)}.`,
        ].filter(Boolean).join(" "),
      );
      await appendPipelineLog(
        sermon.id,
        `Clip generation continuing with degraded transcript; generated clips will require pastor review. ${transcriptReadiness.reason ?? ""}`.trim(),
      );
    }
    await appendJobLog(
      job.id,
      [
        transcriptReadiness.ready
          ? "Transcript readiness passed for clipping:"
          : "Transcript readiness passed for review-first clipping:",
        `Quality band: ${transcriptQualityBand}.`,
        `${formatTranscriptReadinessSummary(transcriptReadiness)}.`,
      ].join(" "),
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

    const existingSuggestions = await prisma.clipCandidate.findMany({
      where: {
        sermonId: sermon.id,
        status: "SUGGESTED",
        isAiGenerated: true,
        isManuallyEdited: false,
        ...(options?.targetCategory ? { smartClipCategory: options.targetCategory } : {}),
      },
      select: {
        qualityLabel: true,
        finalQualityScore: true,
        score: true,
        startTimeSeconds: true,
        endTimeSeconds: true,
        durationSeconds: true,
        transcriptText: true,
        smartClipCategory: true,
        clipType: true,
        hookScore: true,
        standaloneClarityScore: true,
        arcCompletenessScore: true,
        completenessScore: true,
        completenessAction: true,
        boundaryQuality: true,
        riskLevel: true,
        riskReasons: true,
        postReadyStatus: true,
        contextWarning: true,
        qualityWarnings: true,
        qualityDebugSnapshot: true,
      },
    });
    const existingSuggestionReuse = getExistingSuggestionReuseDecision(
      existingSuggestions.map((suggestion) => ({
        ...suggestion,
        qualityWarnings: Array.isArray(suggestion.qualityWarnings)
          ? suggestion.qualityWarnings.filter((warning): warning is string => typeof warning === "string")
          : [],
        riskReasons: Array.isArray(suggestion.riskReasons)
          ? suggestion.riskReasons.filter((reason): reason is string => typeof reason === "string")
          : [],
      })),
      options?.force,
    );

    if (existingSuggestionReuse.reuse) {
      await updateSermonStatus(sermon.id, "CLIPS_GENERATED");
      await markJobSucceeded(job.id, `Existing clip suggestions reused; skipped AI call. ${existingSuggestionReuse.reason}`);
      await appendPipelineLog(sermon.id, `Existing clip suggestions reused; skipped AI call. ${existingSuggestionReuse.reason}`);
      return { clipCount: existingSuggestionReuse.totalCount, reusedExistingSuggestions: true };
    }

    if (existingSuggestionReuse.totalCount > 0) {
      await appendJobLog(job.id, `Existing clip suggestions will be regenerated. ${existingSuggestionReuse.reason}`);
      await appendPipelineLog(sermon.id, `Existing clip suggestions will be regenerated. ${existingSuggestionReuse.reason}`);
    }

    const baselineWindowCount = buildRollingWindows(segments).length;
    const windows = buildRollingWindows(segments, ministryMoments);
    funnel.windowsPrepared = windows.length;
    funnel.cleanWindows = windows.filter((window) => (window.windowEligibility ?? "CLEAN") === "CLEAN").length;
    funnel.repairableWindows = windows.filter((window) => window.windowEligibility === "REPAIRABLE").length;
    funnel.ministryWindowsPrepared = Math.max(0, windows.length - baselineWindowCount);
    if (windows.length === 0 && !degradedTranscriptMode) {
      throw new Error("Unable to build strong transcript windows suitable for pastor-grade clip generation. Re-run transcription or check sermon start/end trimming.");
    }
    if (windows.length === 0 && degradedTranscriptMode) {
      await appendJobLog(
        job.id,
        "No strong transcript windows survived quality filters, so clip generation will use timed manual-review rescue clips from available speech islands.",
      );
    }
    await appendJobLog(
      job.id,
      [
        `Prepared ${windows.length} high-substance transcript window(s) for clip selection.`,
        ministryMoments.length > 0 && windows.length > baselineWindowCount
          ? `${windows.length - baselineWindowCount} window(s) were anchored around detected ministry moments.`
          : "",
        windows.length > 0
          ? `Average window quality ${Number((windows.reduce((total, window) => total + window.windowQualityScore, 0) / windows.length).toFixed(2))}.`
          : "Average window quality N/A because only manual rescue clips are available.",
      ].filter(Boolean).join(" "),
    );

    const sermonContext: SermonContext = {
      id: sermon.id,
      title: sermon.title,
      speakerName: sermon.speakerName,
      churchName: sermon.churchName,
      language: sermon.language,
    };

    const rankedWindows = rankClipWindowsForSelection(windows);
    const batches = degradedTranscriptMode ? [] : chunkWindows(rankedWindows);
    const collected: NormalizedClipCandidate[] = [];
    let repairUsedCount = 0;
    const rejectedReasons: string[] = [];
    let deterministicFallbackUsed = false;

    if (degradedTranscriptMode) {
      const fallbackCandidates = rankedWindows.length > 0 ? buildHeuristicClipCandidatesFromWindows(rankedWindows) : [];
      const timedFallbackCandidates = buildLowTranscriptTimedFallbackCandidates(segments, configuredClipBounds)
        .filter((candidate) => !fallbackCandidates.some((existing) => (
          Math.abs(existing.startTimeSeconds - candidate.startTimeSeconds) < 3 &&
          Math.abs(existing.endTimeSeconds - candidate.endTimeSeconds) < 3
        )));
      deterministicFallbackUsed = true;
      funnel.deterministicCandidatesAdded += fallbackCandidates.length + timedFallbackCandidates.length;
      collected.push(...fallbackCandidates.map(normalizeCandidate));
      collected.push(...timedFallbackCandidates.map(normalizeCandidate));
      await appendJobLog(
        job.id,
        `${transcriptQualityBand} transcript mode skipped AI clip-selection batches and started with ${fallbackCandidates.length} deterministic transcript-island candidate(s) plus ${timedFallbackCandidates.length} timed rescue candidate(s).`,
      );
    }

    for (const [index, batch] of batches.entries()) {
      await appendJobLog(job.id, `Generating clip suggestions for batch ${index + 1}/${batches.length}.`);
      const batchMinistryMoments = selectPromptMinistryMomentsForWindows(batch, ministryMoments);
      if (ministryMoments.length > 0) {
        await appendJobLog(
          job.id,
          `Batch ${index + 1} received ${batchMinistryMoments.length}/${ministryMoments.length} relevant ministry moment(s) as prompt context.`,
        );
      }
      let batchResult: ValidatedClipBatch;
      try {
        batchResult = await callClipModel(sermonContext, batch, {
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
                ministryMoments: batchMinistryMoments,
              }
            : undefined,
        });
      } catch (clipModelError) {
        if (!isAiQuotaError(clipModelError)) {
          throw clipModelError;
        }

        const fallbackCandidates = buildHeuristicClipCandidatesFromWindows(rankedWindows);
        deterministicFallbackUsed = true;
        await appendJobLog(
          job.id,
          `AI clip selection was unavailable due to quota/billing limits. Using ${fallbackCandidates.length} deterministic fallback candidate(s) from ranked sermon windows.`,
        );
        collected.push(...fallbackCandidates.map(normalizeCandidate));
        repairUsedCount += 1;
        break;
      }

      if (batchResult.repairUsed) {
        repairUsedCount += 1;
      }

      const indexedResponseCount = batchResult.candidates.filter((candidate) => candidate.responseFormat === "INDEXED").length;
      const legacyResponseCount = batchResult.candidates.filter((candidate) => candidate.responseFormat === "LEGACY_TIMESTAMPS").length;
      funnel.indexedAiCandidates += indexedResponseCount;
      funnel.legacyAiCandidates += legacyResponseCount;
      await appendJobLog(
        job.id,
        `Batch ${index + 1} AI response formats: INDEXED=${indexedResponseCount}, LEGACY_TIMESTAMPS=${legacyResponseCount}.`,
      );
      if (batchResult.formatWarnings.length > 0) {
        await appendJobLog(
          job.id,
          `Batch ${index + 1} response format warnings: ${batchResult.formatWarnings.join(" | ")}`,
        );
      }

      if (batchResult.rejectedReasons.length > 0) {
        funnel.aiCandidatesOutsideWindow += batchResult.rejectedReasons.filter((reason) => reason.includes("OUTSIDE_BATCH")).length;
        rejectedReasons.push(...batchResult.rejectedReasons.map((reason) => `batch ${index + 1}: ${reason}`));
        await appendJobLog(
          job.id,
          `Batch ${index + 1} rejected ${batchResult.rejectedReasons.length} invalid candidates: ${batchResult.rejectedReasons.join(" | ")}`,
        );
      }

      funnel.aiCandidatesReturned += batchResult.candidates.length + batchResult.rejectedReasons.length;
      funnel.aiCandidatesSchemaValid += batchResult.candidates.length;
      collected.push(...batchResult.candidates.map(normalizeCandidate));
    }

    if (!deterministicFallbackUsed) {
      const supplementalCandidates = buildHeuristicClipCandidatesFromWindows(rankedWindows)
        .map(normalizeCandidate)
        .filter((candidate) => !collected.some((existing) => (
          Math.abs(existing.startTimeSeconds - candidate.startTimeSeconds) < 3 &&
          Math.abs(existing.endTimeSeconds - candidate.endTimeSeconds) < 3
        )));

      if (supplementalCandidates.length > 0) {
        funnel.deterministicCandidatesAdded += supplementalCandidates.length;
        collected.push(...supplementalCandidates);
        await appendJobLog(
          job.id,
          `Added ${supplementalCandidates.length} deterministic sermon-window candidate(s) to broaden pastor review options beyond AI selections.`,
        );
      }
    }

    const boundaryAdjusted: EnrichedClipCandidate[] = [];
    const boundaryRejected: string[] = [];
    let boundaryAdjustedCount = 0;

    for (const [index, candidate] of collected.entries()) {
      funnel.boundaryRepairAttempted += 1;
      const adjustedResult = refineClipBoundaries(candidate, segments);
      if (!adjustedResult.accepted) {
        boundaryRejected.push(`INVALID_TIMESTAMPS candidate ${index + 1}: ${adjustedResult.reason}`);
        continue;
      }

      if (adjustedResult.adjusted) {
        boundaryAdjustedCount += 1;
        funnel.boundaryRepairSucceeded += 1;
      }

      const hookAdjusted = applyHookBoundaryAdjustment(adjustedResult.candidate, segments);
      if (hookAdjusted.adjusted) {
        boundaryAdjustedCount += 1;
        funnel.boundaryRepairSucceeded += 1;
      }

      let candidateForGrounding = hookAdjusted.candidate;
      let repairWarnings: string[] = [];
      const boundaryRepairDetails: CandidateBoundaryRepairDetails = {};
      const repairedOpening = repairWeakOpening(candidateForGrounding, segments);
      candidateForGrounding = repairedOpening.candidate;
      repairWarnings = [...repairWarnings, ...repairedOpening.warnings];
      boundaryRepairDetails.openingRepair = repairedOpening.details;
      if (repairedOpening.adjusted) {
        boundaryAdjustedCount += 1;
        funnel.boundaryRepairSucceeded += 1;
      }
      if (repairedOpening.details.attempted && funnel.openingRepairSamples.length < 3) {
        funnel.openingRepairSamples.push({
          attempted: repairedOpening.details.attempted,
          succeeded: repairedOpening.details.succeeded,
          originalStartTimeSeconds: repairedOpening.details.originalStartTimeSeconds,
          originalEndTimeSeconds: repairedOpening.details.originalEndTimeSeconds,
          adjustedStartTimeSeconds: repairedOpening.details.adjustedStartTimeSeconds,
          adjustedEndTimeSeconds: repairedOpening.details.adjustedEndTimeSeconds,
          searchDistanceSeconds: repairedOpening.details.searchDistanceSeconds,
          reason: repairedOpening.details.reason,
          finalBoundaryQuality: repairedOpening.details.finalBoundaryQuality,
          unresolvedWarnings: repairedOpening.details.unresolvedWarnings,
        });
      }
      let transcriptCoverage = candidateTranscriptCoverage(segments, candidateForGrounding.startTimeSeconds, candidateForGrounding.endTimeSeconds);
      let landingEvidence = assessCandidateLandingEvidence({
        candidate: candidate.rawAiCandidate ?? candidate,
        startTimeSeconds: candidateForGrounding.startTimeSeconds,
        endTimeSeconds: candidateForGrounding.endTimeSeconds,
        segments,
      });

      const preLandingRevalidation = revalidateCandidateBoundary(candidateForGrounding, segments);
      const hasUnresolvedEndingWarning = preLandingRevalidation.unresolvedWarnings.some((warning) => (
        warning === "REVIEW_ENDING" ||
        warning === "NEEDS_END_TRIM" ||
        warning === "NEEDS_CONTEXT_EXTENSION" ||
        warning === "TRANSCRIPT_LIMITED_ENDING"
      ));

      if (!landingEvidence.accepted || hasUnresolvedEndingWarning) {
        const originalLandingEndTimeSeconds = candidateForGrounding.endTimeSeconds;
        funnel.landingRepairAttempted += 1;
        const repairedLanding = repairMissingLanding(candidateForGrounding, segments);
        candidateForGrounding = repairedLanding.candidate;
        repairWarnings = [...repairWarnings, ...repairedLanding.warnings];
        transcriptCoverage = repairedLanding.coverage;
        if (repairedLanding.adjusted) {
          funnel.landingRepairSucceeded += 1;
          boundaryAdjustedCount += 1;
        }
        landingEvidence = assessCandidateLandingEvidence({
          candidate: candidate.rawAiCandidate ?? candidate,
          startTimeSeconds: candidateForGrounding.startTimeSeconds,
          endTimeSeconds: candidateForGrounding.endTimeSeconds,
          segments,
        });
        const landingRepairCompletedCleanly = repairedLanding.adjusted && repairedLanding.validation.quality === "GOOD";
        if (!landingEvidence.accepted && !landingRepairCompletedCleanly) {
          repairWarnings.push(transcriptCoverage.transcriptLimitedEnding ? "TRANSCRIPT_LIMITED_ENDING" : "REVIEW_ENDING");
        }
        if (funnel.landingRepairSamples.length < 3) {
          const repairedWindow = findSegmentWindowForCandidate(segments, candidateForGrounding.startTimeSeconds, candidateForGrounding.endTimeSeconds);
          const selectedEndSegment = repairedWindow ? segments[repairedWindow.endIndex] : null;
          const reasonCode = repairedLanding.warnings[0] ?? (transcriptCoverage.transcriptLimitedEnding ? "TRANSCRIPT_LIMITED_ENDING" : "REVIEW_ENDING");
          funnel.landingRepairSamples.push({
            attempted: true,
            succeeded: repairedLanding.adjusted && repairedLanding.validation.quality === "GOOD",
            originalStartTimeSeconds: repairedLanding.originalBoundary.startTimeSeconds,
            originalEndTimeSeconds: originalLandingEndTimeSeconds,
            adjustedStartTimeSeconds: candidateForGrounding.startTimeSeconds,
            adjustedEndTimeSeconds: candidateForGrounding.endTimeSeconds,
            extendedSeconds: Number((candidateForGrounding.endTimeSeconds - originalLandingEndTimeSeconds).toFixed(2)),
            durationAfterRepairSeconds: candidateForGrounding.durationSeconds,
            reasonCode,
            finalBoundaryQuality: repairedLanding.validation.quality,
            unresolvedWarnings: repairedLanding.unresolvedWarnings,
            selectedEndSegmentStartTimeSeconds: selectedEndSegment?.startTimeSeconds ?? null,
            selectedEndSegmentEndTimeSeconds: selectedEndSegment?.endTimeSeconds ?? null,
          });
        }
      }

      const clampedCandidate = clampCandidateToBounds(candidateForGrounding, segments, configuredClipBounds);
      candidateForGrounding = clampedCandidate.candidate;
      if (clampedCandidate.adjusted) {
        boundaryAdjustedCount += 1;
        funnel.boundaryRepairSucceeded += 1;
        repairWarnings = [...repairWarnings, ...clampedCandidate.warnings];
        if (funnel.clampRepairSamples.length < 3) {
          funnel.clampRepairSamples.push({
            attempted: true,
            succeeded: clampedCandidate.validation.quality === "GOOD",
            originalStartTimeSeconds: clampedCandidate.originalBoundary.startTimeSeconds,
            originalEndTimeSeconds: clampedCandidate.originalBoundary.endTimeSeconds,
            adjustedStartTimeSeconds: candidateForGrounding.startTimeSeconds,
            adjustedEndTimeSeconds: candidateForGrounding.endTimeSeconds,
            finalBoundaryQuality: clampedCandidate.validation.quality,
            unresolvedWarnings: clampedCandidate.unresolvedWarnings,
          });
        }
      }

      if (candidateForGrounding.durationSeconds > TARGET_MAX_DURATION_SECONDS) {
        funnel.durationTrimAttempted += 1;
        const shortSubrange = trimCandidateToShortSubrange(candidateForGrounding, segments);
        candidateForGrounding = shortSubrange.candidate;
        repairWarnings = [...repairWarnings, ...shortSubrange.unresolvedWarnings];
        if (shortSubrange.adjusted) {
          funnel.durationTrimSucceeded += 1;
          boundaryAdjustedCount += 1;
          transcriptCoverage = candidateTranscriptCoverage(
            segments,
            candidateForGrounding.startTimeSeconds,
            candidateForGrounding.endTimeSeconds,
          );
        }
      }

      const grounding = assessCandidateTranscriptGrounding({
        candidateTranscriptText: candidate.rawAiCandidate?.transcriptText ?? candidate.transcriptText,
        startTimeSeconds: candidateForGrounding.startTimeSeconds,
        endTimeSeconds: candidateForGrounding.endTimeSeconds,
        segments,
      });

      if (!grounding.accepted) {
        funnel.groundingRejected += 1;
        boundaryRejected.push(`LOW_GROUNDING candidate ${index + 1}: ${grounding.reason}`);
        continue;
      }
      funnel.groundingPassed += 1;
      const uniqueRepairWarnings = Array.from(new Set(repairWarnings));
      const completedRepairCodes = new Set(["OPENING_REPAIRED", "LANDING_REPAIRED", "SERMON_BOUNDARY_CLAMPED"]);
      if (
        candidateForGrounding.boundaryQuality === "GOOD" &&
        uniqueRepairWarnings.some((warning) => completedRepairCodes.has(warning))
      ) {
        funnel.repairedCleanCount += 1;
      }
      if (candidateForGrounding.boundaryQuality === "NEEDS_REVIEW") {
        funnel.unresolvedBoundaryReviewCount += 1;
      }

      boundaryAdjusted.push(enrichCandidate({
        ...candidateForGrounding,
        transcriptGroundingScore: grounding.score,
        transcriptGroundingReason: grounding.reason,
        transcriptGroundingMatchedTokens: grounding.matchedTokens,
        transcriptGroundingTokenCount: grounding.tokenCount,
        transcriptGroundingMatchedBigrams: grounding.matchedBigrams,
        transcriptGroundingBigramCount: grounding.bigramCount,
        transcriptGroundingOrderedFlowRatio: grounding.orderedFlowRatio,
        repairWarnings: uniqueRepairWarnings,
        transcriptCoverage,
        boundaryRepairDetails,
      }, ministryMoments));
    }
    funnel.hardValidCandidates = boundaryAdjusted.length;

    const completenessReviewedCandidates: CompletenessReviewedClipCandidate[] = (
      await reviewClipCompletenessCandidates(
        boundaryAdjusted,
        segments,
        {
          rawResponseOverride: options?.completenessReviewResponseOverride,
        },
      )
    ).map((candidate) => {
      const cleaned = removeStaleStructuralWarnings(candidate);
      const trimmed = trimCompletenessCandidateToShortSubrange(cleaned, segments);
      if (trimmed.adjusted) {
        funnel.durationTrimAttempted += 1;
        funnel.durationTrimSucceeded += 1;
      }
      return removeStaleStructuralWarnings(trimmed.candidate);
    });
    funnel.completenessReviewed = completenessReviewedCandidates.length;

    const qualityReviewedCandidates: QualityReviewedClipCandidate[] = (
      await reviewClipQualityCandidates(
      completenessReviewedCandidates,
      {
        rawResponseOverride: options?.qualityReviewResponseOverride,
      },
      )
    ).map(removeStaleQualityReviewWarnings);

    const scoredCandidates = qualityReviewedCandidates.map((candidate) => ({
        ...candidate,
        ...scoreProfessionalClipQuality({
          ...candidate,
          qualityWarnings: [
            ...(candidate.qualityWarnings ?? []),
            ...(candidate.repairWarnings ?? []),
          ],
        }),
      }));
    const professionallyScoredCandidates: ProfessionalReviewedClipCandidate[] = sortByProfessionalQuality(
      degradedTranscriptMode
        ? scoredCandidates.map(markCandidateForDegradedTranscriptReview)
        : scoredCandidates,
    );
    funnel.professionallyScored = professionallyScoredCandidates.length;
    const semanticDedupe = semanticDedupeCandidates(professionallyScoredCandidates, {
      similarityThreshold: 0.82,
      overlapThreshold: 0.5,
    });
    funnel.dedupeClusters = semanticDedupe.kept.length;
    funnel.duplicatesRemoved = semanticDedupe.duplicates.length;
    let selectedCandidates: ProfessionalReviewedClipCandidate[] = selectBestClipCandidates(semanticDedupe.kept);
    let reviewOnlyRescueUsed = false;
    let pastorReviewRescueUsed = false;
    let boundaryReviewRescueUsed = false;

    const strongReviewOnlySelectionUsed = selectedCandidates.length === 0 && !deterministicFallbackUsed;

    if (selectedCandidates.length === 0 && deterministicFallbackUsed) {
      selectedCandidates = sortByProfessionalQuality(semanticDedupe.kept)
        .filter((candidate) => (
          candidate.riskLevel !== "HIGH" &&
          (candidate.transcriptGroundingScore ?? 0) >= 0.72 &&
          (candidate.transcriptGroundingOrderedFlowRatio ?? 0) >= 0.82 &&
          countSelectionWords(candidate.transcriptText) >= MIN_SELECTION_TRANSCRIPT_WORDS &&
          !hasPastorReviewBoardSupplementBlocker(candidate)
        ))
        .slice(0, MAX_REVIEWABLE_CLIP_SUGGESTIONS)
        .map((candidate) => ({
          ...candidate,
          qualityLabel: candidate.boundaryQuality === "BAD" ? "NEEDS_EDITING" : "GOOD_NEEDS_REVIEW",
          postReadyStatus: candidate.boundaryQuality === "BAD" ? "NEEDS_EDITING" : "GOOD_NEEDS_REVIEW",
          recommendedNextAction: candidate.boundaryQuality === "BAD"
            ? (nextActionsForWarnings(candidate.qualityWarnings).includes("EXTEND_CONTEXT") ? "EXTEND_CONTEXT" : "TRIM_CLIP")
            : "REVIEW_CLIP",
          qualitySummary: candidate.qualitySummary
            ? `${candidate.qualitySummary} Deterministic fallback used because AI clip selection was unavailable.`
            : "Deterministic fallback used because AI clip selection was unavailable.",
          pastorFriendlyReason: candidate.pastorFriendlyReason
            ? `${candidate.pastorFriendlyReason} Review this fallback clip before posting.`
            : "Review this fallback clip before posting.",
          finalQualityScore: Math.max(candidate.finalQualityScore ?? candidate.score, candidate.boundaryQuality === "BAD" ? 7.05 : 7.2),
          overallPostScore: Math.max(candidate.overallPostScore ?? candidate.score, candidate.boundaryQuality === "BAD" ? 6.8 : 7.0),
        }));
    }

    if (selectedCandidates.length === 0 && strongReviewOnlySelectionUsed) {
      selectedCandidates = selectStrongReviewOnlyClipCandidates(semanticDedupe.kept).map((candidate) => ({
        ...candidate,
        postReadyStatus: "GOOD_NEEDS_REVIEW",
        recommendedNextAction: candidate.recommendedNextAction ?? "REVIEW_CLIP",
        qualitySummary: candidate.qualitySummary
          ? `${candidate.qualitySummary} No fully post-ready clip survived automated gates, so this strong AI-selected moment is being kept for pastor review.`
          : "No fully post-ready clip survived automated gates, so this strong AI-selected moment is being kept for pastor review.",
        pastorFriendlyReason: candidate.pastorFriendlyReason
          ? `${candidate.pastorFriendlyReason} Review before posting because automated checks did not mark it post-ready.`
          : "Review before posting because automated checks did not mark it post-ready.",
        postReadyBlockers: [
          ...new Set([
            ...(candidate.postReadyBlockers ?? []),
            "Needs pastor review before posting because no fully post-ready clip survived automated checks.",
          ]),
        ],
      }));
      reviewOnlyRescueUsed = selectedCandidates.length > 0;
    }

    if (selectedCandidates.length === 0 && !deterministicFallbackUsed) {
      selectedCandidates = sortByProfessionalQuality(semanticDedupe.kept)
        .filter((candidate) => (
          candidate.boundaryQuality !== "BAD" &&
          candidate.riskLevel !== "HIGH" &&
          (candidate.finalQualityScore ?? candidate.score) >= 6.8 &&
          (candidate.transcriptGroundingScore ?? 0) >= 0.9 &&
          (candidate.transcriptGroundingOrderedFlowRatio ?? 0) >= 0.85 &&
          countSelectionWords(candidate.transcriptText) >= MIN_SELECTION_TRANSCRIPT_WORDS
        ))
        .slice(0, Math.min(MAX_SERMON_CLIP_SUGGESTIONS, MIN_REVIEWABLE_CLIP_SUGGESTIONS))
        .map((candidate) => ({
          ...candidate,
          qualityLabel: (candidate.finalQualityScore ?? candidate.score) >= MIN_GOOD_CLIP_SCORE ? "GOOD_NEEDS_REVIEW" : "NEEDS_EDITING",
          postReadyStatus: (candidate.finalQualityScore ?? candidate.score) >= MIN_GOOD_CLIP_SCORE ? "GOOD_NEEDS_REVIEW" : "NEEDS_EDITING",
          recommendedNextAction: candidate.recommendedNextAction === "REJECT"
            ? ((candidate.finalQualityScore ?? candidate.score) >= MIN_GOOD_CLIP_SCORE ? "REVIEW_CLIP" : "TRIM_CLIP")
            : candidate.recommendedNextAction,
          qualitySummary: candidate.qualitySummary
            ? `${candidate.qualitySummary} Kept for pastor review because the clip is grounded and scored well, even though strict automated gates did not mark it post-ready.`
            : "Kept for pastor review because the clip is grounded and scored well, even though strict automated gates did not mark it post-ready.",
          pastorFriendlyReason: candidate.pastorFriendlyReason
            ? `${candidate.pastorFriendlyReason} Review this option before posting.`
            : "Review this option before posting.",
          postReadyBlockers: [
            ...new Set([
              ...(candidate.postReadyBlockers ?? []),
              "Needs pastor review because strict automated quality gates flagged this clip.",
            ]),
          ],
        }));
      pastorReviewRescueUsed = selectedCandidates.length > 0;
    }

    const selectedBeforeRescueCount = selectedCandidates.length;
    selectedCandidates = selectRescueClipCandidates(
      semanticDedupe.kept,
      selectedCandidates,
      MIN_REVIEWABLE_CLIP_SUGGESTIONS,
      MAX_REVIEWABLE_CLIP_SUGGESTIONS,
    );
    if (selectedCandidates.length > selectedBeforeRescueCount) {
      pastorReviewRescueUsed = true;
      funnel.rescueCandidatesAdded += selectedCandidates.length - selectedBeforeRescueCount;
    }

    if (selectedCandidates.length > 0 && selectedCandidates.length < MIN_REVIEWABLE_CLIP_SUGGESTIONS) {
      const supplementCandidates = sortByProfessionalQuality(semanticDedupe.kept)
        .filter((candidate) => (
          !selectedCandidates.some((selectedCandidate) => sameCandidateTiming(candidate, selectedCandidate)) &&
          (candidate.finalQualityScore ?? candidate.score) >= MIN_REVIEW_BOARD_SUPPLEMENT_SCORE &&
          !hasPastorReviewBoardSupplementBlocker(candidate)
        ));

      for (const candidate of supplementCandidates) {
        const reviewCandidate = toPastorReviewBoardCandidate(candidate);
        const nearbySelectedCount = selectedCandidates.filter((selectedCandidate) => isInSameTimeCluster(reviewCandidate, selectedCandidate)).length;
        if (nearbySelectedCount >= MAX_SELECTED_CLIPS_PER_TIME_CLUSTER) {
          continue;
        }
        if (isSemanticallyRedundantSelection(reviewCandidate, selectedCandidates)) {
          continue;
        }

        selectedCandidates.push(reviewCandidate);
        pastorReviewRescueUsed = true;

        if (selectedCandidates.length >= MAX_REVIEWABLE_CLIP_SUGGESTIONS) {
          break;
        }
        if (selectedCandidates.length >= MIN_REVIEWABLE_CLIP_SUGGESTIONS) {
          break;
        }
      }

      if (selectedCandidates.length < MIN_REVIEWABLE_CLIP_SUGGESTIONS) {
        for (const candidate of supplementCandidates) {
          if (selectedCandidates.some((selectedCandidate) => sameCandidateTiming(candidate, selectedCandidate))) {
            continue;
          }

          const reviewCandidate = toPastorReviewBoardCandidate(candidate);
          const nearbySelectedCount = selectedCandidates.filter((selectedCandidate) => isInSameTimeCluster(reviewCandidate, selectedCandidate)).length;
          if (nearbySelectedCount >= MAX_SELECTED_CLIPS_PER_TIME_CLUSTER + 1) {
            continue;
          }

          selectedCandidates.push({
            ...reviewCandidate,
            postReadyBlockers: [
              ...new Set([
                ...(reviewCandidate.postReadyBlockers ?? []),
                "Near-alternate kept so pastors can choose between multiple usable trims from the sermon.",
              ]),
            ],
          });
          pastorReviewRescueUsed = true;

          if (selectedCandidates.length >= MIN_REVIEWABLE_CLIP_SUGGESTIONS) {
            break;
          }
          if (selectedCandidates.length >= MAX_REVIEWABLE_CLIP_SUGGESTIONS) {
            break;
          }
        }
      }
    }

    if (selectedCandidates.length === 0 && !deterministicFallbackUsed) {
      selectedCandidates = selectBoundaryReviewClipCandidates(semanticDedupe.kept).map((candidate) => ({
        ...toPastorReviewBoardCandidate(candidate),
        qualityLabel: "NEEDS_EDITING",
        postReadyStatus: "NEEDS_EDITING",
        recommendedNextAction: "TRIM_CLIP",
        qualitySummary: candidate.qualitySummary
          ? `${candidate.qualitySummary} Kept for pastor review because the sermon moment is grounded, but the automated boundary check was too conservative.`
          : "Kept for pastor review because the sermon moment is grounded, but the automated boundary check was too conservative.",
        pastorFriendlyReason: candidate.pastorFriendlyReason
          ? `${candidate.pastorFriendlyReason} Review and trim this option before posting.`
          : "Review and trim this option before posting.",
        postReadyBlockers: [
          ...new Set([
            ...(candidate.postReadyBlockers ?? []),
            "Needs pastor trim because automated checks did not trust the clip boundary.",
          ]),
        ],
      }));
      boundaryReviewRescueUsed = selectedCandidates.length > 0;
    }

    if (selectedCandidates.length === 0) {
      await appendJobLog(
        job.id,
        [
          "Clip selection diagnostics:",
          `collected=${collected.length}`,
          `boundaryAdjusted=${boundaryAdjusted.length}`,
          `boundaryRejected=${boundaryRejected.length}`,
          `completenessReviewed=${completenessReviewedCandidates.length}`,
          `qualityReviewed=${qualityReviewedCandidates.length}`,
          `professionallyScored=${professionallyScoredCandidates.length}`,
          `dedupeKept=${semanticDedupe.kept.length}`,
          `dedupeDuplicates=${semanticDedupe.duplicates.length}`,
          `fallbackUsed=${deterministicFallbackUsed}`,
          professionallyScoredCandidates.slice(0, 5).map((candidate, index) => (
            `candidate${index + 1} label=${candidate.qualityLabel} post=${candidate.postReadyStatus} final=${candidate.finalQualityScore} boundary=${candidate.boundaryQuality} risk=${candidate.riskLevel} grounding=${candidate.transcriptGroundingScore} ordered=${candidate.transcriptGroundingOrderedFlowRatio}`
          )).join(" | "),
          boundaryRejected.length > 0 ? `boundaryRejectedSample=${boundaryRejected.slice(0, 5).join(" | ")}` : "",
        ].filter(Boolean).join(" "),
      );
        const hardValidAfterQualityCount = professionallyScoredCandidates.filter((candidate) => (
          candidate.riskLevel !== "HIGH" &&
          !(candidate.qualityWarnings ?? []).some(isHardQualityWarning) &&
          (candidate.transcriptGroundingScore ?? 0) >= 0.72 &&
          (candidate.transcriptGroundingOrderedFlowRatio ?? 0) >= 0.82
        )).length;
        if (boundaryAdjusted.length === 0 || hardValidAfterQualityCount === 0) {
          throw new Error("Clip generation produced no hard-valid candidates after timestamp, transcript grounding, safety, and core content checks.");
        }
      throw new Error("Clip generation produced hard-valid candidates, but selection unexpectedly returned zero reviewable suggestions.");
    }

    if (boundaryReviewRescueUsed) {
      await appendJobLog(
        job.id,
        `Boundary review rescue kept ${selectedCandidates.length} grounded clip option(s) for pastor review instead of failing with zero suggestions.`,
      );
    }
    funnel.postReadyCount = selectedCandidates.filter((candidate) => candidate.postReadyStatus === "POST_READY").length;
    funnel.goodNeedsReviewCount = selectedCandidates.filter((candidate) => candidate.postReadyStatus === "GOOD_NEEDS_REVIEW").length;
    funnel.needsEditingCount = selectedCandidates.filter((candidate) => candidate.postReadyStatus === "NEEDS_EDITING").length;
    funnel.hardRejectedCount = professionallyScoredCandidates.filter((candidate) => (
      candidate.qualityLabel === "REJECT" && (candidate.qualityWarnings ?? []).some(isHardQualityWarning)
    )).length + boundaryRejected.length + rejectedReasons.length;
    funnel.rejectionReasons = countReasonCodes([...boundaryRejected, ...rejectedReasons]);
    funnel.warningReasons = countReasonCodes(professionallyScoredCandidates.flatMap((candidate) => candidate.qualityWarnings ?? []));
    for (const candidate of professionallyScoredCandidates) {
      const coherence = analyzeClipCoherence(candidate.transcriptText);
      const qualityWarnings = candidate.qualityWarnings ?? [];
      const completenessWarnings = candidate.completenessWarnings ?? [];
      const openingRepairAttempted = Boolean(candidate.boundaryRepairDetails?.openingRepair?.attempted);
      const landingRepairWasAttempted = (candidate.repairWarnings ?? []).some((warning) => (
        warning === "LANDING_REPAIRED" ||
        warning === "REVIEW_ENDING" ||
        warning === "TRANSCRIPT_LIMITED_ENDING"
      ));

      if (!openingRepairAttempted && qualityWarnings.some((warning) => warning.includes("OPENING") || warning === "NEEDS_START_TRIM")) {
        funnel.mismatchCounters.FINAL_OPENING_WARNING_WITHOUT_REPAIR_ATTEMPT += 1;
      }
      if (
        !landingRepairWasAttempted &&
        qualityWarnings.some((warning) => warning.includes("DANGLING_ENDING") || warning === "REVIEW_ENDING" || warning === "NEEDS_END_TRIM")
      ) {
        funnel.mismatchCounters.FINAL_ENDING_WARNING_WITHOUT_REPAIR_ATTEMPT += 1;
      }
      if (
        coherence.endingStatus === "CLEAN" &&
        completenessWarnings.some((warning) => warning === "INCOMPLETE_ENDING" || warning === "MISSING_LANDING")
      ) {
        funnel.mismatchCounters.COMPLETENESS_DISAGREES_WITH_COHERENCE += 1;
      }
      if (
        candidate.boundaryQuality === "GOOD" &&
        coherence.endingStatus === "CLEAN" &&
        qualityWarnings.some((warning) => warning === "PASTOR_GRADE_DANGLING_ENDING" || warning === "REVIEW_ENDING")
      ) {
        funnel.mismatchCounters.QUALITY_REVIEW_DISAGREES_WITH_COHERENCE += 1;
      }
      if (
        qualityWarnings.includes("MISSING_CAPTION_SEGMENTS") &&
        (candidate as { captionStatus?: string | null }).captionStatus !== "FAILED" &&
        (!(candidate as { captionData?: unknown }).captionData ||
          (typeof (candidate as { captionData?: unknown }).captionData === "object" &&
            !Array.isArray((candidate as { captionData?: unknown }).captionData) &&
            !Array.isArray(((candidate as { captionData?: unknown }).captionData as Record<string, unknown>).cues)))
      ) {
        funnel.mismatchCounters.CAPTION_NOT_EVALUATED_TREATED_AS_FAILURE += 1;
      }
      if (candidate.completenessReviewSource === "FALLBACK" || candidate.qualityReviewSource === "FALLBACK") {
        funnel.mismatchCounters.FALLBACK_SCORE_USED += 1;
      }
      if (candidate.completenessReviewSource === "AI" || candidate.qualityReviewSource === "AI") {
        funnel.mismatchCounters.AI_SCORE_USED += 1;
      }
      if (funnel.candidateDiagnosticSamples.length < 5) {
        funnel.candidateDiagnosticSamples.push({
          title: candidate.title,
          responseFormat: candidate.responseFormat ?? null,
          startTimeSeconds: candidate.startTimeSeconds,
          endTimeSeconds: candidate.endTimeSeconds,
          boundaryQuality: candidate.boundaryQuality,
          openingStatus: coherence.openingStatus,
          endingStatus: coherence.endingStatus,
          landingStatus: coherence.landingStatus,
          completenessAction: candidate.completenessAction ?? null,
          completenessSource: candidate.completenessReviewSource ?? null,
          completenessWarnings,
          qualityWarnings,
          postReadyStatus: candidate.postReadyStatus ?? null,
          recommendedNextAction: candidate.recommendedNextAction ?? null,
        });
      }
    }

    await appendJobLog(
      job.id,
      [
        "Review board selection summary:",
        `collected=${collected.length}`,
        `boundaryAdjusted=${boundaryAdjusted.length}`,
        `boundaryRejected=${boundaryRejected.length}`,
        `professionallyScored=${professionallyScoredCandidates.length}`,
        `dedupeKept=${semanticDedupe.kept.length}`,
        `dedupeDuplicates=${semanticDedupe.duplicates.length}`,
        `selected=${selectedCandidates.length}`,
        `postReady=${selectedCandidates.filter((candidate) => candidate.postReadyStatus === "POST_READY").length}`,
        `review=${selectedCandidates.filter((candidate) => candidate.postReadyStatus === "GOOD_NEEDS_REVIEW").length}`,
        `editing=${selectedCandidates.filter((candidate) => candidate.postReadyStatus === "NEEDS_EDITING").length}`,
        `funnel=${JSON.stringify(funnel)}`,
      ].join(" "),
    );

    await prisma.$transaction(async (tx) => {
      if (options?.force || shouldReplaceExistingSuggestionsBeforeSave(existingSuggestionReuse)) {
        await tx.clipCandidate.deleteMany({
          where: buildSuggestionDeleteWhere(sermon.id, options?.targetCategory, Boolean(options?.force)),
        });
      }

      await tx.clipCandidate.createMany({
        data: selectedCandidates.map((candidate) => ({
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
          rawAiCandidate: candidate.rawAiCandidate ?? candidate,
          qualityDebugSnapshot: {
            rawAiCandidate: candidate.rawAiCandidate ?? candidate,
            adjustedBoundaries: {
              originalStartTimeSeconds: candidate.originalStartTimeSeconds,
              originalEndTimeSeconds: candidate.originalEndTimeSeconds,
              adjustedStartTimeSeconds: candidate.adjustedStartTimeSeconds,
              adjustedEndTimeSeconds: candidate.adjustedEndTimeSeconds,
              boundaryAdjustmentReason: candidate.boundaryAdjustmentReason,
              boundaryQuality: candidate.boundaryQuality,
            },
            hookAnalysis: {
              hookScore: candidate.hookScore,
              hookType: candidate.hookType,
              hookProblem: candidate.hookProblem,
              hookReason: candidate.hookReason,
              suggestedStartAdjustment: candidate.suggestedStartAdjustment,
            },
            transcriptGrounding: {
              score: candidate.transcriptGroundingScore,
              reason: candidate.transcriptGroundingReason,
              matchedTokens: candidate.transcriptGroundingMatchedTokens,
              tokenCount: candidate.transcriptGroundingTokenCount,
              matchedBigrams: candidate.transcriptGroundingMatchedBigrams,
              bigramCount: candidate.transcriptGroundingBigramCount,
              orderedFlowRatio: candidate.transcriptGroundingOrderedFlowRatio,
            },
            transcriptCoverage: candidate.transcriptCoverage,
            repairWarnings: candidate.repairWarnings,
            boundaryRepairDetails: candidate.boundaryRepairDetails,
            arcAnalysis: {
              clipArcType: candidate.clipArcType,
              arcSummary: candidate.arcSummary,
              setupStartTime: candidate.setupStartTime,
              mainPointTime: candidate.mainPointTime,
              payoffTime: candidate.payoffTime,
              applicationTime: candidate.applicationTime,
              arcCompletenessScore: candidate.arcCompletenessScore,
              whyThisClipFeelsComplete: candidate.whyThisClipFeelsComplete,
              whatContextMightBeMissing: candidate.whatContextMightBeMissing,
            },
            scoreBreakdown: {
              hookScore: candidate.hookScore,
              standaloneClarityScore: candidate.standaloneClarityScore,
              emotionalWeightScore: candidate.emotionalWeightScore,
              ministryValueScore: candidate.ministryValueScore,
              boundaryQualityScore: candidate.boundaryQualityScore,
              visualConfidenceScore: candidate.visualConfidenceScore,
              socialShareabilityScore: candidate.socialShareabilityScore,
              audioQualityScore: candidate.audioQualityScore,
              captionQualityScore: candidate.captionQualityScore,
              durationQualityScore: candidate.durationQualityScore,
              finalQualityScore: candidate.finalQualityScore,
            },
            scoreProvenance: {
              hook: candidate.hookReason === "Existing hook score was reused."
                ? "EXISTING_CANDIDATE_SCORE"
                : "DETERMINISTIC_HOOK_ANALYSIS",
              standaloneClarity: candidate.qualityReviewSource === "AI"
                ? "AI_QUALITY_REVIEW"
                : candidate.qualityReviewSource === "FALLBACK"
                  ? "FALLBACK_QUALITY_REVIEW"
                  : "LOCAL_SCORING",
              completeness: candidate.completenessReviewSource ?? null,
              arc: "DETERMINISTIC_ARC_ANALYSIS",
              qualityReview: candidate.qualityReviewSource ?? null,
            },
            warnings: candidate.qualityWarnings,
            postReadyDecision: {
              postReadyStatus: candidate.postReadyStatus,
              postReadyReasons: candidate.postReadyReasons,
              postReadyBlockers: candidate.postReadyBlockers,
              recommendedNextAction: candidate.recommendedNextAction,
            },
          },
          startTimeSeconds: candidate.startTimeSeconds,
          endTimeSeconds: candidate.endTimeSeconds,
          durationSeconds: candidate.durationSeconds,
          originalStartTimeSeconds: candidate.originalStartTimeSeconds,
          originalEndTimeSeconds: candidate.originalEndTimeSeconds,
          adjustedStartTimeSeconds: candidate.adjustedStartTimeSeconds,
          adjustedEndTimeSeconds: candidate.adjustedEndTimeSeconds,
          boundaryAdjustmentReason: candidate.boundaryAdjustmentReason,
          boundaryQuality: candidate.boundaryQuality,
          completenessScore: candidate.completenessScore,
          completenessAction: candidate.completenessAction,
          completenessReason: candidate.completenessReason,
          completenessWarnings: candidate.completenessWarnings,
          completenessReviewedAt: candidate.completenessReviewedAt,
          completenessReviewSource: candidate.completenessReviewSource,
          previousAdjustedStartTimeSeconds: candidate.previousAdjustedStartTimeSeconds,
          previousAdjustedEndTimeSeconds: candidate.previousAdjustedEndTimeSeconds,
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
          hookStrengthScore: candidate.hookStrengthScore,
          hookScore: candidate.hookScore,
          hookType: candidate.hookType,
          hookProblem: candidate.hookProblem,
          suggestedStartAdjustment: candidate.suggestedStartAdjustment,
          hookReason: candidate.hookReason,
          standaloneClarityScore: candidate.standaloneClarityScore,
          emotionalImpactScore: candidate.emotionalImpactScore,
          emotionalWeightScore: candidate.emotionalWeightScore,
          sermonValueScore: candidate.sermonValueScore,
          ministryValueScore: candidate.ministryValueScore,
          shareabilityScore: candidate.shareabilityScore,
          socialShareabilityScore: candidate.socialShareabilityScore,
          contextSafetyScore: candidate.contextSafetyScore,
          boundaryQualityScore: candidate.boundaryQualityScore,
          visualConfidenceScore: candidate.visualConfidenceScore,
          visualReadinessScore: candidate.visualReadinessScore,
          audioQualityScore: candidate.audioQualityScore,
          averageLoudness: candidate.averageLoudness,
          peakLoudness: candidate.peakLoudness,
          silenceAtBeginningSeconds: candidate.silenceAtBeginningSeconds,
          silenceAtEndSeconds: candidate.silenceAtEndSeconds,
          audioWarnings: candidate.audioWarnings,
          captionQualityScore: candidate.captionQualityScore,
          captionQualityWarnings: candidate.captionQualityWarnings,
          arcCompletenessScore: candidate.arcCompletenessScore,
          finalQualityScore: candidate.finalQualityScore,
          qualityLabel: candidate.qualityLabel,
          qualityReasons: candidate.qualityReasons,
          rankingCategory: candidate.rankingCategory,
          clipArcType: candidate.clipArcType,
          arcSummary: candidate.arcSummary,
          setupStartTime: candidate.setupStartTime,
          mainPointTime: candidate.mainPointTime,
          payoffTime: candidate.payoffTime,
          applicationTime: candidate.applicationTime,
          whyThisClipFeelsComplete: candidate.whyThisClipFeelsComplete,
          whatContextMightBeMissing: candidate.whatContextMightBeMissing,
          durationQualityScore: candidate.durationQualityScore,
          durationQualityLabel: candidate.durationQualityLabel,
          bestPlatform: candidate.bestPlatform,
          postReadyStatus: candidate.postReadyStatus,
          postReadyReasons: candidate.postReadyReasons,
          postReadyBlockers: candidate.postReadyBlockers,
          recommendedNextAction: candidate.recommendedNextAction,
          overallPostScore: candidate.overallPostScore,
          qualitySummary: candidate.qualitySummary,
          pastorFriendlyReason: candidate.pastorFriendlyReason,
          recommendedAction: candidate.recommendedAction,
          suggestedStartTimeSeconds: candidate.suggestedStartTimeSeconds,
          suggestedEndTimeSeconds: candidate.suggestedEndTimeSeconds,
          qualityClipCategory: candidate.qualityClipCategory,
          qualityWarnings: candidate.qualityWarnings,
          qualityReviewedAt: candidate.qualityReviewedAt,
          qualityReviewSource: candidate.qualityReviewSource,
          status: "SUGGESTED",
        })),
      });
    });

    const savedClipsForQc = await prisma.clipCandidate.findMany({
      where: {
        sermonId: sermon.id,
        status: "SUGGESTED",
        isAiGenerated: true,
        isManuallyEdited: false,
        createdAt: { gte: job.createdAt },
        ...(options?.targetCategory ? { smartClipCategory: options.targetCategory } : {}),
      },
      select: {
        id: true,
        title: true,
        qualityLabel: true,
        postReadyStatus: true,
        boundaryQuality: true,
        rankingCategory: true,
        finalQualityScore: true,
        startTimeSeconds: true,
      },
    });

    let trackedClipCount = 0;
    const shouldDeferVideoSubjectTracking =
      deterministicFallbackUsed ||
      savedClipsForQc.length > 0 && savedClipsForQc.every((clip) => clip.postReadyStatus !== "POST_READY");
    if (shouldDeferVideoSubjectTracking) {
      await appendJobLog(
        job.id,
        `Deferred video subject tracking for ${savedClipsForQc.length} review-first clip(s); pastor review can run before heavier media QC.`,
      );
    } else {
      for (const clip of savedClipsForQc) {
        try {
          const trackingResult = await refreshVideoSubjectTracking(clip.id);
          trackedClipCount += 1;
          await appendJobLog(job.id, `Video subject tracking prepared for clip ${clip.id} using ${trackingResult.source}.`);
          await refreshClipVisualQuality(clip.id).catch((visualQualityError: unknown) => {
            const visualQualityMessage = visualQualityError instanceof Error ? visualQualityError.message : "Unknown visual quality refresh error.";
            return appendJobLog(job.id, `Visual quality refresh skipped for clip ${clip.id}: ${visualQualityMessage}`);
          });
        } catch (trackingError) {
          const trackingMessage = trackingError instanceof Error ? trackingError.message : "Unknown video subject tracking error.";
          await appendJobLog(job.id, `Video subject tracking skipped for clip ${clip.id}: ${trackingMessage}`);
          await refreshClipVisualQuality(clip.id).catch((visualQualityError: unknown) => {
            const visualQualityMessage = visualQualityError instanceof Error ? visualQualityError.message : "Unknown visual quality refresh error.";
            return appendJobLog(job.id, `Visual quality refresh skipped for clip ${clip.id}: ${visualQualityMessage}`);
          });
        }
      }
    }

    const curationSummary = {
      clipsFound: savedClipsForQc.length,
      clipsKept: savedClipsForQc.length,
      clipsRejected: 0,
      rejectedWeak: 0,
      rejectedOverflow: 0,
      decisions: [],
    };
    if (deterministicFallbackUsed) {
      await appendJobLog(
        job.id,
        `Automatic rejection curation skipped for ${savedClipsForQc.length} deterministic fallback clip(s); keeping them in pastor review as review-first suggestions.`,
      );
    } else if (reviewOnlyRescueUsed) {
      await appendJobLog(
        job.id,
        `Automatic rejection curation skipped for ${savedClipsForQc.length} strong AI review-only clip(s); keeping them in pastor review because no post-ready clip survived automated checks.`,
      );
    } else if (pastorReviewRescueUsed) {
      await appendJobLog(
        job.id,
        `Automatic rejection curation skipped for ${savedClipsForQc.length} pastor-review rescue clip(s); keeping grounded high-scoring options visible for pastor choice.`,
      );
    } else if (curationSummary.clipsFound > 0) {
      await appendJobLog(
        job.id,
        `Automatic rejection curation skipped for ${savedClipsForQc.length} generated clip option(s); keeping the pastor review board broad.`,
      );
    }

    const savedClips = await prisma.clipCandidate.findMany({
      where: {
        sermonId: sermon.id,
        status: "SUGGESTED",
        isAiGenerated: true,
        isManuallyEdited: false,
        createdAt: { gte: job.createdAt },
        ...(options?.targetCategory ? { smartClipCategory: options.targetCategory } : {}),
      },
      orderBy: [{ finalQualityScore: "desc" }, { score: "desc" }, { startTimeSeconds: "asc" }],
      select: {
        id: true,
        title: true,
        qualityLabel: true,
        rankingCategory: true,
        finalQualityScore: true,
        startTimeSeconds: true,
      },
    });

    if (savedClips.length === 0) {
      throw new Error("Clip generation created candidates, but none remained pastor-review-ready after visual QC and automatic curation.");
    }

    const fallbackQualityCount = selectedCandidates.filter((candidate) => candidate.qualityReviewSource === "FALLBACK").length;
    const needsReviewCount = savedClips.filter((candidate) => candidate.qualityLabel === "GOOD_NEEDS_REVIEW" || (candidate.qualityLabel === "POST_READY" && !isSavedPostReadyClip(candidate))).length;
    const needsEditingCount = savedClips.filter((candidate) => candidate.qualityLabel === "NEEDS_EDITING").length;
    const postReadyCount = savedClips.filter(isSavedPostReadyClip).length;

    if (postReadyCount === 0 && !deterministicFallbackUsed) {
      await appendJobLog(
        job.id,
        `No post-ready clip survived automated checks; keeping ${savedClips.length} strong AI-selected clip(s) in pastor review.`,
      );
    }

    await updateSermonStatus(sermon.id, "CLIPS_GENERATED");
    const rejectCount = curationSummary.clipsRejected;
    const topClipTitles = [...savedClips]
      .sort((left, right) => {
        const labelOrder = { POST_READY: 0, GOOD_NEEDS_REVIEW: 1, NEEDS_EDITING: 2, REJECT: 3 } as const;
        const labelDiff = labelOrder[getSavedClipRankingLabel(left)] - labelOrder[getSavedClipRankingLabel(right)];
        if (labelDiff !== 0) return labelDiff;
        return (right.finalQualityScore ?? 0) - (left.finalQualityScore ?? 0);
      })
      .slice(0, 5)
      .map((candidate) => candidate.title)
      .join(", ");
    const generationSummary = buildStructuredGenerationSummary({
      totalCandidatesGenerated: collected.length,
      validCandidates: boundaryAdjusted.length,
      boundaryRejectedCount: boundaryRejected.length,
      validationRejectedCount: rejectedReasons.length,
      semanticDuplicateCount: semanticDedupe.duplicates.length,
      savedClips,
    });
    funnel.savedCount = savedClips.length;
    const successMessage = [
      `Created ${selectedCandidates.length} clip suggestion(s); ${savedClips.length} remain in pastor review after visual QC and automatic curation.`,
      `Generation summary: ${collected.length} total candidate(s), ${boundaryAdjusted.length} valid after boundary checks, ${boundaryRejected.length + rejectedReasons.length} rejected before scoring, ${postReadyCount} post-ready, ${needsReviewCount} good but review first, ${needsEditingCount} need editing, ${rejectCount} rejected by post-QC curation.`,
      `Quality review complete: ${fallbackQualityCount} fallback review(s). Top picks: ${topClipTitles || "none"}.`,
      `Semantic dedupe removed ${semanticDedupe.duplicates.length} repetitive candidate(s). Pastor-grade filtering kept ${selectedCandidates.length} of ${semanticDedupe.kept.length} deduped candidate(s).`,
      `Candidate funnel diagnostics: ${JSON.stringify(funnel)}.`,
      `Video subject tracking prepared for ${trackedClipCount} clip(s).`,
      `Automatic review curation kept ${curationSummary.clipsKept} of ${curationSummary.clipsFound} reviewable AI suggestion(s).`,
      `Repair used in ${repairUsedCount} batch(es).`,
      `Target duration guidance ${TARGET_MIN_DURATION_SECONDS}-${TARGET_MAX_DURATION_SECONDS}s preferred, ${TARGET_MAX_DURATION_SECONDS}-${HARD_MAX_DURATION_SECONDS}s allowed for complete scripture, story, testimony, prayer, or emotional ministry moments.`,
      `Boundary adjustments applied to ${boundaryAdjustedCount} candidate(s).`,
      boundaryRejected.length > 0
        ? `Rejected ${boundaryRejected.length} candidate(s) due to boundary checks: ${boundaryRejected.join(" | ")}`
        : "No candidates were rejected by boundary checks.",
      rejectedReasons.length > 0
        ? `Rejected ${rejectedReasons.length} invalid candidate(s): ${rejectedReasons.join(" | ")}`
        : "No candidates were rejected by validation.",
    ].join(" ");
    await prisma.processingJob.update({
      where: { id: job.id },
      data: { generationSummary: { ...generationSummary, funnel } },
    });
    await markJobSucceeded(job.id, successMessage);
    await appendPipelineLog(sermon.id, `Clip suggestions generated successfully (${selectedCandidates.length} saved, ranked by professional post readiness).`);

    return { clipCount: selectedCandidates.length, reusedExistingSuggestions: false };
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
  getExistingSuggestionReuseDecision,
  buildSuggestionDeleteWhere,
  shouldPreserveClipDuringRegeneration,
  shouldReplaceExistingSuggestionsBeforeSave,
  buildStructuredGenerationSummary,
  selectReusableReviewBoardSuggestions,
  selectBestClipCandidates,
  selectStrongReviewOnlyClipCandidates,
  selectBoundaryReviewClipCandidates,
  selectRescueClipCandidates,
  assessTranscriptReadinessForClipping,
  isReviewOnlyTranscriptUsableForClipGeneration,
  isManualRescueTranscriptUsableForClipGeneration,
  classifyTranscriptQualityForClipGeneration,
  assessClipWindowQuality,
  buildRollingWindows,
  buildHeuristicClipCandidatesFromWindows,
  buildLowTranscriptTimedFallbackCandidates,
  isAiQuotaError,
  rankClipWindowsForSelection,
  filterCandidatesToPromptWindows,
  repairMissingLanding,
  repairWeakOpening,
  clampCandidateToBounds,
  trimCandidateToShortSubrange,
  revalidateCandidateBoundary,
  validatePastorTitle,
  deterministicPastorTitle,
  normalizePastorTitle,
  candidateTranscriptCoverage,
  assessCandidateTranscriptGrounding,
  assessCandidateLandingEvidence,
  scoreMomentForWindows,
  selectPromptMinistryMomentsForWindows,
};
