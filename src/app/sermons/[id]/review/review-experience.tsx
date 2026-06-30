"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  burnSubtitlesForClipAction,
  exportVerticalClipAction,
  generateSmartCropDebugSnapshotAction,
  generateSubtitlesForClipAction,
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
  standaloneClarityScore: number | null;
  contextSafetyScore: number | null;
  visualReadinessScore: number | null;
  qualitySummary: string | null;
  pastorFriendlyReason: string | null;
  recommendedAction: ReviewRecommendedAction | null;
  qualityClipCategory: ReviewQualityCategory | null;
  qualityWarnings: string[];
  reasonSelected: string;
  suggestedHook: string | null;
  suggestedCaption: string | null;
  smartClipCategory: string | null;
  recommendationReason: string | null;
  intendedAudience: string | null;
  ministryValue: string | null;
  socialValue: string | null;
  status: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
  riskLevel: ReviewRiskLevel;
  contextWarning: boolean;
  boundaryQuality: "GOOD" | "NEEDS_REVIEW" | "BAD";
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

const REVIEW_INITIAL_VISIBLE_COUNT = 8;

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
    return "Review";
  }

  if (status === "EXPORTED") {
    return "Ready";
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

export function ReviewExperience({ sermonId, sermonTitle, clips, localMediaAvailable }: ReviewExperienceProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<ReviewFilter>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [sort, setSort] = useState<ReviewSort>("HIGHEST_SCORE");
  const [viewMode, setViewMode] = useState<"LIST" | "GRID">("LIST");
  const [showFullFeed, setShowFullFeed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
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
    <main className="container review-feed-shell stack-md">
      <header className="review-feed-topbar card stack-sm">
        <div className="review-feed-topbar-row">
          <div>
            <p className="kicker">Pastor review feed</p>
            <h1>{sermonTitle}</h1>
            <p className="muted">Best clips first, with the sermon moment, AI note, and a simple decision path.</p>
          </div>
          <div className="review-feed-topbar-actions">
            <Link href={`/ready-to-post?sermonId=${sermonId}`} className="button primary">
              Ready to post
            </Link>
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
              Curate feed
            </button>
          </div>
        </div>

        <div className="review-feed-summary-row" role="list" aria-label="Review summary">
          <span className="review-feed-chip" role="listitem">{summary.total} Total</span>
          <span className="review-feed-chip review-feed-chip-approved" role="listitem">{summary.approved} Approved</span>
          <span className="review-feed-chip review-feed-chip-pending" role="listitem">{summary.pending} Pending</span>
          <span className="review-feed-chip review-feed-chip-rejected" role="listitem">{summary.rejected} Rejected</span>
          <span className="review-feed-chip" role="listitem">{summary.rendered} Preview ready</span>
          {fallbackClipCount > 0 ? (
            <span className="review-feed-chip" role="listitem">{fallbackClipCount} AI quota fallback</span>
          ) : null}
        </div>
      </header>

      <section className="card review-feed-toolbar stack-sm">
        <div className="review-feed-toolbar-row">
          <div className="review-feed-filter-row">
            <label className="stack-sm review-feed-toolbar-field">
              Status
              <select value={filter} onChange={(event) => setFilter(event.target.value as ReviewFilter)} disabled={isPending}>
                <option value="ALL">All Clips</option>
                <option value="PENDING">Needs Review</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="RENDERED">Preview Ready</option>
                <option value="NOT_RENDERED">No Preview Yet</option>
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
                  Reject selected
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
        <p className="status-help">Saving changes or running workflow actions. Please wait...</p>
      ) : null}

      <section className={viewMode === "GRID" ? "review-feed-grid" : "review-feed-list"}>
        {visibleClips.length === 0 ? (
          <article className="card">
            <p className="muted">No clips match the selected filter.</p>
            <p className="status-help">Try switching to All Clips, or run Generate Clip Suggestions from sermon detail.</p>
          </article>
        ) : (
          <>
          {renderedClips.map((clip, index) => {
            const draft = drafts[clip.id] ?? toDraft(clip);
            const warnings = buildClipWarnings(clip).filter((warning) => !warning.toLowerCase().includes("invalid option"));
            const qualityView = buildClipQualityView(clip, index);
            const qualitySignals = [
              { key: "message", dimension: "Message", ...qualityView.messageClarity },
              { key: "context", dimension: "Context", ...qualityView.contextSafety },
              { key: "video", dimension: "Video", ...qualityView.visualReadiness },
            ].filter((signal) => signal.scoreLabel !== "-");
            const clipCategory = getQualityCategoryLabel(clip.qualityClipCategory ?? clip.smartClipCategory);
            const actionLabel = clip.status === "REJECTED" ? "Rejected clip" : qualityView.actionLabel;
            const actionTone = clip.status === "REJECTED" ? "weak" : qualityView.actionTone;
            const readinessLabel =
              clip.status === "EXPORTED" || clip.exportStatus === "COMPLETED"
                ? "Ready to post"
                : clip.status === "APPROVED"
                  ? "Approved for prep"
                  : actionLabel;
            const insight =
              clip.pastorFriendlyReason ??
              clip.qualitySummary ??
              clip.recommendationReason ??
              "Clip is ready for a quick pastor review.";
            const canApprove = clip.status !== "EXPORTED";
            const canReject = clip.status !== "EXPORTED";
            const canSetPending = clip.status !== "EXPORTED";
            const canRender =
              clip.status !== "REJECTED" &&
              clip.renderStatus !== "RENDERING" &&
              clip.renderStatus !== "COMPLETED";
            const canGenerateCaptions =
              (clip.status === "APPROVED" || clip.status === "EXPORTED") &&
              clip.captionStatus !== "GENERATING";
            const canBurnCaptions =
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
              clip.renderStatus === "COMPLETED" &&
              clip.exportStatus !== "EXPORTING" &&
              clip.exportStatus !== "COMPLETED";
            const isSmartCrop = clip.exportLayoutStrategy === "SMART_CROP";
            const manualFramingApplied = hasManualFraming(clip);
            const isFallbackClip = isDeterministicFallbackClip(clip);
            const canPreviewVideo = localMediaAvailable || Boolean(clip.remotePreviewUrl);

            return (
              <article
                key={clip.id}
                className={`card review-feed-card review-feed-card-${clip.status.toLowerCase()} quality-tone-${actionTone}`}
              >
                <div className="review-feed-card-layout">
                  <div className="review-feed-video-column stack-sm">
                    <label className="review-checkbox-row">
                      <input
                        type="checkbox"
                        checked={selected.includes(clip.id)}
                        onChange={() => toggleSelected(clip.id)}
                        disabled={isPending}
                      />
                      <span>Select</span>
                    </label>

                    <div className="review-feed-video-frame">
                      <span className="review-feed-score-pill">{qualityView.scoreLabel}</span>
                      <span className="review-feed-duration-pill">{toDurationLabel(clip.durationSeconds)}</span>
                      {canPreviewVideo ? (
                        <video
                          className="review-video"
                          controls
                          playsInline
                          preload="metadata"
                          src={`/api/clips/${clip.id}/preview?variant=best`}
                        />
                      ) : (
                        <div className="review-video empty-video-state">
                          <span>Preview on Mac app</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="review-feed-content-column stack-sm">
                    <h3>{clip.title}</h3>
                    <div className="clip-badge-row">
                      <span className={`status-pill status-${clip.status.toLowerCase()}`}>
                        {toClipStatusLabel(clip.status)}
                      </span>
                      <span className={`status-pill quality-action-${actionTone}`}>
                        {readinessLabel}
                      </span>
                      <span className="status-pill quality-category-pill">{clipCategory}</span>
                      <span className={`status-pill risk-${clip.riskLevel.toLowerCase()}`}>{clip.riskLevel.toLowerCase()} context risk</span>
                      {isFallbackClip ? (
                        <span className="status-pill quality-action-watch">AI quota fallback</span>
                      ) : null}
                    </div>

                    {isFallbackClip ? (
                      <p className="status-help small">
                        AI selection was unavailable, so this clip came from deterministic sermon-window ranking. Review the moment and boundaries before approving.
                      </p>
                    ) : null}

                    <p className="review-feed-insight">{insight}</p>
                    <div
                      className={qualitySignals.length > 0 ? "review-feed-quality-strip" : "review-feed-quality-strip review-feed-quality-strip-compact"}
                      aria-label={`Quality signals for ${clip.title}`}
                    >
                      <div className={`review-feed-quality-score quality-action-${actionTone}`}>
                        <span>{qualityView.scoreSourceLabel}</span>
                        <strong>{qualityView.scoreLabel}</strong>
                      </div>
                      {qualitySignals.length > 0 ? (
                        <div className="review-feed-signal-list">
                          {qualitySignals.map((signal) => (
                            <span key={signal.key} className={`review-feed-signal quality-metric-${signal.tone}`}>
                              <small>{signal.dimension}</small>
                              <strong>{signal.label}</strong>
                              <em>{`${signal.scoreLabel}/10`}</em>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <p className="review-feed-transcript">&quot;{clip.transcriptText}&quot;</p>

                    <div className="review-feed-meta-row small muted">
                      <span>{toDurationLabel(clip.durationSeconds)} duration</span>
                      <span>{clip.intendedAudience ?? "General audience"}</span>
                      <span>{toFriendlyStatus(clip.exportStatus)}</span>
                    </div>

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

                  <div className="review-feed-action-column" aria-label={`Review actions for ${clip.title}`}>
                    <div className="review-feed-action-stack">
                      <button
                        type="button"
                        className="button primary review-action-primary"
                        disabled={isPending || !canApprove}
                        onClick={() => applySingleAction(() => setClipReviewStatusAction(clip.id, "APPROVED"))}
                      >
                        {clip.status === "APPROVED" || clip.status === "EXPORTED" ? "Approved" : "Approve"}
                      </button>
                      <button
                        type="button"
                        className="button secondary review-action-secondary"
                        disabled={isPending || !canReject}
                        onClick={() => applySingleAction(() => setClipReviewStatusAction(clip.id, "REJECTED"))}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="button tertiary review-action-secondary"
                        disabled={isPending || !canSetPending}
                        onClick={() => applySingleAction(() => setClipReviewStatusAction(clip.id, "SUGGESTED"))}
                      >
                        Needs review
                      </button>
                    </div>

                    <div className="review-feed-action-stack review-feed-action-stack-secondary">
                      <Link href={`/sermons/${sermonId}/clips/${clip.id}/studio`} className="button accent review-action-edit">
                        Edit clip
                      </Link>
                      {clip.exportStatus === "COMPLETED" || clip.status === "EXPORTED" ? (
                        <Link href={`/ready-to-post?sermonId=${sermonId}`} className="button secondary review-action-secondary">
                          Open post queue
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>

                <details className="review-feed-details stack-sm">
                  <summary>Text and production tools</summary>

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
                      Hook
                      <input
                        value={draft.hook}
                        disabled={isPending}
                        onChange={(event) => updateDraft(clip.id, { hook: event.target.value })}
                      />
                    </label>
                    <label className="stack-sm">
                      Caption Text
                      <textarea
                        value={draft.caption}
                        disabled={isPending}
                        onChange={(event) => updateDraft(clip.id, { caption: event.target.value })}
                      />
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
                  Keep the first pass focused, then expand when you are ready for the full review queue.
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
