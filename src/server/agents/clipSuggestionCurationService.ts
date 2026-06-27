import { prisma } from "@/lib/prisma";
import {
  evaluateReviewableClipPolicy,
  hasActionableEditingSignal,
  hasHardQualityWarning,
  isHardQualityWarning,
  isRepairableQualityWarning,
} from "@/server/agents/clipCandidatePolicy";

export type CuratableClipSuggestion = {
  id: string;
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
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  contextWarning: boolean;
  standaloneClarityScore: number | null;
  hookScore?: number | null;
  arcCompletenessScore?: number | null;
  completenessScore?: number | null;
  completenessAction?: string | null;
  qualityWarnings?: string[] | null;
  transcriptText?: string | null;
  qualityDebugSnapshot?: unknown;
  createdAt: Date;
};

export type ClipSuggestionCurationDecision = {
  clipId: string;
  action: "KEEP" | "REJECT";
  reason: string;
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
  const policy = evaluateReviewableClipPolicy(clip, {
    minTranscriptWords: MIN_REUSABLE_REVIEW_BOARD_WORDS,
    minGroundingScore: MIN_REVIEWABLE_TRANSCRIPT_GROUNDING_SCORE,
    minOrderedFlowRatio: MIN_REVIEWABLE_TRANSCRIPT_ORDERED_FLOW_RATIO,
    allowBadBoundaryWhenRepairable: true,
    requireActionableEditingSignal: true,
  });
  if (!policy.reviewable) {
    return policy.reason;
  }

  const qualityWarnings = clip.qualityWarnings ?? [];
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
    const rankDiff = qualityRank(left) - qualityRank(right);
    if (rankDiff !== 0) return rankDiff;

    const scoreDiff = scoreForRanking(right) - scoreForRanking(left);
    if (scoreDiff !== 0) return scoreDiff;

    return left.createdAt.getTime() - right.createdAt.getTime();
  });
  const keepIds = new Set(ranked.slice(0, maxReviewSuggestions).map((clip) => clip.id));

  for (const clip of ranked) {
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
      riskLevel: true,
      contextWarning: true,
      standaloneClarityScore: true,
      hookScore: true,
      arcCompletenessScore: true,
      completenessScore: true,
      completenessAction: true,
      qualityWarnings: true,
      transcriptText: true,
      qualityDebugSnapshot: true,
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
  const summary = planAiSuggestionCuration(normalizedClips, {
    maxReviewSuggestions: input.maxReviewSuggestions,
  });
  const rejectDecisions = summary.decisions.filter((decision) => decision.action === "REJECT");

  for (const decision of rejectDecisions) {
    const clip = clips.find((item) => item.id === decision.clipId);
    await prisma.clipCandidate.update({
      where: { id: decision.clipId },
      data: {
        status: "REJECTED",
        clipNotes: appendCurationNote(clip?.clipNotes ?? null, decision.reason),
      },
    });
  }

  return summary;
}
