import {
  HARD_MAX_DURATION_SECONDS,
  HARD_MIN_DURATION_SECONDS,
  validateFinalClipBoundary,
  type TranscriptSegmentBoundary,
} from "@/server/agents/clipBoundaryRefinement";
import { analyzeClipCoherence } from "@/server/agents/clipCoherenceAnalysis";

export const CLIP_HOOK_TYPES = [
  "QUESTION",
  "BOLD_STATEMENT",
  "SCRIPTURE_TRUTH",
  "EMOTIONAL_LINE",
  "PROBLEM_STATEMENT",
  "STORY_OPENING",
  "WEAK_CONTEXTUAL_START",
] as const;

export type ClipHookType = typeof CLIP_HOOK_TYPES[number];

export type ClipHookAnalysis = {
  hookScore: number;
  hookType: ClipHookType;
  hookProblem: string | null;
  suggestedStartAdjustment: number | null;
  hookReason: string;
};

export type HookBoundaryResult<T> = {
  candidate: T & {
    hookScore: number;
    hookType: ClipHookType;
    hookProblem: string | null;
    suggestedStartAdjustment: number | null;
    hookReason: string;
    adjustedStartTimeSeconds?: number | null;
    adjustedEndTimeSeconds?: number | null;
    boundaryAdjustmentReason?: string | null;
    boundaryQuality?: "GOOD" | "NEEDS_REVIEW" | "BAD";
    transcriptText: string;
    durationSeconds: number;
    startTimeSeconds: number;
    endTimeSeconds: number;
  };
  adjusted: boolean;
};

type HookCandidate = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  transcriptText: string;
  hook?: string | null;
  boundaryAdjustmentReason?: string | null;
  boundaryQuality?: "GOOD" | "NEEDS_REVIEW" | "BAD";
};

const FILLER_PATTERN = /^(um|uh|erm|okay|alright|you know|i mean|well)\b/i;
const SUBJECT_PATTERN = /\b(god|jesus|christ|lord|holy spirit|scripture|bible|faith|prayer|church|you|we|your|our|people|life|heart|hope|grace)\b/i;
const SCRIPTURE_PATTERN = /\b(scripture|bible|verse|john|romans|psalm|isaiah|matthew|mark|luke|acts|corinthians|genesis|revelation)\b/i;
const EMOTION_PATTERN = /\b(hurt|pain|fear|weary|broken|hope|love|joy|peace|grace|mercy|forgive|healing|deliver)\b/i;
const PROBLEM_PATTERN = /\b(problem|struggle|question|why|when you|if you|what do you do|challenge|enemy|temptation)\b/i;
const STORY_PATTERN = /\b(i remember|one day|there was|when i was|story|testimony|years ago)\b/i;

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(10, Number(value.toFixed(2))));
}

