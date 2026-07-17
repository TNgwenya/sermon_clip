"use client";

import Image from "next/image";
import Link from "next/link";
import type { SyntheticEvent } from "react";
import { useEffect, useRef, useState } from "react";

type HomeTopClipCardProps = {
  clipId: string;
  href: string;
  title: string;
  sermonTitle: string;
  statusLabel: string;
  statusTone: string;
  scoreLabel: string;
  durationLabel: string;
  timecodeLabel: string;
  clipTypeLabel: string;
  platformLabel: string | null;
  hookLine: string | null;
  canPreviewVideo: boolean;
  priority?: boolean;
};

const PREVIEW_LOOP_SECONDS = 5;

function supportsHoverPreview(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function HomeTopClipCard({
  clipId,
  href,
  title,
  sermonTitle,
  statusLabel,
  statusTone,
  scoreLabel,
  durationLabel,
  timecodeLabel,
  clipTypeLabel,
  platformLabel,
  hookLine,
  canPreviewVideo,
  priority = false,
}: HomeTopClipCardProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [shouldLoadPreview, setShouldLoadPreview] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const previewEnabled = canPreviewVideo && shouldLoadPreview && !previewFailed;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isHovering || !previewEnabled) {
      return;
    }

    video.currentTime = 0;
    const playPromise = video.play();
    if (playPromise) {
      playPromise.catch(() => setPreviewFailed(true));
    }
  }, [isHovering, previewEnabled]);

  function startPreview() {
    if (!canPreviewVideo || !supportsHoverPreview()) {
      return;
    }

    setShouldLoadPreview(true);
    setIsHovering(true);
  }

  function stopPreview() {
    setIsHovering(false);
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.pause();
    video.currentTime = 0;
  }

  function handlePreviewTimeUpdate(event: SyntheticEvent<HTMLVideoElement>) {
    if (event.currentTarget.currentTime < PREVIEW_LOOP_SECONDS) {
      return;
    }

    event.currentTarget.currentTime = 0;
    event.currentTarget.play().catch(() => setPreviewFailed(true));
  }

  return (
    <Link
      href={href}
      className={`dashboard-clip-card home-top-clip-card${canPreviewVideo ? " has-preview" : ""}`}
      onPointerEnter={startPreview}
      onFocus={startPreview}
      onPointerLeave={stopPreview}
      onBlur={stopPreview}
    >
      <div className="dashboard-clip-poster">
        <Image
          src={`/api/clips/${clipId}/thumbnail`}
          alt=""
          fill
          sizes="(max-width: 760px) 100vw, (max-width: 1100px) 50vw, 25vw"
          priority={priority}
          unoptimized
        />
        {previewEnabled ? (
          <video
            ref={videoRef}
            className="dashboard-clip-preview"
            src={`/api/clips/${clipId}/preview?variant=best`}
            muted
            playsInline
            preload="none"
            onError={() => setPreviewFailed(true)}
            onTimeUpdate={handlePreviewTimeUpdate}
          />
        ) : null}
        <span className="clip-preview-affordance" aria-hidden="true">
          <svg viewBox="0 0 20 20" focusable="false">
            <path d="m8 6 6 4-6 4V6Z" fill="currentColor" />
          </svg>
        </span>
        <div className="clip-card-topline">
          <span className={`status-pill ${statusTone}`}>{statusLabel}</span>
          <span className="clip-duration-pill">{durationLabel}</span>
        </div>
        <div className="clip-card-poster-footer">
          <span>{timecodeLabel}</span>
          <strong className="clip-quality-score">
            <small>Quality</small>
            {scoreLabel}<span aria-hidden="true">/10</span>
          </strong>
        </div>
      </div>
      <div className="stack-sm">
        <div className="clip-badge-row">
          <span className="status-pill clip-type-pill">{clipTypeLabel}</span>
          {platformLabel ? <span className="status-pill clip-platform-pill">{platformLabel}</span> : null}
        </div>
        <h3>{title}</h3>
        {hookLine ? <p className="clip-hook-line">{hookLine}</p> : null}
        <p className="muted small">{sermonTitle}</p>
        <span className="clip-card-action" aria-hidden="true">
          Review clip
          <svg viewBox="0 0 20 20" focusable="false">
            <path d="M4 10h11M11 6l4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
          </svg>
        </span>
      </div>
    </Link>
  );
}
