"use client";

import Link from "next/link";
import { useRef, useState } from "react";

type SermonDetailPreviewCardProps = {
  sermonId: string;
  clip: {
    id: string;
    title: string;
    hook: string;
    suggestedHook?: string | null;
    startTimeSeconds: number;
    durationSeconds: number;
    score: number;
    status: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
    clipType: string;
    smartClipCategory?: string | null;
    renderedFilePath: string | null;
    exportedFilePath: string | null;
    captionedVideoPath?: string | null;
    overlayVideoPath?: string | null;
  };
  localMediaAvailable: boolean;
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

function supportsHoverPreview(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function SermonDetailPreviewCard({
  sermonId,
  clip,
  localMediaAvailable,
}: SermonDetailPreviewCardProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isHoverPreviewing, setIsHoverPreviewing] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const hasPreviewMedia = Boolean(
    clip.overlayVideoPath ||
    clip.captionedVideoPath ||
    clip.exportedFilePath ||
    clip.renderedFilePath,
  );
  const canPreview = localMediaAvailable && hasPreviewMedia && !previewFailed;
  const hookLine = clip.suggestedHook?.trim() || clip.hook;
  const actionLabel = clip.status === "EXPORTED" ? "Ready" : clip.status === "APPROVED" ? "Open studio" : "Review";

  function stopPreview() {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setIsHoverPreviewing(false);
  }

  function onPointerEnter() {
    if (!canPreview || !supportsHoverPreview()) return;

    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    setIsHoverPreviewing(true);
    void video.play().catch(() => {
      setIsHoverPreviewing(false);
      setPreviewFailed(true);
    });
  }

  function onTimeUpdate() {
    const video = videoRef.current;
    if (video && video.currentTime >= HOVER_PREVIEW_SECONDS) {
      stopPreview();
    }
  }

  return (
    <Link
      href={`/sermons/${sermonId}/clips/${clip.id}/studio`}
      className="sermon-preview-card"
      onPointerEnter={onPointerEnter}
      onPointerLeave={stopPreview}
      onMouseEnter={onPointerEnter}
      onMouseLeave={stopPreview}
      onBlur={stopPreview}
    >
      <div className="video-card-shell sermon-detail-preview-media">
        {canPreview ? (
          <video
            ref={videoRef}
            className={`review-video sermon-detail-hover-preview${isHoverPreviewing ? " is-playing" : ""}`}
            muted
            playsInline
            preload="none"
            poster={`/api/clips/${clip.id}/thumbnail`}
            src={`/api/clips/${clip.id}/preview?variant=best`}
            onTimeUpdate={onTimeUpdate}
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <div className="review-video empty-video-state">
            <span>{localMediaAvailable ? "Preview media not ready yet" : "Preview on Mac app"}</span>
          </div>
        )}
        <span className="video-quality-pill">{actionLabel}</span>
        <span className="video-duration-pill">{Math.round(clip.durationSeconds)}s</span>
      </div>
      <div className="sermon-preview-card-copy">
        <div className="sermon-preview-meta-row" aria-label="Clip details">
          <span>{formatClipType(clip.smartClipCategory || clip.clipType)}</span>
          <span>{formatTimecode(clip.startTimeSeconds)}</span>
        </div>
        <strong>{clip.title}</strong>
        <p>{hookLine}</p>
        <span className="muted small">AI score {clip.score.toFixed(1)}/10</span>
      </div>
    </Link>
  );
}
