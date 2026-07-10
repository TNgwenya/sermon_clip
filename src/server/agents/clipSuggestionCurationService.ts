import { prisma } from "@/lib/prisma";
import {
  evaluateReviewableClipPolicy,
  hasActionableEditingSignal,
  hasHardQualityWarning,
  isHardQualityWarning,
  isRepairableQualityWarning,
  transcriptGroundingSnapshot,
} from "@/server/agents/clipCandidatePolicy";
import { semanticDedupeCandidates } from "@/server/agents/semanticDedupe";
import { resolveClipVolumeTarget } from "@/lib/clipVolumeTargets";
import {
  hasLocalActionMarker,
  hasLocalSpiritualAnchor,
} from "@/server/agents/multilingualTranscriptAnalysis";

export type CuratableClipSuggestion = {
  id: string;
  title: string;
  hook: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  status: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
  isAiGenerated: boolean;
  isManuallyEdited: boolean;
  score: number;
  finalQualityScore: number | null;
  qualityLabel: "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT" | null;
  postReadyStatus: "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT" | null;
  overallPostScore: number | null;
  recommendedAction: string | null;
  boundaryQuality: "GOOD" | "NEEDS_REVIEW" | "BAD";
  boundaryQualityScore?: number | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  contextWarning: boolean;
  standaloneClarityScore: number | null;
  hookScore?: number | null;
  arcCompletenessScore?: number | null;
  completenessScore?: number | null;
  completenessAction?: string | null;
  qualityWarnings?: string[] | null;
  transcriptText: string;
  smartClipCategory?: string | null;
  clipType?: string | null;
  ministryValue?: string | null;
  visualConfidenceScore?: number | null;
  qualityDebugSnapshot?: unknown;
  transcriptSafetyStatus?: "TRUSTED" | "REVIEW_REQUIRED" | "REVIEWED" | null;
  createdAt: Date;
};

export type ClipSuggestionCurationDecision = {
  clipId: string;
  action: "KEEP" | "REJECT";
  reason: string;
  duplicateOfClipId?: string | null;
  dedupeScore?: number | null;
};

export type ClipSuggestionCurationSummary = {
  clipsFound: number;
  clipsKept: number;
  clipsRejected: number;
  rejectedWeak: number;
  rejectedOverflow: number;
  decisions: ClipSuggestionCurationDecision[];
};

const DEFAULT_MAX_REVIEW_SUGGESTIONS = 24;
const MIN_REVIEWABLE_FINAL_SCORE = 7.0;
const MIN_REVIEWABLE_OVERALL_SCORE = 6.8;
const MIN_REVIEWABLE_HOOK_SCORE = 5.8;
const MIN_REVIEWABLE_STANDALONE_SCORE = 6.2;
const MIN_CONTEXT_WARNING_STANDALONE_SCORE = 6.8;
const MIN_REVIEWABLE_ARC_COMPLETENESS_SCORE = 6.2;
const MIN_REVIEWABLE_COMPLETENESS_SCORE = 5.5;
const MIN_REVIEWABLE_TRANSCRIPT_GROUNDING_SCORE = 0.72;
const MIN_REVIEWABLE_TRANSCRIPT_ORDERED_FLOW_RATIO = 0.82;
const MIN_REUSABLE_REVIEW_BOARD_WORDS = 18;
const MIN_LOCAL_MINISTRY_REVIEW_WORDS = 8;
const LANGUAGE_SEMANTIC_REVIEW_WARNINGS = new Set([
  "PASTOR_GRADE_NO_SPIRITUAL_ANCHOR",
  "PASTOR_GRADE_TRANSCRIPT_NO_SPIRITUAL_ANCHOR",
  "PASTOR_GRADE_NO_CLEAR_TAKEAWAY",
  "PASTOR_GRADE_TRANSCRIPT_NO_CLEAR_TAKEAWAY",
  "PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION",
]);

function transcriptSafetyRank(clip: CuratableClipSuggestion): number {
  if (clip.transcriptSafetyStatus === "REVIEW_REQUIRED") return 1;
  return 0;
}

function effectiveWarningsForCuration(clip: CuratableClipSuggestion): string[] {
  const warnings = clip.qualityWarnings ?? [];
  if (clip.transcriptSafetyStatus !== "REVIEW_REQUIRED") {
    return warnings;
  }

  // When the words themselves still need review, English-only semantic checks
  // are not proof that a local/mixed-language clip is weak. Keep it in the
  // transcript-review tier while retaining timing, grounding, and context gates.
  return Array.from(new Set([
    ...warnings.filter((warning) => !LANGUAGE_SEMANTIC_REVIEW_WARNINGS.has(warning)),
    "TRANSCRIPT_REVIEW_REQUIRED",
  ]));
}

