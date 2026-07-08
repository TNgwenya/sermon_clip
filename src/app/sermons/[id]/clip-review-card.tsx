"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  approveClipCandidateAction,
  burnSubtitlesForClipAction,
  exportVerticalClipAction,
  generateSubtitlesForClipAction,
  markClipTranscriptReviewedAction,
  reburnSubtitlesForClipAction,
  reexportVerticalClipAction,
  regenerateClipOutdatedAssetsAction,
  renderClipCandidateAction,
  rerenderClipCandidateAction,
  rejectClipCandidateAction,
  renderClipOverlayAction,
  rerenderClipOverlayAction,
  updateClipCandidateAction,
  updateClipFramingAction,
  type UpdateClipCandidateState,
} from "@/server/actions/sermons";
import {
  FRAMING_PRESET_DESCRIPTIONS,
  FRAMING_PRESET_LABELS,
  SELECTABLE_FRAMING_PRESETS,
  resolveFramingPreset,
  type FramingPreset,
} from "@/lib/clipFraming";
import { pastorFriendlyError } from "@/lib/pastorFriendlyErrors";

type ClipStatus = "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
type BoundaryQuality = "GOOD" | "NEEDS_REVIEW" | "BAD";
type ClipRenderStatus = "NOT_RENDERED" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
type CaptionStatus = "NOT_GENERATED" | "GENERATING" | "GENERATED" | "FAILED";
type CaptionBurnStatus = "NOT_BURNED" | "BURNING" | "COMPLETED" | "FAILED";
type ClipOverlayStatus = "NOT_RENDERED" | "RENDERING" | "COMPLETED" | "FAILED";
type ClipExportStatus = "NOT_EXPORTED" | "QUEUED" | "EXPORTING" | "COMPLETED" | "FAILED";
type ClipExportFormat = "VERTICAL_9_16" | "HORIZONTAL_16_9" | "SQUARE_1_1";
type ClipExportLayoutStrategy = "CENTER_CROP" | "LEFT_FOCUS" | "RIGHT_FOCUS" | "FIT_BLURRED_BACKGROUND" | "SMART_CROP";
type AssetFreshness = "UP_TO_DATE" | "OUTDATED" | "NEEDS_REGENERATION" | "FAILED";
type ClipQualityLabel = "POST_READY" | "GOOD_NEEDS_REVIEW" | "NEEDS_EDITING" | "REJECT";
type ClipTranscriptSafetyStatus = "TRUSTED" | "REVIEW_REQUIRED" | "REVIEWED";

type ClipReviewCardProps = {
  clip: {
    id: string;
    startTimeSeconds: number;
    endTimeSeconds: number;
    durationSeconds: number;
    originalStartTimeSeconds: number | null;
    originalEndTimeSeconds: number | null;
    adjustedStartTimeSeconds: number | null;
    adjustedEndTimeSeconds: number | null;
    boundaryAdjustmentReason: string | null;
    boundaryQuality: BoundaryQuality;
    renderStatus: ClipRenderStatus;
    renderedAt: Date | null;
    renderError: string | null;
    renderedFilePath: string | null;
    renderedDurationSeconds: number | null;
    renderedSizeBytes: number | null;
    exportFormat: ClipExportFormat | null;
    exportStatus: ClipExportStatus;
    exportLayoutStrategy: ClipExportLayoutStrategy | null;
    exportedAt: Date | null;
    exportError: string | null;
    exportedFilePath: string | null;
    transcriptText: string;
    transcriptSafetyStatus: ClipTranscriptSafetyStatus;
    transcriptSafetyReasons?: string[];
    transcriptSafetyReviewedAt?: Date | null;
    title: string;
    hook: string;
    caption: string;
    suggestedHook?: string | null;
    suggestedCaption?: string | null;
    hashtags: string[];
    score: number;
    finalQualityScore?: number | null;
    qualityLabel?: ClipQualityLabel | null;
    qualityReasons?: string[];
    qualityWarnings?: string[];
    rawAiCandidate?: unknown;
    qualityDebugSnapshot?: unknown;
    rankingCategory?: string | null;
    hookScore?: number | null;
    arcCompletenessScore?: number | null;
    visualConfidenceScore?: number | null;
    audioQualityScore?: number | null;
    captionQualityScore?: number | null;
    bestPlatform?: string | null;
    postReadyStatus?: ClipQualityLabel | null;
    postReadyReasons?: string[];
    postReadyBlockers?: string[];
    recommendedNextAction?: string | null;
    videoSubjectTracks?: Array<{
      kind: string;
      confidenceScore: number;
      sampleCount: number;
      boxesJson: unknown;
    }>;
    reasonSelected: string;
    clipType: string;
    smartClipCategory?: string | null;
    recommendationReason?: string | null;
    intendedAudience?: string | null;
    ministryValue?: string | null;
    socialValue?: string | null;
    riskLevel: RiskLevel;
    riskReasons: string[];
    contextWarning: boolean;
    status: ClipStatus;
    exportPath?: string | null;
    srtPath?: string | null;
    subtitlesGenerated?: boolean;
    subtitlesBurned?: boolean;
    captionStatus?: CaptionStatus;
    subtitleFilePath?: string | null;
    captionGeneratedAt?: Date | null;
    captionGenerationError?: string | null;
    captionBurnStatus?: CaptionBurnStatus;
    captionedVideoPath?: string | null;
    captionBurnedAt?: Date | null;
    captionBurnError?: string | null;
    overlayStatus?: ClipOverlayStatus;
    overlayVideoPath?: string | null;
    overlayRenderedAt?: Date | null;
    overlayRenderError?: string | null;
    renderFreshness: AssetFreshness;
    captionFreshness: AssetFreshness;
    captionBurnFreshness: AssetFreshness;
    overlayFreshness: AssetFreshness;
    exportFreshness: AssetFreshness;
    renderAssetVersion: number;
    captionAssetVersion: number;
    captionBurnAssetVersion: number;
    overlayAssetVersion: number;
    exportAssetVersion: number;
    assetInvalidationReason?: string | null;
  };
};

