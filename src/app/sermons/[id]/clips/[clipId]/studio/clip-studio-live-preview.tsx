"use client";

import { type CSSProperties, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState, StatusBadge } from "@/components/ui";
import { BRANDING_PRESET_LABELS } from "@/lib/clipBranding";
import { resolveCaptionStylePreset } from "@/lib/captionStylePresets";
import { resolveFramingDisplayLabel } from "@/lib/clipExportSettings";
import {
  buildSpeechCleanupPreviewPlan,
  mapCleanedPreviewSecondsToSourceSeconds,
  mapSourceSecondsToCleanedPreviewSeconds,
  resolveActiveCaptionCueText,
  resolveActiveCaptionWordIndex,
  resolveSpeechCleanupJumpTarget,
  shouldShowHookOverlay,
} from "@/lib/clipStudioPreviewTimeline";
import { remapTimelineRangeToCleanedTime } from "@/lib/speechCleanupPlan";
import { formatSecondsForPastorView } from "@/lib/sermonSegment";
import {
  CLIP_STUDIO_OVERLAY_POSITION_EVENT,
  clampCaptionOverlayOffset,
  clampOverlayRatio,
  resolveBrollPositionFromOverlayRatio,
  resolveCaptionPositionFromOverlayRatio,
  resolveHookPositionFromOverlayRatio,
  type ClipStudioOverlayPositionDetail,
} from "@/lib/clipStudioOverlayEvents";
import { useClipStudioPreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";

type ClipStudioLivePreviewProps = {
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

type OverlayDragState = {
  overlay: "caption" | "hook" | "broll";
  cardId?: string;
  pointerId: number;
  originClientY: number;
  originCaptionOffset: number;
  frameTop: number;
  frameHeight: number;
};

function dispatchOverlayPosition(detail: ClipStudioOverlayPositionDetail) {
  window.dispatchEvent(new CustomEvent(CLIP_STUDIO_OVERLAY_POSITION_EVENT, { detail }));
}

export function ClipStudioLivePreview({
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
    playbackRequest,
    seekPreviewTo,
    churchName,
    sermonTitle,
    preacherName,
    updatePreviewClock,
  } = useClipStudioPreview();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [overlayDragState, setOverlayDragState] = useState<OverlayDragState | null>(null);
  const [previewSeconds, setPreviewSeconds] = useState(0);
  const [sourcePreviewSeconds, setSourcePreviewSeconds] = useState(0);
  const [previewDurationSeconds, setPreviewDurationSeconds] = useState<number | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewErrorState, setPreviewErrorState] = useState<{ src: string; message: string } | null>(null);
  const [previewReadySrc, setPreviewReadySrc] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
  const brandingEnabled = brandingConfig.enabled && brandingConfig.preset !== "NO_BRANDING";
  const captionsOverrideBranding = editPreview.applyCaptionsToClip && editPreview.captionCues.length > 0;
  const showWatermark = brandingEnabled && (brandingConfig.watermarkEnabled || brandingConfig.preset === "MINIMAL_WATERMARK");
  const showLowerThird =
    brandingEnabled && brandingConfig.lowerThirdEnabled && brandingConfig.preset !== "MINIMAL_WATERMARK" && !captionsOverrideBranding;
  const captionStyle = resolveCaptionStylePreset(editPreview.captionStylePresetId);
  const activePreviewSrc = sourcePreviewSrc ?? previewSrc;
  const canPreview = hasPreview || Boolean(sourcePreviewSrc);
  const hasSourcePreview = Boolean(sourcePreviewSrc);
  const previewError = previewErrorState?.src === activePreviewSrc ? previewErrorState.message : "";
  const playbackSrc = useMemo(() => {
    if (!activePreviewSrc) {
      return null;
    }

    const separator = activePreviewSrc.includes("?") ? "&" : "?";
    return `${activePreviewSrc}${separator}retry=${retryNonce}`;
  }, [activePreviewSrc, retryNonce]);
  const previewMediaReady = Boolean(playbackSrc && previewReadySrc === playbackSrc && !previewError);
  const draftDurationSeconds = editPreview.durationSeconds;
  const draftStartSeconds = hasSourcePreview ? editPreview.startSeconds : 0;
  const draftEndSeconds = hasSourcePreview ? editPreview.endSeconds : draftDurationSeconds;
  const isDraftTrimPreview = Boolean(activePreviewSrc && draftDurationSeconds !== null);
  const speechCleanupPreviewPlan = useMemo(
    () =>
      buildSpeechCleanupPreviewPlan({
        captionCues: editPreview.captionCues,
        durationSeconds: draftDurationSeconds,
        speechCleanup: editPreview.speechCleanup,
        audioSilenceEvents: editPreview.audioSilenceEvents,
        audioSilenceAnalysisAvailable: editPreview.audioSilenceAnalyzed,
        speechCleanupEdits: editPreview.speechCleanupEdits,
      }),
    [
      draftDurationSeconds,
      editPreview.audioSilenceAnalyzed,
      editPreview.audioSilenceEvents,
      editPreview.captionCues,
      editPreview.speechCleanup,
      editPreview.speechCleanupEdits,
    ],
  );
  const cleanupWindowKey = `${speechCleanupPreviewPlan.sourceStartSeconds}:${speechCleanupPreviewPlan.sourceEndSeconds}:${speechCleanupPreviewPlan.cuts
    .map((cut) => `${cut.startSeconds}-${cut.endSeconds}`)
    .join(",")}`;
  const windowKey = `${hasSourcePreview ? "source" : "rendered"}:${draftStartSeconds ?? "x"}:${draftEndSeconds ?? "x"}:${cleanupWindowKey}`;
  const hookOverlay = useMemo(() => {
    if (!speechCleanupPreviewPlan.enabled) {
      return editPreview.hookOverlay;
    }

    const startSeconds = Number.isFinite(editPreview.hookOverlay.startSeconds)
      ? Math.max(0, editPreview.hookOverlay.startSeconds)
      : 0;
    const durationSeconds = Number.isFinite(editPreview.hookOverlay.durationSeconds)
      ? Math.max(1, editPreview.hookOverlay.durationSeconds)
      : 6;
    const remapped = remapTimelineRangeToCleanedTime({
      startSeconds,
      endSeconds: startSeconds + durationSeconds,
      plan: speechCleanupPreviewPlan,
    });

    return remapped
      ? {
          ...editPreview.hookOverlay,
          startSeconds: remapped.startSeconds,
          durationSeconds: remapped.endSeconds - remapped.startSeconds,
        }
      : {
          ...editPreview.hookOverlay,
          enabled: false,
        };
  }, [editPreview.hookOverlay, speechCleanupPreviewPlan]);
  const showTimedHook = shouldShowHookOverlay(hookOverlay, previewSeconds);
  const activeBrollCard = useMemo(() => {
    if (!editPreview.brollLayer.enabled) {
      return null;
    }

    return editPreview.brollLayer.cards.find((card) => {
      if (!card.enabled || !card.text.trim()) {
        return false;
      }

      const startSeconds = Number.isFinite(card.startSeconds) ? Math.max(0, card.startSeconds) : 0;
      const endSeconds = startSeconds + (Number.isFinite(card.durationSeconds) ? Math.max(1, card.durationSeconds) : 5);
      if (speechCleanupPreviewPlan.enabled) {
        const remapped = remapTimelineRangeToCleanedTime({
          startSeconds,
          endSeconds,
          plan: speechCleanupPreviewPlan,
        });
        return Boolean(remapped && previewSeconds >= remapped.startSeconds && previewSeconds <= remapped.endSeconds);
      }

      return sourcePreviewSeconds >= startSeconds && sourcePreviewSeconds <= endSeconds;
    }) ?? null;
  }, [editPreview.brollLayer, previewSeconds, sourcePreviewSeconds, speechCleanupPreviewPlan]);
  const activeCaptionCue = useMemo(() => {
    if (!editPreview.applyCaptionsToClip) {
      return null;
    }

    const sortedCues = editPreview.captionCues
      .filter((cue) => cue.text.trim().length > 0)
      .sort((left, right) => left.startSeconds - right.startSeconds);
    return sortedCues.find((cue, index) => {
      const isLastCue = index === sortedCues.length - 1;
      return sourcePreviewSeconds >= cue.startSeconds && (sourcePreviewSeconds < cue.endSeconds || (isLastCue && sourcePreviewSeconds <= cue.endSeconds));
    }) ?? null;
  }, [editPreview.applyCaptionsToClip, editPreview.captionCues, sourcePreviewSeconds]);
  const captionPreviewText = useMemo(() => {
    return resolveActiveCaptionCueText({
      applyCaptionsToClip: editPreview.applyCaptionsToClip,
      captionCues: editPreview.captionCues,
      fallbackText: editPreview.onVideoCaptionText,
      previewSeconds: sourcePreviewSeconds,
    });
  }, [editPreview.applyCaptionsToClip, editPreview.captionCues, editPreview.onVideoCaptionText, sourcePreviewSeconds]);
  const captionDisplayText = editPreview.captionAppearance.uppercase ? captionPreviewText.toUpperCase() : captionPreviewText;
  const captionWords = useMemo(() => captionDisplayText.split(/\s+/).filter(Boolean), [captionDisplayText]);
  const captionAppearanceStyle = {
    "--caption-offset-y": `${editPreview.captionAppearance.verticalOffset}px`,
  } as CSSProperties;
  const manualCropPreview = exportSettings.manualCropKeyframes[0] ?? null;
  const hasManualCropPreview = Boolean(manualCropPreview);
  const activeCaptionWordIndex = useMemo(() => {
    return resolveActiveCaptionWordIndex({
      activeCue: activeCaptionCue,
      words: captionWords,
      previewSeconds: sourcePreviewSeconds,
    });
  }, [activeCaptionCue, captionWords, sourcePreviewSeconds]);
  const previewStyle = {
    "--clip-brand-color": brandingConfig.themeColor ?? "#75d9b8",
    ...(manualCropPreview
      ? {
          "--clip-manual-x": `${Math.round(manualCropPreview.centerX * 100)}%`,
          "--clip-manual-y": `${Math.round((manualCropPreview.centerY ?? 0.5) * 100)}%`,
          "--clip-manual-zoom": String(manualCropPreview.zoom ?? 1),
        }
      : {}),
  } as CSSProperties;
  const backgroundStyleClass = `background-${brandingConfig.backgroundStyle.toLowerCase().replace(/_/g, "-")}`;
  const framingDisplayLabel = resolveFramingDisplayLabel(exportSettings);
  function updateOverlayPositionFromPointer(state: OverlayDragState, clientY: number) {
    const ratio = clampOverlayRatio((clientY - state.frameTop) / Math.max(1, state.frameHeight));

    if (state.overlay === "caption") {
      dispatchOverlayPosition({
        overlay: "caption",
        position: resolveCaptionPositionFromOverlayRatio(ratio),
        verticalOffset: clampCaptionOverlayOffset(state.originCaptionOffset - (clientY - state.originClientY)),
      });
      return;
    }

    if (state.overlay === "broll" && state.cardId) {
      dispatchOverlayPosition({
        overlay: "broll",
        cardId: state.cardId,
        position: resolveBrollPositionFromOverlayRatio(ratio),
      });
      return;
    }

    dispatchOverlayPosition({
      overlay: "hook",
      position: resolveHookPositionFromOverlayRatio(ratio),
    });
  }

  function startOverlayDrag(event: PointerEvent<HTMLElement>, overlay: OverlayDragState["overlay"], cardId?: string) {
    if (event.button !== 0) {
      return;
    }

    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const rect = frame.getBoundingClientRect();
    if (rect.height <= 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    const nextDragState: OverlayDragState = {
      overlay,
      cardId,
      pointerId: event.pointerId,
      originClientY: event.clientY,
      originCaptionOffset: editPreview.captionAppearance.verticalOffset,
      frameTop: rect.top,
      frameHeight: rect.height,
    };

    setOverlayDragState(nextDragState);
    updateOverlayPositionFromPointer(nextDragState, event.clientY);
  }

  function moveOverlayDrag(event: PointerEvent<HTMLElement>) {
    if (!overlayDragState || overlayDragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    updateOverlayPositionFromPointer(overlayDragState, event.clientY);
  }

  function endOverlayDrag(event: PointerEvent<HTMLElement>) {
    if (!overlayDragState || overlayDragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    updateOverlayPositionFromPointer(overlayDragState, event.clientY);

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }

    setOverlayDragState(null);
  }
  const updatePreviewSeconds = useCallback(() => {
    const video = videoRef.current;
    const videoSeconds = video?.currentTime ?? 0;
    const sourceSeconds = isDraftTrimPreview
      ? Math.max(0, Math.min(draftDurationSeconds ?? Number.POSITIVE_INFINITY, hasSourcePreview ? videoSeconds - (draftStartSeconds ?? 0) : videoSeconds))
      : videoSeconds;
    const currentSeconds = speechCleanupPreviewPlan.enabled
      ? mapSourceSecondsToCleanedPreviewSeconds(sourceSeconds, speechCleanupPreviewPlan)
      : sourceSeconds;
    const nativeDurationSeconds = video && Number.isFinite(video.duration) ? video.duration : null;
    const unclippedDurationSeconds = isDraftTrimPreview
      ? hasSourcePreview
        ? draftDurationSeconds
        : nativeDurationSeconds !== null && draftDurationSeconds !== null
          ? Math.min(nativeDurationSeconds, draftDurationSeconds)
          : draftDurationSeconds
      : nativeDurationSeconds;
    const durationSeconds = speechCleanupPreviewPlan.enabled && unclippedDurationSeconds !== null
      ? speechCleanupPreviewPlan.cleanedDurationSeconds
      : unclippedDurationSeconds;
    const isPlaying = Boolean(video && !video.paused && !video.ended);

    setSourcePreviewSeconds(sourceSeconds);
    setPreviewSeconds(currentSeconds);
    setPreviewDurationSeconds(durationSeconds);
    setIsPreviewPlaying(isPlaying);
    updatePreviewClock({
      currentSeconds,
      durationSeconds,
      isPlaying,
    });
  }, [draftDurationSeconds, draftStartSeconds, hasSourcePreview, isDraftTrimPreview, speechCleanupPreviewPlan, updatePreviewClock]);

  const clampVideoToDraftWindow = useCallback((options?: { restartAtEnd?: boolean }) => {
    const video = videoRef.current;
    if (!video || !isDraftTrimPreview || draftStartSeconds === null) {
      return;
    }

    const startSeconds = Math.max(0, draftStartSeconds + (speechCleanupPreviewPlan.enabled ? speechCleanupPreviewPlan.sourceStartSeconds : 0));
    const rawEndSeconds = draftEndSeconds !== null && draftEndSeconds > draftStartSeconds
      ? draftEndSeconds
      : null;
    const endSeconds = rawEndSeconds !== null
      ? draftStartSeconds + (speechCleanupPreviewPlan.enabled ? speechCleanupPreviewPlan.sourceEndSeconds : rawEndSeconds - draftStartSeconds)
      : null;
    const relativeSourceSeconds = Math.max(0, video.currentTime - draftStartSeconds);
    const cleanupJumpTarget = speechCleanupPreviewPlan.enabled
      ? resolveSpeechCleanupJumpTarget(relativeSourceSeconds, speechCleanupPreviewPlan)
      : null;

    if (cleanupJumpTarget !== null && cleanupJumpTarget < speechCleanupPreviewPlan.sourceEndSeconds) {
      video.currentTime = draftStartSeconds + cleanupJumpTarget;
      updatePreviewSeconds();
      return;
    }

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
  }, [draftEndSeconds, draftStartSeconds, isDraftTrimPreview, speechCleanupPreviewPlan, updatePreviewSeconds]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !seekRequest) {
      return;
    }

    const maxSeconds = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
    const sourceStartSeconds = hasSourcePreview ? draftStartSeconds ?? 0 : 0;
    const sourceEndSeconds = speechCleanupPreviewPlan.enabled
      ? sourceStartSeconds + speechCleanupPreviewPlan.sourceEndSeconds
      : draftEndSeconds ?? maxSeconds;
    const seekSourceSeconds = speechCleanupPreviewPlan.enabled
      ? mapCleanedPreviewSecondsToSourceSeconds(seekRequest.seconds, speechCleanupPreviewPlan)
      : seekRequest.seconds;
    const targetSeconds = hasSourcePreview
      ? sourceStartSeconds + Math.min(seekSourceSeconds, Math.max(0, sourceEndSeconds - sourceStartSeconds))
      : seekSourceSeconds;
    video.currentTime = Math.max(0, Math.min(maxSeconds, Math.min(targetSeconds, sourceEndSeconds)));
    updatePreviewSeconds();
  }, [draftEndSeconds, draftStartSeconds, hasSourcePreview, seekRequest, speechCleanupPreviewPlan, updatePreviewSeconds]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isDraftTrimPreview || draftStartSeconds === null) {
      return;
    }

    const seekToDraftStart = () => {
      video.currentTime = Math.max(0, draftStartSeconds + (speechCleanupPreviewPlan.enabled ? speechCleanupPreviewPlan.sourceStartSeconds : 0));
      updatePreviewSeconds();
    };

    if (video.readyState >= 1) {
      seekToDraftStart();
      return;
    }

    video.addEventListener("loadedmetadata", seekToDraftStart, { once: true });
    return () => video.removeEventListener("loadedmetadata", seekToDraftStart);
  }, [draftStartSeconds, isDraftTrimPreview, speechCleanupPreviewPlan, updatePreviewSeconds, windowKey]);

  const startPreviewPlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    clampVideoToDraftWindow({ restartAtEnd: true });

    try {
      await video.play();
      setPlaybackNotice(null);
    } catch {
      try {
        video.muted = true;
        await video.play();
        setPlaybackNotice("Preview started muted because the browser blocked audio playback.");
      } catch {
        setPlaybackNotice("Preview playback is blocked by the browser. Try again or reload the Studio.");
      }
    } finally {
      updatePreviewSeconds();
    }
  }, [clampVideoToDraftWindow, updatePreviewSeconds]);

  const togglePreviewPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (!video.paused && !video.ended) {
      video.pause();
      setPlaybackNotice(null);
      updatePreviewSeconds();
      return;
    }

    void startPreviewPlayback();
  }, [startPreviewPlayback, updatePreviewSeconds]);

  useEffect(() => {
    if (!playbackRequest) {
      return;
    }

    const playbackTimer = window.setTimeout(() => {
      void startPreviewPlayback();
    }, 0);

    return () => window.clearTimeout(playbackTimer);
  }, [playbackRequest, startPreviewPlayback]);

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
            ref={frameRef}
            className={`clip-studio-live-frame ${formatClassName[exportSettings.primaryFormat]} ${frameClassName[exportSettings.framingMode]} ${
              brandingEnabled ? "branding-on" : "branding-off"
            } ${hasManualCropPreview ? "has-manual-crop" : ""} ${overlayDragState ? "is-dragging-overlay" : ""} ${backgroundStyleClass}`}
            style={previewStyle}
          >
            {canPreview && playbackSrc ? (
              <>
                {exportSettings.backgroundMode === "BLURRED" ? (
                  <video className="clip-studio-live-backdrop" muted playsInline preload="metadata" src={playbackSrc} />
                ) : null}
                <video
                  ref={videoRef}
                  className="review-video clip-studio-video"
                  preload="metadata"
                  src={playbackSrc}
                  onLoadedMetadata={() => {
                    setPreviewErrorState(null);
                    setPreviewReadySrc(playbackSrc);
                    updatePreviewSeconds();
                  }}
                  onLoadedData={() => {
                    setPreviewErrorState(null);
                    setPreviewReadySrc(playbackSrc);
                  }}
                  onError={() => {
                    setPreviewErrorState({
                      src: activePreviewSrc ?? "",
                      message: "Preview media could not be loaded. Check the source video or retry the preview.",
                    });
                    setPreviewReadySrc(null);
                    setIsPreviewPlaying(false);
                  }}
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
                {previewError ? (
                  <div className="clip-studio-preview-error" role="status">
                    <strong>Preview could not load</strong>
                    <span>{previewError}</span>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        setPreviewErrorState(null);
                        setPreviewReadySrc(null);
                        setRetryNonce((current) => current + 1);
                      }}
                    >
                      Retry preview
                    </button>
                  </div>
                ) : null}
                {!previewError && !previewMediaReady ? (
                  <div className="clip-studio-preview-error is-loading" role="status">
                    <strong>Loading preview media</strong>
                    <span>The video metadata is not ready yet, so overlays are paused until the media loads.</span>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        setPreviewReadySrc(null);
                        setRetryNonce((current) => current + 1);
                      }}
                    >
                      Retry preview
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyState
                title="Preview not available yet"
                description={unavailableDescription ?? "Clip preview is not available yet. Review timing and captions, then render to generate a playable preview."}
              />
            )}

            {previewMediaReady && showWatermark ? (
              <div className="clip-studio-live-watermark">{churchName ? churchName.slice(0, 2).toUpperCase() : "SC"}</div>
            ) : null}

            {previewMediaReady && brandingEnabled && brandingConfig.introEnabled ? (
              <div className="clip-studio-live-brand-slate clip-studio-live-brand-slate-intro">Intro</div>
            ) : null}

            {previewMediaReady && showLowerThird ? (
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

            {previewMediaReady && activeBrollCard ? (
              <div
                className={`clip-studio-live-broll broll-${activeBrollCard.tone} broll-position-${activeBrollCard.position}`}
                onPointerDown={(event) => startOverlayDrag(event, "broll", activeBrollCard.id)}
                onPointerMove={moveOverlayDrag}
                onPointerUp={endOverlayDrag}
                onPointerCancel={endOverlayDrag}
                title="Drag visual card"
              >
                <span>{activeBrollCard.label}</span>
                <strong>{activeBrollCard.text}</strong>
              </div>
            ) : null}

            {previewMediaReady && showTimedHook ? (
              <div
                className={`clip-studio-live-hook hook-${hookOverlay.position} hook-${hookOverlay.animation} hook-${hookOverlay.size} ${
                  hookOverlay.bold ? "is-bold" : ""
                }`}
                onPointerDown={(event) => startOverlayDrag(event, "hook")}
                onPointerMove={moveOverlayDrag}
                onPointerUp={endOverlayDrag}
                onPointerCancel={endOverlayDrag}
                title="Drag hook overlay"
              >
                {hookOverlay.text}
              </div>
            ) : null}

            {previewMediaReady && captionPreviewText ? (
              <div
                className={`clip-studio-live-caption ${captionStyle.className} caption-position-${editPreview.captionPosition} caption-size-${editPreview.captionAppearance.fontScale} ${
                  editPreview.captionAppearance.uppercase ? "caption-uppercase" : ""
                }`}
                style={captionAppearanceStyle}
                data-max-lines={editPreview.captionAppearance.maxLines}
                onPointerDown={(event) => startOverlayDrag(event, "caption")}
                onPointerMove={moveOverlayDrag}
                onPointerUp={endOverlayDrag}
                onPointerCancel={endOverlayDrag}
                title="Drag captions"
              >
                <span aria-label={captionDisplayText}>
                  {captionWords.map((word, index) => (
                    <span
                      key={`${word}-${index}`}
                      aria-hidden="true"
                      className={index === activeCaptionWordIndex ? "clip-studio-live-caption-word is-active" : "clip-studio-live-caption-word"}
                    >
                      {word}
                    </span>
                  ))}
                </span>
              </div>
            ) : null}

            {previewMediaReady && brandingEnabled && brandingConfig.outroEnabled ? (
              <div className="clip-studio-live-brand-slate clip-studio-live-brand-slate-outro">Outro</div>
            ) : null}
          </div>

          {canPreview && playbackSrc ? (
            <div className="stack-sm">
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
              {playbackNotice ? <p className="muted small">{playbackNotice}</p> : null}
            </div>
          ) : null}
        </div>

        <div className="clip-studio-preview-control-stack">
          <div className="clip-studio-preview-spec">
            <div className="clip-studio-preview-state-line">
              <strong>{editPreview.isTimingValid ? "Preview updated" : "Preview needs timing"}</strong>
              <span>{framingDisplayLabel}</span>
            </div>
            <div className="clip-studio-layer-chips" aria-label="Active preview layers">
              {editPreview.applyCaptionsToClip ? <span>Captions On</span> : null}
              {brandingEnabled ? (
                <span>
                  {captionsOverrideBranding && showWatermark
                    ? "Branding On"
                    : BRANDING_PRESET_LABELS[brandingConfig.preset]}
                </span>
              ) : null}
              {speechCleanupPreviewPlan.enabled ? <span>Dead Air Removed</span> : null}
              {editPreview.brollLayer.enabled && editPreview.brollLayer.cards.length > 0 ? <span>B-roll On</span> : null}
              <span>{framingDisplayLabel}</span>
            </div>
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