function sentenceEndIndex(text: string): number {
  const match = text.match(/[.!?]["')\]]?(?:\s|$)/u);
  return match?.index === undefined ? -1 : match.index + match[0].trimEnd().length;
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const endIndex = sentenceEndIndex(trimmed);
  return (endIndex === -1 ? trimmed : trimmed.slice(0, endIndex)).trim();
}

function composeTranscriptText(segments: TranscriptSegmentBoundary[], startIndex: number, endIndex: number): string {
  return segments
    .slice(startIndex, endIndex + 1)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
}

function findStartIndex(segments: TranscriptSegmentBoundary[], startTimeSeconds: number): number {
  return segments.findIndex((segment) => segment.endTimeSeconds > startTimeSeconds);
}

function findEndIndex(segments: TranscriptSegmentBoundary[], endTimeSeconds: number, startIndex: number): number {
  let endIndex = startIndex;

  for (let index = startIndex; index < segments.length; index += 1) {
    if (segments[index].startTimeSeconds >= endTimeSeconds) {
      break;
    }

    endIndex = index;
  }

  return endIndex;
}

function inferHookType(opening: string): ClipHookType {
  const coherence = analyzeClipCoherence(opening);
  if (coherence.openingStatus !== "CLEAN" || FILLER_PATTERN.test(opening)) {
    return "WEAK_CONTEXTUAL_START";
  }
  if (/\?/.test(opening)) {
    return "QUESTION";
  }
  if (SCRIPTURE_PATTERN.test(opening)) {
    return "SCRIPTURE_TRUTH";
  }
  if (STORY_PATTERN.test(opening)) {
    return "STORY_OPENING";
  }
  if (PROBLEM_PATTERN.test(opening)) {
    return "PROBLEM_STATEMENT";
  }
  if (EMOTION_PATTERN.test(opening)) {
    return "EMOTIONAL_LINE";
  }

  return "BOLD_STATEMENT";
}

export function analyzeClipHook(candidate: HookCandidate): ClipHookAnalysis {
  const opening = firstSentence(candidate.transcriptText || candidate.hook || "");
  const reasons: string[] = [];
  let score = 7.2;
  const coherence = analyzeClipCoherence(opening);

  if (!opening) {
    return {
      hookScore: 1,
      hookType: "WEAK_CONTEXTUAL_START",
      hookProblem: "Opening transcript is missing.",
      suggestedStartAdjustment: null,
      hookReason: "The clip does not have enough opening text to judge the first few seconds.",
    };
  }

  if (coherence.openingStatus === "SOFT_CONNECTOR" || coherence.openingStatus === "DEPENDENT") {
    score -= 2.4;
    reasons.push("starts with a connector or sermon-outline phrase");
  }
  if (FILLER_PATTERN.test(opening)) {
    score -= 1.8;
    reasons.push("starts with filler");
  }
  if (!SUBJECT_PATTERN.test(opening)) {
    score -= 1.3;
    reasons.push("opening subject is unclear");
  }
  if (coherence.openingStatus === "MID_SENTENCE") {
    score -= 1;
    reasons.push("appears to begin mid-thought");
  }
  if (opening.split(/\s+/).filter(Boolean).length > 30) {
    score -= 0.8;
    reasons.push("first sentence is slow for short-form video");
  }

  const hookType = inferHookType(opening);
  if (hookType === "QUESTION" || hookType === "SCRIPTURE_TRUTH" || hookType === "EMOTIONAL_LINE" || hookType === "PROBLEM_STATEMENT") {
    score += 1;
  }

  const hookProblem = reasons.length > 0 ? `Weak opening: ${reasons.join(", ")}.` : null;

  return {
    hookScore: clampScore(score),
    hookType,
    hookProblem,
    suggestedStartAdjustment: hookProblem ? candidate.startTimeSeconds : null,
    hookReason: hookProblem ?? `Strong ${hookType.toLowerCase().replace(/_/g, " ")} opening in the first sentence.`,
  };
}

export function applyHookBoundaryAdjustment<T extends HookCandidate>(
  candidate: T,
  segments: TranscriptSegmentBoundary[],
): HookBoundaryResult<T> {
  const analysis = analyzeClipHook(candidate);
  if (analysis.hookScore >= 6 || segments.length === 0) {
    return { candidate: { ...candidate, ...analysis }, adjusted: false };
  }

  const originalStartIndex = findStartIndex(segments, candidate.startTimeSeconds);
  if (originalStartIndex === -1) {
    return { candidate: { ...candidate, ...analysis }, adjusted: false };
  }

  const originalEndIndex = findEndIndex(segments, candidate.endTimeSeconds, originalStartIndex);
  const candidates: Array<{ startIndex: number; analysis: ClipHookAnalysis }> = [];

  for (let index = Math.max(0, originalStartIndex - 3); index <= Math.min(segments.length - 1, originalStartIndex + 3); index += 1) {
    const duration = candidate.endTimeSeconds - segments[index].startTimeSeconds;
    if (duration < HARD_MIN_DURATION_SECONDS || duration > HARD_MAX_DURATION_SECONDS) {
      continue;
    }

    const transcriptText = composeTranscriptText(segments, index, originalEndIndex);
    candidates.push({
      startIndex: index,
      analysis: analyzeClipHook({ ...candidate, startTimeSeconds: segments[index].startTimeSeconds, transcriptText }),
    });
  }

  const best = candidates
    .filter((option) => option.analysis.hookScore >= 6)
    .sort((left, right) => right.analysis.hookScore - left.analysis.hookScore)[0];

  if (!best || best.startIndex === originalStartIndex) {
    return { candidate: { ...candidate, ...analysis }, adjusted: false };
  }

  const adjustedStart = segments[best.startIndex].startTimeSeconds;
  const adjustedTranscript = composeTranscriptText(segments, best.startIndex, originalEndIndex);
  const durationSeconds = Number((candidate.endTimeSeconds - adjustedStart).toFixed(2));
  const adjustmentNote = "Opening adjusted to start on a stronger complete thought.";
  const finalBoundary = validateFinalClipBoundary({
    startTimeSeconds: adjustedStart,
    endTimeSeconds: candidate.endTimeSeconds,
    transcriptText: adjustedTranscript,
    segments,
  });

  return {
    candidate: {
      ...candidate,
      ...best.analysis,
      startTimeSeconds: adjustedStart,
      durationSeconds,
      transcriptText: adjustedTranscript,
      adjustedStartTimeSeconds: adjustedStart,
      adjustedEndTimeSeconds: candidate.endTimeSeconds,
      boundaryAdjustmentReason: [candidate.boundaryAdjustmentReason, adjustmentNote].filter(Boolean).join(" "),
      boundaryQuality: finalBoundary.quality,
      suggestedStartAdjustment: adjustedStart,
    },
    adjusted: true,
  };
}

export const __clipHookAnalysisTestUtils = {
  firstSentence,
  inferHookType,
};
