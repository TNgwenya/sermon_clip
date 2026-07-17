import { z, ZodError } from "zod";

import {
  HARD_MAX_DURATION_SECONDS,
  startsMidSentence,
  startsWithContextDependentReference,
  startsWithUnclearConnector,
  validateBoundaryTimes,
  validateFinalClipBoundary,
  type BoundaryQuality,
  type TranscriptSegmentBoundary,
} from "@/server/agents/clipBoundaryRefinement";
import { analyzeClipCoherence } from "@/server/agents/clipCoherenceAnalysis";
import { createLoggedChatCompletion } from "@/server/ai/aiGateway";
import { resolveOpenAIChatModel, resolveOpenAIReasoningEffort } from "@/server/ai/modelConfig";

export const CLIP_COMPLETENESS_ACTIONS = [
  "KEEP_AS_IS",
  "START_EARLIER",
  "START_LATER",
  "END_EARLIER",
  "END_LATER",
  "EXTEND_BOTH",
  "SHORTEN_BOTH",
  "NEEDS_REVIEW",
  "REJECT_INCOMPLETE",
] as const;

export const CLIP_COMPLETENESS_WARNING_CODES = [
  "CONNECTOR_START",
  "UNRESOLVED_PRONOUN_START",
  "MISSING_SETUP",
  "MISSING_LANDING",
  "INCOMPLETE_ENDING",
  "CONTEXT_RISK",
  "DURATION_LIMIT",
  "LOW_STANDALONE_CLARITY",
  "AI_COMPLETENESS_FAILED",
  "FALLBACK_COMPLETENESS_REVIEW",
] as const;

export type ClipCompletenessAction = typeof CLIP_COMPLETENESS_ACTIONS[number];
export type ClipCompletenessWarningCode = typeof CLIP_COMPLETENESS_WARNING_CODES[number];
export type ClipCompletenessReviewSource = "AI" | "FALLBACK";

export type ClipCompletenessCandidateInput = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  transcriptText: string;
  title: string;
  hook: string;
  caption: string;
  score: number;
  reasonSelected: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  riskReasons: string[];
  contextWarning: boolean;
  boundaryQuality: BoundaryQuality;
  boundaryAdjustmentReason?: string | null;
  originalStartTimeSeconds?: number | null;
  originalEndTimeSeconds?: number | null;
  adjustedStartTimeSeconds?: number | null;
  adjustedEndTimeSeconds?: number | null;
  selectionReasoning?: {
    needsCaptionOrContextSupport: boolean;
  } | null;
};

export type ClipCompletenessFields = {
  completenessScore: number;
  completenessAction: ClipCompletenessAction;
  completenessReason: string;
  completenessWarnings: ClipCompletenessWarningCode[];
  completenessReviewedAt: Date;
  completenessReviewSource: ClipCompletenessReviewSource;
  previousAdjustedStartTimeSeconds: number | null;
  previousAdjustedEndTimeSeconds: number | null;
};

export type ClipCompletenessReviewedCandidate<T extends ClipCompletenessCandidateInput> = T & ClipCompletenessFields;

type SegmentWindow = {
  startIndex: number;
  endIndex: number;
};

type CompletenessBatchEntry<T extends ClipCompletenessCandidateInput = ClipCompletenessCandidateInput> = {
  candidate: T;
  originalIndex: number;
};

type PromptContextWindow = SegmentWindow & {
  contextStartIndex: number;
  contextEndIndex: number;
};

type AiCompletenessReview = {
  candidateIndex: number;
  standaloneCompletenessScore: number;
  action: ClipCompletenessAction;
  suggestedStartSegmentIndex?: number | null;
  suggestedEndSegmentIndex?: number | null;
  suggestedStartTimeSeconds?: number | null;
  suggestedEndTimeSeconds?: number | null;
  warnings: ClipCompletenessWarningCode[];
  reason: string;
};

const MAX_SETUP_EXTENSION_SECONDS = 12;
const MAX_CONCLUSION_EXTENSION_SECONDS = 18;
const UNRESOLVED_PRONOUN_PATTERN = /^(it|they|them|he|she|him|her|these|those)\b/i;
const QUESTION_OR_SETUP_PATTERN = /\?|\b(question|problem|struggle|issue|reason|scripture|verse|bible says|look at|notice|before|context)\b/i;
const CONCLUSION_PATTERN = /\b(so|therefore|that means|here is the point|the point is|remember|application|apply|walk in|trust|believe|pray|amen)\b/i;
const PROVENANCE_WARNING_CODES = new Set<ClipCompletenessWarningCode>([
  "AI_COMPLETENESS_FAILED",
  "FALLBACK_COMPLETENESS_REVIEW",
]);
const STRUCTURAL_WARNING_CODES = new Set<ClipCompletenessWarningCode>(
  CLIP_COMPLETENESS_WARNING_CODES.filter((warning) => !PROVENANCE_WARNING_CODES.has(warning)),
);
const DEFAULT_COMPLETENESS_BATCH_SIZE = 4;
const CONTEXT_BEFORE_SECONDS = 20;
const CONTEXT_AFTER_SECONDS = 35;