function minTranscriptWordsForCuration(clip: CuratableClipSuggestion): number {
  const hasGroundedLocalMinistrySignal =
    clip.transcriptSafetyStatus === "REVIEW_REQUIRED" &&
    hasLocalSpiritualAnchor(clip.transcriptText) &&
    hasLocalActionMarker(clip.transcriptText);

  // Nguni and Sotho-Tswana wording can carry more meaning per written word
  // than the English-oriented review threshold assumes. This narrower gate
  // only admits grounded ministry excerpts to human transcript review; all
  // timing, risk, boundary, and transcript-grounding checks still apply.
  return hasGroundedLocalMinistrySignal
    ? MIN_LOCAL_MINISTRY_REVIEW_WORDS
    : MIN_REUSABLE_REVIEW_BOARD_WORDS;
}

function qualityRank(clip: CuratableClipSuggestion): number {
  const label = clip.qualityLabel ?? clip.postReadyStatus;
  if (label === "POST_READY") return 0;
  if (label === "GOOD_NEEDS_REVIEW") return 1;
  if (label === "NEEDS_EDITING") return 2;
  if (label === "REJECT") return 4;
  return 3;
}

function scoreForRanking(clip: CuratableClipSuggestion): number {
  return clip.finalQualityScore ?? clip.overallPostScore ?? clip.score;
}

function buildWeakRejectReason(clip: CuratableClipSuggestion): string | null {
  const qualityWarnings = effectiveWarningsForCuration(clip);
  const policy = evaluateReviewableClipPolicy({
    ...clip,
    qualityLabel: clip.transcriptSafetyStatus === "REVIEW_REQUIRED" ? "NEEDS_EDITING" : clip.qualityLabel,
    postReadyStatus: clip.transcriptSafetyStatus === "REVIEW_REQUIRED" ? "NEEDS_EDITING" : clip.postReadyStatus,
    qualityWarnings,
  }, {
    minTranscriptWords: minTranscriptWordsForCuration(clip),
    minGroundingScore: MIN_REVIEWABLE_TRANSCRIPT_GROUNDING_SCORE,
    minOrderedFlowRatio: MIN_REVIEWABLE_TRANSCRIPT_ORDERED_FLOW_RATIO,
    allowBadBoundaryWhenRepairable: true,
    requireActionableEditingSignal: true,
  });
  if (!policy.reviewable) {
    return policy.reason;
  }

  const reviewScore = clip.finalQualityScore ?? clip.overallPostScore ?? clip.score;
  const pastorReviewOption =
    ((clip.qualityLabel === "GOOD_NEEDS_REVIEW" || clip.postReadyStatus === "GOOD_NEEDS_REVIEW") &&
      reviewScore >= MIN_REVIEWABLE_OVERALL_SCORE) ||
    clip.qualityLabel === "NEEDS_EDITING" ||
    clip.postReadyStatus === "NEEDS_EDITING" ||
    qualityWarnings.some(isRepairableQualityWarning) ||
    hasActionableEditingSignal(clip);
  if (
    pastorReviewOption &&
    clip.riskLevel !== "HIGH" &&
    !hasHardQualityWarning(qualityWarnings) &&
    !qualityWarnings.some(isHardQualityWarning)
  ) {
    return null;
  }

  if (clip.contextWarning && (clip.standaloneClarityScore ?? 10) < 6) {
    return "Rejected because it depends on too much surrounding context.";
  }
  if (typeof clip.hookScore === "number" && clip.hookScore < MIN_REVIEWABLE_HOOK_SCORE) {
    return "Rejected because the opening hook is not strong enough for pastor review.";
  }
  if (typeof clip.standaloneClarityScore === "number" && clip.standaloneClarityScore < MIN_REVIEWABLE_STANDALONE_SCORE) {
    return "Rejected because the clip is not clear enough as a standalone post.";
  }
  if (clip.contextWarning && typeof clip.standaloneClarityScore === "number" && clip.standaloneClarityScore < MIN_CONTEXT_WARNING_STANDALONE_SCORE) {
    return "Rejected because context risk is too high for pastor review.";
  }
  if (typeof clip.arcCompletenessScore === "number" && clip.arcCompletenessScore < MIN_REVIEWABLE_ARC_COMPLETENESS_SCORE) {
    return "Rejected because the clip does not have a complete enough sermon arc.";
  }
  if (typeof clip.completenessScore === "number" && clip.completenessScore < MIN_REVIEWABLE_COMPLETENESS_SCORE) {
    return "Rejected because the clip is likely missing setup, landing, or a clean ending.";
  }
  if (clip.completenessAction === "REJECT_INCOMPLETE") {
    return "Rejected because the completeness pass marked it incomplete.";
  }

  if (hasHardQualityWarning(qualityWarnings) || qualityWarnings.some(isHardQualityWarning)) {
    return "Rejected because pastor-grade quality checks found a core content blocker.";
  }
  if (qualityWarnings.some((warning) => warning.startsWith("PASTOR_GRADE_") && !isRepairableQualityWarning(warning) && !isHardQualityWarning(warning))) {
    return "Rejected because pastor-grade quality checks found an unsupported content blocker.";
  }

  if ((clip.finalQualityScore ?? 10) < MIN_REVIEWABLE_FINAL_SCORE) {
    return "Rejected because the professional quality score is too low.";
  }
  if ((clip.overallPostScore ?? 10) < MIN_REVIEWABLE_OVERALL_SCORE) {
    return "Rejected because the post-worthiness score is too low.";
  }

  return null;
}

