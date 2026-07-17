"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  burnSubtitlesForClipAction,
  exportVerticalClipAction,
  generateSmartCropDebugSnapshotAction,
  generateSubtitlesForClipAction,
  markClipTranscriptReviewedAction,
  renderClipCandidateAction,
  renderClipOverlayAction,
  rerenderClipCandidateAction,
  curateSermonAiSuggestionsAction,
  runClipBatchReviewAction,
  saveManualCropCorrectionAction,
  setClipReviewStatusAction,
  startSermonClipQualityRefreshJobAction,
  resetManualCropCorrectionAction,
  updateClipReviewContentAction,
  type ClipReviewBatchAction,
} from "@/server/actions/sermons";
import {
  buildClipQualityView,
  buildClipWarnings,
  filterClips,
  getQualityCategoryLabel,
  sortClips,
  summarizeReview,
  type ReviewFilter,
  type ReviewQualityCategory,
  type ReviewRecommendedAction,
  type ReviewRiskLevel,
  type ReviewSort,
} from "@/lib/clipReview";
import {
  buildTranscriptReviewGuidance,
  type TranscriptReviewEvidenceView,
} from "@/lib/transcriptReviewGuidance";

type ClipReviewItem = {
  id: string;
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  clipNotes: string | null;
  transcriptText: string;
  durationSeconds: number;
  score: number;
  finalQualityScore: number | null;
  qualityLabel: "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT" | null;
  postReadyStatus: "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT" | null;
  postReadyBlockers: string[];
  recommendedNextAction: string | null;
  overallPostScore: number | null;
  hookStrengthScore: number | null;
  hookScore: number | null;
  standaloneClarityScore: number | null;
  emotionalImpactScore: number | null;
  ministryValueScore: number | null;
  sermonValueScore: number | null;
  shareabilityScore: number | null;
  socialShareabilityScore: number | null;
  arcCompletenessScore: number | null;
  contextSafetyScore: number | null;
  visualReadinessScore: number | null;
  bestPlatform: string | null;
  qualitySummary: string | null;
  pastorFriendlyReason: string | null;
  recommendedAction: ReviewRecommendedAction | null;
  qualityClipCategory: ReviewQualityCategory | null;
  qualityWarnings: string[];
  qualityReviewedAt: string | null;
  qualityReviewSource: "AI" | "FALLBACK" | null;
  reasonSelected: string;
  suggestedHook: string | null;
  suggestedCaption: string | null;
  smartClipCategory: string | null;
  recommendationReason: string | null;
  intendedAudience: string | null;
  ministryValue: string | null;
  socialValue: string | null;
  transcriptSafetyStatus: "TRUSTED" | "REVIEW_REQUIRED" | "REVIEWED";
  transcriptSafetyReasons: string[];
  transcriptSafetyReviewedAt: string | null;
  status: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
  riskLevel: ReviewRiskLevel;
  contextWarning: boolean;
  boundaryQuality: "GOOD" | "NEEDS_REVIEW" | "BAD";
  boundaryAdjustmentReason: string | null;
  suggestedStartTimeSeconds: number | null;
  suggestedEndTimeSeconds: number | null;
  transcriptEvidence: TranscriptReviewEvidenceView | null;
  renderStatus: "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
  captionStatus: "NOT_GENERATED" | "GENERATING" | "GENERATED" | "FAILED";
  captionBurnStatus: "NOT_BURNED" | "BURNING" | "COMPLETED" | "FAILED";
  overlayStatus: "NOT_RENDERED" | "RENDERING" | "COMPLETED" | "FAILED";
  exportStatus: "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED";
  exportLayoutStrategy: "CENTER_CROP" | "LEFT_FOCUS" | "RIGHT_FOCUS" | "FIT_BLURRED_BACKGROUND" | "SMART_CROP" | null;
  manualCropKeyframes: unknown;
  manualCropUpdatedAt: string | null;
  smartCropDebugGeneratedAt: string | null;
  smartCropDebugError: string | null;
  subtitleFilePath: string | null;
  overlayVideoPath: string | null;
  remotePreviewUrl: string | null;
  canPreviewVideo: boolean;
  createdAt: string;
};

type ReviewExperienceProps = {
  sermonId: string;
  sermonTitle: string;
  clips: ClipReviewItem[];
  localMediaAvailable: boolean;
};

type Draft = {
  title: string;
  hook: string;
  caption: string;
  hashtags: string;
  clipNotes: string;
};

const REVIEW_INITIAL_VISIBLE_COUNT = 12;

function toDraft(clip: Pick<ClipReviewItem, "title" | "hook" | "caption" | "hashtags" | "clipNotes">): Draft {
  return {
    title: clip.title,
    hook: clip.hook,
    caption: clip.caption,
    hashtags: clip.hashtags.join(" "),
    clipNotes: clip.clipNotes ?? "",
  };
}

