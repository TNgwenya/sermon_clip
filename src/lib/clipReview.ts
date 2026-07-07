export type ReviewClipStatus = "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
export type ReviewRenderStatus = "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
export type ReviewCaptionStatus = "NOT_GENERATED" | "GENERATING" | "GENERATED" | "FAILED";
export type ReviewOverlayStatus = "NOT_RENDERED" | "RENDERING" | "COMPLETED" | "FAILED";
export type ReviewExportStatus = "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED";
export type ReviewBoundaryQuality = "GOOD" | "NEEDS_REVIEW" | "BAD";
export type ReviewRiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type ReviewRecommendedAction = "KEEP" | "EXTEND" | "SHORTEN" | "MERGE" | "REJECT" | "NEEDS_REVIEW";
export type ReviewQualityCategory = "ENCOURAGEMENT" | "SCRIPTURE_TEACHING" | "ALTAR_CALL" | "TESTIMONY_STORY" | "QUOTE" | "LEADERSHIP" | "EVANGELISTIC" | "PRAYER" | "GENERAL";
export type ReviewProfessionalQualityLabel = "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT";

export type ReviewFilter = "ALL" | "APPROVED" | "REJECTED" | "PENDING" | "RENDERED" | "NOT_RENDERED";
export type ReviewSort = "HIGHEST_SCORE" | "NEWEST" | "SHORTEST" | "LONGEST";
export type ReviewBatchAction = "approve" | "reject" | "pending" | "render" | "caption" | "burn" | "overlay" | "export" | "prepare";
export type ReviewQueuedMediaAsset = "render" | "caption" | "captionBurn" | "overlay" | "export";

export type ReviewClipModel = {
  id: string;
  status: ReviewClipStatus;
  score: number;
  finalQualityScore?: number | null;
  qualityLabel?: ReviewProfessionalQualityLabel | null;
  postReadyStatus?: ReviewProfessionalQualityLabel | null;
  postReadyBlockers?: string[];
  recommendedNextAction?: string | null;
  overallPostScore?: number | null;
  hookStrengthScore?: number | null;
  standaloneClarityScore?: number | null;
  contextSafetyScore?: number | null;
  visualReadinessScore?: number | null;
  recommendedAction?: ReviewRecommendedAction | null;
  qualityClipCategory?: ReviewQualityCategory | null;
  qualitySummary?: string | null;
  pastorFriendlyReason?: string | null;
  qualityWarnings?: string[];
  riskLevel?: ReviewRiskLevel;
  contextWarning?: boolean;
  durationSeconds: number;
  createdAt: Date;
  renderStatus: ReviewRenderStatus;
  captionStatus: ReviewCaptionStatus;
  overlayStatus: ReviewOverlayStatus;
  exportStatus: ReviewExportStatus;
  boundaryQuality: ReviewBoundaryQuality;
  subtitleFilePath?: string | null;
  overlayVideoPath?: string | null;
  manualCropKeyframes?: unknown;
  manualCropUpdatedAt?: string | Date | null;
};

export function filterClips<T extends ReviewClipModel>(clips: T[], filter: ReviewFilter): T[] {
  if (filter === "ALL") {
    return clips;
  }

  if (filter === "APPROVED") {
    return clips.filter((clip) => clip.status === "APPROVED" || clip.status === "EXPORTED");
  }

  if (filter === "REJECTED") {
    return clips.filter((clip) => clip.status === "REJECTED");
  }

  if (filter === "PENDING") {
    return clips.filter((clip) => clip.status === "SUGGESTED");
  }

  if (filter === "RENDERED") {
    return clips.filter((clip) => clip.renderStatus === "COMPLETED");
  }

  return clips.filter((clip) => clip.renderStatus !== "COMPLETED");
}

