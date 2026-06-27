import { hasHardQualityWarning } from "@/server/agents/clipCandidatePolicy";

export const POST_READY_STATUSES = ["POST_READY", "GOOD_NEEDS_REVIEW", "NEEDS_EDITING", "REJECT"] as const;
export const POST_READY_ACTIONS = [
  "POST_NOW",
  "REVIEW_CLIP",
  "REVIEW_OPENING",
  "FIX_CROP",
  "FIX_CAPTIONS",
  "TRIM_CLIP",
  "EXTEND_CONTEXT",
  "RERENDER",
  "REJECT",
] as const;

export type PostReadyStatus = typeof POST_READY_STATUSES[number];
export type PostReadyRecommendedAction = typeof POST_READY_ACTIONS[number];

export type PostReadyReviewInput = {
  finalQualityScore: number;
  hookScore: number;
  arcCompletenessScore: number;
  boundaryQualityScore: number;
  visualQualityScore: number;
  audioQualityScore: number;
  captionQualityScore: number;
  boundaryQuality: "GOOD" | "NEEDS_REVIEW" | "BAD";
  standaloneClarityScore?: number | null;
  renderStatus?: string | null;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH";
  contextWarning?: boolean;
  qualityWarnings?: string[];
  audioWarnings?: string[];
  captionWarnings?: string[];
};

export type PostReadyReviewResult = {
  postReadyStatus: PostReadyStatus;
  postReadyReasons: string[];
  postReadyBlockers: string[];
  recommendedNextAction: PostReadyRecommendedAction;
};

function includesAny(values: string[] | undefined, targets: string[]): boolean {
  return (values ?? []).some((value) => targets.includes(value));
}

function includesCorePastorGradeBlocker(values: string[] | undefined): boolean {
  return hasHardQualityWarning(values);
}

function includesPastorGradeWarning(values: string[] | undefined): boolean {
  return (values ?? []).some((value) => value.startsWith("PASTOR_GRADE_"));
}

const HARD_CROP_EDIT_WARNING_CODES = [
  "POSSIBLE_WRONG_PERSON",
  "CROP_JUMP_DETECTED",
  "SMART_CROP_UNSTABLE",
  "OUTPUT_DIMENSION_MISMATCH",
  "RENDER_FAILED",
  "RENDER_MISSING",
];

const REVIEWABLE_CROP_WARNING_CODES = [
  "LOW_TRACKING_CONFIDENCE",
  "HEURISTIC_TRACKING_USED",
  "MISSING_BODY_TRACK",
  "LOW_SAMPLE_COUNT",
  "SPEAKER_NOT_VISIBLE_ENOUGH",
  "STATIC_CENTER_CROP_USED",
  "MANUAL_CROP_RECOMMENDED",
  "SMART_CROP_REVIEW_RECOMMENDED",
];

const CAPTION_WARNING_CODES = [
  "CAPTIONS_TOO_FAST",
  "CAPTIONS_TOO_LONG",
  "CAPTIONS_OUT_OF_SAFE_ZONE",
  "MISSING_CAPTION_SEGMENTS",
  "CAPTION_TIMING_MISMATCH",
];

const AUDIO_WARNING_CODES = [
  "NO_AUDIO_DETECTED",
  "LOW_AUDIO_VOLUME",
  "AUDIO_CLIPPING_RISK",
  "EFFECTIVE_SILENCE",
  "LONG_SILENCE_AT_START",
  "LONG_SILENCE_AT_END",
  "LONG_INTERNAL_SILENCE",
];

const AUDIO_TRIM_WARNING_CODES = [
  "LONG_INTERNAL_SILENCE",
];

const INVALID_BOUNDARY_WARNING_CODES = [
  "INVALID_BOUNDARY",
  "INVALID_TIMESTAMPS",
  "UNRECOVERABLE_BOUNDARY",
];

const OPENING_EDIT_WARNINGS = [
  "NEEDS_START_TRIM",
  "PASTOR_GRADE_DEPENDENT_OPENING",
  "PASTOR_GRADE_WEAK_OPENING",
];

const ENDING_OR_CONTEXT_EDIT_WARNINGS = [
  "NEEDS_END_TRIM",
  "REVIEW_ENDING",
  "NEEDS_CONTEXT_EXTENSION",
  "TRANSCRIPT_LIMITED_ENDING",
  "PASTOR_REVIEW_NEEDS_STRONGER_LANDING",
  "PASTOR_GRADE_BAD_BOUNDARY",
  "PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION",
  "PASTOR_GRADE_SETUP_WITHOUT_LANDING",
  "PASTOR_GRADE_DANGLING_ENDING",
  "PASTOR_GRADE_INCOMPLETE_THOUGHT",
];

const DURATION_EDIT_WARNINGS = [
  "PASTOR_REVIEW_DURATION",
  "DURATION_NEEDS_EDIT",
  "PASTOR_GRADE_TOO_LONG",
  "FILLER_WORD_DENSITY",
  "SPEECH_POLISH_NEEDED",
];