const aiReviewSchema = z.object({
  reviews: z.array(z.object({
    candidateIndex: z.number().int().min(0),
    standaloneCompletenessScore: z.number().min(0).max(10),
    action: z.enum(CLIP_COMPLETENESS_ACTIONS),
    suggestedStartSegmentIndex: z.number().int().min(0).nullable().optional(),
    suggestedEndSegmentIndex: z.number().int().min(0).nullable().optional(),
    suggestedStartTimeSeconds: z.number().min(0).nullable().optional(),
    suggestedEndTimeSeconds: z.number().min(0).nullable().optional(),
    warnings: z.array(z.enum(CLIP_COMPLETENESS_WARNING_CODES)).default([]),
    reason: z.string().trim().min(1),
  })),
});

function uniqueWarnings(warnings: ClipCompletenessWarningCode[]): ClipCompletenessWarningCode[] {
  return Array.from(new Set(warnings));
}

function contentWarnings(warnings: ClipCompletenessWarningCode[]): ClipCompletenessWarningCode[] {
  return warnings.filter((warning) => !PROVENANCE_WARNING_CODES.has(warning));
}

function structuralWarnings(warnings: ClipCompletenessWarningCode[]): ClipCompletenessWarningCode[] {
  return warnings.filter((warning) => STRUCTURAL_WARNING_CODES.has(warning));
}

function composeTranscriptText(segments: TranscriptSegmentBoundary[], startIndex: number, endIndex: number): string {
  return segments
    .slice(startIndex, endIndex + 1)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
}

function findStartIndexForTime(segments: TranscriptSegmentBoundary[], startTimeSeconds: number): number {
  return segments.findIndex((segment) => segment.endTimeSeconds > startTimeSeconds);
}

function findEndIndexForTime(segments: TranscriptSegmentBoundary[], endTimeSeconds: number, startIndex: number): number {
  let endIndex = startIndex;

  for (let index = startIndex; index < segments.length; index += 1) {
    if (segments[index].startTimeSeconds >= endTimeSeconds) {
      break;
    }

    endIndex = index;
  }

  return endIndex;
}

function findWindow(candidate: ClipCompletenessCandidateInput, segments: TranscriptSegmentBoundary[]): SegmentWindow | null {
  const startIndex = findStartIndexForTime(segments, candidate.startTimeSeconds);
  if (startIndex === -1) {
    return null;
  }

  const endIndex = findEndIndexForTime(segments, candidate.endTimeSeconds, startIndex);
  return { startIndex, endIndex: Math.max(startIndex, endIndex) };
}

function findPromptContextWindow(candidate: ClipCompletenessCandidateInput, segments: TranscriptSegmentBoundary[]): PromptContextWindow | null {
  const window = findWindow(candidate, segments);
  if (!window) {
    return null;
  }

  let contextStartIndex = window.startIndex;
  while (
    contextStartIndex > 0 &&
    segments[window.startIndex].startTimeSeconds - segments[contextStartIndex - 1].startTimeSeconds <= CONTEXT_BEFORE_SECONDS
  ) {
    contextStartIndex -= 1;
  }

  let contextEndIndex = window.endIndex;
  while (
    contextEndIndex < segments.length - 1 &&
    segments[contextEndIndex + 1].endTimeSeconds - segments[window.endIndex].endTimeSeconds <= CONTEXT_AFTER_SECONDS
  ) {
    contextEndIndex += 1;
  }

  return {
    ...window,
    contextStartIndex,
    contextEndIndex,
  };
}

function canUseWindow(segments: TranscriptSegmentBoundary[], startIndex: number, endIndex: number, maxDurationSeconds: number): boolean {
  const duration = segments[endIndex].endTimeSeconds - segments[startIndex].startTimeSeconds;
  return duration >= 0 && duration <= maxDurationSeconds && duration <= HARD_MAX_DURATION_SECONDS;
}

function chooseEarlierStart(input: {
  segments: TranscriptSegmentBoundary[];
  startIndex: number;
  endIndex: number;
  maxDurationSeconds: number;
}): number {
  const { segments, endIndex, maxDurationSeconds } = input;
  let startIndex = input.startIndex;

  while (startIndex > 0) {
    const previous = segments[startIndex - 1];
    const currentStart = segments[input.startIndex].startTimeSeconds;
    const setupDelta = currentStart - previous.startTimeSeconds;

    if (setupDelta > MAX_SETUP_EXTENSION_SECONDS || !canUseWindow(segments, startIndex - 1, endIndex, maxDurationSeconds)) {
      break;
    }

    startIndex -= 1;

    if (segments[startIndex].text.trim().endsWith(".") || segments[startIndex].text.trim().endsWith("?") || QUESTION_OR_SETUP_PATTERN.test(segments[startIndex].text)) {
      break;
    }
  }

  return startIndex;
}