export function sortClips<T extends ReviewClipModel>(clips: T[], sort: ReviewSort): T[] {
  const copy = [...clips];

  if (sort === "HIGHEST_SCORE") {
    const labelOrder: Record<ReviewProfessionalQualityLabel, number> = {
      POST_READY: 0,
      GOOD_NEEDS_REVIEW: 1,
      NEEDS_EDITING: 2,
      REJECT: 3,
    };
    return copy.sort((a, b) => {
      const aLabel = a.qualityLabel ?? a.postReadyStatus;
      const bLabel = b.qualityLabel ?? b.postReadyStatus;
      const labelDiff = (aLabel ? labelOrder[aLabel] : 2) - (bLabel ? labelOrder[bLabel] : 2);
      if (labelDiff !== 0) return labelDiff;
      return (b.finalQualityScore ?? b.overallPostScore ?? b.score) - (a.finalQualityScore ?? a.overallPostScore ?? a.score);
    });
  }

  if (sort === "NEWEST") {
    return copy.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  if (sort === "SHORTEST") {
    return copy.sort((a, b) => a.durationSeconds - b.durationSeconds);
  }

  return copy.sort((a, b) => b.durationSeconds - a.durationSeconds);
}

export function getQueuedMediaAssetsForRemoteBatchAction(action: ReviewBatchAction): ReviewQueuedMediaAsset[] {
  if (action === "prepare") {
    return ["render", "caption", "captionBurn", "overlay", "export"];
  }

  if (action === "caption") {
    return ["caption"];
  }

  if (action === "burn") {
    return ["captionBurn"];
  }

  if (action === "overlay") {
    return ["overlay"];
  }

  if (action === "export") {
    return ["render", "overlay", "export"];
  }

  return [];
}

export function getClipPostScore(clip: Pick<ReviewClipModel, "overallPostScore" | "score">): number {
  return ("finalQualityScore" in clip && typeof clip.finalQualityScore === "number" ? clip.finalQualityScore : null) ?? clip.overallPostScore ?? clip.score;
}

function formatScore(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(1) : "-";
}

export function getRecommendedActionLabel(action: ReviewRecommendedAction | null | undefined): string {
  if (!action) {
    return "Ready to review";
  }

  const labels: Record<ReviewRecommendedAction, string> = {
    KEEP: "Ready to post",
    NEEDS_REVIEW: "Needs pastor review",
    REJECT: "Weak clip",
    EXTEND: "May need more context",
    SHORTEN: "Consider shortening",
    MERGE: "Works better with another moment",
  };

  return labels[action];
}

export function getProfessionalQualityLabel(label: ReviewProfessionalQualityLabel | null | undefined): string {
  if (label === "POST_READY") return "Post-ready";
  if (label === "GOOD_NEEDS_REVIEW") return "Good, review first";
  if (label === "NEEDS_EDITING") return "Needs editing";
  if (label === "REJECT") return "Not recommended";
  return "Needs review";
}

export function getQualityCategoryLabel(category: ReviewQualityCategory | string | null | undefined): string {
  if (!category) {
    return "General";
  }

  const labels: Record<ReviewQualityCategory, string> = {
    ENCOURAGEMENT: "Encouragement",
    SCRIPTURE_TEACHING: "Scripture Teaching",
    ALTAR_CALL: "Altar Call",
    TESTIMONY_STORY: "Testimony/Story",
    QUOTE: "Quote",
    LEADERSHIP: "Leadership",
    EVANGELISTIC: "Evangelistic",
    PRAYER: "Prayer",
    GENERAL: "General",
  };

  return labels[category as ReviewQualityCategory] ?? category.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getReadinessFromScore(score: number | null | undefined, strongLabel: string, reviewLabel: string, weakLabel: string): {
  label: string;
  tone: "good" | "review" | "weak" | "neutral";
  scoreLabel: string;
} {
  if (typeof score !== "number") {
    return { label: "Not reviewed yet", tone: "neutral", scoreLabel: "-" };
  }

  if (score >= 8) {
    return { label: strongLabel, tone: "good", scoreLabel: formatScore(score) };
  }

  if (score >= 6) {
    return { label: reviewLabel, tone: "review", scoreLabel: formatScore(score) };
  }

  return { label: weakLabel, tone: "weak", scoreLabel: formatScore(score) };
}

export function buildClipQualityView(clip: ReviewClipModel, rank: number): {
  rankLabel: string;
  scoreLabel: string;
  scoreSourceLabel: string;
  actionLabel: string;
  actionTone: "good" | "review" | "weak" | "neutral";
  categoryLabel: string;
  reason: string;
  postReadiness: { label: string; tone: "good" | "review" | "weak" | "neutral"; scoreLabel: string };
  messageClarity: { label: string; tone: "good" | "review" | "weak" | "neutral"; scoreLabel: string };
  contextSafety: { label: string; tone: "good" | "review" | "weak" | "neutral"; scoreLabel: string };
  visualReadiness: { label: string; tone: "good" | "review" | "weak" | "neutral"; scoreLabel: string };
  hasQualityReview: boolean;
} {
  const score = getClipPostScore(clip);
  const professionalLabel = clip.qualityLabel ?? clip.postReadyStatus ?? null;
  const hasQualityReview = typeof clip.finalQualityScore === "number" || typeof clip.overallPostScore === "number" || Boolean(clip.recommendedAction || clip.qualitySummary || clip.pastorFriendlyReason);
  const actionTone =
    professionalLabel === "POST_READY"
      ? "good"
      : professionalLabel === "GOOD_NEEDS_REVIEW" || professionalLabel === "NEEDS_EDITING"
        ? "review"
        : professionalLabel === "REJECT"
          ? "weak"
          : clip.recommendedAction === "KEEP"
      ? "good"
      : clip.recommendedAction === "REJECT"
        ? "weak"
        : clip.recommendedAction
          ? "review"
          : "neutral";

  const contextSafety = getReadinessFromScore(
    clip.contextSafetyScore ?? (clip.contextWarning ? 5 : clip.riskLevel === "HIGH" ? 4 : clip.riskLevel === "MEDIUM" ? 6.5 : undefined),
    "Safe to post",
    "May need more context",
    "Context needs review",
  );

  return {
    rankLabel: rank === 0 ? "Best first post" : `Post pick #${rank + 1}`,
    scoreLabel: formatScore(score),
    scoreSourceLabel: typeof clip.finalQualityScore === "number"
      ? "Quality score"
      : typeof clip.overallPostScore === "number"
        ? "Post score"
        : "Legacy score",
    actionLabel: professionalLabel ? getProfessionalQualityLabel(professionalLabel) : getRecommendedActionLabel(clip.recommendedAction),
    actionTone,
    categoryLabel: getQualityCategoryLabel(clip.qualityClipCategory),
    reason: clip.pastorFriendlyReason ?? clip.qualitySummary ?? "This older clip is ready for a quick pastor review. Check the preview, caption, and framing before posting.",
    postReadiness: getReadinessFromScore(score, "Strong post-ready clip", "Worth reviewing", "Weak post candidate"),
    messageClarity: getReadinessFromScore(clip.standaloneClarityScore, "Message stands alone", "May need more context", "Message may feel incomplete"),
    contextSafety,
    visualReadiness: getReadinessFromScore(clip.visualReadinessScore, "Video looks ready", "Check framing", "Video needs review"),
    hasQualityReview,
  };
}

export function buildClipWarnings(clip: ReviewClipModel): string[] {
  const warnings: string[] = [];

  if (clip.captionStatus !== "GENERATED" || !clip.subtitleFilePath) {
    warnings.push("Captions not generated");
  }

  if (clip.overlayStatus !== "COMPLETED" || !clip.overlayVideoPath) {
    warnings.push("Overlay not generated");
  }

  if (clip.durationSeconds > 70) {
    warnings.push("Clip duration exceeds recommendation");
  }

  if (clip.boundaryQuality !== "GOOD") {
    warnings.push("Clip start or ending may need review");
  }

  if (Array.isArray(clip.manualCropKeyframes) && clip.manualCropKeyframes.length > 0 && clip.manualCropUpdatedAt) {
    warnings.push("Manual framing applied");
  }

  if (clip.recommendedAction === "NEEDS_REVIEW") {
    warnings.push("Needs pastor review before posting");
  }

  if (clip.recommendedAction === "REJECT") {
    warnings.push("Not recommended as a post");
  }

  for (const warning of clip.qualityWarnings ?? []) {
    if (warning === "CONTEXT_RISK") {
      warnings.push("May need more context");
    } else if (warning === "INCOMPLETE_THOUGHT") {
      warnings.push("Clip may not stand alone clearly");
    } else if (warning === "WEAK_HOOK") {
      warnings.push("Hook may be weak");
    } else if (warning === "LOW_POST_WORTHINESS") {
      warnings.push("Weak post candidate");
    } else if (warning === "HEURISTIC_TRACKING_USED") {
      warnings.push("Video framing may need review");
    } else if (warning === "SMART_CROP_UNSTABLE") {
      warnings.push("Smart crop movement may need review");
    } else if (warning === "LOW_TRACKING_CONFIDENCE" || warning === "SMART_CROP_REVIEW_RECOMMENDED") {
      warnings.push("Video framing needs review");
    } else if (warning === "MISSING_BODY_TRACK" || warning === "LOW_SAMPLE_COUNT") {
      warnings.push("Pastor may not stay centered throughout");
    } else if (warning === "RENDER_MISSING") {
      warnings.push("Rendered video is missing");
    } else if (warning === "RENDER_FAILED") {
      warnings.push("Render failed");
    } else if (warning === "OUTPUT_DURATION_MISMATCH") {
      warnings.push("Rendered clip length needs review");
    } else if (warning === "OUTPUT_DIMENSION_MISMATCH") {
      warnings.push("Rendered video size needs review");
    } else if (warning === "AUDIO_MISSING") {
      warnings.push("Rendered video may be missing audio");
    } else if (warning === "OUTPUT_FILE_TOO_SMALL") {
      warnings.push("Rendered video file looks incomplete");
    }
  }

  return Array.from(new Set(warnings));
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

export function resolveBatchClipIds(input: {
  action: ReviewBatchAction;
  selectedClipIds: string[];
  approvedClipIds: string[];
}): string[] {
  const selected = uniqueIds(input.selectedClipIds);
  if (input.action === "prepare" && selected.length === 0) {
    return uniqueIds(input.approvedClipIds);
  }

  return selected;
}

export function resolveReadyClipTargets<T extends { id: string }>(input: {
  readyClips: T[];
  selectedClipIds: string[];
}): T[] {
  const selected = new Set(input.selectedClipIds);
  if (selected.size === 0) {
    return input.readyClips;
  }

  return input.readyClips.filter((clip) => selected.has(clip.id));
}

export function buildMobileReviewBarModel(input: {
  selectedCount: number;
  approvedClipCount: number;
  isPending: boolean;
}): {
  visible: boolean;
  label: string;
  canApprove: boolean;
  canPrepare: boolean;
} {
  return {
    visible: input.selectedCount > 0,
    label: `${input.selectedCount} selected`,
    canApprove: input.selectedCount > 0 && !input.isPending,
    canPrepare: (input.selectedCount > 0 || input.approvedClipCount > 0) && !input.isPending,
  };
}

export function summarizeReview(clips: ReviewClipModel[]): {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  rendered: number;
} {
  return clips.reduce(
    (acc, clip) => {
      acc.total += 1;
      if (clip.status === "APPROVED" || clip.status === "EXPORTED") {
        acc.approved += 1;
      } else if (clip.status === "REJECTED") {
        acc.rejected += 1;
      } else if (clip.status === "SUGGESTED") {
        acc.pending += 1;
      }

      if (clip.renderStatus === "COMPLETED") {
        acc.rendered += 1;
      }

      return acc;
    },
    { total: 0, approved: 0, rejected: 0, pending: 0, rendered: 0 },
  );
}

export function applyClipApprovalStatus(
  clips: ReviewClipModel[],
  clipId: string,
  status: ReviewClipStatus,
): ReviewClipModel[] {
  return clips.map((clip) => {
    if (clip.id !== clipId) {
      return clip;
    }

    return {
      ...clip,
      status,
    };
  });
}

export function persistClipNote(
  notesByClipId: Record<string, string>,
  clipId: string,
  note: string,
): Record<string, string> {
  return {
    ...notesByClipId,
    [clipId]: note,
  };
}

export function summarizeBatchSelection(clips: ReviewClipModel[], selectedClipIds: string[]): {
  selectedCount: number;
  approvedSelected: number;
  rejectedSelected: number;
  pendingSelected: number;
} {
  const selected = new Set(selectedClipIds);
  const selectedClips = clips.filter((clip) => selected.has(clip.id));

  return selectedClips.reduce(
    (acc, clip) => {
      acc.selectedCount += 1;
      if (clip.status === "APPROVED") {
        acc.approvedSelected += 1;
      } else if (clip.status === "REJECTED") {
        acc.rejectedSelected += 1;
      } else if (clip.status === "SUGGESTED") {
        acc.pendingSelected += 1;
      }
      return acc;
    },
    {
      selectedCount: 0,
      approvedSelected: 0,
      rejectedSelected: 0,
      pendingSelected: 0,
    },
  );
}
