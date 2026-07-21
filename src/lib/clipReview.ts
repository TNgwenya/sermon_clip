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
export type ReviewSort = "HIGHEST_SCORE" | "SERMON_ORDER" | "NEWEST" | "SHORTEST" | "LONGEST";
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
  hookScore?: number | null;
  standaloneClarityScore?: number | null;
  emotionalImpactScore?: number | null;
  ministryValueScore?: number | null;
  sermonValueScore?: number | null;
  shareabilityScore?: number | null;
  socialShareabilityScore?: number | null;
  arcCompletenessScore?: number | null;
  contextSafetyScore?: number | null;
  visualReadinessScore?: number | null;
  bestPlatform?: string | null;
  qualityReviewedAt?: string | Date | null;
  qualityReviewSource?: "AI" | "FALLBACK" | null;
  recommendedAction?: ReviewRecommendedAction | null;
  qualityClipCategory?: ReviewQualityCategory | null;
  qualitySummary?: string | null;
  pastorFriendlyReason?: string | null;
  qualityWarnings?: string[];
  riskLevel?: ReviewRiskLevel;
  contextWarning?: boolean;
  startTimeSeconds?: number | null;
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

  if (sort === "SERMON_ORDER") {
    return copy.sort((a, b) => {
      const aStart = typeof a.startTimeSeconds === "number" && Number.isFinite(a.startTimeSeconds)
        ? a.startTimeSeconds
        : Number.POSITIVE_INFINITY;
      const bStart = typeof b.startTimeSeconds === "number" && Number.isFinite(b.startTimeSeconds)
        ? b.startTimeSeconds
        : Number.POSITIVE_INFINITY;
      if (aStart !== bStart) {
        return aStart < bStart ? -1 : 1;
      }

      return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
    });
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
  const value = ("finalQualityScore" in clip && typeof clip.finalQualityScore === "number" ? clip.finalQualityScore : null)
    ?? clip.overallPostScore
    ?? clip.score;
  if (!Number.isFinite(value)) return 0;
  if (value > 10 && value <= 100) return value / 10;
  return Math.min(10, Math.max(0, value));
}

function formatScore(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(1) : "-";
}

export function getRecommendedActionLabel(action: ReviewRecommendedAction | null | undefined): string {
  if (!action) {
    return "Ready to review";
  }

  const labels: Record<ReviewRecommendedAction, string> = {
    KEEP: "Strong moment",
    NEEDS_REVIEW: "Needs pastor review",
    REJECT: "Weak clip",
    EXTEND: "May need more context",
    SHORTEN: "Consider shortening",
    MERGE: "Works better with another moment",
  };

  return labels[action];
}