function chooseLaterEnd(input: {
  segments: TranscriptSegmentBoundary[];
  startIndex: number;
  endIndex: number;
  maxDurationSeconds: number;
}): number {
  const { segments, startIndex, maxDurationSeconds } = input;
  let endIndex = input.endIndex;
  const originalEnd = segments[endIndex].endTimeSeconds;

  while (endIndex < segments.length - 1) {
    const nextEnd = segments[endIndex + 1].endTimeSeconds;
    if (nextEnd - originalEnd > MAX_CONCLUSION_EXTENSION_SECONDS || !canUseWindow(segments, startIndex, endIndex + 1, maxDurationSeconds)) {
      break;
    }

    endIndex += 1;

    if (/[.!?]["')\]]*$/u.test(segments[endIndex].text.trim()) && CONCLUSION_PATTERN.test(segments[endIndex].text)) {
      break;
    }
  }

  return endIndex;
}

function hasSpokenLanding(text: string): boolean {
  return analyzeClipCoherence(text).landingStatus !== "NONE";
}

function assessStructuralCompleteness(input: {
  candidate: ClipCompletenessCandidateInput;
  segments: TranscriptSegmentBoundary[];
  startIndex: number;
  endIndex: number;
  maxDurationSeconds: number;
}): ClipCompletenessWarningCode[] {
  const { candidate, segments, startIndex, endIndex, maxDurationSeconds } = input;
  const startText = segments[startIndex].text.trim();
  const endText = segments[endIndex].text.trim();
  const transcriptText = composeTranscriptText(segments, startIndex, endIndex);
  const durationSeconds = segments[endIndex].endTimeSeconds - segments[startIndex].startTimeSeconds;
  const warnings: ClipCompletenessWarningCode[] = [];

  if (startsWithUnclearConnector(startText)) {
    warnings.push("CONNECTOR_START", "MISSING_SETUP");
  }
  if (startsMidSentence(startText) || UNRESOLVED_PRONOUN_PATTERN.test(startText) || startsWithContextDependentReference(startText)) {
    warnings.push("UNRESOLVED_PRONOUN_START", "MISSING_SETUP");
  }
  if (candidate.contextWarning || candidate.riskLevel === "HIGH") {
    warnings.push("CONTEXT_RISK");
  }
  if (analyzeClipCoherence(endText).endingStatus !== "CLEAN") {
    warnings.push("INCOMPLETE_ENDING");
  }
  if (
    !hasSpokenLanding(transcriptText) &&
    endIndex < segments.length - 1 &&
    hasSpokenLanding(segments[endIndex + 1].text)
  ) {
    warnings.push("MISSING_LANDING");
  }
  if (durationSeconds > maxDurationSeconds) {
    warnings.push("DURATION_LIMIT");
  }
  if (candidate.selectionReasoning?.needsCaptionOrContextSupport) {
    warnings.push("LOW_STANDALONE_CLARITY", "CONTEXT_RISK");
  }

  return uniqueWarnings(warnings);
}

function scoreCompleteness(input: {
  warnings: ClipCompletenessWarningCode[];
  candidate: ClipCompletenessCandidateInput;
  adjusted: boolean;
  durationSeconds: number;
}): number {
  let score = input.candidate.boundaryQuality === "GOOD" ? 8.4 : input.candidate.boundaryQuality === "NEEDS_REVIEW" ? 6.2 : 3.5;

  for (const warning of contentWarnings(input.warnings)) {
    if (warning === "CONNECTOR_START" || warning === "INCOMPLETE_ENDING" || warning === "MISSING_LANDING") {
      score -= 1.2;
    } else if (warning === "UNRESOLVED_PRONOUN_START" || warning === "MISSING_SETUP" || warning === "CONTEXT_RISK") {
      score -= 1.5;
    } else if (warning === "DURATION_LIMIT") {
      score -= 2;
    } else if (warning === "LOW_STANDALONE_CLARITY") {
      score -= 1;
    }
  }

  if (input.adjusted) {
    score += 0.9;
  }

  if (input.durationSeconds < 30 || input.durationSeconds > HARD_MAX_DURATION_SECONDS) {
    score -= 0.8;
  }

  return Math.max(0, Math.min(10, Number(score.toFixed(2))));
}

function mergeBoundaryReason(existing: string | null | undefined, addition: string): string {
  return [existing, addition].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function formatValidationError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown completeness review error.";
}

function inferAction(input: {
  originalStartIndex: number;
  originalEndIndex: number;
  startIndex: number;
  endIndex: number;
  warnings: ClipCompletenessWarningCode[];
  canRepair: boolean;
  weakClip: boolean;
}): ClipCompletenessAction {
  if (!input.canRepair && input.weakClip) {
    return "REJECT_INCOMPLETE";
  }

  if (!input.canRepair && input.warnings.length > 0) {
    return "NEEDS_REVIEW";
  }

  const startEarlier = input.startIndex < input.originalStartIndex;
  const startLater = input.startIndex > input.originalStartIndex;
  const endEarlier = input.endIndex < input.originalEndIndex;
  const endLater = input.endIndex > input.originalEndIndex;

  if (startEarlier && endLater) {
    return "EXTEND_BOTH";
  }
  if (startLater && endEarlier) {
    return "SHORTEN_BOTH";
  }
  if (startEarlier) {
    return "START_EARLIER";
  }
  if (startLater) {
    return "START_LATER";
  }
  if (endEarlier) {
    return "END_EARLIER";
  }
  if (endLater) {
    return "END_LATER";
  }

  return input.warnings.length > 0 ? "NEEDS_REVIEW" : "KEEP_AS_IS";
}

function applyFallbackCompleteness<T extends ClipCompletenessCandidateInput>(input: {
  candidate: T;
  segments: TranscriptSegmentBoundary[];
  maxDurationSeconds: number;
  fallbackReason?: string;
}): ClipCompletenessReviewedCandidate<T> {
  const { candidate, segments, maxDurationSeconds } = input;
  const previousAdjustedStartTimeSeconds = candidate.adjustedStartTimeSeconds ?? candidate.startTimeSeconds;
  const previousAdjustedEndTimeSeconds = candidate.adjustedEndTimeSeconds ?? candidate.endTimeSeconds;
  const window = findWindow(candidate, segments);
  const fallbackWarnings: ClipCompletenessWarningCode[] = input.fallbackReason
    ? ["AI_COMPLETENESS_FAILED", "FALLBACK_COMPLETENESS_REVIEW"]
    : ["FALLBACK_COMPLETENESS_REVIEW"];

  if (!window) {
    const reason = "Completeness review could not match this clip to transcript segments.";
    return {
      ...candidate,
      boundaryQuality: "BAD",
      contextWarning: true,
      riskReasons: Array.from(new Set([...candidate.riskReasons, reason])),
      completenessScore: 2,
      completenessAction: "REJECT_INCOMPLETE",
      completenessReason: input.fallbackReason ? `${reason} AI fallback used: ${input.fallbackReason}` : reason,
      completenessWarnings: uniqueWarnings([...fallbackWarnings, "LOW_STANDALONE_CLARITY", "CONTEXT_RISK"]),
      completenessReviewedAt: new Date(),
      completenessReviewSource: "FALLBACK",
      previousAdjustedStartTimeSeconds,
      previousAdjustedEndTimeSeconds,
    };
  }

  const originalStartIndex = window.startIndex;
  const originalEndIndex = window.endIndex;
  const originalWarnings = assessStructuralCompleteness({
    candidate,
    segments,
    startIndex: originalStartIndex,
    endIndex: originalEndIndex,
    maxDurationSeconds,
  });

  let startIndex = originalStartIndex;
  let endIndex = originalEndIndex;

  if (originalWarnings.includes("CONNECTOR_START") || originalWarnings.includes("UNRESOLVED_PRONOUN_START") || originalWarnings.includes("MISSING_SETUP")) {
    startIndex = chooseEarlierStart({ segments, startIndex, endIndex, maxDurationSeconds });
  }

  if (originalWarnings.includes("INCOMPLETE_ENDING") || originalWarnings.includes("MISSING_LANDING")) {
    endIndex = chooseLaterEnd({ segments, startIndex, endIndex, maxDurationSeconds });
  }

  const adjusted = startIndex !== originalStartIndex || endIndex !== originalEndIndex;
  const adjustedStart = segments[startIndex].startTimeSeconds;
  const adjustedEnd = segments[endIndex].endTimeSeconds;
  const transcriptText = composeTranscriptText(segments, startIndex, endIndex);
  const durationSeconds = Number((adjustedEnd - adjustedStart).toFixed(2));
  const validation = validateBoundaryTimes({
    startTimeSeconds: adjustedStart,
    endTimeSeconds: adjustedEnd,
    sermonDurationSeconds: segments[segments.length - 1]?.endTimeSeconds ?? adjustedEnd,
    transcriptText,
  });

  const finalBoundary = validateFinalClipBoundary({
    startTimeSeconds: adjustedStart,
    endTimeSeconds: adjustedEnd,
    transcriptText,
    segments,
    sermonStartSeconds: segments[0]?.startTimeSeconds,
    sermonEndSeconds: segments[segments.length - 1]?.endTimeSeconds,
  });
  const finalStructuralWarnings = validation.isValid
    ? assessStructuralCompleteness({
        candidate: {
          ...candidate,
          startTimeSeconds: adjustedStart,
          endTimeSeconds: adjustedEnd,
          durationSeconds,
          transcriptText,
          contextWarning: candidate.contextWarning && originalWarnings.includes("CONTEXT_RISK"),
        },
        segments,
        startIndex,
        endIndex,
        maxDurationSeconds,
      })
    : originalWarnings;
  const canRepair = adjusted || finalStructuralWarnings.length === 0;
  const weakClip = candidate.score < 6 || candidate.riskLevel === "HIGH" || originalWarnings.length >= 4;
  const action = inferAction({
    originalStartIndex,
    originalEndIndex,
    startIndex,
    endIndex,
    warnings: finalStructuralWarnings,
    canRepair,
    weakClip,
  });
  const validAdjustment = validation.isValid && finalBoundary.quality !== "BAD" && durationSeconds <= maxDurationSeconds;
  const finalAction = validAdjustment ? action : weakClip ? "REJECT_INCOMPLETE" : "NEEDS_REVIEW";
  const appliedAdjustment = adjusted && validAdjustment && finalAction !== "REJECT_INCOMPLETE";
  const finalWarnings = uniqueWarnings([
    ...(appliedAdjustment || !adjusted ? finalStructuralWarnings : originalWarnings),
    ...fallbackWarnings,
    ...(!validAdjustment || (!canRepair && finalStructuralWarnings.length > 0) ? ["DURATION_LIMIT" as const] : []),
  ]);
  const completenessScore = scoreCompleteness({
    warnings: finalWarnings,
    candidate,
    adjusted: appliedAdjustment,
    durationSeconds: appliedAdjustment ? durationSeconds : candidate.durationSeconds,
  });
  const pastorReason = buildCompletenessReason({
    action: finalAction,
    warnings: finalWarnings,
    adjusted: appliedAdjustment,
    fallbackReason: input.fallbackReason,
  });
  const boundaryQuality: BoundaryQuality =
    finalAction === "REJECT_INCOMPLETE" ? "BAD" : finalAction === "NEEDS_REVIEW" || structuralWarnings(finalWarnings).length > 0 ? "NEEDS_REVIEW" : candidate.boundaryQuality;

  return {
    ...candidate,
    startTimeSeconds: appliedAdjustment ? adjustedStart : candidate.startTimeSeconds,
    endTimeSeconds: appliedAdjustment ? adjustedEnd : candidate.endTimeSeconds,
    durationSeconds: appliedAdjustment ? durationSeconds : candidate.durationSeconds,
    transcriptText: appliedAdjustment ? transcriptText : candidate.transcriptText,
    adjustedStartTimeSeconds: appliedAdjustment ? adjustedStart : candidate.adjustedStartTimeSeconds,
    adjustedEndTimeSeconds: appliedAdjustment ? adjustedEnd : candidate.adjustedEndTimeSeconds,
    boundaryQuality,
    boundaryAdjustmentReason: mergeBoundaryReason(candidate.boundaryAdjustmentReason, pastorReason),
    reasonSelected: mergeBoundaryReason(candidate.reasonSelected, pastorReason),
    contextWarning: finalWarnings.includes("CONTEXT_RISK") || finalAction === "REJECT_INCOMPLETE",
    riskReasons: Array.from(new Set([...candidate.riskReasons, ...contentWarnings(finalWarnings).map(toRiskReason)])),
    completenessScore,
    completenessAction: finalAction,
    completenessReason: pastorReason,
    completenessWarnings: finalWarnings,
    completenessReviewedAt: new Date(),
    completenessReviewSource: input.fallbackReason ? "FALLBACK" : "FALLBACK",
    previousAdjustedStartTimeSeconds,
    previousAdjustedEndTimeSeconds,
  };
}

function toRiskReason(warning: ClipCompletenessWarningCode): string {
  switch (warning) {
    case "CONNECTOR_START":
      return "Clip starts with a connector and may need setup.";
    case "UNRESOLVED_PRONOUN_START":
      return "Clip may start with an unclear reference.";
    case "MISSING_SETUP":
      return "Clip may be missing setup needed for standalone viewing.";
    case "MISSING_LANDING":
      return "Clip may stop before the sermon application lands.";
    case "INCOMPLETE_ENDING":
      return "Clip may end before the thought lands.";
    case "CONTEXT_RISK":
      return "Clip may need surrounding sermon context.";
    case "DURATION_LIMIT":
      return "Clip completeness could not be improved within the short-form duration limit.";
    case "LOW_STANDALONE_CLARITY":
      return "Clip may not make sense without additional context.";
    case "AI_COMPLETENESS_FAILED":
      return "AI completeness review failed; deterministic fallback was used.";
    case "FALLBACK_COMPLETENESS_REVIEW":
      return "Fallback completeness review was used.";
  }
}

function buildCompletenessReason(input: {
  action: ClipCompletenessAction;
  warnings: ClipCompletenessWarningCode[];
  adjusted: boolean;
  fallbackReason?: string;
}): string {
  if (input.action === "KEEP_AS_IS") {
    return "Completeness pass kept the clip as-is because it starts naturally, carries enough setup, and ends cleanly.";
  }

  if (input.action === "REJECT_INCOMPLETE") {
    return "Completeness pass found this clip does not stand alone well enough to treat as post-ready.";
  }

  if (input.action === "NEEDS_REVIEW") {
    return "Completeness pass found this clip may need pastor review because the nearby context could not safely fix the thought flow within short-form length.";
  }

  const adjustmentText = input.adjusted
    ? "Completeness pass adjusted the boundary so the clip has more complete setup or conclusion."
    : "Completeness pass recommends a boundary adjustment before posting.";

  return input.fallbackReason ? `${adjustmentText} AI fallback used: ${input.fallbackReason}` : adjustmentText;
}

function nearestStartSegmentIndex(segments: TranscriptSegmentBoundary[], timeSeconds: number): number {
  let selectedIndex = 0;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (const [index, segment] of segments.entries()) {
    const distance = Math.abs(segment.startTimeSeconds - timeSeconds);
    if (distance < selectedDistance) {
      selectedIndex = index;
      selectedDistance = distance;
    }
  }
  return selectedIndex;
}

function nearestEndSegmentIndex(segments: TranscriptSegmentBoundary[], timeSeconds: number): number {
  let selectedIndex = 0;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (const [index, segment] of segments.entries()) {
    const distance = Math.abs(segment.endTimeSeconds - timeSeconds);
    if (distance < selectedDistance) {
      selectedIndex = index;
      selectedDistance = distance;
    }
  }
  return selectedIndex;
}

function resolveSuggestedWindow(input: {
  fallbackCandidate: ClipCompletenessReviewedCandidate<ClipCompletenessCandidateInput>;
  aiReview: AiCompletenessReview;
  segments: TranscriptSegmentBoundary[];
  maxDurationSeconds: number;
}): SegmentWindow | null {
  const { fallbackCandidate, aiReview, segments, maxDurationSeconds } = input;
  const currentWindow = findWindow(fallbackCandidate, segments);
  if (!currentWindow) {
    return null;
  }

  const hasStartSuggestion = typeof aiReview.suggestedStartSegmentIndex === "number" || typeof aiReview.suggestedStartTimeSeconds === "number";
  const hasEndSuggestion = typeof aiReview.suggestedEndSegmentIndex === "number" || typeof aiReview.suggestedEndTimeSeconds === "number";
  if (!hasStartSuggestion && !hasEndSuggestion) {
    return null;
  }

  if (
    (typeof aiReview.suggestedStartTimeSeconds === "number" &&
      (aiReview.suggestedStartTimeSeconds < segments[0].startTimeSeconds || aiReview.suggestedStartTimeSeconds > segments[segments.length - 1].endTimeSeconds)) ||
    (typeof aiReview.suggestedEndTimeSeconds === "number" &&
      (aiReview.suggestedEndTimeSeconds < segments[0].startTimeSeconds || aiReview.suggestedEndTimeSeconds > segments[segments.length - 1].endTimeSeconds))
  ) {
    return null;
  }

  const startIndex = typeof aiReview.suggestedStartSegmentIndex === "number"
    ? aiReview.suggestedStartSegmentIndex
    : typeof aiReview.suggestedStartTimeSeconds === "number"
      ? nearestStartSegmentIndex(segments, aiReview.suggestedStartTimeSeconds)
      : currentWindow.startIndex;
  const endIndex = typeof aiReview.suggestedEndSegmentIndex === "number"
    ? aiReview.suggestedEndSegmentIndex
    : typeof aiReview.suggestedEndTimeSeconds === "number"
      ? nearestEndSegmentIndex(segments, aiReview.suggestedEndTimeSeconds)
      : currentWindow.endIndex;

  if (
    startIndex < 0 ||
    endIndex < 0 ||
    startIndex >= segments.length ||
    endIndex >= segments.length ||
    endIndex < startIndex
  ) {
    return null;
  }

  const startTimeSeconds = segments[startIndex].startTimeSeconds;
  const endTimeSeconds = segments[endIndex].endTimeSeconds;
  const durationSeconds = endTimeSeconds - startTimeSeconds;
  if (durationSeconds <= 0 || durationSeconds > maxDurationSeconds || durationSeconds > HARD_MAX_DURATION_SECONDS) {
    return null;
  }

  const transcriptText = composeTranscriptText(segments, startIndex, endIndex);
  const boundaryValidation = validateFinalClipBoundary({
    startTimeSeconds,
    endTimeSeconds,
    transcriptText,
    segments,
    sermonStartSeconds: segments[0]?.startTimeSeconds,
    sermonEndSeconds: segments[segments.length - 1]?.endTimeSeconds,
  });
  if (boundaryValidation.quality === "BAD" || !transcriptText.trim()) {
    return null;
  }

  return { startIndex, endIndex };
}

function applyCompletenessWindow<T extends ClipCompletenessCandidateInput>(input: {
  candidate: ClipCompletenessReviewedCandidate<T>;
  segments: TranscriptSegmentBoundary[];
  window: SegmentWindow;
  reason: string;
}): ClipCompletenessReviewedCandidate<T> {
  const { candidate, segments, window, reason } = input;
  const startTimeSeconds = segments[window.startIndex].startTimeSeconds;
  const endTimeSeconds = segments[window.endIndex].endTimeSeconds;
  const durationSeconds = Number((endTimeSeconds - startTimeSeconds).toFixed(2));
  const transcriptText = composeTranscriptText(segments, window.startIndex, window.endIndex);

  return {
    ...candidate,
    startTimeSeconds,
    endTimeSeconds,
    durationSeconds,
    transcriptText,
    adjustedStartTimeSeconds: startTimeSeconds,
    adjustedEndTimeSeconds: endTimeSeconds,
    boundaryAdjustmentReason: mergeBoundaryReason(candidate.boundaryAdjustmentReason, reason),
    reasonSelected: mergeBoundaryReason(candidate.reasonSelected, reason),
  };
}

function buildSystemPrompt(): string {
  return [
    "You are a senior short-form sermon editor checking whether clips stand alone before a pastor posts them.",
    "Judge completeness, not virality. Prefer clear setup, natural opening, complete thought, clean ending, context safety, and short-form duration.",
    "Be conservative when a clip starts mid-thought, starts with a connector, uses unresolved pronouns, lacks scripture/setup, or ends before the spiritual point lands.",
    "Return structured JSON only. Do not include markdown or commentary.",
  ].join("\n");
}

function buildUserPrompt(entries: Array<CompletenessBatchEntry>, segments: TranscriptSegmentBoundary[]): string {
  const candidateLines = entries.map(({ candidate, originalIndex }) => {
    const contextWindow = findPromptContextWindow(candidate, segments);
    const segmentLines = contextWindow
      ? segments
          .slice(contextWindow.contextStartIndex, contextWindow.contextEndIndex + 1)
          .map((segment, localOffset) => {
            const globalIndex = contextWindow.contextStartIndex + localOffset;
            const marker = globalIndex >= contextWindow.startIndex && globalIndex <= contextWindow.endIndex ? "IN_CLIP" : "CONTEXT";
            return `[${globalIndex}] ${marker} ${segment.startTimeSeconds.toFixed(1)}-${segment.endTimeSeconds.toFixed(1)} ${segment.text.trim()}`;
          })
          .join("\n")
      : "No transcript context window matched this candidate.";

    return [
    `Candidate ${originalIndex}`,
    `Title: ${candidate.title}`,
    `Hook: ${candidate.hook}`,
    `Candidate transcript range: ${candidate.transcriptText}`,
    `Start: ${candidate.startTimeSeconds}`,
    `End: ${candidate.endTimeSeconds}`,
    `Duration: ${candidate.durationSeconds}`,
    `Boundary quality: ${candidate.boundaryQuality}`,
    `Boundary reason: ${candidate.boundaryAdjustmentReason ?? ""}`,
    `Context warning: ${candidate.contextWarning}`,
    `Risk reasons: ${candidate.riskReasons.join(" | ")}`,
    "Nearby transcript segments:",
    segmentLines,
    ].join("\n");
  }).join("\n\n");

  return [
    "Review each clip using nearby transcript segments before, inside, and after the clip.",
    `Each candidate includes only its transcript range, about ${CONTEXT_BEFORE_SECONDS}s before, and about ${CONTEXT_AFTER_SECONDS}s after.`,
    "Use the stable candidateIndex and transcript segment indexes exactly as shown if recommending boundary changes.",
    "Allowed action values: KEEP_AS_IS, START_EARLIER, START_LATER, END_EARLIER, END_LATER, EXTEND_BOTH, SHORTEN_BOTH, NEEDS_REVIEW, REJECT_INCOMPLETE.",
    "Warnings may include CONNECTOR_START, UNRESOLVED_PRONOUN_START, MISSING_SETUP, MISSING_LANDING, INCOMPLETE_ENDING, CONTEXT_RISK, DURATION_LIMIT, LOW_STANDALONE_CLARITY.",
    "If a small 5-12 second setup extension makes a strong clip standalone and keeps it under 90 seconds, recommend it.",
    "If the clip cannot stand alone within short-form length, use NEEDS_REVIEW or REJECT_INCOMPLETE.",
    "Return this JSON shape exactly:",
    '{"reviews":[{"candidateIndex":0,"standaloneCompletenessScore":8,"action":"KEEP_AS_IS","suggestedStartSegmentIndex":null,"suggestedEndSegmentIndex":null,"suggestedStartTimeSeconds":null,"suggestedEndTimeSeconds":null,"warnings":[],"reason":"This clip is complete on its own."}]}',
    "Candidates:",
    candidateLines,
  ].join("\n\n");
}

function parseAiResponse(rawResponse: string): AiCompletenessReview[] {
  const parsed = JSON.parse(rawResponse) as unknown;
  return aiReviewSchema.parse(parsed).reviews;
}

async function callCompletenessModel(
  entries: Array<CompletenessBatchEntry>,
  segments: TranscriptSegmentBoundary[],
  rawResponseOverride?: string,
): Promise<AiCompletenessReview[]> {
  if (rawResponseOverride !== undefined) {
    return parseAiResponse(rawResponseOverride);
  }

  const model = resolveOpenAIChatModel("clipCompleteness");
  const reasoningEffort = resolveOpenAIReasoningEffort("clipCompleteness", model);
  return createLoggedChatCompletion({
    operation: "clip_completeness_review",
    model,
    reasoningEffort,
    response_format: { type: "json_object" },
    temperature: 0.1,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(entries, segments) },
    ],
    promptVersion: "clip-completeness-v1",
    metadata: {
      candidateCount: entries.length,
      transcriptSegmentCount: segments.length,
      transcriptCharacters: entries.reduce((total, entry) => total + entry.candidate.transcriptText.length, 0),
    },
    missingKeyMessage: "OPENAI_API_KEY is missing. Add it to your environment before reviewing clip completeness.",
    validateResponse: (completion) => parseAiResponse(
      completion.choices[0]?.message?.content ?? "",
    ),
  });
}