const HUMAN_REVIEW_WARNINGS = [
  "PASTOR_REVIEW_OPENING",
  "PASTOR_REVIEW_OPENING_CONNECTOR",
  "PASTOR_REVIEW_BOUNDARY",
  "PASTOR_REVIEW_COMPLETENESS",
  "PASTOR_REVIEW_SERMON_ARC",
  "PASTOR_REVIEW_STANDALONE_CLARITY",
  "PASTOR_GRADE_LOW_STANDALONE_CLARITY",
  "PASTOR_GRADE_CONTEXT_DEPENDENT",
];

type ClassificationBlockers = {
  hard: string[];
  edit: string[];
  review: string[];
};

function hasRenderFailure(renderStatus?: string | null): boolean {
  return renderStatus === "FAILED" || renderStatus === "ERROR";
}

function hasIncompleteRender(renderStatus?: string | null): boolean {
  return Boolean(renderStatus && renderStatus !== "COMPLETED" && !hasRenderFailure(renderStatus));
}

function hasSafeRenderedPreview(input: PostReadyReviewInput): boolean {
  return input.renderStatus === "COMPLETED";
}

function hasCropEditBlocker(input: PostReadyReviewInput): boolean {
  const qualityWarnings = input.qualityWarnings ?? [];
  if (includesAny(qualityWarnings, HARD_CROP_EDIT_WARNING_CODES)) {
    return true;
  }

  if (input.visualQualityScore < 4.8) {
    return true;
  }

  return input.visualQualityScore < 5.8 && !hasSafeRenderedPreview(input);
}

function hasReviewableCropConcern(input: PostReadyReviewInput): boolean {
  const qualityWarnings = input.qualityWarnings ?? [];
  return (
    includesAny(qualityWarnings, REVIEWABLE_CROP_WARNING_CODES) ||
    (input.visualQualityScore < 5.8 && hasSafeRenderedPreview(input))
  );
}

function classifyBlockers(input: PostReadyReviewInput): ClassificationBlockers {
  const hard: string[] = [];
  const edit: string[] = [];
  const review: string[] = [];
  const qualityWarnings = input.qualityWarnings ?? [];

  if (includesCorePastorGradeBlocker(qualityWarnings)) {
    hard.push("Pastor-grade content gate failed; regenerate or choose a stronger sermon moment.");
  }
  if (input.riskLevel === "HIGH") {
    hard.push("Context risk is too high for this clip to be used safely.");
  }
  if (input.finalQualityScore < 4) {
    hard.push("Overall quality score is too low to recover this clip.");
  }
  if (includesAny(qualityWarnings, INVALID_BOUNDARY_WARNING_CODES)) {
    hard.push("Clip boundary is invalid or unrecoverable.");
  }
  if (hasRenderFailure(input.renderStatus)) {
    hard.push("Rendered preview failed and the clip is unusable until regenerated.");
  }

  if (hasCropEditBlocker(input)) {
    edit.push("Smart crop or speaker framing needs correction.");
  }
  if (input.audioQualityScore < 5.8 || includesAny(input.audioWarnings, AUDIO_WARNING_CODES)) {
    edit.push("Audio needs correction before posting.");
  }
  if (input.captionQualityScore < 5.8 || includesAny(input.captionWarnings, CAPTION_WARNING_CODES)) {
    edit.push("Captions need correction before posting.");
  }
  if (hasIncompleteRender(input.renderStatus)) {
    edit.push("Rendered preview is not complete yet.");
  }
  if (input.boundaryQuality === "BAD" || input.boundaryQualityScore < 4.5) {
    edit.push("Clip boundary needs correction before posting.");
  }
  if (includesAny(qualityWarnings, ENDING_OR_CONTEXT_EDIT_WARNINGS)) {
    edit.push("Clip needs context, landing, or ending correction before posting.");
  }
  if (includesAny(qualityWarnings, DURATION_EDIT_WARNINGS)) {
    edit.push("Clip duration needs trimming or extension before posting.");
  }
  if (includesAny(qualityWarnings, OPENING_EDIT_WARNINGS) || input.hookScore < 5.5) {
    edit.push("Opening needs trimming or hook correction before posting.");
  }

  const standaloneClarityScore = input.standaloneClarityScore ?? 0;
  const contextNeedsPastorJudgment =
    input.contextWarning &&
    input.riskLevel !== "HIGH" &&
    input.hookScore >= 5.5 &&
    input.arcCompletenessScore >= 6 &&
    standaloneClarityScore >= 6.5;

  if (contextNeedsPastorJudgment) {
    review.push("Pastor should confirm the clip has enough context before posting.");
  }
  if (input.boundaryQuality === "NEEDS_REVIEW" && !includesAny(qualityWarnings, [...OPENING_EDIT_WARNINGS, ...ENDING_OR_CONTEXT_EDIT_WARNINGS, ...DURATION_EDIT_WARNINGS])) {
    review.push("Pastor should review the boundary, but no active trim or extension warning remains.");
  }
  if (includesAny(qualityWarnings, HUMAN_REVIEW_WARNINGS)) {
    review.push("Pastor should review this clip before posting.");
  }
  if (includesPastorGradeWarning(qualityWarnings) && edit.length === 0 && hard.length === 0) {
    review.push("Pastor should review this clip before posting.");
  }
  if (hasReviewableCropConcern(input) && !hasCropEditBlocker(input)) {
    review.push("Pastor should confirm the safe framing preview before posting.");
  }

  return {
    hard: Array.from(new Set(hard)),
    edit: Array.from(new Set(edit)),
    review: Array.from(new Set(review)),
  };
}