function toClipStatusLabel(status: ClipReviewItem["status"]): string {
  if (status === "SUGGESTED") {
    return "Awaiting decision";
  }

  if (status === "EXPORTED") {
    return "Prepared";
  }

  if (status === "REJECTED") {
    return "Not selected";
  }

  return status.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toFriendlyStatus(value: string): string {
  if (value === "NOT_RENDERED") return "No preview";
  if (value === "RENDERING" || value === "QUEUED") return "Creating preview";
  if (value === "COMPLETED") return "Ready";
  if (value === "NOT_EXPORTED") return "Not downloaded";
  if (value === "EXPORTING") return "Preparing download";
  if (value === "NOT_GENERATED") return "Not ready";
  if (value === "GENERATING") return "Creating";
  if (value === "NOT_BURNED") return "Not added";
  if (value === "BURNING") return "Adding";
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toDurationLabel(durationSeconds: number): string {
  const totalSeconds = Math.max(0, Math.round(durationSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isDeterministicFallbackClip(clip: Pick<ClipReviewItem, "qualityWarnings" | "reasonSelected">): boolean {
  return (
    clip.qualityWarnings.includes("FALLBACK_REVIEW") ||
    clip.qualityWarnings.includes("AI_REVIEW_FAILED") ||
    /deterministic fallback|AI clip selection was unavailable/i.test(clip.reasonSelected)
  );
}

function toPastorFriendlyInsight(value: string): string {
  const cleaned = value
    .replace(/\s*Boundary (?:adjusted|kept)[^.]*\.?/gi, "")
    .replace(/\s*AI timing[^.]*\.?/gi, "")
    .replace(/\b\d+(?:\.\d+)?-\d+(?:\.\d+)?s\b/g, "")
    .replace(/\s+to\s*\.\s*$/i, ".")
    .replace(/\.{2,}$/g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned || "This moment carries a clear, self-contained message for a short clip.";
}

function toPastorFriendlyCategory(value: string): string {
  return value.replace(/^Best\s+/i, "").replace(/\s+Clip$/i, "");
}

export function ReviewExperience({ sermonId, sermonTitle, clips, localMediaAvailable }: ReviewExperienceProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<ReviewFilter>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [sort, setSort] = useState<ReviewSort>("HIGHEST_SCORE");
  const [viewMode, setViewMode] = useState<"LIST" | "GRID">("LIST");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showFullFeed, setShowFullFeed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [failedPreviewClipIds, setFailedPreviewClipIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [messageSuccess, setMessageSuccess] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    return clips.reduce<Record<string, Draft>>((acc, clip) => {
      acc[clip.id] = toDraft(clip);
      return acc;
    }, {});
  });

  const normalizedClips = useMemo(
    () =>
      clips.map((clip) => ({
        ...clip,
        createdAt: new Date(clip.createdAt),
      })),
    [clips],
  );

  const summary = useMemo(() => summarizeReview(normalizedClips), [normalizedClips]);
  const decidedCount = summary.approved + summary.rejected;
  const decisionProgress = summary.total > 0 ? Math.round((decidedCount / summary.total) * 100) : 0;
  const reviewIsComplete = summary.total > 0 && summary.pending === 0;
  const strongestApprovedClip = useMemo(
    () => sortClips(normalizedClips.filter((clip) => clip.status === "APPROVED"), "HIGHEST_SCORE")[0] ?? null,
    [normalizedClips],
  );
  const hasPostReadyClip = useMemo(
    () => normalizedClips.some((clip) => clip.status === "EXPORTED" || clip.exportStatus === "COMPLETED"),
    [normalizedClips],
  );
  const fallbackClipCount = useMemo(
    () => normalizedClips.filter((clip) => clip.status !== "REJECTED" && isDeterministicFallbackClip(clip)).length,
    [normalizedClips],
  );

  const availableCategories = useMemo(
    () =>
      Array.from(
        new Set(
          normalizedClips
            .map((clip) => clip.qualityClipCategory ?? clip.smartClipCategory)
            .filter((value): value is string => Boolean(value)),
        ),
      ),
    [normalizedClips],
  );

  const visibleClips = useMemo(() => {
    const filtered = filterClips(normalizedClips, filter).filter((clip) => {
      if (categoryFilter === "ALL") {
        return true;
      }

      return (clip.qualityClipCategory ?? clip.smartClipCategory) === categoryFilter;
    });
    return sortClips(filtered, sort);
  }, [normalizedClips, filter, categoryFilter, sort]);
  const isFeedLimited = !showFullFeed && visibleClips.length > REVIEW_INITIAL_VISIBLE_COUNT;
  const renderedClips = isFeedLimited ? visibleClips.slice(0, REVIEW_INITIAL_VISIBLE_COUNT) : visibleClips;
  const filterSummary = [
    filter === "ALL" ? "All clips" : filter.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()),
    categoryFilter === "ALL" ? "All categories" : getQualityCategoryLabel(categoryFilter),
    sort === "HIGHEST_SCORE"
      ? "Best first"
      : sort.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
  ].join(" / ");

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 981px)");
    const syncFilterDisclosure = () => setFiltersOpen(mediaQuery.matches);

    syncFilterDisclosure();
    mediaQuery.addEventListener("change", syncFilterDisclosure);
    return () => mediaQuery.removeEventListener("change", syncFilterDisclosure);
  }, []);

  function setStatusMessage(success: boolean, value: string) {
    setMessageSuccess(success);
    setMessage(value);
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      if (current.includes(id)) {
        return current.filter((item) => item !== id);
      }
      return [...current, id];
    });
  }

  function applySingleAction(action: () => Promise<{ success: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      setStatusMessage(result.success, result.message);
      router.refresh();
    });
  }

  function runBatch(action: ClipReviewBatchAction) {
    startTransition(async () => {
      const result = await runClipBatchReviewAction({
        sermonId,
        clipIds: selected,
        action,
      });

      setStatusMessage(result.success, result.message);
      if (result.success) {
        setSelected([]);
      }
      router.refresh();
    });
  }

  function runQualityRefreshJob(force = false) {
    startTransition(async () => {
      const result = await startSermonClipQualityRefreshJobAction({ sermonId, force });
      setStatusMessage(result.success, result.message);
      router.refresh();
    });
  }

  function curateReviewFeed() {
    const confirmed = window.confirm(
      `Refine ${summary.pending} undecided moment${summary.pending === 1 ? "" : "s"}? Weaker suggestions may move to Not selected, and you can restore them later.`,
    );
    if (!confirmed) {
      return;
    }

    startTransition(async () => {
      const result = await curateSermonAiSuggestionsAction({ sermonId });
      setStatusMessage(result.success, result.message);
      router.refresh();
    });
  }

  function hasManualFraming(clip: Pick<ClipReviewItem, "manualCropKeyframes" | "manualCropUpdatedAt">): boolean {
    return (
      Array.isArray(clip.manualCropKeyframes) &&
      clip.manualCropKeyframes.length > 0 &&
      Boolean(clip.manualCropUpdatedAt)
    );
  }

  function saveDraft(clipId: string) {
    const draft = drafts[clipId];
    if (!draft) {
      return;
    }

    applySingleAction(async () => {
      const result = await updateClipReviewContentAction({
        clipId,
        title: draft.title,
        hook: draft.hook,
        caption: draft.caption,
        hashtags: draft.hashtags,
        clipNotes: draft.clipNotes,
      });

      return {
        success: result.success,
        message: result.message,
      };
    });
  }

  function updateDraft(clipId: string, value: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [clipId]: {
        ...(current[clipId] ?? { title: "", hook: "", caption: "", hashtags: "", clipNotes: "" }),
        ...value,
      },
    }));
  }

  return (
    <main className="container review-feed-shell premium-review-shell stack-md">
      <header className="review-feed-topbar premium-review-header card stack-sm">
        <div className="review-feed-topbar-row">
          <div>
            <p className="kicker">Pastor review</p>
            <h1>{sermonTitle}</h1>
            <p className="muted premium-review-intro">
              Watch the moment, verify the message in context, then approve it, edit it, or leave it out.
            </p>
          </div>
          <div className="review-feed-topbar-actions">
            {hasPostReadyClip ? (
              <Link href={`/ready-to-post?sermonId=${sermonId}`} className="button secondary">
                Publishing desk
              </Link>
            ) : null}
            <details className="review-topbar-more">
              <summary>Review tools</summary>
              <div className="review-topbar-more-menu">
                <button
                  type="button"
                  className="button secondary"
                  disabled={isPending}
                  onClick={() => runQualityRefreshJob(false)}
                >
                  Check readiness
                </button>
                <button
                  type="button"
                  className="button tertiary"
                  disabled={isPending}
                  onClick={() => runQualityRefreshJob(true)}
                >
                  Recheck all
                </button>
                <button
                  type="button"
                  className="button tertiary"
                  disabled={isPending}
                  onClick={curateReviewFeed}
                >
                  Refine suggestions
                </button>
              </div>
            </details>
          </div>
        </div>

        <ol className="premium-review-journey" aria-label="Sermon clip workflow">
          <li className="is-complete"><span>1</span><strong>Analyze</strong></li>
          <li className="is-current" aria-current="step"><span>2</span><strong>Pastor review</strong></li>
          <li><span>3</span><strong>Edit &amp; brand</strong></li>
          <li><span>4</span><strong>Prepare post</strong></li>
        </ol>

        <div className="premium-review-progress">
          <div className="premium-review-progress-copy">
            <strong>{summary.pending > 0 ? `${summary.pending} moment${summary.pending === 1 ? "" : "s"} awaiting a decision` : "Review complete"}</strong>
            <span>{decidedCount} of {summary.total} reviewed</span>
          </div>
          <div
            className="premium-review-progress-track"
            role="progressbar"
            aria-label="Clip review progress"
            aria-valuemin={0}
            aria-valuemax={Math.max(summary.total, 1)}
            aria-valuenow={decidedCount}
          >
            <span style={{ width: `${decisionProgress}%` }} />
          </div>
          <details className="premium-review-overview">
            <summary>Queue details</summary>
            <dl>
              <div><dt>Total moments</dt><dd>{summary.total}</dd></div>
              <div><dt>Approved</dt><dd>{summary.approved}</dd></div>
              <div><dt>Waiting</dt><dd>{summary.pending}</dd></div>
              <div><dt>Not selected</dt><dd>{summary.rejected}</dd></div>
              <div><dt>Preview ready</dt><dd>{summary.rendered}</dd></div>
              {fallbackClipCount > 0 ? <div><dt>Fallback suggestions</dt><dd>{fallbackClipCount}</dd></div> : null}
            </dl>
          </details>
        </div>
      </header>

      {reviewIsComplete ? (
        <section className="premium-review-complete" aria-labelledby="review-complete-title">
          <div className="stack-sm">
            <p className="kicker">Review complete</p>
            <h2 id="review-complete-title">
              {strongestApprovedClip
                ? "Your approved moments are ready for Clip Studio."
                : hasPostReadyClip
                  ? "Your reviewed clips are ready at the publishing desk."
                  : "You have reviewed every suggested moment."}
            </h2>
            <p className="muted">
              {strongestApprovedClip
                ? "Start with the strongest approved clip, then shape its captions, framing, and church branding."
                : hasPostReadyClip
                  ? "Open the publishing desk to prepare platform copy, download the finished files, or schedule the next post."
                  : "No clips are approved right now. You can return to the sermon to find more moments or reconsider one from this queue."}
            </p>
          </div>
          <div className="premium-review-complete-actions">
            {strongestApprovedClip ? (
              <Link href={`/sermons/${sermonId}/clips/${strongestApprovedClip.id}/studio`} className="button primary">
                Continue to Clip Studio
              </Link>
            ) : hasPostReadyClip ? (
              <Link href={`/ready-to-post?sermonId=${sermonId}`} className="button primary">
                Open publishing desk
              </Link>
            ) : (
              <Link href={`/sermons/${sermonId}`} className="button primary">
                Find more moments
              </Link>
            )}
            {strongestApprovedClip || hasPostReadyClip ? (
              <Link href={`/sermons/${sermonId}`} className="button tertiary">Back to sermon</Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="card review-feed-toolbar premium-review-toolbar stack-sm">
        <div className="review-feed-toolbar-row">
          <details
            className="review-filter-disclosure"
            open={filtersOpen}
            onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
          >
            <summary>
              <span>Filter clips</span>
              <span className="muted small">{filterSummary}</span>
            </summary>
            <div className="review-feed-filter-row">
              <label className="stack-sm review-feed-toolbar-field">
                Status
                <select value={filter} onChange={(event) => setFilter(event.target.value as ReviewFilter)} disabled={isPending}>
                  <option value="ALL">All clips</option>
                  <option value="PENDING">Awaiting decision</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Not selected</option>
                  <option value="RENDERED">Preview ready</option>
                  <option value="NOT_RENDERED">Preview pending</option>
                </select>
              </label>

              <label className="stack-sm review-feed-toolbar-field">
                Category
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} disabled={isPending}>
                  <option value="ALL">All Categories</option>
                  {availableCategories.map((category) => (
                    <option key={category} value={category}>
                      {getQualityCategoryLabel(category)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="stack-sm review-feed-toolbar-field">
                Sort
                <select value={sort} onChange={(event) => setSort(event.target.value as ReviewSort)} disabled={isPending}>
                  <option value="HIGHEST_SCORE">Best first</option>
                  <option value="NEWEST">Newest</option>
                  <option value="SHORTEST">Shortest duration</option>
                  <option value="LONGEST">Longest duration</option>
                </select>
              </label>
            </div>
          </details>

          <div className="review-feed-toolbar-actions">
            <p className="small muted">Selected: {selected.length}</p>
            <details className="review-batch-more">
              <summary>Batch actions</summary>
              <div className="review-batch-more-menu">
                <button
                  type="button"
                  className="button primary"
                  disabled={isPending || selected.length === 0}
                  onClick={() => runBatch("approve")}
                >
                  Approve selected
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={isPending || selected.length === 0}
                  onClick={() => runBatch("reject")}
                >
                  Mark as not selected
                </button>
                <button
                  type="button"
                  className="button tertiary"
                  disabled={isPending || selected.length === 0}
                  onClick={() => runBatch("render")}
                >
                  Create previews
                </button>
                <button
                  type="button"
                  className="button tertiary"
                  disabled={isPending || selected.length === 0}
                  onClick={() => runBatch("export")}
                >
                  Prepare downloads
                </button>
              </div>
            </details>
            <div className="review-view-toggle" role="group" aria-label="Review view mode">
              <button
                type="button"
                className={viewMode === "GRID" ? "review-view-btn review-view-btn-active" : "review-view-btn"}
                onClick={() => setViewMode("GRID")}
                disabled={isPending}
              >
                Grid
              </button>
              <button
                type="button"
                className={viewMode === "LIST" ? "review-view-btn review-view-btn-active" : "review-view-btn"}
                onClick={() => setViewMode("LIST")}
                disabled={isPending}
              >
                List
              </button>
            </div>
          </div>
        </div>
      </section>

      {message ? (
        <p className={messageSuccess ? "success-banner" : "error-banner"} role="status" aria-live="polite">
          {messageSuccess ? message : `${message} Next step: open the clip card status and retry the failed step.`}
        </p>
      ) : null}

      {isPending ? (
        <p className="status-help">Saving your changes. This view will update when they are ready.</p>
      ) : null}

      <section className={viewMode === "GRID" ? "review-feed-grid" : "review-feed-list"}>
        {visibleClips.length === 0 ? (
          <article className="card premium-review-empty">
            <p className="kicker">Nothing to review here</p>
            <h2>No moments match these filters</h2>
            <p className="muted">Clear the filters to return to the full review, or open the sermon if you need to find more moments.</p>
            <div className="actions-row">
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  setFilter("ALL");
                  setCategoryFilter("ALL");
                  setSort("HIGHEST_SCORE");
                }}
              >
                Show all moments
              </button>
              <Link href={`/sermons/${sermonId}`} className="button tertiary">Open sermon</Link>
            </div>
          </article>
        ) : (
          <>
          {renderedClips.map((clip, index) => {
            const draft = drafts[clip.id] ?? toDraft(clip);
            const warnings = buildClipWarnings(clip).filter((warning) => !warning.toLowerCase().includes("invalid option"));
            const qualityView = buildClipQualityView(clip, index);
            const qualitySignals = [
              { key: "opening", dimension: "Opening", ...qualityView.openingStrength },
              { key: "message", dimension: "Clarity", ...qualityView.messageClarity },
              { key: "ministry", dimension: "Ministry impact", ...qualityView.ministryImpact },
              { key: "resonance", dimension: "Resonance", ...qualityView.emotionalResonance },
              { key: "context", dimension: "Context", ...qualityView.contextSafety },
              { key: "complete", dimension: "Completeness", ...qualityView.completeness },
              { key: "social", dimension: "Social fit", ...qualityView.socialFit },
            ];
            const clipCategory = toPastorFriendlyCategory(
              getQualityCategoryLabel(clip.qualityClipCategory ?? clip.smartClipCategory),
            );
            const actionTone = qualityView.actionTone;
            const workflowLabel =
              clip.status === "EXPORTED" || clip.exportStatus === "COMPLETED"
                ? "Prepared"
                : clip.status === "APPROVED"
                  ? "Approved"
                  : clip.status === "REJECTED"
                    ? "Not selected"
                    : "Awaiting decision";
            const insight = toPastorFriendlyInsight(
              clip.reasonSelected ??
              clip.pastorFriendlyReason ??
              clip.qualitySummary ??
              clip.recommendationReason ??
              "This moment is ready for a quick pastor review.",
            );
            const canApprove = clip.status !== "EXPORTED" && clip.transcriptSafetyStatus !== "REVIEW_REQUIRED";
            const canReject = clip.status !== "EXPORTED";
            const canSetPending = clip.status !== "EXPORTED";
            const canRender =
              clip.status !== "REJECTED" &&
              clip.renderStatus !== "RENDERING" &&
              clip.renderStatus !== "COMPLETED";
            const canGenerateCaptions =
              clip.transcriptSafetyStatus !== "REVIEW_REQUIRED" &&
              (clip.status === "APPROVED" || clip.status === "EXPORTED") &&
              clip.captionStatus !== "GENERATING";
            const canBurnCaptions =
              clip.transcriptSafetyStatus !== "REVIEW_REQUIRED" &&
              clip.renderStatus === "COMPLETED" &&
              clip.captionStatus === "GENERATED" &&
              clip.captionBurnStatus !== "BURNING" &&
              clip.captionBurnStatus !== "COMPLETED";
            const canGenerateOverlay =
              (clip.status === "APPROVED" || clip.status === "EXPORTED") &&
              clip.renderStatus === "COMPLETED" &&
              clip.overlayStatus !== "RENDERING" &&
              clip.overlayStatus !== "COMPLETED";
            const canExport =
              clip.transcriptSafetyStatus !== "REVIEW_REQUIRED" &&
              clip.renderStatus === "COMPLETED" &&
              clip.exportStatus !== "EXPORTING" &&
              clip.exportStatus !== "COMPLETED";
            const isSmartCrop = clip.exportLayoutStrategy === "SMART_CROP";
            const manualFramingApplied = hasManualFraming(clip);
            const isFallbackClip = isDeterministicFallbackClip(clip);
            const transcriptReviewRequired = clip.transcriptSafetyStatus === "REVIEW_REQUIRED";
            const transcriptReviewed = clip.transcriptSafetyStatus === "REVIEWED";
            const transcriptGuidance = buildTranscriptReviewGuidance({
              transcriptSafetyReasons: clip.transcriptSafetyReasons,
              evidence: clip.transcriptEvidence,
              boundaryQuality: clip.boundaryQuality,
            });
            const previewRequestFailed = failedPreviewClipIds.includes(clip.id);
            const canPreviewVideo = clip.canPreviewVideo && !previewRequestFailed;
            const isApprovedState = clip.status === "APPROVED" || clip.status === "EXPORTED";
            const isPostReady = clip.status === "EXPORTED" || clip.exportStatus === "COMPLETED";
            const contextLabel = clip.riskLevel !== "LOW" || clip.contextWarning
              ? `${clip.riskLevel.toLowerCase()} context risk`
              : clip.boundaryQuality === "GOOD"
                ? "Context intact"
                : "Check the clip boundaries";

            return (
              <article
                key={clip.id}
                id={`clip-${clip.id}`}
                className={`card review-feed-card premium-review-card review-feed-card-${clip.status.toLowerCase()} quality-tone-${actionTone}`}
              >
                <div className="review-feed-card-layout">
                  <div className="review-feed-video-column stack-sm">
                    <label className="review-checkbox-row premium-review-select">
                      <input
                        type="checkbox"
                        checked={selected.includes(clip.id)}
                        onChange={() => toggleSelected(clip.id)}
                        disabled={isPending}
                      />
                      <span>Select</span>
                    </label>

                    <div className="review-feed-video-frame">
                      <span className="review-feed-duration-pill">{toDurationLabel(clip.durationSeconds)}</span>
                      {canPreviewVideo ? (
                        <video
                          className="review-video"
                          controls
                          playsInline
                          preload="none"
                          aria-label={`Preview ${clip.title}`}
                          poster={`/api/clips/${clip.id}/thumbnail`}
                          src={`/api/clips/${clip.id}/preview?variant=best`}
                          onError={() => {
                            setFailedPreviewClipIds((current) =>
                              current.includes(clip.id) ? current : [...current, clip.id],
                            );
                          }}
                        />
                      ) : (
                        <div className="review-video empty-video-state" role="status">
                          <span>
                            {previewRequestFailed
                              ? "This preview could not be opened. Your clip is still safe."
                              : localMediaAvailable
                                ? "Preview media not ready yet"
                                : "Preview on Mac app"}
                          </span>
                          {previewRequestFailed ? (
                            <button
                              type="button"
                              className="button secondary"
                              onClick={() => {
                                setFailedPreviewClipIds((current) => current.filter((id) => id !== clip.id));
                              }}
                            >
                              Try preview again
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="review-feed-content-column stack-sm">
                    <div className="premium-review-card-heading">
                      <p className="kicker">{clipCategory} · {toDurationLabel(clip.durationSeconds)}</p>
                      <h3>{clip.title}</h3>
                      {draft.hook.trim() ? <p className="premium-review-hook">&ldquo;{draft.hook}&rdquo;</p> : null}
                    </div>
                    <div className="clip-badge-row premium-review-primary-status">
                      <span className={`status-pill review-workflow-status status-${clip.status.toLowerCase()}`}>
                        {workflowLabel}
                      </span>
                      {transcriptReviewRequired ? <span className="status-pill quality-needs-editing">Transcript review needed</span> : null}
                    </div>

                    <div className="premium-review-rationale">
                      <span>Why this moment</span>
                      <p>{insight}</p>
                    </div>

                    <div className={`premium-review-evidence ${transcriptReviewRequired ? "needs-review" : ""}`}>
                      <div className="premium-review-evidence-heading">
                        <span>Exact words</span>
                        <small>{contextLabel}</small>
                      </div>
                      <blockquote>&ldquo;{clip.transcriptText}&rdquo;</blockquote>
                      <p>
                        <strong>Context:</strong>{" "}
                        {clip.boundaryAdjustmentReason
                          ? clip.boundaryAdjustmentReason
                          : clip.boundaryQuality === "GOOD"
                            ? "The opening and ending form a complete thought from the sermon."
                            : "Listen to the opening and ending before approving this excerpt."}
                      </p>
                    </div>

                    {transcriptReviewRequired ? (
                      <div className="warning-banner stack-sm premium-review-safety-gate">
                        <strong>{transcriptGuidance.title}</strong>
                        <p>{transcriptGuidance.summary}</p>
                        {clip.transcriptEvidence?.uncertainRegions.length ? (
                          <div className="stack-sm">
                            <strong className="small">Listen closely here</strong>
                            <ul className="warning-list">
                              {clip.transcriptEvidence.uncertainRegions.slice(0, 3).map((region) => (
                                <li key={`${region.startTimeSeconds}-${region.endTimeSeconds}`}>
                                  {toDurationLabel(region.startTimeSeconds)}–{toDurationLabel(region.endTimeSeconds)}: {region.text}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {transcriptGuidance.reasonLabels.length ? (
                          <details>
                            <summary>Why this check is required</summary>
                            <ul className="warning-list">
                              {transcriptGuidance.reasonLabels.map((reason) => <li key={reason}>{reason}</li>)}
                            </ul>
                          </details>
                        ) : null}
                        <button
                          type="button"
                          className="button secondary"
                          disabled={isPending}
                          onClick={() => applySingleAction(() => markClipTranscriptReviewedAction(clip.id))}
                        >
                          {transcriptGuidance.actionLabel}
                        </button>
                      </div>
                    ) : null}

                    <details className="review-feed-card-details">
                      <summary>Scores &amp; recommendation</summary>
                      <div className="stack-sm">
                        <div
                          className="review-feed-quality-strip review-feed-quality-strip-compact"
                          aria-label={`Quality signals for ${clip.title}`}
                        >
                          <div className={`review-feed-quality-score quality-action-${actionTone}`}>
                            <span>{qualityView.scoreSourceLabel}</span>
                            <strong>{qualityView.scoreLabel}</strong>
                          </div>
                        </div>
                        <div className="premium-review-rationale">
                          <span>{qualityView.freshness.label}</span>
                          <p>{qualityView.freshness.detail}</p>
                        </div>
                        <div className="review-feed-meta-row small muted">
                          <span>{clipCategory}</span>
                          <span>{toDurationLabel(clip.durationSeconds)} duration</span>
                          <span>{clip.intendedAudience ?? "General audience"}</span>
                          <span>{toFriendlyStatus(clip.exportStatus)}</span>
                          <span>{toClipStatusLabel(clip.status)}</span>
                          {transcriptReviewed ? <span>Transcript reviewed</span> : null}
                          {isFallbackClip ? <span>Fallback suggestion</span> : null}
                        </div>

                        {isFallbackClip ? (
                          <p className="status-help small">
                            Automatic ranking used the sermon transcript when the full AI review was unavailable. Check the message and boundaries before approving.
                          </p>
                        ) : null}

                        <div className="review-feed-signal-list">
                          {qualitySignals.map((signal) => (
                            <span key={signal.key} className={`review-feed-signal quality-metric-${signal.tone}`}>
                              <small>{signal.dimension}</small>
                              <strong>{signal.label}</strong>
                              <em>{signal.scoreLabel === "-" ? "Not assessed" : `${signal.scoreLabel}/10`}</em>
                            </span>
                          ))}
                        </div>

                        <div className="premium-review-rationale">
                          <span>{qualityView.platformFit.assessed ? `Best channel · ${qualityView.platformFit.label}` : "Channel fit not assessed"}</span>
                          <p>{qualityView.platformFit.reason}</p>
                        </div>
                        <p className="status-help small"><strong>Recommended next check:</strong> {qualityView.nextStep}</p>

                        {clip.boundaryAdjustmentReason ? (
                          <p className="status-help small"><strong>Boundary guidance:</strong> {clip.boundaryAdjustmentReason}</p>
                        ) : null}
                        {typeof clip.suggestedStartTimeSeconds === "number" || typeof clip.suggestedEndTimeSeconds === "number" ? (
                          <p className="status-help small">
                            <strong>Suggested timing:</strong>{" "}
                            {typeof clip.suggestedStartTimeSeconds === "number" ? toDurationLabel(clip.suggestedStartTimeSeconds) : "current start"}
                            {" – "}
                            {typeof clip.suggestedEndTimeSeconds === "number" ? toDurationLabel(clip.suggestedEndTimeSeconds) : "current end"}
                          </p>
                        ) : null}

                        {clip.postReadyBlockers.length > 0 ? (
                          <p className="status-help small">
                            Needs a quick check: {clip.postReadyBlockers.slice(0, 2).join(" ")}
                          </p>
                        ) : null}

                        {warnings.length > 0 ? (
                          <ul className="warning-list">
                            {warnings.slice(0, 3).map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </details>
                  </div>

                  <div className="review-feed-action-column" aria-label={`Review actions for ${clip.title}`}>
                    <div className="review-feed-action-stack">
                      {isApprovedState ? (
                        <span className="review-approved-status status-pill status-approved">Approved</span>
                      ) : clip.status === "REJECTED" ? (
                        <span className="review-approved-status status-pill status-rejected">Not selected</span>
                      ) : (
                        <button
                          type="button"
                          className="button primary review-action-primary"
                          disabled={isPending || !canApprove}
                          onClick={() => applySingleAction(() => setClipReviewStatusAction(clip.id, "APPROVED"))}
                        >
                          Approve
                        </button>
                      )}
                      {isApprovedState && isPostReady ? (
                        <Link href={`/ready-to-post?sermonId=${sermonId}`} className="button primary review-action-primary">
                          Prepare post
                        </Link>
                      ) : (
                        <Link
                          href={`/sermons/${sermonId}/clips/${clip.id}/studio`}
                          className={isApprovedState ? "button primary review-action-primary" : "button secondary review-action-edit"}
                        >
                          {isApprovedState ? "Finish in Studio" : "Edit"}
                        </Link>
                      )}
                      {clip.status === "SUGGESTED" ? (
                        <button
                          type="button"
                          className="button tertiary review-action-decline"
                          disabled={isPending || !canReject}
                          onClick={() => applySingleAction(() => setClipReviewStatusAction(clip.id, "REJECTED"))}
                        >
                          Not this clip
                        </button>
                      ) : null}
                    </div>

                    <p className="premium-review-action-note">
                      {clip.status === "REJECTED"
                        ? "This moment is out of the active queue. You can return it to review from More actions."
                        : transcriptReviewRequired
                          ? "Check the transcript wording before approving this moment."
                        : isApprovedState
                          ? isPostReady
                            ? "The final video is ready for its posting plan."
                            : "Fine-tune captions, framing, and church branding."
                          : "Make one clear decision, then move to the next moment."}
                    </p>

                    <details className="review-card-more-actions">
                      <summary>More actions</summary>
                      <div className="review-feed-action-stack review-feed-action-stack-secondary">
                        {clip.status === "APPROVED" ? (
                          <button
                            type="button"
                            className="button secondary review-action-secondary"
                            disabled={isPending || !canReject}
                            onClick={() => applySingleAction(() => setClipReviewStatusAction(clip.id, "REJECTED"))}
                          >
                            Mark as not selected
                          </button>
                        ) : null}
                        {clip.status !== "SUGGESTED" && clip.status !== "EXPORTED" ? (
                          <button
                            type="button"
                            className="button tertiary review-action-secondary"
                            disabled={isPending || !canSetPending}
                            onClick={() => applySingleAction(() => setClipReviewStatusAction(clip.id, "SUGGESTED"))}
                          >
                            Move back to review
                          </button>
                        ) : null}
                        {clip.exportStatus === "COMPLETED" || clip.status === "EXPORTED" ? (
                          <Link href={`/ready-to-post?sermonId=${sermonId}`} className="button secondary review-action-secondary">
                            Open post queue
                          </Link>
                        ) : null}
                        {isApprovedState && isPostReady ? (
                          <Link href={`/sermons/${sermonId}/clips/${clip.id}/studio`} className="button tertiary review-action-secondary">
                            Edit clip
                          </Link>
                        ) : null}
                      </div>
                    </details>
                  </div>
                </div>

                <details className="review-feed-details stack-sm">
                  <summary>Advanced text &amp; production tools</summary>

                  <div className="review-edit-grid">
                    <label className="stack-sm">
                      Title
                      <input
                        value={draft.title}
                        disabled={isPending}
                        onChange={(event) => updateDraft(clip.id, { title: event.target.value })}
                      />
                    </label>
                    <label className="stack-sm">
                      Post opener
                      <input
                        value={draft.hook}
                        disabled={isPending}
                        onChange={(event) => updateDraft(clip.id, { hook: event.target.value })}
                      />
                      {clip.suggestedHook?.trim() && clip.suggestedHook.trim() !== draft.hook.trim() ? (
                        <button
                          type="button"
                          className="button tertiary"
                          onClick={() => updateDraft(clip.id, { hook: clip.suggestedHook?.trim() ?? draft.hook })}
                          disabled={isPending}
                        >
                          Compare: {clip.suggestedHook}
                        </button>
                      ) : null}
                    </label>
                    <label className="stack-sm">
                      Post caption
                      <textarea
                        value={draft.caption}
                        disabled={isPending}
                        onChange={(event) => updateDraft(clip.id, { caption: event.target.value })}
                      />
                      {clip.suggestedCaption?.trim() && clip.suggestedCaption.trim() !== draft.caption.trim() ? (
                        <button
                          type="button"
                          className="button tertiary"
                          onClick={() => updateDraft(clip.id, { caption: clip.suggestedCaption?.trim() ?? draft.caption })}
                          disabled={isPending}
                        >
                          Use suggested caption
                        </button>
                      ) : null}
                    </label>
                    <label className="stack-sm">
                      Hashtags
                      <input
                        value={draft.hashtags}
                        disabled={isPending}
                        onChange={(event) => updateDraft(clip.id, { hashtags: event.target.value })}
                      />
                    </label>
                    <label className="stack-sm">
                      Review Notes
                      <textarea
                        value={draft.clipNotes}
                        disabled={isPending}
                        onChange={(event) => updateDraft(clip.id, { clipNotes: event.target.value })}
                      />
                    </label>
                  </div>

                  <p className="small muted">
                    Preview: {toFriendlyStatus(clip.renderStatus)} | Captions: {toFriendlyStatus(clip.captionStatus)} |
                    Captions on video: {toFriendlyStatus(clip.captionBurnStatus)} | Branding: {toFriendlyStatus(clip.overlayStatus)}
                  </p>

                  <div className="review-secondary-actions">
                    <button type="button" className="button secondary" disabled={isPending} onClick={() => saveDraft(clip.id)}>
                      Save text
                    </button>
                    <button
                      type="button"
                      className="button tertiary"
                      disabled={isPending || !canRender}
                      onClick={() => applySingleAction(() => renderClipCandidateAction(clip.id))}
                    >
                      Create preview
                    </button>
                    <button
                      type="button"
                      className="button tertiary"
                      disabled={isPending || !canGenerateCaptions}
                      onClick={() => applySingleAction(() => generateSubtitlesForClipAction(clip.id))}
                    >
                      Create captions
                    </button>
                    <button
                      type="button"
                      className="button tertiary"
                      disabled={isPending || !canBurnCaptions}
                      onClick={() => applySingleAction(() => burnSubtitlesForClipAction(clip.id))}
                    >
                      Add captions to video
                    </button>
                    <button
                      type="button"
                      className="button tertiary"
                      disabled={isPending || !canGenerateOverlay}
                      onClick={() => applySingleAction(() => renderClipOverlayAction(clip.id))}
                    >
                      Add church branding
                    </button>
                    <button
                      type="button"
                      className="button tertiary"
                      disabled={isPending}
                      onClick={() => applySingleAction(() => rerenderClipCandidateAction(clip.id))}
                    >
                      Update preview
                    </button>
                    <button
                      type="button"
                      className="button tertiary"
                      disabled={isPending || !canExport}
                      onClick={() => applySingleAction(() => exportVerticalClipAction(clip.id))}
                    >
                      Prepare download
                    </button>
                  </div>

                  {isSmartCrop ? (
                    <div className="review-secondary-actions">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={isPending}
                        onClick={() =>
                          applySingleAction(() => saveManualCropCorrectionAction({ clipId: clip.id, nudge: "left" }))
                        }
                      >
                        Frame left
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={isPending}
                        onClick={() =>
                          applySingleAction(() => saveManualCropCorrectionAction({ clipId: clip.id, direction: "center" }))
                        }
                      >
                        Center pastor
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={isPending}
                        onClick={() =>
                          applySingleAction(() => saveManualCropCorrectionAction({ clipId: clip.id, nudge: "right" }))
                        }
                      >
                        Frame right
                      </button>
                      <button
                        type="button"
                        className="button tertiary"
                        disabled={isPending || !manualFramingApplied}
                        onClick={() => applySingleAction(() => resetManualCropCorrectionAction(clip.id))}
                      >
                        Reset framing
                      </button>
                      <button
                        type="button"
                        className="button tertiary"
                        disabled={isPending}
                        onClick={() => applySingleAction(() => generateSmartCropDebugSnapshotAction(clip.id))}
                      >
                        Framing details
                      </button>
                    </div>
                  ) : null}

                  {clip.smartCropDebugGeneratedAt ? (
                    <p className="small muted">
                      Debug snapshot generated {new Date(clip.smartCropDebugGeneratedAt).toLocaleString()}.
                    </p>
                  ) : null}
                  {clip.smartCropDebugError ? <p className="status-help">{clip.smartCropDebugError}</p> : null}
                </details>
              </article>
            );
          })
          }
          {visibleClips.length > REVIEW_INITIAL_VISIBLE_COUNT ? (
            <article className="card review-feed-more-panel">
              <div>
                <strong>
                  {isFeedLimited
                    ? `Showing strongest ${REVIEW_INITIAL_VISIBLE_COUNT} of ${visibleClips.length} clips`
                    : `Showing all ${visibleClips.length} clips`}
                </strong>
                <p className="muted small">
                  The full review queue stays available; start with the strongest options, then expand for more sermon moments.
                </p>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowFullFeed((current) => !current)}
                disabled={isPending}
              >
                {isFeedLimited ? `Show all ${visibleClips.length}` : `Show strongest ${REVIEW_INITIAL_VISIBLE_COUNT}`}
              </button>
            </article>
          ) : null}
          </>
        )}
      </section>
    </main>
  );
}