export function mergeCompletenessEvidence<T extends ClipCompletenessCandidateInput>(input: {
  fallbackCandidate: ClipCompletenessReviewedCandidate<T>;
  aiReview: AiCompletenessReview | undefined;
  segments: TranscriptSegmentBoundary[];
  maxDurationSeconds: number;
}): ClipCompletenessReviewedCandidate<T> {
  const { fallbackCandidate, aiReview, segments, maxDurationSeconds } = input;
  if (!aiReview) {
    return fallbackCandidate;
  }

  const currentWindow = findWindow(fallbackCandidate, segments);
  if (!currentWindow) {
    return {
      ...fallbackCandidate,
      completenessReviewSource: "AI",
      completenessReason: aiReview.reason,
    };
  }

  const suggestedWindow = resolveSuggestedWindow({
    fallbackCandidate,
    aiReview,
    segments,
    maxDurationSeconds,
  });
  const boundaryAdjustedCandidate = suggestedWindow
    ? applyCompletenessWindow({
        candidate: fallbackCandidate,
        segments,
        window: suggestedWindow,
        reason: `AI completeness suggested a transcript-boundary adjustment. ${aiReview.reason}`,
      })
    : fallbackCandidate;
  const finalWindow = suggestedWindow ?? currentWindow;
  const finalStructuralWarnings = assessStructuralCompleteness({
    candidate: boundaryAdjustedCandidate,
    segments,
    startIndex: finalWindow.startIndex,
    endIndex: finalWindow.endIndex,
    maxDurationSeconds,
  });
  const fallbackStructuralWarnings = structuralWarnings(fallbackCandidate.completenessWarnings);
  const aiStructuralWarnings = structuralWarnings(aiReview.warnings);
  const aiFoundIssue = aiStructuralWarnings.length > 0 || aiReview.action === "NEEDS_REVIEW" || aiReview.action === "REJECT_INCOMPLETE";
  const aiRequestedBoundaryChange = (
    aiReview.action === "START_EARLIER" ||
    aiReview.action === "START_LATER" ||
    aiReview.action === "END_EARLIER" ||
    aiReview.action === "END_LATER" ||
    aiReview.action === "EXTEND_BOTH" ||
    aiReview.action === "SHORTEN_BOTH"
  );
  const invalidBoundarySuggestion = aiRequestedBoundaryChange && !suggestedWindow;
  const finalWarnings = uniqueWarnings([
    ...finalStructuralWarnings,
    ...(aiFoundIssue ? aiStructuralWarnings : []),
  ]);
  const finalHasStructuralWarnings = finalWarnings.length > 0;
  const aiConfirmedClean = aiReview.action === "KEEP_AS_IS" && !aiFoundIssue && !finalHasStructuralWarnings;
  const appliedSuggestion = Boolean(suggestedWindow);
  const aiAction: ClipCompletenessAction = aiReview.action === "KEEP_AS_IS"
    ? finalHasStructuralWarnings
      ? fallbackCandidate.completenessAction === "KEEP_AS_IS" ? "NEEDS_REVIEW" : fallbackCandidate.completenessAction
      : "KEEP_AS_IS"
    : invalidBoundarySuggestion && !finalHasStructuralWarnings
      ? "KEEP_AS_IS"
    : aiReview.action;
  const finalAction: ClipCompletenessAction = finalHasStructuralWarnings && aiAction === "KEEP_AS_IS"
    ? "NEEDS_REVIEW"
    : aiAction;
  const deterministicScore = scoreCompleteness({
    warnings: finalWarnings,
    candidate: boundaryAdjustedCandidate,
    adjusted: appliedSuggestion,
    durationSeconds: boundaryAdjustedCandidate.durationSeconds,
  });
  const aiScore = Number(aiReview.standaloneCompletenessScore.toFixed(2));
  const completenessScore = fallbackStructuralWarnings.length > 0 && finalHasStructuralWarnings
    ? Math.min(deterministicScore, aiScore)
    : aiConfirmedClean
      ? Math.max(deterministicScore, Math.min(9.2, Number(((deterministicScore * 0.55) + (aiScore * 0.45)).toFixed(2))))
      : aiFoundIssue
        ? Math.min(deterministicScore, aiScore)
        : Number(((deterministicScore * 0.65) + (aiScore * 0.35)).toFixed(2));

  return {
    ...boundaryAdjustedCandidate,
    completenessScore,
    completenessAction: finalAction,
    completenessReason: aiReview.reason,
    completenessWarnings: finalWarnings,
    completenessReviewSource: "AI",
    boundaryQuality: finalAction === "REJECT_INCOMPLETE" ? "BAD" : finalAction === "NEEDS_REVIEW" || finalHasStructuralWarnings ? "NEEDS_REVIEW" : boundaryAdjustedCandidate.boundaryQuality,
    contextWarning: finalWarnings.includes("CONTEXT_RISK") || finalAction === "REJECT_INCOMPLETE",
    riskReasons: Array.from(new Set([...boundaryAdjustedCandidate.riskReasons, ...finalWarnings.map(toRiskReason)])),
  };
}