export function planAiSuggestionCuration(
  clips: CuratableClipSuggestion[],
  options?: { maxReviewSuggestions?: number },
): ClipSuggestionCurationSummary {
  const maxReviewSuggestions = options?.maxReviewSuggestions ?? DEFAULT_MAX_REVIEW_SUGGESTIONS;
  const reviewable = clips.filter((clip) => (
    clip.status === "SUGGESTED" &&
    clip.isAiGenerated &&
    !clip.isManuallyEdited
  ));
  const decisions = new Map<string, ClipSuggestionCurationDecision>();
  const candidatesToRank: CuratableClipSuggestion[] = [];

  for (const clip of reviewable) {
    const grounding = transcriptGroundingSnapshot(clip);
    if (!grounding || grounding.score === null) {
      decisions.set(clip.id, {
        clipId: clip.id,
        action: "KEEP",
        reason: "Kept for manual review because this older suggestion predates saved transcript-grounding evidence.",
      });
      continue;
    }

    const weakReason = buildWeakRejectReason(clip);
    if (weakReason) {
      decisions.set(clip.id, {
        clipId: clip.id,
        action: "REJECT",
        reason: weakReason,
      });
      continue;
    }

    candidatesToRank.push(clip);
  }

  const ranked = [...candidatesToRank].sort((left, right) => {
    const safetyDiff = transcriptSafetyRank(left) - transcriptSafetyRank(right);
    if (safetyDiff !== 0) return safetyDiff;

    const rankDiff = qualityRank(left) - qualityRank(right);
    if (rankDiff !== 0) return rankDiff;

    const scoreDiff = scoreForRanking(right) - scoreForRanking(left);
    if (scoreDiff !== 0) return scoreDiff;

    return left.createdAt.getTime() - right.createdAt.getTime();
  });
  const semanticDedupe = semanticDedupeCandidates(ranked, { preserveInputOrder: true });
  for (const duplicate of semanticDedupe.duplicates) {
    decisions.set(duplicate.duplicate.id, {
      clipId: duplicate.duplicate.id,
      action: "REJECT",
      reason: `Rejected because it repeats another suggested clip: ${duplicate.dedupeReason}.`,
      duplicateOfClipId: duplicate.representative.id,
      dedupeScore: duplicate.dedupeScore,
    });
  }

  const dedupedRanked = semanticDedupe.kept.sort((left, right) => {
    const safetyDiff = transcriptSafetyRank(left) - transcriptSafetyRank(right);
    if (safetyDiff !== 0) return safetyDiff;

    const rankDiff = qualityRank(left) - qualityRank(right);
    if (rankDiff !== 0) return rankDiff;

    const scoreDiff = scoreForRanking(right) - scoreForRanking(left);
    if (scoreDiff !== 0) return scoreDiff;

    return left.createdAt.getTime() - right.createdAt.getTime();
  });
  const keepIds = new Set(dedupedRanked.slice(0, maxReviewSuggestions).map((clip) => clip.id));

  for (const clip of dedupedRanked) {
    if (keepIds.has(clip.id)) {
      decisions.set(clip.id, {
        clipId: clip.id,
        action: "KEEP",
        reason: "Kept as one of the strongest AI suggestions for pastor review.",
      });
    } else {
      decisions.set(clip.id, {
        clipId: clip.id,
        action: "REJECT",
        reason: `Rejected to keep the pastor review feed focused on the top ${maxReviewSuggestions} AI suggestions.`,
      });
    }
  }

  const orderedDecisions = reviewable.map((clip) => decisions.get(clip.id)).filter((decision): decision is ClipSuggestionCurationDecision => Boolean(decision));
  const rejected = orderedDecisions.filter((decision) => decision.action === "REJECT");

  return {
    clipsFound: reviewable.length,
    clipsKept: orderedDecisions.filter((decision) => decision.action === "KEEP").length,
    clipsRejected: rejected.length,
    rejectedWeak: rejected.filter((decision) => !decision.reason.includes("top")).length,
    rejectedOverflow: rejected.filter((decision) => decision.reason.includes("top")).length,
    decisions: orderedDecisions,
  };
}