type EditFormValues = {
  title: string;
  hook: string;
  caption: string;
  hashtagsText: string;
  startTimeSeconds: string;
  endTimeSeconds: string;
};

const emptyUpdateState: UpdateClipCandidateState = {
  success: false,
  message: "",
};

function toEditFormValues(clip: ClipReviewCardProps["clip"]): EditFormValues {
  return {
    title: clip.title,
    hook: clip.hook,
    caption: clip.caption,
    hashtagsText: clip.hashtags.join(", "),
    startTimeSeconds: String(clip.startTimeSeconds),
    endTimeSeconds: String(clip.endTimeSeconds),
  };
}

/**
 * A simple CSS diagram showing where the source video is positioned in the
 * 9:16 vertical frame for the given framing preset.
 * The outer box is the vertical frame; the inner shaded bar is the source video.
 */
function FramingPreview({ preset }: { preset: FramingPreset }) {
  const outerStyle: React.CSSProperties = {
    position: "relative",
    width: 36,
    height: 64,
    border: "2px solid currentColor",
    borderRadius: 3,
    overflow: "hidden",
    flexShrink: 0,
    background: "#1a1a1a",
  };

  // The source (landscape) video strip is wider than the frame and shorter.
  // Width ~160% of outer, height ~40% of outer, representing a 16:9 clip.
  const stripWidth = 58; // px, wider than the 36px frame to show it overflows
  const stripHeight = 25;

  let leftOffset = (36 - stripWidth) / 2; // center by default

  if (preset === "LEFT_FOCUS") {
    leftOffset = 0; // left edge of source aligns with left edge of frame
  } else if (preset === "RIGHT_FOCUS") {
    leftOffset = 36 - stripWidth; // right edge aligns
  }

  const stripStyle: React.CSSProperties = {
    position: "absolute",
    width: stripWidth,
    height: stripHeight,
    top: (64 - stripHeight) / 2,
    left: leftOffset,
    background: preset === "FIT_BLURRED_BACKGROUND" ? "rgba(100,160,220,0.5)" : "rgba(100,160,220,0.85)",
    borderRadius: 2,
  };

  const blurOverlayStyle: React.CSSProperties =
    preset === "FIT_BLURRED_BACKGROUND"
      ? {
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(80,120,180,0.3) 0%, rgba(80,120,180,0.4) 100%)",
          backdropFilter: "blur(2px)",
        }
      : {};

  // Fit-with-blur: the visible strip is smaller (fits within the frame).
  const fitStripStyle: React.CSSProperties =
    preset === "FIT_BLURRED_BACKGROUND"
      ? {
          position: "absolute",
          width: 32,
          height: 18,
          top: (64 - 18) / 2,
          left: (36 - 32) / 2,
          background: "rgba(100,160,220,0.95)",
          borderRadius: 2,
          border: "1px solid rgba(255,255,255,0.4)",
        }
      : {};

  return (
    <span style={outerStyle} aria-hidden="true">
      {preset === "FIT_BLURRED_BACKGROUND" ? (
        <>
          <span style={blurOverlayStyle} />
          <span style={fitStripStyle} />
        </>
      ) : (
        <span style={stripStyle} />
      )}
    </span>
  );
}

function toFreshnessLabel(value: AssetFreshness): string {
  if (value === "UP_TO_DATE") return "Up To Date";
  if (value === "OUTDATED") return "Outdated";
  if (value === "FAILED") return "Failed";
  return "Needs Regeneration";
}

function toQualityLabel(value: ClipQualityLabel | null | undefined): string {
  if (value === "POST_READY") return "Post-ready";
  if (value === "GOOD_NEEDS_REVIEW") return "Good, review first";
  if (value === "NEEDS_EDITING") return "Needs editing";
  if (value === "REJECT") return "Rejected by quality check";
  return "Needs quality review";
}

function isDeterministicFallbackClip(
  clip: Pick<ClipReviewCardProps["clip"], "qualityWarnings" | "reasonSelected">,
): boolean {
  return (
    (clip.qualityWarnings ?? []).includes("FALLBACK_REVIEW") ||
    (clip.qualityWarnings ?? []).includes("AI_REVIEW_FAILED") ||
    /deterministic fallback|AI clip selection was unavailable/i.test(clip.reasonSelected)
  );
}