export async function reviewClipCompletenessCandidates<T extends ClipCompletenessCandidateInput>(
  candidates: T[],
  segments: TranscriptSegmentBoundary[],
  options?: {
    rawResponseOverride?: string | string[];
    maxDurationSeconds?: number;
    disableAi?: boolean;
    batchSize?: number;
  },
): Promise<Array<ClipCompletenessReviewedCandidate<T>>> {
  const maxDurationSeconds = options?.maxDurationSeconds ?? HARD_MAX_DURATION_SECONDS;
  const batchSize = Math.max(1, options?.batchSize ?? DEFAULT_COMPLETENESS_BATCH_SIZE);
  const fallbackCandidates = candidates.map((candidate) => applyFallbackCompleteness({
    candidate,
    segments,
    maxDurationSeconds,
  }));

  if (candidates.length === 0 || options?.disableAi) {
    return fallbackCandidates;
  }

  const shouldEscalateToAi = (candidate: T, fallback: ClipCompletenessReviewedCandidate<T>): boolean => (
    options?.rawResponseOverride !== undefined ||
    candidate.boundaryQuality !== "GOOD" ||
    candidate.riskLevel !== "LOW" ||
    candidate.contextWarning ||
    candidate.score < 8 ||
    fallback.completenessAction !== "KEEP_AS_IS" ||
    structuralWarnings(fallback.completenessWarnings).length > 0
  );
  const entries = candidates
    .map((candidate, originalIndex) => ({ candidate, originalIndex }))
    .filter(({ candidate, originalIndex }) => shouldEscalateToAi(candidate, fallbackCandidates[originalIndex]));

  if (entries.length === 0) {
    return fallbackCandidates;
  }

  try {
    const aiReviews: AiCompletenessReview[] = [];
    for (let index = 0; index < entries.length; index += batchSize) {
      const batch = entries.slice(index, index + batchSize);
      const override = Array.isArray(options?.rawResponseOverride)
        ? options.rawResponseOverride[Math.floor(index / batchSize)]
        : options?.rawResponseOverride;
      aiReviews.push(...await callCompletenessModel(batch, segments, override));
    }
    const reviewsByIndex = new Map(aiReviews.map((review) => [review.candidateIndex, review]));
    return fallbackCandidates.map((candidate, index) => mergeCompletenessEvidence({
      fallbackCandidate: candidate,
      aiReview: reviewsByIndex.get(index),
      segments,
      maxDurationSeconds,
    }));
  } catch (error) {
    const fallbackReason = formatValidationError(error);
    const escalatedIndexes = new Set(entries.map((entry) => entry.originalIndex));
    return candidates.map((candidate, index) => escalatedIndexes.has(index)
      ? applyFallbackCompleteness({ candidate, segments, maxDurationSeconds, fallbackReason })
      : fallbackCandidates[index]);
  }
}

export const __clipCompletenessTestUtils = {
  applyFallbackCompleteness,
  buildCompletenessReason,
  buildUserPrompt,
  findWindow,
  findPromptContextWindow,
  mergeCompletenessEvidence,
};