export function getProfessionalQualityLabel(label: ReviewProfessionalQualityLabel | null | undefined): string {
  if (label === "POST_READY") return "Strong moment";
  if (label === "GOOD_NEEDS_REVIEW") return "Strong — check context";
  if (label === "NEEDS_EDITING") return "Worth refining";
  if (label === "REJECT") return "Choose another moment";
  return "Review this moment";
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

function getQualityFreshness(
  clip: ReviewClipModel,
  hasQualityReview: boolean,
): {
  state: "current" | "review" | "unassessed";
  label: string;
  detail: string;
} {
  if (!hasQualityReview) {
    return {
      state: "unassessed",
      label: "Content guidance not assessed",
      detail: "Watch the moment yourself, or run Check readiness for transcript-grounded guidance.",
    };
  }

  if (!clip.qualityReviewedAt) {
    return {
      state: "review",
      label: "Content guidance needs a refresh",
      detail: "The saved score may predate a copy edit. Recheck before using it as a decision signal.",
    };
  }

  if (clip.qualityReviewSource === "FALLBACK") {
    return {
      state: "review",
      label: "Transcript-based estimate",
      detail: "The full content review was unavailable, so treat these signals as guidance and confirm the moment yourself.",
    };
  }

  return {
    state: "current",
    label: "Content guidance is current",
    detail: "Signals were checked against the saved clip transcript. Your pastoral judgment remains the final decision.",
  };
}

function getRecommendedNextStep(clip: ReviewClipModel): string {
  const action = clip.recommendedNextAction ?? clip.recommendedAction;
  if (!action) return "Watch the full moment, then approve it or refine it in Studio.";

  const labels: Record<string, string> = {
    POST_NOW: "Approve this moment, then finish captions and branding in Studio.",
    KEEP: "Approve this moment, then finish captions and branding in Studio.",
    REVIEW_CLIP: "Watch the full moment and confirm the wording before approval.",
    NEEDS_REVIEW: "Watch the full moment and confirm the wording before approval.",
    REVIEW_OPENING: "Check whether the opening makes sense without the sermon around it.",
    REVIEW_START_TRIM: "Tighten the opening so the first sentence starts cleanly.",
    REVIEW_ENDING: "Check that the final sentence lands before moving to Studio.",
    EXTEND_CONTEXT: "Add a little more sermon context before approving this moment.",
    EXTEND: "Add a little more sermon context before approving this moment.",
    SHORTEN: "Trim repetition while protecting the main point and landing.",
    REVIEW_CAPTION: "Confirm that the post copy reflects the spoken message accurately.",
    FIX_CAPTIONS: "Open Studio and repair the on-video captions before export.",
    FIX_CROP: "Open Studio and confirm the speaker stays framed throughout.",
    RERENDER: "Rebuild the preview before making a final decision.",
    REJECT: "Do not use this moment unless the message or boundaries are substantially revised.",
  };

  return labels[action] ?? action.replace(/_/g, " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

function getPlatformFit(clip: ReviewClipModel): {
  label: string;
  reason: string;
  assessed: boolean;
} {
  const platform = clip.bestPlatform?.trim();
  if (!platform) {
    return {
      label: "Choose in Studio",
      reason: "No channel has been recommended yet. Confirm the final length and opening before choosing a platform.",
      assessed: false,
    };
  }

  const normalized = platform.toLowerCase();
  const reason = normalized.includes("tiktok")
    ? "The opening and short running time suit a fast, hook-led viewing pattern."
    : normalized.includes("instagram")
      ? "This concise, emotionally clear moment should read well in a visual-first Reels feed."
      : normalized.includes("youtube")
        ? "The complete teaching arc and running time suit viewers who expect a self-contained Short."
        : normalized.includes("facebook")
          ? "The fuller context and shareable ministry message suit a church community feed."
          : "This channel was suggested from the clip's saved content and duration review.";

  return { label: platform, reason, assessed: true };
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
  openingStrength: { label: string; tone: "good" | "review" | "weak" | "neutral"; scoreLabel: string };
  ministryImpact: { label: string; tone: "good" | "review" | "weak" | "neutral"; scoreLabel: string };
  emotionalResonance: { label: string; tone: "good" | "review" | "weak" | "neutral"; scoreLabel: string };
  completeness: { label: string; tone: "good" | "review" | "weak" | "neutral"; scoreLabel: string };
  socialFit: { label: string; tone: "good" | "review" | "weak" | "neutral"; scoreLabel: string };
  platformFit: { label: string; reason: string; assessed: boolean };
  freshness: { state: "current" | "review" | "unassessed"; label: string; detail: string };
  nextStep: string;
  hasQualityReview: boolean;
} {
  const score = getClipPostScore(clip);
  const professionalLabel = clip.qualityLabel ?? clip.postReadyStatus ?? null;
  const hasQualityReview = typeof clip.finalQualityScore === "number" || typeof clip.overallPostScore === "number" || Boolean(clip.recommendedAction || clip.qualitySummary || clip.pastorFriendlyReason);
  const actionTone: "good" | "review" | "weak" | "neutral" =
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

  const qualityView = {
    rankLabel: rank === 0 ? "Best first post" : `Post pick #${rank + 1}`,
    scoreLabel: formatScore(score),
    scoreSourceLabel: typeof clip.finalQualityScore === "number"
      ? "Quality score"
      : typeof clip.overallPostScore === "number"
        ? "Post score"
        : "Earlier estimate",
    actionLabel: professionalLabel ? getProfessionalQualityLabel(professionalLabel) : getRecommendedActionLabel(clip.recommendedAction),
    actionTone,
    categoryLabel: getQualityCategoryLabel(clip.qualityClipCategory),
    reason: clip.pastorFriendlyReason ?? clip.qualitySummary ?? "This older clip is ready for a quick pastor review. Check the preview, caption, and framing before posting.",
    postReadiness: getReadinessFromScore(score, "Strong content potential", "Worth reviewing", "Choose another moment"),
    messageClarity: getReadinessFromScore(clip.standaloneClarityScore, "Message stands alone", "May need more context", "Message may feel incomplete"),
    contextSafety,
    visualReadiness: getReadinessFromScore(clip.visualReadinessScore, "Video looks ready", "Check framing", "Video needs review"),
    openingStrength: getReadinessFromScore(clip.hookStrengthScore ?? clip.hookScore, "Opening earns attention", "Opening is worth checking", "Opening may lose viewers"),
    ministryImpact: getReadinessFromScore(clip.ministryValueScore ?? clip.sermonValueScore, "Strong ministry value", "Useful with a quick review", "Ministry takeaway feels light"),
    emotionalResonance: getReadinessFromScore(clip.emotionalImpactScore, "Emotion supports the message", "Resonance is moderate", "Emotional pull feels limited"),
    completeness: getReadinessFromScore(clip.arcCompletenessScore, "Thought lands completely", "Check the ending", "Thought may feel unfinished"),
    socialFit: getReadinessFromScore(clip.socialShareabilityScore ?? clip.shareabilityScore, "Strong sharing potential", "Channel fit is worth checking", "Social fit may be limited"),
    platformFit: getPlatformFit(clip),
    freshness: getQualityFreshness(clip, hasQualityReview),
    nextStep: getRecommendedNextStep(clip),
    hasQualityReview,
  };

  return qualityView;
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