function resolveAction(input: PostReadyReviewInput, blockers: ClassificationBlockers, status: PostReadyStatus): PostReadyRecommendedAction {
  if (status === "REJECT") return "REJECT";
  if (status === "POST_READY") return "POST_NOW";

  const qualityWarnings = input.qualityWarnings ?? [];
  if (hasCropEditBlocker(input)) return "FIX_CROP";
  if (includesAny(input.audioWarnings, AUDIO_TRIM_WARNING_CODES)) return "TRIM_CLIP";
  if (input.audioQualityScore < 5.8 || includesAny(input.audioWarnings, AUDIO_WARNING_CODES)) return "RERENDER";
  if (hasIncompleteRender(input.renderStatus)) return "RERENDER";
  if (input.captionQualityScore < 5.8 || includesAny(input.captionWarnings, CAPTION_WARNING_CODES)) return "FIX_CAPTIONS";
  if (includesAny(qualityWarnings, ["NEEDS_CONTEXT_EXTENSION", "TRANSCRIPT_LIMITED_ENDING", "PASTOR_GRADE_BAD_BOUNDARY", "PASTOR_GRADE_CONTEXT_DEPENDENT", "PASTOR_GRADE_INCOMPLETE_THOUGHT"])) return "EXTEND_CONTEXT";
  if (includesAny(qualityWarnings, [...DURATION_EDIT_WARNINGS, "NEEDS_END_TRIM", "REVIEW_ENDING", "PASTOR_REVIEW_NEEDS_STRONGER_LANDING", "PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION", "PASTOR_GRADE_SETUP_WITHOUT_LANDING", "PASTOR_GRADE_DANGLING_ENDING"])) return "TRIM_CLIP";
  if (includesAny(qualityWarnings, [...OPENING_EDIT_WARNINGS, "PASTOR_REVIEW_OPENING", "PASTOR_REVIEW_OPENING_CONNECTOR"]) || input.hookScore < 5.5) return "REVIEW_OPENING";
  if (blockers.review.length > 0) return "REVIEW_CLIP";

  return status === "GOOD_NEEDS_REVIEW" ? "REVIEW_CLIP" : "POST_NOW";
}

export function reviewPostReady(input: PostReadyReviewInput): PostReadyReviewResult {
  const reasons: string[] = [];

  if (input.finalQualityScore >= 8) reasons.push("Strong professional quality score.");
  if (input.hookScore >= 7) reasons.push("Opening is clear enough for a short-form clip.");
  if (input.arcCompletenessScore >= 7) reasons.push("Clip has a complete sermon mini-arc.");
  if (input.visualQualityScore >= 7) reasons.push("Framing looks safe for review.");
  if (input.audioQualityScore >= 7) reasons.push("Audio quality appears usable.");
  if (input.captionQualityScore >= 7) reasons.push("Caption quality appears usable.");

  const blockers = classifyBlockers(input);
  const contentStrong = input.finalQualityScore >= 7.2 && input.hookScore >= 5.5 && input.arcCompletenessScore >= 6;
  const publishThresholdsPass =
    input.finalQualityScore >= 8 &&
    input.boundaryQuality === "GOOD" &&
    input.hookScore >= 5.5 &&
    input.arcCompletenessScore >= 6 &&
    (input.visualQualityScore >= 5.8 || (hasSafeRenderedPreview(input) && !hasCropEditBlocker(input))) &&
    input.audioQualityScore >= 5.8 &&
    input.captionQualityScore >= 5.8 &&
    !input.contextWarning;

  const status: PostReadyStatus =
    blockers.hard.length > 0
      ? "REJECT"
      : publishThresholdsPass && blockers.edit.length === 0 && blockers.review.length === 0
        ? "POST_READY"
      : blockers.edit.length > 0
        ? "NEEDS_EDITING"
      : contentStrong
        ? "GOOD_NEEDS_REVIEW"
        : "NEEDS_EDITING";
  const postReadyBlockers = status === "REJECT"
    ? blockers.hard
    : status === "NEEDS_EDITING"
      ? blockers.edit
      : blockers.review;
  const action = resolveAction(input, blockers, status);

  return {
    postReadyStatus: status,
    postReadyReasons: reasons.length > 0 ? reasons : ["This clip has some value but does not yet pass the post-ready gate."],
    postReadyBlockers,
    recommendedNextAction: action,
  };
}
