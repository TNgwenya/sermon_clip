export const HARD_REJECTION_QUALITY_WARNINGS = new Set([
  "PASTOR_GRADE_NON_SERMON_LOGISTICS",
  "PASTOR_GRADE_WARMUP_FILLER",
  "PASTOR_GRADE_NO_SPIRITUAL_ANCHOR",
  "PASTOR_GRADE_TRANSCRIPT_NO_SPIRITUAL_ANCHOR",
  "PASTOR_GRADE_NO_CLEAR_TAKEAWAY",
  "PASTOR_GRADE_TRANSCRIPT_NO_CLEAR_TAKEAWAY",
  "PASTOR_GRADE_UNSUPPORTED_METADATA_CLAIM",
  "PASTOR_GRADE_HIGH_CONTEXT_RISK",
  "PASTOR_GRADE_TOO_SHORT",
  "PASTOR_GRADE_LOW_SPOKEN_SUBSTANCE",
  "PASTOR_GRADE_LOW_SPOKEN_DENSITY",
]);

export const REPAIRABLE_QUALITY_WARNINGS = new Set([
  "PASTOR_GRADE_BAD_BOUNDARY",
  "PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION",
  "PASTOR_GRADE_SETUP_WITHOUT_LANDING",
  "PASTOR_GRADE_CONTEXT_DEPENDENT",
  "PASTOR_GRADE_DEPENDENT_OPENING",
  "PASTOR_GRADE_DANGLING_ENDING",
  "PASTOR_GRADE_WEAK_OPENING",
  "PASTOR_GRADE_LOW_STANDALONE_CLARITY",
  "PASTOR_GRADE_INCOMPLETE_THOUGHT",
]);

export const REPAIRABLE_NEXT_ACTIONS = [
  "REVIEW_START_TRIM",
  "REVIEW_ENDING",
  "EXTEND_CONTEXT",
  "REVIEW_CAPTION",
] as const;

export type RepairableNextAction = typeof REPAIRABLE_NEXT_ACTIONS[number];

export type ReviewableClipPolicyCandidate = {
  qualityLabel?: "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT" | null;
  postReadyStatus?: "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT" | null;
  recommendedAction?: string | null;
  recommendedNextAction?: string | null;
  startTimeSeconds?: number | null;
  endTimeSeconds?: number | null;
  durationSeconds?: number | null;
  transcriptText?: string | null;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | null;
  boundaryQuality?: "GOOD" | "NEEDS_REVIEW" | "BAD" | null;
  qualityWarnings?: string[] | null;
  qualityDebugSnapshot?: unknown;
  transcriptGroundingScore?: number | null;
  transcriptGroundingOrderedFlowRatio?: number | null;
};

export type ReviewableClipPolicyOptions = {
  minTranscriptWords?: number;
  minGroundingScore?: number;
  minOrderedFlowRatio?: number;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  allowBadBoundaryWhenRepairable?: boolean;
  requireActionableEditingSignal?: boolean;
};

export type ReviewableClipPolicyResult = {
  reviewable: boolean;
  reason: string | null;
};

const DEFAULT_MIN_REVIEWABLE_TRANSCRIPT_WORDS = 18;
const DEFAULT_MIN_REVIEWABLE_TRANSCRIPT_GROUNDING_SCORE = 0.72;
const DEFAULT_MIN_REVIEWABLE_TRANSCRIPT_ORDERED_FLOW_RATIO = 0.82;
const DEFAULT_MIN_REVIEWABLE_DURATION_SECONDS = 20;
const DEFAULT_MAX_REVIEWABLE_DURATION_SECONDS = 150;

const ACTIONABLE_EDIT_WARNING_CODES = new Set([
  ...REPAIRABLE_QUALITY_WARNINGS,
  "REVIEW_ENDING",
  "NEEDS_CONTEXT_EXTENSION",
  "TRANSCRIPT_LIMITED_ENDING",
  "NEEDS_START_TRIM",
  "NEEDS_END_TRIM",
  "REVIEW_OPENING",
  "REVIEW_CAPTION",
  "PASTOR_REVIEW_NEEDS_STRONGER_LANDING",
  "DURATION_NEEDS_EDIT",
  "CAPTIONS_TOO_FAST",
  "CAPTIONS_TOO_LONG",
  "CAPTIONS_OUT_OF_SAFE_ZONE",
  "MISSING_CAPTION_SEGMENTS",
  "CAPTION_TIMING_MISMATCH",
  "LOW_AUDIO_VOLUME",
  "AUDIO_CLIPPING_RISK",
  "LONG_SILENCE_AT_START",
  "LONG_SILENCE_AT_END",
  "LONG_INTERNAL_SILENCE",
  "FILLER_WORD_DENSITY",
  "SPEECH_POLISH_NEEDED",
  "TRANSCRIPT_REVIEW_REQUIRED",
]);

