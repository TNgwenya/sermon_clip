"use client";

import Link from "next/link";
import { useRef, useState } from "react";

type SermonDetailPreviewCardProps = {
  sermonId: string;
  clip: {
    id: string;
    title: string;
    startTimeSeconds: number;
    durationSeconds: number;
    status: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
    clipType: string;
    smartClipCategory?: string | null;
    reasonSelected: string;
    ministryValue?: string | null;
    transcriptText: string;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    transcriptSafetyStatus: "TRUSTED" | "REVIEW_REQUIRED" | "REVIEWED";
  };
  localMediaAvailable: boolean;
  canPreviewVideo: boolean;
};

const HOVER_PREVIEW_SECONDS = 5;

function formatTimecode(seconds: number): string {
  const roundedSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatClipType(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toExactWordsExcerpt(value: string, maxLength = 170): string {
  const compactText = value.replace(/\s+/g, " ").trim();
  if (compactText.length <= maxLength) return compactText;

  const wordBoundaryExcerpt = compactText.slice(0, maxLength).replace(/\s+\S*$/, "").trimEnd();
  return `${wordBoundaryExcerpt || compactText.slice(0, maxLength).trimEnd()}…`;
}

function supportsHoverPreview(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function SermonDetailPreviewCard({
  sermonId,
  clip,
  localMediaAvailable,
  canPreviewVideo,
}: SermonDetailPreviewCardProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hoverPreviewRef = useRef(false);
  const [isHoverPreviewing, setIsHoverPreviewing] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const canPreview = canPreviewVideo && !previewFailed;
  const rationale = clip.ministryValue?.trim() || clip.reasonSelected.trim() || "This moment carries a clear, self-contained thought from the sermon.";
  const exactWordsExcerpt = toExactWordsExcerpt(clip.transcriptText);
  const statusLabel = clip.status === "EXPORTED" ? "Ready to publish" : clip.status === "APPROVED" ? "Approved" : "To review";
  const actionLabel = clip.status === "EXPORTED" ? "Publish clip" : clip.status === "APPROVED" ? "Edit clip" : "Review moment";
  const warningLabel = clip.transcriptSafetyStatus === "REVIEW_REQUIRED"
    ? "Check sermon wording"
    : clip.riskLevel === "HIGH"
      ? "Review pastoral context"
      : clip.riskLevel === "MEDIUM"
        ? "Check pastoral context"
        : null;
  const actionHref = clip.status === "EXPORTED"
    ? `/ready-to-post?sermonId=${sermonId}&clipId=${clip.id}`
    : clip.status === "APPROVED"
      ? `/sermons/${sermonId}/clips/${clip.id}/studio`
      : `/sermons/${sermonId}/review#clip-${clip.id}`;

  function stopHoverPreview() {
    if (!hoverPreviewRef.current) return;

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    hoverPreviewRef.current = false;
    setIsHoverPreviewing(false);
  }

  function onPointerEnter() {
    if (!canPreview || !supportsHoverPreview()) return;

    const video = videoRef.current;
    if (!video || !video.paused) return;

    video.currentTime = 0;
    hoverPreviewRef.current = true;
    setIsHoverPreviewing(true);
    void video.play().catch(() => {
      hoverPreviewRef.current = false;
      setIsHoverPreviewing(false);
      setPreviewFailed(true);
    });
  }

  function onTimeUpdate() {
    const video = videoRef.current;
    if (video && hoverPreviewRef.current && video.currentTime >= HOVER_PREVIEW_SECONDS) {
      stopHoverPreview();
    }
  }

  return (
    <article
      className="sermon-preview-card"
      onPointerEnter={onPointerEnter}
      onPointerLeave={stopHoverPreview}
    >
      <div className="video-card-shell sermon-detail-preview-media">
        {canPreview ? (
          <video
            ref={videoRef}
            className={`review-video sermon-detail-hover-preview${isHoverPreviewing ? " is-playing" : ""}`}
            muted
            controls
            playsInline
            preload="metadata"
            poster={`/api/clips/${clip.id}/thumbnail`}
            src={`/api/clips/${clip.id}/preview?variant=best`}
            onTimeUpdate={onTimeUpdate}
            onPointerDown={() => {
              hoverPreviewRef.current = false;
            }}
            onPlay={() => setIsHoverPreviewing(true)}
            onPause={() => setIsHoverPreviewing(false)}
            onEnded={() => setIsHoverPreviewing(false)}
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <div className="review-video empty-video-state">
            <span>{localMediaAvailable ? "Preview is being prepared" : "Open on desktop to preview"}</span>
          </div>
        )}
        <span className="video-quality-pill">{statusLabel}</span>
        <span className="video-duration-pill">{Math.round(clip.durationSeconds)}s</span>
      </div>
      <div className="sermon-preview-card-copy">
        <div className="sermon-preview-meta-row" aria-label="Clip details">
          <span>{formatClipType(clip.smartClipCategory || clip.clipType)}</span>
          <span>{formatTimecode(clip.startTimeSeconds)}</span>
        </div>
        <strong>{clip.title}</strong>
        <div className="premium-review-rationale">
          <span>Why this moment</span>
          <p>{rationale}</p>
        </div>
        {exactWordsExcerpt ? (
          <div className={`premium-review-evidence${warningLabel ? " needs-review" : ""}`}>
            <div className="premium-review-evidence-heading">
              <span>Exact words</span>
              <small>From the sermon</small>
            </div>
            <blockquote>&ldquo;{exactWordsExcerpt}&rdquo;</blockquote>
          </div>
        ) : null}
        <div className="sermon-preview-meta-row">
          {warningLabel ? <span className="status-pill quality-needs-editing">{warningLabel}</span> : null}
          <Link href={actionHref} className="text-link" aria-label={`${actionLabel}: ${clip.title}`}>
            {actionLabel} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </article>
  );
}