function appendCurationNote(existing: string | null, reason: string): string {
  const note = `Auto-curated from pastor review: ${reason}`;
  if (!existing?.trim()) {
    return note;
  }

  if (existing.includes(note)) {
    return existing;
  }

  return `${existing.trim()}\n${note}`;
}

function clipSpanDurationSeconds(clips: Array<Pick<CuratableClipSuggestion, "startTimeSeconds" | "endTimeSeconds">>): number | null {
  if (clips.length === 0) {
    return null;
  }

  const starts = clips.map((clip) => clip.startTimeSeconds).filter((value) => Number.isFinite(value));
  const ends = clips.map((clip) => clip.endTimeSeconds).filter((value) => Number.isFinite(value));
  if (starts.length === 0 || ends.length === 0) {
    return null;
  }

  return Math.max(0, Math.max(...ends) - Math.min(...starts));
}

function resolveCurationDurationSeconds(input: {
  sourceDurationSeconds?: number | null;
  sermonStartSeconds?: number | null;
  sermonEndSeconds?: number | null;
  clipSpanSeconds?: number | null;
}): number {
  if (
    typeof input.sermonStartSeconds === "number" &&
    typeof input.sermonEndSeconds === "number" &&
    input.sermonEndSeconds > input.sermonStartSeconds
  ) {
    return input.sermonEndSeconds - input.sermonStartSeconds;
  }

  if (typeof input.sourceDurationSeconds === "number" && input.sourceDurationSeconds > 0) {
    return input.sourceDurationSeconds;
  }

  return typeof input.clipSpanSeconds === "number" && input.clipSpanSeconds > 0 ? input.clipSpanSeconds : 0;
}

export async function curateSermonAiSuggestions(input: {
  sermonId: string;
  maxReviewSuggestions?: number;
}): Promise<ClipSuggestionCurationSummary> {
  const sermonId = input.sermonId.trim();
  if (!sermonId) {
    return {
      clipsFound: 0,
      clipsKept: 0,
      clipsRejected: 0,
      rejectedWeak: 0,
      rejectedOverflow: 0,
      decisions: [],
    };
  }

  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: {
      sourceDurationSeconds: true,
      sermonStartSeconds: true,
      sermonEndSeconds: true,
    },
  });
  const clips = await prisma.clipCandidate.findMany({
    where: {
      sermonId,
      status: "SUGGESTED",
      isAiGenerated: true,
      isManuallyEdited: false,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      hook: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      durationSeconds: true,
      status: true,
      isAiGenerated: true,
      isManuallyEdited: true,
      score: true,
      finalQualityScore: true,
      qualityLabel: true,
      postReadyStatus: true,
      overallPostScore: true,
      recommendedAction: true,
      boundaryQuality: true,
      boundaryQualityScore: true,
      riskLevel: true,
      contextWarning: true,
      standaloneClarityScore: true,
      hookScore: true,
      arcCompletenessScore: true,
      completenessScore: true,
      completenessAction: true,
      qualityWarnings: true,
      transcriptText: true,
      smartClipCategory: true,
      clipType: true,
      ministryValue: true,
      visualConfidenceScore: true,
      qualityDebugSnapshot: true,
      transcriptSafetyStatus: true,
      clipNotes: true,
      createdAt: true,
    },
  });
  const normalizedClips = clips.map((clip) => ({
    ...clip,
    qualityWarnings: Array.isArray(clip.qualityWarnings)
      ? clip.qualityWarnings.filter((warning): warning is string => typeof warning === "string")
      : [],
  }));
  const durationSeconds = resolveCurationDurationSeconds({
    sourceDurationSeconds: sermon?.sourceDurationSeconds,
    sermonStartSeconds: sermon?.sermonStartSeconds,
    sermonEndSeconds: sermon?.sermonEndSeconds,
    clipSpanSeconds: clipSpanDurationSeconds(normalizedClips),
  });
  const volumeTarget = resolveClipVolumeTarget(durationSeconds);
  const summary = planAiSuggestionCuration(normalizedClips, {
    maxReviewSuggestions: input.maxReviewSuggestions ?? volumeTarget.maxReviewSuggestions,
  });
  const rejectDecisions = summary.decisions.filter((decision) => decision.action === "REJECT");

  for (const decision of rejectDecisions) {
    const clip = clips.find((item) => item.id === decision.clipId);
    await prisma.clipCandidate.update({
      where: { id: decision.clipId },
      data: {
        status: "REJECTED",
        clipNotes: appendCurationNote(clip?.clipNotes ?? null, decision.reason),
        duplicateOfClipId: decision.duplicateOfClipId ?? undefined,
        dedupeReason: decision.duplicateOfClipId ? decision.reason : undefined,
        dedupeScore: decision.dedupeScore ?? undefined,
      },
    });
  }

  return summary;
}
