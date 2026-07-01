"use client";

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState, StatusBadge } from "@/components/ui";
import { BRANDING_PRESET_LABELS } from "@/lib/clipBranding";
import { resolveCaptionStylePreset } from "@/lib/captionStylePresets";
import { FORMAT_LABELS, FRAMING_LABELS, PLATFORM_PRESET_LABELS } from "@/lib/clipExportSettings";
import { resolveActiveCaptionCueText, shouldShowHookOverlay } from "@/lib/clipStudioPreviewTimeline";
import { formatSecondsForPastorView } from "@/lib/sermonSegment";
import { ClipStudioDecisionBar } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-decision-bar";
import { useClipStudioPreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";

type ClipStudioLivePreviewProps = {
  clipId: string;
  currentStatus: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
  hasPreview: boolean;
  previewSrc: string | null;
  sourcePreviewSrc: string | null;
  renderLabel: string;
  renderTone: "success" | "danger" | "neutral";
  durationLabel: string;
  timingLabel: string;
  riskLabel: string;
  riskClassName: string;
  unavailableDescription?: string;
};

const formatClassName = {
  VERTICAL_9_16: "format-vertical",
  HORIZONTAL_16_9: "format-horizontal",
  SQUARE_1_1: "format-square",
};

const frameClassName = {
  CENTER_CROP: "frame-center",
  LEFT_FOCUS: "frame-left",
  RIGHT_FOCUS: "frame-right",
  FIT_BLURRED_BACKGROUND: "frame-fit",
  SMART_CROP: "frame-smart",
};

export function ClipStudioLivePreview({
  clipId,
  currentStatus,
  hasPreview,
  previewSrc,
  sourcePreviewSrc,
  renderLabel,
  renderTone,
  durationLabel,
  timingLabel,
  riskLabel,
  riskClassName,
  unavailableDescription,
}: ClipStudioLivePreviewProps) {
  const {
    exportSettings,
    brandingConfig,
    editPreview,
    seekRequest,
    seekPreviewTo,
    churchName,
    sermonTitle,
    preacherName,
    updatePreviewClock,
  } = useClipStudioPreview();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [previewSeconds, setPreviewSeconds] = useState(0);
  const [previewDurationSeconds, setPreviewDurationSeconds] = useState<number | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const brandingEnabled = brandingConfig.enabled && brandingConfig.preset !== "NO_BRANDING";
  const showWatermark = brandingEnabled && (brandingConfig.watermarkEnabled || brandingConfig.preset === "MINIMAL_WATERMARK");
  const showLowerThird =
    brandingEnabled && brandingConfig.lowerThirdEnabled && brandingConfig.preset !== "MINIMAL_WATERMARK";
  const captionStyle = resolveCaptionStylePreset(editPreview.captionStylePresetId);
  const activePreviewSrc = sourcePreviewSrc ?? previewSrc;
  const canPreview = hasPreview || Boolean(sourcePreviewSrc);
  const hasSourcePreview = Boolean(sourcePreviewSrc);
  const draftDurationSeconds = editPreview.durationSeconds;
  const draftStartSeconds = hasSourcePreview ? editPreview.startSeconds : 0;
  const draftEndSeconds = hasSourcePreview ? editPreview.endSeconds : draftDurationSeconds;
  const isDraftTrimPreview = Boolean(activePreviewSrc && draftDurationSeconds !== null);
  const windowKey = `${hasSourcePreview ? "source" : "rendered"}:${draftStartSeconds ?? "x"}:${draftEndSeconds ?? "x"}`;
  const hookOverlay = editPreview.hookOverlay;
  const showTimedHook = shouldShowHookOverlay(hookOverlay, previewSeconds);
  const captionPreviewText = useMemo(() => {
    return resolveActiveCaptionCueText({
      applyCaptionsToClip: editPreview.applyCaptionsToClip,
      captionCues: editPreview.captionCues,
      fallbackText: editPreview.onVideoCaptionText,
      previewSeconds,
    });
  }, [editPreview.applyCaptionsToClip, editPreview.captionCues, editPreview.onVideoCaptionText, previewSeconds]);
  const previewStyle = {
    "--clip-brand-color": brandingConfig.themeColor ?? "#75d9b8",
  } as CSSProperties;
  const updatePreviewSeconds = useCallback(() => {
    const video = videoRef.current;
    const videoSeconds = video?.currentTime ?? 0;
    const startSeconds = hasSourcePreview ? draftStartSeconds ?? 0 : 0;
    const currentSeconds = isDraftTrimPreview
      ? Math.max(0, Math.min(draftDurationSeconds ?? Number.POSITIVE_INFINITY, videoSeconds - startSeconds))
      : videoSeconds;
    const nativeDurationSeconds = video && Number.isFinite(video.duration) ? video.duration : null;
    const durationSeconds = isDraftTrimPreview
      ? hasSourcePreview
        ? draftDurationSeconds
        : nativeDurationSeconds !== null && draftDurationSeconds !== null
          ? Math.min(nativeDurationSeconds, draftDurationSeconds)
          : draftDurationSeconds
      : nativeDurationSeconds;
    const isPlaying = Boolean(video && !video.paused && !video.ended);

    setPreviewSeconds(currentSeconds);
    setPreviewDurationSeconds(durationSeconds);
    setIsPreviewPlaying(isPlaying);
    updatePreviewClock({
      currentSeconds,
      durationSeconds,
      isPlaying,
    });
  }, [draftDurationSeconds, draftStartSeconds, hasSourcePreview, isDraftTrimPreview, updatePreviewClock]);

  const clampVideoToDraftWindow = useCallback((options?: { restartAtEnd?: boolean }) => {
    const video = videoRef.current;
    if (!video || !isDraftTrimPreview || draftStartSeconds === null) {
      return;
    }

    const startSeconds = Math.max(0, draftStartSeconds);
    const endSeconds = draftEndSeconds !== null && draftEndSeconds > startSeconds ? draftEndSeconds : null;

    if (video.currentTime < startSeconds || (endSeconds !== null && video.currentTime > endSeconds + 0.05)) {
      video.currentTime = startSeconds;
      updatePreviewSeconds();
      return;
    }

    if (endSeconds !== null && video.currentTime >= endSeconds) {
      const wasPlaying = !video.paused && !video.ended;
      video.currentTime = startSeconds;
      updatePreviewSeconds();

      if (options?.restartAtEnd && wasPlaying) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    }
  }, [draftEndSeconds, draftStartSeconds, isDraftTrimPreview, updatePreviewSeconds]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !seekRequest) {
      return;
    }

    const maxSeconds = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
    const sourceStartSeconds = hasSourcePreview ? draftStartSeconds ?? 0 : 0;
    const sourceEndSeconds = draftEndSeconds ?? maxSeconds;
    const targetSeconds = hasSourcePreview
      ? sourceStartSeconds + Math.min(seekRequest.seconds, Math.max(0, sourceEndSeconds - sourceStartSeconds))
      : seekRequest.seconds;
    video.currentTime = Math.max(0, Math.min(maxSeconds, Math.min(targetSeconds, sourceEndSeconds)));
    updatePreviewSeconds();
  }, [draftEndSeconds, draftStartSeconds, hasSourcePreview, seekRequest, updatePreviewSeconds]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isDraftTrimPreview || draftStartSeconds === null) {
      return;
    }

    const seekToDraftStart = () => {
      video.currentTime = Math.max(0, draftStartSeconds);
      updatePreviewSeconds();
    };

    if (video.readyState >= 1) {
      seekToDraftStart();
      return;
    }

    video.addEventListener("loadedmetadata", seekToDraftStart, { once: true });
    return () => video.removeEventListener("loadedmetadata", seekToDraftStart);
  }, [draftStartSeconds, isDraftTrimPreview, updatePreviewSeconds, windowKey]);

  const togglePreviewPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (!video.paused && !video.ended) {
      video.pause();
      updatePreviewSeconds();
      return;
    }

    clampVideoToDraftWindow({ restartAtEnd: true });
    void video.play().catch(() => undefined);
    updatePreviewSeconds();
  }, [clampVideoToDraftWindow, updatePreviewSeconds]);

  const scrubPreview = useCallback((seconds: number) => {
    const durationSeconds = previewDurationSeconds ?? 0;
    seekPreviewTo(Math.max(0, Math.min(durationSeconds, seconds)));
  }, [previewDurationSeconds, seekPreviewTo]);

  return (
    <section className="card clip-studio-preview-card stack-sm">
      <div className="section-heading-row">
        <div className="stack-sm">
          <p className="kicker">Preview</p>
          <h2>Live clip output</h2>
        </div>
        <StatusBadge tone={renderTone}>{renderLabel}</StatusBadge>
      </div>

      <div className="clip-studio-preview-body">
        <div className="clip-studio-video-shell">
          <div
            className={`clip-studio-live-frame ${formatClassName[exportSettings.primaryFormat]} ${frameClassName[exportSettings.framingMode]} ${
              brandingEnabled ? "branding-on" : "branding-off"
            }`}
            style={previewStyle}
          >
            {canPreview && activePreviewSrc ? (
              <>
                {exportSettings.backgroundMode === "BLURRED" && !hasSourcePreview ? (
                  <video className="clip-studio-live-backdrop" muted playsInline preload="metadata" src={activePreviewSrc} />
                ) : null}
                <video
                  ref={videoRef}
                  className="review-video clip-studio-video"
                  preload="metadata"
                  src={activePreviewSrc}
                  onLoadedMetadata={updatePreviewSeconds}
                  onTimeUpdate={() => {
                    clampVideoToDraftWindow();
                    updatePreviewSeconds();
                  }}
                  onSeeking={updatePreviewSeconds}
                  onSeeked={() => {
                    clampVideoToDraftWindow();
                    updatePreviewSeconds();
                  }}
                  onPlay={() => {
                    clampVideoToDraftWindow();
                    updatePreviewSeconds();
                  }}
                  onPause={updatePreviewSeconds}
                  onEnded={() => {
                    clampVideoToDraftWindow();
                    updatePreviewSeconds();
                  }}
                />
              </>
            ) : (
              <EmptyState
                title="Preview not available yet"
                description={unavailableDescription ?? "Clip preview is not available yet. Review timing and captions, then render to generate a playable preview."}
              />
            )}

            {showWatermark ? (
              <div className="clip-studio-live-watermark">{churchName ? churchName.slice(0, 2).toUpperCase() : "SC"}</div>
            ) : null}

            {showLowerThird ? (
              <div className="clip-studio-live-lower-third">
                <strong>{brandingConfig.showSermonTitle ? sermonTitle || "Sermon title" : "Clip"}</strong>
                <span>
                  {brandingConfig.showPreacherName
                    ? preacherName || "Preacher"
                    : brandingConfig.showChurchName
                      ? churchName || "Church"
                      : BRANDING_PRESET_LABELS[brandingConfig.preset]}
                </span>
              </div>
            ) : null}

            {showTimedHook ? (
              <div
                className={`clip-studio-live-hook hook-${hookOverlay.position} hook-${hookOverlay.animation} hook-${hookOverlay.size} ${
                  hookOverlay.bold ? "is-bold" : ""
                }`}
              >
                {hookOverlay.text}
              </div>
            ) : null}

            {captionPreviewText ? (
              <div className={`clip-studio-live-caption ${captionStyle.className}`}>
                <span>{captionPreviewText}</span>
              </div>
            ) : null}
          </div>

          {canPreview && activePreviewSrc ? (
            <div className="clip-studio-player-controls" aria-label="Live preview playback controls">
              <button type="button" className="button secondary" onClick={togglePreviewPlayback}>
                {isPreviewPlaying ? "Pause" : "Play"}
              </button>
              <input
                aria-label="Preview position"
                type="range"
                min="0"
                max={Math.max(0, previewDurationSeconds ?? 0)}
                step="0.1"
                value={Math.min(previewSeconds, previewDurationSeconds ?? previewSeconds)}
                onChange={(event) => scrubPreview(Number(event.target.value))}
                disabled={!previewDurationSeconds || previewDurationSeconds <= 0}
              />
              <span>
                {formatSecondsForPastorView(previewSeconds)} / {previewDurationSeconds !== null ? formatSecondsForPastorView(previewDurationSeconds) : "--:--"}
              </span>
            </div>
          ) : null}
        </div>

        <div className="clip-studio-preview-control-stack">
          <ClipStudioDecisionBar clipId={clipId} currentStatus={currentStatus} />
          <div className="clip-studio-preview-spec">
            <p className="muted small">Previewing unsaved choices</p>
            <strong>{FORMAT_LABELS[exportSettings.primaryFormat]}</strong>
            <span>{PLATFORM_PRESET_LABELS[exportSettings.platformPreset]}</span>
            <span>{FRAMING_LABELS[exportSettings.framingMode]}</span>
            <span>{brandingEnabled ? BRANDING_PRESET_LABELS[brandingConfig.preset] : "No branding"}</span>
            <span>{editPreview.applyCaptionsToClip ? `${captionStyle.name} captions` : "Captions off"}</span>
            <span>{isDraftTrimPreview ? "Live clipped preview" : "Rendered clip preview"}</span>
            <span>{editPreview.isTimingValid ? "Draft timing ready" : "Draft timing needs review"}</span>
          </div>
        </div>
      </div>

      <div className="clip-studio-chip-row">
        <span className="status-pill">{editPreview.durationLabel || durationLabel}</span>
        <span className={`status-pill ${editPreview.isTimingValid ? "" : "risk-high"}`}>
          {editPreview.startLabel && editPreview.endLabel ? `${editPreview.startLabel} - ${editPreview.endLabel}` : timingLabel}
        </span>
        <span className={`status-pill ${riskClassName}`}>{riskLabel}</span>
      </div>
    </section>
  );
}