function toRankingLabel(value: string | null | undefined): string {
  if (!value) return "Needs review";
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ClipReviewCard({ clip }: ClipReviewCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionSuccess, setActionSuccess] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateClipCandidateState>(emptyUpdateState);
  const [formValues, setFormValues] = useState<EditFormValues>(() => toEditFormValues(clip));
  const [selectedFraming, setSelectedFraming] = useState<FramingPreset>(
    resolveFramingPreset(clip.exportLayoutStrategy),
  );

  const isExported = clip.status === "EXPORTED";
  const isFallbackClip = isDeterministicFallbackClip(clip);

  const cardClassName = useMemo(() => {
    const base = ["candidate-card", "stack-sm"];

    if (clip.status === "APPROVED") {
      base.push("candidate-approved");
    }

    if (clip.status === "REJECTED") {
      base.push("candidate-rejected");
    }

    if (clip.riskLevel === "HIGH") {
      base.push("candidate-high-risk");
    }

    return base.join(" ");
  }, [clip.riskLevel, clip.status]);

  function runAction(action: () => Promise<{ success: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      setActionMessage(result.message);
      setActionSuccess(result.success);
      if (result.success) {
        setIsEditing(false);
        setUpdateState(emptyUpdateState);
        router.refresh();
      }
    });
  }

  function onApprove() {
    runAction(() => approveClipCandidateAction(clip.id));
  }

  function onReject() {
    runAction(() => rejectClipCandidateAction(clip.id));
  }

  function onMarkTranscriptReviewed() {
    runAction(() => markClipTranscriptReviewedAction(clip.id));
  }

  function onEditStart() {
    if (isExported) {
      setActionMessage("Ready-to-post clips are locked. Open Clip Studio and prepare a new version if you need changes.");
      setActionSuccess(false);
      return;
    }

    setActionMessage("");
    setActionSuccess(false);
    setUpdateState(emptyUpdateState);
    setFormValues(toEditFormValues(clip));
    setIsEditing(true);
  }

  function onRender() {
    runAction(() => renderClipCandidateAction(clip.id));
  }

  function onRerender() {
    runAction(() => rerenderClipCandidateAction(clip.id));
  }

  function onExportVertical() {
    runAction(() => exportVerticalClipAction(clip.id));
  }

  function onReexportVertical() {
    runAction(() => reexportVerticalClipAction(clip.id));
  }

  function onRegenerateCaptions() {
    runAction(() => generateSubtitlesForClipAction(clip.id));
  }

  function onBurnCaptions() {
    runAction(() => burnSubtitlesForClipAction(clip.id));
  }

  function onReburnCaptions() {
    runAction(() => reburnSubtitlesForClipAction(clip.id));
  }

  function onRegenerateOutdatedAssets() {
    runAction(() => regenerateClipOutdatedAssetsAction(clip.id));
  }

  function onRenderOverlay() {
    runAction(() => renderClipOverlayAction(clip.id));
  }

  function onRerenderOverlay() {
    runAction(() => rerenderClipOverlayAction(clip.id));
  }

  function onFramingChange(preset: FramingPreset) {
    if (isExported) {
      setActionMessage("Ready-to-post clips are locked. Open Clip Studio and prepare a new version if you need changes.");
      setActionSuccess(false);
      return;
    }

    setSelectedFraming(preset);
    startTransition(async () => {
      const result = await updateClipFramingAction(clip.id, preset);
      setActionMessage(result.message);
      setActionSuccess(result.success);
      if (result.success) {
        router.refresh();
      }
    });
  }

  function onCancelEdit() {
    setIsEditing(false);
    setUpdateState(emptyUpdateState);
    setFormValues(toEditFormValues(clip));
  }

  function onSubmitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const startTimeSeconds = Number(formValues.startTimeSeconds);
    const endTimeSeconds = Number(formValues.endTimeSeconds);

    startTransition(async () => {
      const result = await updateClipCandidateAction({
        clipId: clip.id,
        title: formValues.title,
        hook: formValues.hook,
        caption: formValues.caption,
        hashtags: formValues.hashtagsText,
        startTimeSeconds,
        endTimeSeconds,
      });

      setUpdateState(result);
      setActionMessage(result.message);
      setActionSuccess(result.success);

      if (result.success) {
        setIsEditing(false);
        router.refresh();
      }
    });
  }

  const statusBadgeClass = `status-pill status-${clip.status.toLowerCase()}`;
  const qualityLabel = clip.qualityLabel ?? clip.postReadyStatus ?? null;
  const qualityBadgeClass = `status-pill quality-${(qualityLabel ?? "needs_review").toLowerCase().replace(/_/g, "-")}`;
  const riskBadgeClass = `status-pill risk-${clip.riskLevel.toLowerCase()}`;
  const boundaryQualityClass = `status-pill boundary-${clip.boundaryQuality.toLowerCase().replace("_", "-")}`;
  const renderStatusClass = `status-pill render-${clip.renderStatus.toLowerCase().replace("_", "-")}`;
  const exportStatusClass = `status-pill export-${clip.exportStatus.toLowerCase().replace("_", "-")}`;
  const captionStatus = clip.captionStatus ?? "NOT_GENERATED";
  const captionStatusClass = `status-pill render-${captionStatus.toLowerCase().replace("_", "-")}`;
  const captionBurnStatus = clip.captionBurnStatus ?? "NOT_BURNED";
  const captionBurnStatusClass = `status-pill render-${captionBurnStatus.toLowerCase().replace("_", "-")}`;
  const overlayStatus = clip.overlayStatus ?? "NOT_RENDERED";
  const overlayStatusClass = `status-pill render-${overlayStatus.toLowerCase().replace(/_/g, "-")}`;
  const renderFreshnessClass = `status-pill freshness-${clip.renderFreshness.toLowerCase().replace(/_/g, "-")}`;
  const captionFreshnessClass = `status-pill freshness-${clip.captionFreshness.toLowerCase().replace(/_/g, "-")}`;
  const captionBurnFreshnessClass = `status-pill freshness-${clip.captionBurnFreshness.toLowerCase().replace(/_/g, "-")}`;
  const overlayFreshnessClass = `status-pill freshness-${clip.overlayFreshness.toLowerCase().replace(/_/g, "-")}`;
  const exportFreshnessClass = `status-pill freshness-${clip.exportFreshness.toLowerCase().replace(/_/g, "-")}`;
  const transcriptReviewRequired = clip.transcriptSafetyStatus === "REVIEW_REQUIRED";
  const transcriptReviewed = clip.transcriptSafetyStatus === "REVIEWED";

  return (
    <article className={cardClassName}>
      <div className="candidate-topline">
        <h3>{clip.title}</h3>
        <div className="clip-badge-row">
          <span className={statusBadgeClass}>{clip.status}</span>
          <span className={qualityBadgeClass}>{toQualityLabel(qualityLabel)}</span>
          {transcriptReviewRequired ? <span className="status-pill quality-needs-editing">Transcript review needed</span> : null}
          {transcriptReviewed ? <span className="status-pill quality-good-needs-review">Transcript reviewed</span> : null}
          {clip.renderStatus === "COMPLETED" ? <span className="status-pill">Rendered preview available</span> : null}
          <span className={riskBadgeClass}>{clip.riskLevel} RISK</span>
          {clip.smartClipCategory ? <span className="status-pill">{clip.smartClipCategory}</span> : null}
        </div>
      </div>

      {!isEditing ? (
        <div className="stack-sm">
          {transcriptReviewRequired ? (
            <div className="warning-banner stack-sm">
              <p>
                <strong>Review the words before captions or export.</strong> This clip may include local-language wording the transcript misunderstood. Watch the moment and check the transcript before creating captions or a final post.
              </p>
              {clip.transcriptSafetyReasons && clip.transcriptSafetyReasons.length > 0 ? (
                <p className="muted small">Reason: {clip.transcriptSafetyReasons.map((reason) => reason.replace(/_/g, " ").toLowerCase()).join(", ")}</p>
              ) : null}
              <button
                type="button"
                className="button secondary"
                onClick={onMarkTranscriptReviewed}
                disabled={isPending}
              >
                I reviewed the transcript
              </button>
            </div>
          ) : null}
          {transcriptReviewed ? (
            <p className="status-help">
              Transcript reviewed{clip.transcriptSafetyReviewedAt ? ` on ${new Date(clip.transcriptSafetyReviewedAt).toLocaleString()}` : ""}.
            </p>
          ) : null}
          <p>
            <strong>Hook:</strong> {clip.hook}
          </p>
          <p>
            <strong>Timing:</strong> {clip.startTimeSeconds.toFixed(1)}s - {clip.endTimeSeconds.toFixed(1)}s ({clip.durationSeconds.toFixed(1)}s)
          </p>
          <p>
            <strong>Original AI Timing:</strong>{" "}
            {clip.originalStartTimeSeconds !== null && clip.originalEndTimeSeconds !== null
              ? `${clip.originalStartTimeSeconds.toFixed(1)}s - ${clip.originalEndTimeSeconds.toFixed(1)}s`
              : "Not recorded"}
          </p>
          <p>
            <strong>Adjusted Timing:</strong>{" "}
            {clip.adjustedStartTimeSeconds !== null && clip.adjustedEndTimeSeconds !== null
              ? `${clip.adjustedStartTimeSeconds.toFixed(1)}s - ${clip.adjustedEndTimeSeconds.toFixed(1)}s`
              : `${clip.startTimeSeconds.toFixed(1)}s - ${clip.endTimeSeconds.toFixed(1)}s`}
          </p>
          <p>
            <strong>Boundary Quality:</strong> <span className={boundaryQualityClass}>{clip.boundaryQuality}</span>
          </p>
          <p>
            <strong>Boundary Adjustment Reason:</strong> {clip.boundaryAdjustmentReason ?? "No boundary adjustment note."}
          </p>
          <p>
            <strong>Render Status:</strong> <span className={renderStatusClass}>{clip.renderStatus}</span>
          </p>
          <p>
            <strong>Render Freshness:</strong> <span className={renderFreshnessClass}>{toFreshnessLabel(clip.renderFreshness)}</span> (v{clip.renderAssetVersion})
          </p>
          <p>
            <strong>Rendered At:</strong> {clip.renderedAt ? new Date(clip.renderedAt).toLocaleString() : "Not rendered yet"}
          </p>
          <p>
            <strong>Render File:</strong> {clip.renderedFilePath ?? "No rendered file yet"}
          </p>
          <p>
            <strong>Rendered Duration:</strong> {clip.renderedDurationSeconds !== null ? `${clip.renderedDurationSeconds.toFixed(1)}s` : "-"}
          </p>
          <p>
            <strong>Render Size:</strong> {clip.renderedSizeBytes !== null ? `${clip.renderedSizeBytes} bytes` : "-"}
          </p>
          {clip.renderError ? (
            <div className="error-banner stack-sm">
              <p><strong>Render Error:</strong> {pastorFriendlyError(clip.renderError)}</p>
              <details className="small">
                <summary>Technical details</summary>
                <p>{clip.renderError}</p>
              </details>
            </div>
          ) : null}
          <p>
            <strong>Export Status:</strong> <span className={exportStatusClass}>{clip.exportStatus}</span>
          </p>
          <p>
            <strong>Export Freshness:</strong> <span className={exportFreshnessClass}>{toFreshnessLabel(clip.exportFreshness)}</span> (v{clip.exportAssetVersion})
          </p>
          <p>
            <strong>Export Format:</strong> {clip.exportFormat ?? "Not exported"}
          </p>
          <p>
            <strong>Export Layout:</strong> {clip.exportLayoutStrategy ?? "-"}
          </p>
          <p>
            <strong>Exported At:</strong> {clip.exportedAt ? new Date(clip.exportedAt).toLocaleString() : "Not exported yet"}
          </p>
          <p>
            <strong>Export File:</strong> {clip.exportedFilePath ?? "No export file yet"}
          </p>
          {clip.exportedFilePath && clip.exportFormat === "VERTICAL_9_16" ? (
            <p>
              <a className="text-link" href={`/api/clips/${clip.id}/download?variant=vertical`}>
                Download Vertical Export
              </a>
            </p>
          ) : null}
          {clip.exportError ? (
            <div className="error-banner stack-sm">
              <p><strong>Export Error:</strong> {pastorFriendlyError(clip.exportError)}</p>
              <details className="small">
                <summary>Technical details</summary>
                <p>{clip.exportError}</p>
              </details>
            </div>
          ) : null}
          <p>
            <strong>Score:</strong> {clip.score} / 10
          </p>
          <div className="quality-review-panel stack-sm">
            {isFallbackClip ? (
              <p className="status-help">
                <strong>AI quota fallback:</strong> This clip was selected by deterministic sermon-window ranking because AI clip selection was unavailable. Review the moment and boundaries before approving.
              </p>
            ) : null}
            <div className="quality-score-row">
              <p>
                <strong>Quality Score:</strong>{" "}
                {clip.finalQualityScore !== null && clip.finalQualityScore !== undefined
                  ? `${clip.finalQualityScore.toFixed(1)} / 10`
                  : "Not scored yet"}
              </p>
              <p>
                <strong>Quality Label:</strong> <span className={qualityBadgeClass}>{toQualityLabel(qualityLabel)}</span>
              </p>
              <p>
                <strong>Ranking:</strong> {toRankingLabel(clip.rankingCategory)}
              </p>
            </div>
            <p>
              <strong>Best Platform:</strong> {clip.bestPlatform ?? "Review with media team"}
            </p>
            <p>
              <strong>Suggested Title:</strong> {clip.title}
            </p>
            <p>
              <strong>Suggested Caption:</strong> {clip.suggestedCaption ?? clip.caption}
            </p>
            <p>
              <strong>What Makes It Valuable:</strong> {clip.ministryValue ?? clip.reasonSelected}
            </p>
            <p>
              <strong>Why Selected:</strong> {clip.recommendationReason ?? clip.reasonSelected}
            </p>
            <p>
              <strong>May Need Review:</strong>{" "}
              {clip.postReadyBlockers && clip.postReadyBlockers.length > 0
                ? clip.postReadyBlockers.join(" ")
                : clip.qualityWarnings && clip.qualityWarnings.length > 0
                  ? clip.qualityWarnings.join(", ")
                  : "No major quality warnings."}
            </p>
            <p>
              <strong>Recommended Next Action:</strong> {clip.recommendedNextAction?.replace(/_/g, " ") ?? "Review"}
            </p>
            <div className="quality-metrics-grid">
              <span className="quality-metric">
                <small>Hook</small>
                <strong>{clip.hookScore?.toFixed(1) ?? "-"}</strong>
              </span>
              <span className="quality-metric">
                <small>Arc</small>
                <strong>{clip.arcCompletenessScore?.toFixed(1) ?? "-"}</strong>
              </span>
              <span className="quality-metric">
                <small>Visual</small>
                <strong>{clip.visualConfidenceScore?.toFixed(1) ?? "-"}</strong>
              </span>
              <span className="quality-metric">
                <small>Audio</small>
                <strong>{clip.audioQualityScore?.toFixed(1) ?? "-"}</strong>
              </span>
              <span className="quality-metric">
                <small>Captions</small>
                <strong>{clip.captionQualityScore?.toFixed(1) ?? "-"}</strong>
              </span>
            </div>
            {clip.qualityReasons && clip.qualityReasons.length > 0 ? (
              <details className="small">
                <summary>Quality reasons</summary>
                <ul>
                  {clip.qualityReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <details className="small">
              <summary>Internal quality debug</summary>
              <div className="stack-sm">
                <p>
                  <strong>Tracking Confidence Timeline:</strong>{" "}
                  {clip.videoSubjectTracks && clip.videoSubjectTracks.length > 0
                    ? clip.videoSubjectTracks
                        .map((track) => `${track.kind}: ${(track.confidenceScore * 100).toFixed(0)}% / ${track.sampleCount} samples`)
                        .join("; ")
                    : "No tracking timeline recorded yet."}
                </p>
                <p>
                  <strong>Caption Quality Issues:</strong>{" "}
                  {clip.qualityWarnings?.filter((warning) => warning.startsWith("CAPTION")).join(", ") || "No caption-specific warnings recorded."}
                </p>
                <p>
                  <strong>Downgrade Reason:</strong>{" "}
                  {clip.postReadyBlockers && clip.postReadyBlockers.length > 0
                    ? clip.postReadyBlockers.join(" ")
                    : clip.recommendedNextAction?.replace(/_/g, " ") ?? "No downgrade reason recorded."}
                </p>
                <pre className="debug-json">
                  {JSON.stringify(
                    {
                      rawAiCandidate: clip.rawAiCandidate,
                      qualityDebugSnapshot: clip.qualityDebugSnapshot,
                      tracking: clip.videoSubjectTracks,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
            </details>
          </div>
          {clip.recommendationReason ? (
            <p>
              <strong>Why Recommended:</strong> {clip.recommendationReason}
            </p>
          ) : null}
          {clip.intendedAudience ? (
            <p>
              <strong>Intended Audience:</strong> {clip.intendedAudience}
            </p>
          ) : null}
          {clip.ministryValue ? (
            <p>
              <strong>Ministry Value:</strong> {clip.ministryValue}
            </p>
          ) : null}
          {clip.socialValue ? (
            <p>
              <strong>Social Value:</strong> {clip.socialValue}
            </p>
          ) : null}
          {clip.suggestedHook ? (
            <p>
              <strong>Suggested Hook:</strong> {clip.suggestedHook}
            </p>
          ) : null}
          {clip.suggestedCaption ? (
            <p>
              <strong>Suggested Caption:</strong> {clip.suggestedCaption}
            </p>
          ) : null}
          <p>
            <strong>Transcript Excerpt:</strong> {clip.transcriptText}
          </p>
          <p>
            <strong>Caption:</strong> {clip.caption}
          </p>
          <p>
            <strong>Hashtags:</strong> {clip.hashtags.join(" ") || "None"}
          </p>
          <p>
            <strong>Reason Selected:</strong> {clip.reasonSelected}
          </p>
          <p>
            <strong>Clip Type:</strong> {clip.clipType}
          </p>
          <p>
            <strong>Risk Reasons:</strong> {clip.riskReasons.length > 0 ? clip.riskReasons.join(", ") : "None"}
          </p>
          <p className={clip.contextWarning ? "context-warning" : "muted"}>
            <strong>Context Warning:</strong>{" "}
            {clip.contextWarning ? "This clip may require context before posting." : "No context warning."}
          </p>
          {clip.status === "EXPORTED" && clip.exportPath ? (
            <p>
              <strong>Export Path:</strong> {clip.exportPath}
            </p>
          ) : null}
          <p>
            <strong>Caption Status:</strong> <span className={captionStatusClass}>{captionStatus}</span>
          </p>
          <p>
            <strong>Caption Freshness:</strong> <span className={captionFreshnessClass}>{toFreshnessLabel(clip.captionFreshness)}</span> (v{clip.captionAssetVersion})
          </p>
          <p>
            <strong>Caption Generated At:</strong> {clip.captionGeneratedAt ? new Date(clip.captionGeneratedAt).toLocaleString() : "Not generated yet"}
          </p>
          <p>
            <strong>Subtitles Generated:</strong> {clip.subtitlesGenerated ? "Yes" : "No"}
          </p>
          {clip.subtitleFilePath || clip.srtPath ? (
            <p>
              <strong>SRT Path:</strong> {clip.subtitleFilePath ?? clip.srtPath}
            </p>
          ) : null}
          {clip.captionGenerationError ? (
            <div className="error-banner stack-sm">
              <p><strong>Caption Error:</strong> {pastorFriendlyError(clip.captionGenerationError)}</p>
              <details className="small">
                <summary>Technical details</summary>
                <p>{clip.captionGenerationError}</p>
              </details>
            </div>
          ) : null}
          <p>
            <strong>Caption Burn Status:</strong> <span className={captionBurnStatusClass}>{captionBurnStatus}</span>
          </p>
          <p>
            <strong>Caption Burn Freshness:</strong> <span className={captionBurnFreshnessClass}>{toFreshnessLabel(clip.captionBurnFreshness)}</span> (v{clip.captionBurnAssetVersion})
          </p>
          <p>
            <strong>Caption Burned At:</strong> {clip.captionBurnedAt ? new Date(clip.captionBurnedAt).toLocaleString() : "Not burned yet"}
          </p>
          <p>
            <strong>Captioned Video Path:</strong> {clip.captionedVideoPath ?? "No captioned video yet"}
          </p>
          {clip.captionBurnError ? (
            <div className="error-banner stack-sm">
              <p><strong>Caption Burn Error:</strong> {pastorFriendlyError(clip.captionBurnError)}</p>
              <details className="small">
                <summary>Technical details</summary>
                <p>{clip.captionBurnError}</p>
              </details>
            </div>
          ) : null}

          <div className="stack-sm">
            <p>
              <strong>Overlay Status:</strong> <span className={overlayStatusClass}>{overlayStatus}</span>
            </p>
            <p>
              <strong>Overlay Freshness:</strong> <span className={overlayFreshnessClass}>{toFreshnessLabel(clip.overlayFreshness)}</span> (v{clip.overlayAssetVersion})
            </p>
            <p>
              <strong>Overlay Rendered At:</strong>{" "}
              {clip.overlayRenderedAt ? new Date(clip.overlayRenderedAt).toLocaleString() : "Not rendered yet"}
            </p>
            <p>
              <strong>Overlay Path:</strong> {clip.overlayVideoPath ?? "No overlay video yet"}
            </p>
            {clip.overlayRenderError ? (
              <div className="error-banner stack-sm">
                <p><strong>Overlay Error:</strong> {pastorFriendlyError(clip.overlayRenderError)}</p>
                <details className="small">
                  <summary>Technical details</summary>
                  <p>{clip.overlayRenderError}</p>
                </details>
              </div>
            ) : null}
            {clip.assetInvalidationReason ? (
              <p className="muted small">
                <strong>Change Impact:</strong> {clip.assetInvalidationReason}
              </p>
            ) : null}
          </div>

          <div className="stack-sm">
            <p>
              <strong>Framing:</strong>{" "}
              <span className={`status-pill framing-${selectedFraming.toLowerCase().replace(/_/g, "-")}`}>
                {FRAMING_PRESET_LABELS[selectedFraming]}
              </span>
            </p>

            <fieldset className="framing-selector" disabled={isPending || isExported}>
              <legend className="framing-selector-legend">Vertical Video Framing</legend>
              <div className="framing-options">
                {SELECTABLE_FRAMING_PRESETS.map((preset) => {
                  const isSelected = selectedFraming === preset;
                  return (
                    <label
                      key={preset}
                      className={`framing-option${isSelected ? " framing-option-selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name={`framing-${clip.id}`}
                        value={preset}
                        checked={isSelected}
                        onChange={() => onFramingChange(preset)}
                        disabled={isPending || isExported}
                        className="framing-radio"
                      />
                      <span className="framing-option-content">
                        <FramingPreview preset={preset} />
                        <span className="framing-option-label">{FRAMING_PRESET_LABELS[preset]}</span>
                        <span className="framing-option-desc">{FRAMING_PRESET_DESCRIPTIONS[preset]}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
        </div>
      ) : (
        <form className="stack-sm" onSubmit={onSubmitEdit}>
          <label className="stack-sm">
            Title
            <input
              type="text"
              value={formValues.title}
              onChange={(event) => setFormValues((current) => ({ ...current, title: event.target.value }))}
              disabled={isPending}
            />
            {updateState.fieldErrors?.title ? <span className="field-error">{updateState.fieldErrors.title}</span> : null}
          </label>

          <label className="stack-sm">
            Hook
            <input
              type="text"
              value={formValues.hook}
              onChange={(event) => setFormValues((current) => ({ ...current, hook: event.target.value }))}
              disabled={isPending}
            />
            {updateState.fieldErrors?.hook ? <span className="field-error">{updateState.fieldErrors.hook}</span> : null}
          </label>

          <label className="stack-sm">
            Caption
            <input
              type="text"
              value={formValues.caption}
              onChange={(event) => setFormValues((current) => ({ ...current, caption: event.target.value }))}
              disabled={isPending}
            />
            {updateState.fieldErrors?.caption ? <span className="field-error">{updateState.fieldErrors.caption}</span> : null}
          </label>

          <label className="stack-sm">
            Hashtags (comma, space, or newline separated)
            <textarea
              className="text-area"
              value={formValues.hashtagsText}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  hashtagsText: event.target.value,
                }))
              }
              disabled={isPending}
            />
            {updateState.fieldErrors?.hashtags ? <span className="field-error">{updateState.fieldErrors.hashtags}</span> : null}
          </label>

          <div className="grid-two">
            <label className="stack-sm">
              Start Time (seconds)
              <input
                type="number"
                min={0}
                step={0.1}
                value={formValues.startTimeSeconds}
                onChange={(event) =>
                  setFormValues((current) => ({
                    ...current,
                    startTimeSeconds: event.target.value,
                  }))
                }
                disabled={isPending}
              />
              {updateState.fieldErrors?.startTimeSeconds ? (
                <span className="field-error">{updateState.fieldErrors.startTimeSeconds}</span>
              ) : null}
            </label>

            <label className="stack-sm">
              End Time (seconds)
              <input
                type="number"
                min={0}
                step={0.1}
                value={formValues.endTimeSeconds}
                onChange={(event) =>
                  setFormValues((current) => ({
                    ...current,
                    endTimeSeconds: event.target.value,
                  }))
                }
                disabled={isPending}
              />
              {updateState.fieldErrors?.endTimeSeconds ? (
                <span className="field-error">{updateState.fieldErrors.endTimeSeconds}</span>
              ) : null}
            </label>
          </div>

          <div className="actions-row">
            <button type="submit" className="button" disabled={isPending}>
              {isPending ? "Saving..." : "Save"}
            </button>
            <button type="button" className="button secondary" onClick={onCancelEdit} disabled={isPending}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="actions-row">
        <button type="button" className="button primary" onClick={onApprove} disabled={isPending || isExported}>
          Approve
        </button>
        <button type="button" className="button danger" onClick={onReject} disabled={isPending || isExported}>
          Reject
        </button>
        <button type="button" className="button secondary" onClick={onEditStart} disabled={isPending}>
          Edit
        </button>
        <button
          type="button"
          className="button tertiary"
          onClick={onRender}
          disabled={isPending || clip.status !== "APPROVED" || clip.renderStatus === "RENDERING" || clip.renderStatus === "COMPLETED"}
        >
          {clip.renderStatus === "RENDERING" ? "Rendering..." : "Render"}
        </button>
        <button
          type="button"
          className="button tertiary"
          onClick={onRerender}
          disabled={
            isPending ||
            clip.status === "REJECTED" ||
            clip.renderStatus === "RENDERING" ||
            clip.renderStatus === "NOT_RENDERED"
          }
        >
          {clip.renderStatus === "FAILED" ? "Retry Render" : "Rerender"}
        </button>
        <button
          type="button"
          className="button tertiary"
          onClick={onExportVertical}
          disabled={
            isPending ||
            transcriptReviewRequired ||
            clip.renderStatus !== "COMPLETED" ||
            clip.exportStatus === "EXPORTING" ||
            clip.exportStatus === "COMPLETED"
          }
        >
          {clip.exportStatus === "EXPORTING" ? "Exporting..." : "Export Vertical 9:16"}
        </button>
        <button
          type="button"
          className="button tertiary"
          onClick={onReexportVertical}
          disabled={isPending || transcriptReviewRequired || clip.exportStatus !== "COMPLETED"}
        >
          Re-export Vertical
        </button>
        <button
          type="button"
          className="button tertiary"
          onClick={onRegenerateCaptions}
          disabled={isPending || transcriptReviewRequired || (clip.status !== "APPROVED" && clip.status !== "EXPORTED")}
        >
          Regenerate Captions
        </button>
        <button
          type="button"
          className="button tertiary"
          onClick={onBurnCaptions}
          disabled={
            isPending ||
            transcriptReviewRequired ||
            clip.status !== "APPROVED" ||
            clip.renderStatus !== "COMPLETED" ||
            captionStatus !== "GENERATED" ||
            captionBurnStatus === "BURNING" ||
            captionBurnStatus === "COMPLETED"
          }
        >
          {captionBurnStatus === "BURNING" ? "Burning..." : "Burn Captions"}
        </button>
        <button
          type="button"
          className="button tertiary"
          onClick={onReburnCaptions}
          disabled={isPending || transcriptReviewRequired || clip.renderStatus !== "COMPLETED" || captionStatus !== "GENERATED"}
        >
          Re-burn Captions
        </button>
        <button
          type="button"
          className="button tertiary"
          onClick={onRenderOverlay}
          disabled={
            isPending ||
            clip.renderStatus !== "COMPLETED" ||
            overlayStatus === "RENDERING" ||
            overlayStatus === "COMPLETED"
          }
        >
          {overlayStatus === "RENDERING" ? "Rendering Overlay..." : "Generate Overlay"}
        </button>
        <button
          type="button"
          className="button tertiary"
          onClick={onRerenderOverlay}
          disabled={isPending || clip.renderStatus !== "COMPLETED" || overlayStatus === "RENDERING"}
        >
          Regenerate Overlay
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={onRegenerateOutdatedAssets}
          disabled={isPending}
        >
          Regenerate All Outdated (Clip)
        </button>
      </div>

      {isExported ? <p className="muted small">Ready-to-post clips are locked. Open Clip Studio to prepare a new version.</p> : null}

      {isPending ? <p className="muted small">Operation in progress. Please wait for completion.</p> : null}

      {actionMessage ? (
        <p className={actionSuccess ? "success-banner" : "error-banner"} role="status" aria-live="polite">
          {actionSuccess ? actionMessage : `${actionMessage} Next step: check the status pills above and retry the blocked stage.`}
        </p>
      ) : null}
    </article>
  );
}