const ACTIONABLE_EDIT_ACTIONS = new Set([
  "REVIEW_START_TRIM",
  "REVIEW_ENDING",
  "EXTEND_CONTEXT",
  "REVIEW_CAPTION",
  "TRIM_CLIP",
  "REVIEW_OPENING",
  "FIX_CAPTIONS",
  "RERENDER",
  "FIX_CROP",
]);

export function isHardQualityWarning(warning: string): boolean {
  return HARD_REJECTION_QUALITY_WARNINGS.has(warning);
}

export function isRepairableQualityWarning(warning: string): boolean {
  return REPAIRABLE_QUALITY_WARNINGS.has(warning);
}

export function hasHardQualityWarning(warnings: string[] | undefined): boolean {
  return (warnings ?? []).some(isHardQualityWarning);
}

function countTranscriptWords(text: string): number {
  return (text.normalize("NFKC").match(/[\p{L}\p{M}\p{N}]+(?:[’'][\p{L}\p{M}\p{N}]+)*/gu) ?? []).length;
}

function readNumberProperty(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object" || !(key in value)) {
    return null;
  }

  const rawValue = (value as Record<string, unknown>)[key];
  return typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
}

export function transcriptGroundingSnapshot(candidate: ReviewableClipPolicyCandidate): {
  score: number | null;
  orderedFlowRatio: number | null;
} | null {
  if (typeof candidate.transcriptGroundingScore === "number") {
    return {
      score: candidate.transcriptGroundingScore,
      orderedFlowRatio: typeof candidate.transcriptGroundingOrderedFlowRatio === "number"
        ? candidate.transcriptGroundingOrderedFlowRatio
        : null,
    };
  }

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

export function hasActionableEditingSignal(candidate: ReviewableClipPolicyCandidate): boolean {
  const warnings = candidate.qualityWarnings ?? [];
  return (
    warnings.some((warning) => ACTIONABLE_EDIT_WARNING_CODES.has(warning) || isRepairableQualityWarning(warning)) ||
    ACTIONABLE_EDIT_ACTIONS.has(candidate.recommendedAction ?? "") ||
    ACTIONABLE_EDIT_ACTIONS.has(candidate.recommendedNextAction ?? "")
  );
}

export function evaluateReviewableClipPolicy(
  candidate: ReviewableClipPolicyCandidate,
  options: ReviewableClipPolicyOptions = {},
): ReviewableClipPolicyResult {
  const transcriptText = candidate.transcriptText?.trim() ?? "";
  const minTranscriptWords = options.minTranscriptWords ?? DEFAULT_MIN_REVIEWABLE_TRANSCRIPT_WORDS;
  const minGroundingScore = options.minGroundingScore ?? DEFAULT_MIN_REVIEWABLE_TRANSCRIPT_GROUNDING_SCORE;
  const minOrderedFlowRatio = options.minOrderedFlowRatio ?? DEFAULT_MIN_REVIEWABLE_TRANSCRIPT_ORDERED_FLOW_RATIO;
  const minDurationSeconds = options.minDurationSeconds ?? DEFAULT_MIN_REVIEWABLE_DURATION_SECONDS;
  const maxDurationSeconds = options.maxDurationSeconds ?? DEFAULT_MAX_REVIEWABLE_DURATION_SECONDS;
  const qualityWarnings = candidate.qualityWarnings ?? [];

  if (!transcriptText) {
    return { reviewable: false, reason: "Rejected because the saved transcript excerpt is missing." };
  }
  if (countTranscriptWords(transcriptText) < minTranscriptWords) {
    return { reviewable: false, reason: "Rejected because the saved transcript excerpt is too thin for pastor review." };
  }

  const grounding = transcriptGroundingSnapshot(candidate);
  if (!grounding || grounding.score === null) {
    return { reviewable: false, reason: "Rejected because the saved transcript excerpt lacks grounding proof." };
  }
  if (grounding.score < minGroundingScore) {
    return { reviewable: false, reason: "Rejected because the saved transcript excerpt is not grounded strongly enough in the sermon transcript." };
  }
  if (grounding.orderedFlowRatio !== null && grounding.orderedFlowRatio < minOrderedFlowRatio) {
    return { reviewable: false, reason: "Rejected because the saved transcript excerpt does not preserve the sermon wording order closely enough." };
  }

  const durationSeconds = typeof candidate.durationSeconds === "number"
    ? candidate.durationSeconds
    : typeof candidate.startTimeSeconds === "number" && typeof candidate.endTimeSeconds === "number"
      ? candidate.endTimeSeconds - candidate.startTimeSeconds
      : null;
  if (durationSeconds !== null && (durationSeconds < minDurationSeconds || durationSeconds > maxDurationSeconds)) {
    return { reviewable: false, reason: "Rejected because the clip timing is outside reviewable duration bounds." };
  }
  if (
    typeof candidate.startTimeSeconds === "number" &&
    typeof candidate.endTimeSeconds === "number" &&
    candidate.endTimeSeconds <= candidate.startTimeSeconds
  ) {
    return { reviewable: false, reason: "Rejected because the clip timing is invalid." };
  }

  if (candidate.qualityLabel === "REJECT" || candidate.postReadyStatus === "REJECT" || candidate.recommendedAction === "REJECT" || candidate.recommendedNextAction === "REJECT") {
    return { reviewable: false, reason: "Rejected by quality review." };
  }
  if (candidate.riskLevel === "HIGH") {
    return { reviewable: false, reason: "Rejected because the clip has high context risk." };
  }
  if (hasHardQualityWarning(qualityWarnings)) {
    return { reviewable: false, reason: "Rejected because pastor-grade quality checks found a core content blocker." };
  }
  if (candidate.boundaryQuality === "BAD" && !options.allowBadBoundaryWhenRepairable) {
    return { reviewable: false, reason: "Rejected because the boundary is not repairable for pastor review." };
  }
  if (
    candidate.boundaryQuality === "BAD" &&
    options.allowBadBoundaryWhenRepairable &&
    !qualityWarnings.some((warning) => warning === "PASTOR_GRADE_BAD_BOUNDARY" || isRepairableQualityWarning(warning))
  ) {
    return { reviewable: false, reason: "Rejected because the boundary is bad without an actionable repair warning." };
  }
  if (
    options.requireActionableEditingSignal !== false &&
    (candidate.qualityLabel === "NEEDS_EDITING" || candidate.postReadyStatus === "NEEDS_EDITING") &&
    !hasActionableEditingSignal(candidate)
  ) {
    return { reviewable: false, reason: "Rejected because a needs-editing clip must include an actionable edit warning or next action." };
  }

  return { reviewable: true, reason: null };
}

export function hasOnlyRepairableQualityWarnings(warnings: string[] | undefined): boolean {
  const pastorGradeWarnings = (warnings ?? []).filter((warning) => warning.startsWith("PASTOR_GRADE_"));
  return pastorGradeWarnings.length > 0 && pastorGradeWarnings.every(isRepairableQualityWarning);
}

export function nextActionsForWarnings(warnings: string[] | undefined): RepairableNextAction[] {
  const actions = new Set<RepairableNextAction>();
  for (const warning of warnings ?? []) {
    if (warning === "PASTOR_GRADE_DEPENDENT_OPENING" || warning === "PASTOR_GRADE_WEAK_OPENING") {
      actions.add("REVIEW_START_TRIM");
    }
    if (
      warning === "PASTOR_GRADE_DANGLING_ENDING" ||
      warning === "PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION" ||
      warning === "PASTOR_GRADE_SETUP_WITHOUT_LANDING"
    ) {
      actions.add("REVIEW_ENDING");
    }
    if (
      warning === "PASTOR_GRADE_CONTEXT_DEPENDENT" ||
      warning === "PASTOR_GRADE_INCOMPLETE_THOUGHT" ||
      warning === "PASTOR_GRADE_BAD_BOUNDARY"
    ) {
      actions.add("EXTEND_CONTEXT");
    }
  }

  if (actions.size === 0) {
    actions.add("REVIEW_CAPTION");
  }

  return [...actions];
}

export function countReasonCodes(reasons: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const reason of reasons) {
    const code = reason.match(/\b[A-Z][A-Z0-9_]{2,}\b/)?.[0] ?? "UNCLASSIFIED";
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}
