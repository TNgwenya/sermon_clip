"use client";

import Image from "next/image";
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState, StatusBadge } from "@/components/ui";
import {
  BRANDING_PRESET_LABELS,
  DEFAULT_INTRO_DURATION_SECONDS,
  DEFAULT_OUTRO_DURATION_SECONDS,
  normalizeBrandingDurationSeconds,
  resolveBrandingLowerThirdPlacement,
  resolveBrandBackgroundOpacity,
  shouldBrandingLowerThirdYieldToCaptions,
} from "@/lib/clipBranding";
import {
  resolveCaptionFontFamily,
  resolveCaptionSafeWidthPercent,
  resolveCaptionStylePreset,
} from "@/lib/captionStylePresets";
import { PLATFORM_PRESET_LABELS, resolveFramingDisplayLabel } from "@/lib/clipExportSettings";
import { buildRetryablePreviewUrl } from "@/lib/clipPreview";
import type {
  ResolvedFramingPlanDocument,
  ResolvedFramingTimelinePoint,
} from "@/lib/resolvedFramingPlan";
import {
  buildSpeechCleanupPreviewPlan,
  mapSourceSecondsToCleanedPreviewSeconds,
  resolveActiveCaptionCueText,
  resolveActiveCaptionWordIndex,
  resolveCaptionLookupSeconds,
  resolveCompositionPreviewDuration,
  resolveHookOverlayAnimationFrame,
  resolvePreviewSeekSourceSeconds,
  resolveSpeechCleanupJumpTarget,
  shouldShowHookOverlay,
} from "@/lib/clipStudioPreviewTimeline";
import { remapTimelineRangeToCleanedTime } from "@/lib/speechCleanupPlan";
import { formatSecondsForPastorView } from "@/lib/sermonSegment";
import {
  CLIP_STUDIO_OVERLAY_POSITION_EVENT,
  clampCaptionOverlayOffset,
  clampOverlayRatio,
  nudgeCaptionOverlayOffset,
  resolveBrollPositionFromOverlayRatio,
  resolveCaptionPositionFromOverlayRatio,
  resolveHookPositionFromOverlayRatio,
  type ClipStudioOverlayPositionDetail,
} from "@/lib/clipStudioOverlayEvents";
import { useClipStudioPreview } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-preview-context";
import styles from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-live-preview.module.css";

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
  resolvedFramingPlan: ResolvedFramingPlanDocument | null;
  unavailableDescription?: string;
};

const formatClassName = {
  VERTICAL_9_16: "format-vertical",
  HORIZONTAL_16_9: "format-horizontal",
  SQUARE_1_1: "format-square",
};

const captionRenderFrameSize = {
  VERTICAL_9_16: { width: 1080, height: 1920 },
  HORIZONTAL_16_9: { width: 1920, height: 1080 },
  SQUARE_1_1: { width: 1080, height: 1080 },
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
  originClientX: number;
  originClientY: number;
  originCaptionHorizontalOffset: number;
  originCaptionVerticalOffset: number;
  renderUnitsPerClientX: number;
  renderUnitsPerClientY: number;
  frameTop: number;
  frameHeight: number;
};

type ManualCropPreviewFrame = {
  centerX: number;
  centerY: number;
  zoom: number;
};

export type ClipStudioFramingPreviewResolution = {
  state: "MANUAL" | "READY" | "FALLBACK" | "PASSTHROUGH" | "PENDING" | "STALE";
  statusLabel: string;
  canConsumePlan: boolean;
  layout: ResolvedFramingPlanDocument["effective"]["layout"] | null;
  treatment: ResolvedFramingPlanDocument["effective"]["treatment"] | null;
  message: string;
};

const PLATFORM_SAFE_ZONE_INSETS = {
  INSTAGRAM_REELS: { top: 10, right: 8, bottom: 19, left: 8 },
  TIKTOK: { top: 10, right: 22, bottom: 24, left: 8 },
  YOUTUBE_SHORTS: { top: 10, right: 16, bottom: 20, left: 8 },
  FACEBOOK_REELS: { top: 9, right: 9, bottom: 18, left: 9 },
  YOUTUBE_HORIZONTAL: { top: 8, right: 8, bottom: 12, left: 8 },
  WEBSITE_HORIZONTAL: { top: 7, right: 7, bottom: 10, left: 7 },
} as const;

export function resolveClipStudioPreviewSource({
  hasPreview,
  previewSrc,
  sourcePreviewSrc,
  preferSourcePreview,
  unavailableSourcePreviewSrc,
  unavailablePreparedPreviewSrc,
}: {
  hasPreview: boolean;
  previewSrc: string | null;
  sourcePreviewSrc: string | null;
  preferSourcePreview: boolean;
  unavailableSourcePreviewSrc: string | null;
  unavailablePreparedPreviewSrc: string | null;
}): {
  activePreviewSrc: string | null;
  canPreview: boolean;
  hasSourcePreview: boolean;
} {
  const sourceIsAvailable = Boolean(
    sourcePreviewSrc && sourcePreviewSrc !== unavailableSourcePreviewSrc,
  );
  const preparedPreviewIsAvailable = Boolean(
    hasPreview &&
    previewSrc &&
    previewSrc !== unavailablePreparedPreviewSrc,
  );
  const sourceIsRequiredButUnavailable = preferSourcePreview && !sourceIsAvailable;
  const useSourcePreview = sourceIsAvailable && (
    preferSourcePreview || !preparedPreviewIsAvailable
  );
  const usePreparedPreview = preparedPreviewIsAvailable && !sourceIsRequiredButUnavailable;

  return {
    activePreviewSrc: useSourcePreview
      ? sourcePreviewSrc
      : usePreparedPreview
        ? previewSrc
        : null,
    canPreview: usePreparedPreview || sourceIsAvailable,
    hasSourcePreview: useSourcePreview,
  };
}

export function clipStudioPreviewNeedsSourceMedia(input: {
  initialStartSeconds: number | null;
  initialEndSeconds: number | null;
  currentStartSeconds: number | null;
  currentEndSeconds: number | null;
  seekTimeDomain?: "cleaned" | "source" | null;
}): boolean {
  if (input.seekTimeDomain === "source") {
    return true;
  }

  if (
    input.initialStartSeconds === null
    || input.initialEndSeconds === null
    || input.currentStartSeconds === null
    || input.currentEndSeconds === null
  ) {
    return (
      input.initialStartSeconds !== input.currentStartSeconds
      || input.initialEndSeconds !== input.currentEndSeconds
    );
  }

  // The prepared clip already contains trims made inside its saved range.
  // Switch to the much larger sermon source only when the draft extends past
  // that range and genuinely needs surrounding media.
  return (
    input.currentStartSeconds < input.initialStartSeconds - 0.01
    || input.currentEndSeconds > input.initialEndSeconds + 0.01
  );
}

export function clipStudioPreviewMediaCoversDraft(input: {
  mediaDurationSeconds: number;
  draftDurationSeconds: number | null;
  draftEndSeconds: number | null;
  hasSourcePreview: boolean;
}): boolean {
  if (Number.isNaN(input.mediaDurationSeconds) || input.mediaDurationSeconds <= 0) {
    return false;
  }
  if (input.mediaDurationSeconds === Number.POSITIVE_INFINITY) {
    return true;
  }

  const requiredEndSeconds = input.hasSourcePreview
    ? input.draftEndSeconds
    : input.draftDurationSeconds;
  if (requiredEndSeconds === null || !Number.isFinite(requiredEndSeconds) || requiredEndSeconds <= 0) {
    return true;
  }

  return input.mediaDurationSeconds + 0.25 >= requiredEndSeconds;
}

function interpolateNumber(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function smoothStep(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

export function resolveCanonicalFramingPreviewFrame(
  timeline: ResolvedFramingTimelinePoint[],
  seconds: number,
): ManualCropPreviewFrame | null {
  if (timeline.length === 0) {
    return null;
  }

  const first = timeline[0];
  const last = timeline.at(-1);
  if (!first || !last) {
    return null;
  }

  if (seconds <= first.timeSeconds || timeline.length === 1) {
    return {
      centerX: first.centerX,
      centerY: first.centerY,
      zoom: first.zoom,
    };
  }

  if (seconds >= last.timeSeconds) {
    return {
      centerX: last.centerX,
      centerY: last.centerY,
      zoom: last.zoom,
    };
  }

  const nextIndex = timeline.findIndex((point) => point.timeSeconds >= seconds);
  const next = timeline[nextIndex];
  const previous = timeline[Math.max(0, nextIndex - 1)];
  if (!previous || !next) {
    return null;
  }

  const spanSeconds = Math.max(0.001, next.timeSeconds - previous.timeSeconds);
  const progress = smoothStep((seconds - previous.timeSeconds) / spanSeconds);
  return {
    centerX: interpolateNumber(previous.centerX, next.centerX, progress),
    centerY: interpolateNumber(previous.centerY, next.centerY, progress),
    zoom: interpolateNumber(previous.zoom, next.zoom, progress),
  };
}

export function resolveClipStudioFramingPreview(input: {
  plan: ResolvedFramingPlanDocument | null;
  framingMode: string;
  framingPersonality: string;
  hasManualCrop: boolean;
}): ClipStudioFramingPreviewResolution {
  if (input.hasManualCrop) {
    return {
      state: "MANUAL",
      statusLabel: "Manual framing",
      canConsumePlan: false,
      layout: null,
      treatment: null,
      message: "Manual crop points override automatic framing and remain authoritative in this preview.",
    };
  }

  if (!input.plan) {
    return {
      state: "PENDING",
      statusLabel: "Framing pending",
      canConsumePlan: false,
      layout: null,
      treatment: null,
      message: input.framingMode === "SMART_CROP"
        ? "Speaker tracking has not produced a framing plan yet. Studio will not simulate movement until a canonical plan is ready."
        : "Prepare the video to resolve a canonical framing plan for this selection.",
    };
  }

  if (
    input.plan.requested.layout !== input.framingMode
    || input.plan.requested.personality !== input.framingPersonality
  ) {
    return {
      state: "STALE",
      statusLabel: "Framing stale",
      canConsumePlan: false,
      layout: null,
      treatment: null,
      message: "The saved framing plan belongs to different Studio settings. Prepare the video to resolve the current choice.",
    };
  }

  if (
    input.plan.effective.layout === "SMART_CROP"
    && input.plan.tracking.timeline.length === 0
  ) {
    return {
      state: "PENDING",
      statusLabel: "Tracking unavailable",
      canConsumePlan: false,
      layout: null,
      treatment: null,
      message: "The canonical plan does not contain a usable tracking timeline, so Studio is not simulating speaker movement.",
    };
  }

  const state = input.plan.resolution.status;
  return {
    state,
    statusLabel: `Framing ${state}`,
    canConsumePlan: true,
    layout: input.plan.effective.layout,
    treatment: input.plan.effective.treatment,
    message: input.plan.resolution.summary,
  };
}

function resolveManualCropPreviewFrame(
  keyframes: Array<{ timeSeconds: number; centerX: number; centerY?: number; zoom?: number }>,
  seconds: number,
): ManualCropPreviewFrame | null {
  if (keyframes.length === 0) {
    return null;
  }

  const first = keyframes[0];
  const last = keyframes.at(-1);
  if (!first || !last) {
    return null;
  }

  if (seconds <= first.timeSeconds || keyframes.length === 1) {
    return {
      centerX: first.centerX,
      centerY: first.centerY ?? 0.5,
      zoom: first.zoom ?? 1,
    };
  }

  if (seconds >= last.timeSeconds) {
    return {
      centerX: last.centerX,
      centerY: last.centerY ?? 0.5,
      zoom: last.zoom ?? 1,
    };
  }

  const nextIndex = keyframes.findIndex((keyframe) => keyframe.timeSeconds >= seconds);
  const next = keyframes[nextIndex];
  const previous = keyframes[Math.max(0, nextIndex - 1)];
  if (!previous || !next) {
    return null;
  }

  const spanSeconds = Math.max(0.001, next.timeSeconds - previous.timeSeconds);
  const progress = Math.max(0, Math.min(1, (seconds - previous.timeSeconds) / spanSeconds));

  return {
    centerX: interpolateNumber(previous.centerX, next.centerX, progress),
    centerY: interpolateNumber(previous.centerY ?? 0.5, next.centerY ?? 0.5, progress),
    zoom: interpolateNumber(previous.zoom ?? 1, next.zoom ?? 1, progress),
  };
}

function dispatchOverlayPosition(detail: ClipStudioOverlayPositionDetail) {
  window.dispatchEvent(new CustomEvent(CLIP_STUDIO_OVERLAY_POSITION_EVENT, { detail }));
}

function colorWithOpacity(hexColor: string, opacity: number): string {
  const normalized = hexColor.replace(/^#/, "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  if (![red, green, blue].every(Number.isFinite)) {
    return hexColor;
  }

  return `rgb(${red} ${green} ${blue} / ${Math.max(0, Math.min(1, opacity))})`;
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
  resolvedFramingPlan,
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
    logoSrc,
    updatePreviewClock,
  } = useClipStudioPreview();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const backdropVideoRef = useRef<HTMLVideoElement | null>(null);
  const sourceWarmupVideoRef = useRef<HTMLVideoElement | null>(null);
  const playbackIntentRef = useRef(false);
  const [overlayDragState, setOverlayDragState] = useState<OverlayDragState | null>(null);
  const [previewSeconds, setPreviewSeconds] = useState(0);
  const [sourcePreviewSeconds, setSourcePreviewSeconds] = useState(0);
  const [previewDurationSeconds, setPreviewDurationSeconds] = useState<number | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isPreviewMuted, setIsPreviewMuted] = useState(false);
  const [previewErrorState, setPreviewErrorState] = useState<{ src: string; message: string } | null>(null);
  const [unavailableSourcePreviewSrc, setUnavailableSourcePreviewSrc] = useState<string | null>(null);
  const [unavailablePreparedPreviewSrc, setUnavailablePreparedPreviewSrc] = useState<string | null>(null);
  const [previewReadySrc, setPreviewReadySrc] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
  const [showSafeZoneGuide, setShowSafeZoneGuide] = useState(false);
  const [previewFrameSize, setPreviewFrameSize] = useState({ width: 0, height: 0 });
  const [playbackState, setPlaybackState] = useState<"loading" | "ready" | "waiting" | "stalled" | "playing" | "paused" | "error">("loading");
  const syncBackdropVideo = useCallback((forceTime = false) => {
    const foreground = videoRef.current;
    const backdrop = backdropVideoRef.current;
    if (!foreground || !backdrop) {
      return;
    }

    const driftSeconds = Math.abs(backdrop.currentTime - foreground.currentTime);
    if (forceTime || driftSeconds > 0.12) {
      try {
        backdrop.currentTime = foreground.currentTime;
      } catch {
        // Metadata may still be loading; the next foreground event retries.
      }
    }
    backdrop.playbackRate = foreground.playbackRate;

    if (foreground.paused || foreground.ended) {
      backdrop.pause();
      return;
    }

    void backdrop.play().catch(() => {
      // The foreground remains authoritative if a browser delays muted playback.
    });
  }, []);
  const [initialDraftWindow] = useState(() => ({
    startSeconds: editPreview.startSeconds,
    endSeconds: editPreview.endSeconds,
  }));
  const brandingEnabled = brandingConfig.enabled && brandingConfig.preset !== "NO_BRANDING";
  const captionsRequireSafeBrandingPlacement = shouldBrandingLowerThirdYieldToCaptions({
    applyCaptionsToClip: editPreview.applyCaptionsToClip,
    captionCueCount: editPreview.captionCues.length,
  });
  const lowerThirdPlacement = resolveBrandingLowerThirdPlacement({
    applyCaptionsToClip: editPreview.applyCaptionsToClip,
    captionCueCount: editPreview.captionCues.length,
    captionPosition: editPreview.captionPosition,
  });
  const showLogo = brandingEnabled
    && Boolean(logoSrc)
    && (brandingConfig.watermarkEnabled || brandingConfig.preset === "MINIMAL_WATERMARK");
  const showWatermark = brandingEnabled && !showLogo && (brandingConfig.watermarkEnabled || brandingConfig.preset === "MINIMAL_WATERMARK");
  const lowerThirdRequested =
    brandingEnabled && brandingConfig.lowerThirdEnabled && brandingConfig.preset !== "MINIMAL_WATERMARK";
  const showLowerThird = lowerThirdRequested;
  const lowerThirdMovedForCaptions = lowerThirdRequested && captionsRequireSafeBrandingPlacement;
  const captionStyle = resolveCaptionStylePreset(editPreview.captionStylePresetId);
  const renderFrameSize = captionRenderFrameSize[exportSettings.primaryFormat];
  const protectsPreparedVisualLayers =
    exportSettings.primaryFormat !== "VERTICAL_9_16"
    && (
      editPreview.applyCaptionsToClip
      || editPreview.hookOverlay.enabled
      || editPreview.brollLayer.enabled
      || brandingEnabled
    );
  const safeZoneInsets = PLATFORM_SAFE_ZONE_INSETS[exportSettings.platformPreset];
  const safeZoneStyle = {
    "--safe-zone-top": `${safeZoneInsets.top}%`,
    "--safe-zone-right": `${safeZoneInsets.right}%`,
    "--safe-zone-bottom": `${safeZoneInsets.bottom}%`,
    "--safe-zone-left": `${safeZoneInsets.left}%`,
  } as CSSProperties;
  const sourcePrecisionRequired = clipStudioPreviewNeedsSourceMedia({
    initialStartSeconds: initialDraftWindow.startSeconds,
    initialEndSeconds: initialDraftWindow.endSeconds,
    currentStartSeconds: editPreview.startSeconds,
    currentEndSeconds: editPreview.endSeconds,
    seekTimeDomain: seekRequest?.timeDomain,
  });
  const {
    activePreviewSrc,
    canPreview,
    hasSourcePreview,
  } = resolveClipStudioPreviewSource({
    hasPreview,
    previewSrc,
    sourcePreviewSrc,
    preferSourcePreview: sourcePrecisionRequired,
    unavailableSourcePreviewSrc,
    unavailablePreparedPreviewSrc,
  });
  const previewError = previewErrorState?.src === activePreviewSrc ? previewErrorState.message : "";
  const sourcePrecisionUnavailable = sourcePrecisionRequired && !hasSourcePreview;
  const playbackSrc = useMemo(() => {
    if (!activePreviewSrc) {
      return null;
    }

    return buildRetryablePreviewUrl(activePreviewSrc, retryNonce);
  }, [activePreviewSrc, retryNonce]);

  useEffect(() => {
    if (!sourcePreviewSrc) {
      return undefined;
    }

    // Preload only the sermon metadata and nearby byte ranges while the fast
    // prepared clip is displayed. If a user extends a boundary, the browser
    // can switch to the source without appearing to lose audio during a long
    // cold load of the full recording.
    const warmupVideo = document.createElement("video");
    warmupVideo.preload = "metadata";
    warmupVideo.muted = true;
    warmupVideo.playsInline = true;
    warmupVideo.src = sourcePreviewSrc;
    sourceWarmupVideoRef.current = warmupVideo;
    const warmNearbySource = () => {
      if (initialDraftWindow.startSeconds === null) {
        return;
      }
      warmupVideo.currentTime = Math.max(0, initialDraftWindow.startSeconds - 15);
    };
    warmupVideo.addEventListener("loadedmetadata", warmNearbySource, { once: true });
    warmupVideo.load();

    return () => {
      warmupVideo.removeEventListener("loadedmetadata", warmNearbySource);
      if (sourceWarmupVideoRef.current === warmupVideo) {
        sourceWarmupVideoRef.current = null;
      }
      warmupVideo.removeAttribute("src");
      warmupVideo.load();
    };
  }, [initialDraftWindow.startSeconds, sourcePreviewSrc]);
  const previewMediaReady = Boolean(playbackSrc && previewReadySrc === playbackSrc && !previewError);
  const previewBuffering = playbackState === "waiting" || playbackState === "stalled";
  const draftDurationSeconds = editPreview.durationSeconds;
  const introDurationSeconds = normalizeBrandingDurationSeconds(
    brandingConfig.introDurationSeconds,
    DEFAULT_INTRO_DURATION_SECONDS,
  );
  const outroDurationSeconds = normalizeBrandingDurationSeconds(
    brandingConfig.outroDurationSeconds,
    DEFAULT_OUTRO_DURATION_SECONDS,
  );
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
  const effectivePreviewDuration = resolveCompositionPreviewDuration({
    draftDurationSeconds,
    mediaDurationSeconds: previewDurationSeconds,
    speechCleanupPlan: speechCleanupPreviewPlan,
  });
  const showTimedOutro = Boolean(
    brandingEnabled &&
    brandingConfig.outroEnabled &&
    effectivePreviewDuration !== null &&
    previewSeconds >= Math.max(0, effectivePreviewDuration - outroDurationSeconds),
  );
  const showTimedIntro = Boolean(
    brandingEnabled &&
    brandingConfig.introEnabled &&
    previewSeconds < introDurationSeconds &&
    !showTimedOutro,
  );
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
  const hookAnimationFrame = resolveHookOverlayAnimationFrame(hookOverlay, previewSeconds);
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
  const captionLookupSeconds = resolveCaptionLookupSeconds(
    sourcePreviewSeconds,
    editPreview.captionSyncOffsetSeconds,
  );
  const activeCaptionCue = useMemo(() => {
    if (!editPreview.applyCaptionsToClip) {
      return null;
    }

    const sortedCues = editPreview.captionCues
      .filter((cue) => cue.text.trim().length > 0)
      .sort((left, right) => left.startSeconds - right.startSeconds);
    return sortedCues.find((cue, index) => {
      const isLastCue = index === sortedCues.length - 1;
      return captionLookupSeconds >= cue.startSeconds && (captionLookupSeconds < cue.endSeconds || (isLastCue && captionLookupSeconds <= cue.endSeconds));
    }) ?? null;
  }, [captionLookupSeconds, editPreview.applyCaptionsToClip, editPreview.captionCues]);
  const activeCaptionCueText = useMemo(() => {
    return resolveActiveCaptionCueText({
      applyCaptionsToClip: editPreview.applyCaptionsToClip,
      captionCues: editPreview.captionCues,
      fallbackText: editPreview.onVideoCaptionText,
      previewSeconds: captionLookupSeconds,
    });
  }, [captionLookupSeconds, editPreview.applyCaptionsToClip, editPreview.captionCues, editPreview.onVideoCaptionText]);
  const activeCaptionCueWords = useMemo(
    () => activeCaptionCueText.split(/\s+/).filter(Boolean),
    [activeCaptionCueText],
  );
  const resolvedActiveCaptionWordIndex = useMemo(
    () => resolveActiveCaptionWordIndex({
      activeCue: activeCaptionCue,
      words: activeCaptionCueWords,
      previewSeconds: captionLookupSeconds,
    }),
    [activeCaptionCue, activeCaptionCueWords, captionLookupSeconds],
  );
  const captionPreviewText = editPreview.captionRevealMode === "single-word"
    ? activeCaptionCueWords[resolvedActiveCaptionWordIndex] ?? ""
    : activeCaptionCueText;
  const captionDesign = editPreview.captionDesign ?? captionStyle.design;
  const captionFont = resolveCaptionFontFamily(captionDesign.typography.fontFamilyId);
  const captionDisplayText = captionDesign.typography.textCase === "uppercase"
    ? captionPreviewText.toUpperCase()
    : captionDesign.typography.textCase === "lowercase"
      ? captionPreviewText.toLowerCase()
      : captionPreviewText;
  const captionWords = useMemo(() => captionDisplayText.split(/\s+/).filter(Boolean), [captionDisplayText]);
  const backgroundVisible = captionDesign.background.treatment !== "none";
  const horizontalAnchor = captionDesign.layout.horizontalPosition === "left"
    ? "5%"
    : captionDesign.layout.horizontalPosition === "right"
      ? "95%"
      : "50%";
  const horizontalTranslate = captionDesign.layout.horizontalPosition === "left"
    ? "0%"
    : captionDesign.layout.horizontalPosition === "right"
      ? "-100%"
      : "-50%";
  const captionVisualVariables = {
    "--caption-card-background": backgroundVisible
      ? colorWithOpacity(captionDesign.background.color, captionDesign.background.opacity)
      : "transparent",
    "--caption-card-border": backgroundVisible
      ? colorWithOpacity(captionDesign.background.borderColor, captionDesign.background.borderOpacity)
      : "transparent",
    "--caption-card-border-width": `${backgroundVisible ? captionDesign.background.borderWidthPx : 0}px`,
    "--caption-card-radius": `${captionDesign.background.treatment === "solid" ? 0 : captionDesign.background.borderRadiusPx}px`,
    "--caption-text-color": captionDesign.colors.textColor,
    "--caption-active-color": captionDesign.colors.activeTextColor,
    "--caption-active-background": colorWithOpacity(
      captionDesign.colors.highlightBackgroundColor,
      captionDesign.highlighting.backgroundOpacity,
    ),
    "--caption-active-scale": captionDesign.highlighting.reducedMotion
      ? "1"
      : String(captionDesign.highlighting.scale),
    "--caption-active-weight": String(Math.min(900, captionDesign.typography.fontWeight + captionDesign.highlighting.fontWeightBoost)),
    "--caption-font-family": captionFont.cssStack,
    "--caption-font-size": `${Math.max(0.72, captionDesign.typography.fontSizePx / 36).toFixed(2)}rem`,
    "--caption-font-weight": String(captionDesign.typography.fontWeight),
    "--caption-font-style": captionDesign.typography.italic ? "italic" : "normal",
    "--caption-letter-spacing": `${captionDesign.typography.letterSpacingPx}px`,
    "--caption-line-height": String(captionDesign.typography.lineHeight),
    "--caption-word-spacing": `${captionDesign.typography.wordSpacingPx}px`,
    "--caption-text-align": captionDesign.typography.alignment,
    "--caption-justify": captionDesign.typography.alignment === "left"
      ? "flex-start"
      : captionDesign.typography.alignment === "right"
        ? "flex-end"
        : "center",
    "--caption-padding-x": `${captionDesign.background.paddingX / 16}rem`,
    "--caption-padding-y": `${captionDesign.background.paddingY / 16}rem`,
    "--caption-text-stroke": captionDesign.readability.outlineWidthPx > 0
      ? `${Math.max(0.25, captionDesign.readability.outlineWidthPx / 6).toFixed(2)}px ${captionDesign.readability.outlineColor}`
      : "0 transparent",
    "--caption-text-shadow": `${captionDesign.readability.shadowOffsetX}px ${captionDesign.readability.shadowOffsetY}px ${captionDesign.readability.shadowBlurPx}px ${colorWithOpacity(
      captionDesign.readability.shadowColor,
      captionDesign.readability.shadowOpacity,
    )}`,
    "--caption-safe-width": `${resolveCaptionSafeWidthPercent(captionDesign.layout.safeWidth)}%`,
    "--caption-anchor-x": horizontalAnchor,
    "--caption-translate-x": horizontalTranslate,
    "--caption-offset-x": `${captionDesign.layout.horizontalOffset * (
      previewFrameSize.width > 0 ? previewFrameSize.width / renderFrameSize.width : 0
    )}px`,
  } as CSSProperties;
  const captionAppearanceStyle = {
    ...captionVisualVariables,
    "--caption-offset-y": `${captionDesign.layout.verticalOffset * (
      previewFrameSize.height > 0 ? previewFrameSize.height / renderFrameSize.height : 0
    )}px`,
  } as CSSProperties;
  const hookAppearanceStyle = {
    ...captionVisualVariables,
    fontWeight: hookOverlay.bold ? captionDesign.typography.fontWeight : 700,
    opacity: hookAnimationFrame.opacity,
    translate: captionDesign.highlighting.reducedMotion
      ? "0% 0%"
      : `${hookAnimationFrame.translateXPercent}% ${hookAnimationFrame.translateYPercent}%`,
  } as CSSProperties;
  const manualCropPreview = useMemo(
    () => resolveManualCropPreviewFrame(exportSettings.manualCropKeyframes, sourcePreviewSeconds),
    [exportSettings.manualCropKeyframes, sourcePreviewSeconds],
  );
  const hasManualCropPreview = Boolean(manualCropPreview);
  const framingPreview = useMemo(
    () => resolveClipStudioFramingPreview({
      plan: resolvedFramingPlan,
      framingMode: exportSettings.framingMode,
      framingPersonality: exportSettings.framingPersonality,
      hasManualCrop: hasManualCropPreview,
    }),
    [
      exportSettings.framingMode,
      exportSettings.framingPersonality,
      hasManualCropPreview,
      resolvedFramingPlan,
    ],
  );
  const canonicalCropPreview = useMemo(
    () => (
      framingPreview.canConsumePlan
      && framingPreview.layout === "SMART_CROP"
      && resolvedFramingPlan
        ? resolveCanonicalFramingPreviewFrame(
            resolvedFramingPlan.tracking.timeline,
            sourcePreviewSeconds,
          )
        : null
    ),
    [framingPreview.canConsumePlan, framingPreview.layout, resolvedFramingPlan, sourcePreviewSeconds],
  );
  const canonicalPlanAppliesToPreview = Boolean(
    framingPreview.canConsumePlan
    && !hasManualCropPreview
    && !protectsPreparedVisualLayers
    && hasSourcePreview
    && exportSettings.primaryFormat === "VERTICAL_9_16"
  );
  const preparedPreviewAlreadyFramed = Boolean(
    framingPreview.canConsumePlan
    && !hasManualCropPreview
    && !hasSourcePreview
    && exportSettings.primaryFormat === "VERTICAL_9_16",
  );
  const previewFramingMode = hasManualCropPreview
    ? exportSettings.framingMode
    : protectsPreparedVisualLayers
      ? "FIT_BLURRED_BACKGROUND"
      : preparedPreviewAlreadyFramed
        ? "FIT_BLURRED_BACKGROUND"
        : canonicalPlanAppliesToPreview && framingPreview.layout
          ? framingPreview.layout
          : "FIT_BLURRED_BACKGROUND";
  const activeCanonicalCropPreview = canonicalPlanAppliesToPreview
    ? canonicalCropPreview
    : null;
  const appliedTreatment = canonicalPlanAppliesToPreview
    ? framingPreview.treatment
    : null;
  const treatmentClassName =
    appliedTreatment === "WORSHIP_WIDE"
      ? styles.worshipWideTreatment
      : appliedTreatment === "FULL_STAGE"
        ? styles.fullStageTreatment
        : appliedTreatment === "BLURRED_BACKGROUND"
          ? styles.blurredBackgroundTreatment
          : appliedTreatment === "CENTER_CROP"
            ? styles.centerCropTreatment
            : appliedTreatment === "PASSTHROUGH"
              ? styles.passthroughTreatment
              : preparedPreviewAlreadyFramed
                ? styles.passthroughTreatment
                : appliedTreatment
                  ? styles.trackedTreatment
                  : !hasManualCropPreview && !protectsPreparedVisualLayers
                    ? styles.unresolvedFraming
                    : "";
  const showTrueBlurBackdrop = appliedTreatment === "BLURRED_BACKGROUND";
  const activeCaptionWordIndex = useMemo(() => {
    if (editPreview.captionRevealMode !== "active-word") {
      return -1;
    }

    return resolvedActiveCaptionWordIndex;
  }, [editPreview.captionRevealMode, resolvedActiveCaptionWordIndex]);
  const previewStyle = {
    "--clip-brand-color": brandingConfig.themeColor ?? "#75d9b8",
    "--clip-brand-tint-opacity": resolveBrandBackgroundOpacity(brandingConfig.backgroundStyle),
    ...(manualCropPreview
      ? {
          "--clip-manual-x": `${(manualCropPreview.centerX * 100).toFixed(2)}%`,
          "--clip-manual-y": `${(manualCropPreview.centerY * 100).toFixed(2)}%`,
          "--clip-manual-zoom": manualCropPreview.zoom.toFixed(3),
        }
      : {}),
    ...(activeCanonicalCropPreview
      ? {
          "--clip-plan-x": `${(activeCanonicalCropPreview.centerX * 100).toFixed(2)}%`,
          "--clip-plan-y": `${(activeCanonicalCropPreview.centerY * 100).toFixed(2)}%`,
          "--clip-plan-zoom": activeCanonicalCropPreview.zoom.toFixed(3),
        }
      : {}),
  } as CSSProperties;
  const backgroundStyleClass = `background-${brandingConfig.backgroundStyle.toLowerCase().replace(/_/g, "-")}`;
  const framingDisplayLabel = resolveFramingDisplayLabel(exportSettings);
  const framingPreviewMessage = preparedPreviewAlreadyFramed
    ? `Framing ${framingPreview.state} is already applied to this prepared preview, so Studio is not cropping it a second time. ${framingPreview.message}`
    : framingPreview.message;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return undefined;
    }

    const updateFrameSize = () => {
      const rect = frame.getBoundingClientRect();
      setPreviewFrameSize((current) => (
        Math.abs(current.width - rect.width) < 0.5
        && Math.abs(current.height - rect.height) < 0.5
          ? current
          : { width: rect.width, height: rect.height }
      ));
    };

    updateFrameSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateFrameSize);
      return () => window.removeEventListener("resize", updateFrameSize);
    }

    const observer = new ResizeObserver(updateFrameSize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  function updateOverlayPositionFromPointer(
    state: OverlayDragState,
    clientX: number,
    clientY: number,
  ) {
    const ratio = clampOverlayRatio((clientY - state.frameTop) / Math.max(1, state.frameHeight));

    if (state.overlay === "caption") {
      dispatchOverlayPosition({
        overlay: "caption",
        position: resolveCaptionPositionFromOverlayRatio(ratio),
        horizontalOffset: clampCaptionOverlayOffset(
          state.originCaptionHorizontalOffset
          + (clientX - state.originClientX) * state.renderUnitsPerClientX,
        ),
        verticalOffset: clampCaptionOverlayOffset(
          state.originCaptionVerticalOffset
          - (clientY - state.originClientY) * state.renderUnitsPerClientY,
        ),
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
      originClientX: event.clientX,
      originClientY: event.clientY,
      originCaptionHorizontalOffset: editPreview.captionDesign.layout.horizontalOffset,
      originCaptionVerticalOffset: editPreview.captionDesign.layout.verticalOffset,
      renderUnitsPerClientX: renderFrameSize.width / rect.width,
      renderUnitsPerClientY: renderFrameSize.height / rect.height,
      frameTop: rect.top,
      frameHeight: rect.height,
    };

    setOverlayDragState(nextDragState);
    updateOverlayPositionFromPointer(nextDragState, event.clientX, event.clientY);
  }

  function moveOverlayDrag(event: PointerEvent<HTMLElement>) {
    if (!overlayDragState || overlayDragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    updateOverlayPositionFromPointer(overlayDragState, event.clientX, event.clientY);
  }

  function endOverlayDrag(event: PointerEvent<HTMLElement>) {
    if (!overlayDragState || overlayDragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    updateOverlayPositionFromPointer(overlayDragState, event.clientX, event.clientY);

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }

    setOverlayDragState(null);
  }

  function handleCaptionOverlayKeyDown(event: KeyboardEvent<HTMLElement>) {
    const nextOffset = nudgeCaptionOverlayOffset({
      horizontalOffset: editPreview.captionDesign.layout.horizontalOffset,
      verticalOffset: editPreview.captionDesign.layout.verticalOffset,
      key: event.key,
      largeStep: event.shiftKey,
    });
    if (!nextOffset) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dispatchOverlayPosition({
      overlay: "caption",
      position: editPreview.captionPosition,
      ...nextOffset,
    });
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
      sourceCurrentSeconds: sourceSeconds,
      durationSeconds,
      isPlaying,
    });
  }, [draftDurationSeconds, draftStartSeconds, hasSourcePreview, isDraftTrimPreview, speechCleanupPreviewPlan, updatePreviewClock]);

  const validatePreviewCoverage = useCallback((): boolean => {
    const video = videoRef.current;
    if (!video) {
      return false;
    }

    if (!clipStudioPreviewMediaCoversDraft({
      mediaDurationSeconds: video.duration,
      draftDurationSeconds,
      draftEndSeconds: editPreview.endSeconds,
      hasSourcePreview,
    })) {
      video.pause();
      setPreviewReadySrc(null);
      setIsPreviewPlaying(false);
      setPlaybackState("error");
      setPreviewErrorState({
        src: activePreviewSrc ?? "",
        message: "This media file does not cover the selected clip range. Restore the full sermon source before previewing or preparing this cut.",
      });
      return false;
    }

    return true;
  }, [activePreviewSrc, draftDurationSeconds, editPreview.endSeconds, hasSourcePreview]);

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
    const seekSourceSeconds = resolvePreviewSeekSourceSeconds({
      requestedSeconds: seekRequest.seconds,
      timeDomain: seekRequest.timeDomain,
      plan: speechCleanupPreviewPlan,
    });
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
    if (!video || !validatePreviewCoverage()) {
      return;
    }

    playbackIntentRef.current = true;
    // A previous browser autoplay fallback may have muted this same element.
    // Every deliberate Play action should try audible playback again.
    video.muted = false;
    setIsPreviewMuted(false);
    clampVideoToDraftWindow({ restartAtEnd: true });
    if (video.readyState < 3) {
      setPlaybackState("waiting");
      setPlaybackNotice("Buffering the preview. Playback will begin as soon as enough video is ready.");
    }

    try {
      await video.play();
      setPlaybackNotice(null);
    } catch {
      try {
        video.muted = true;
        setIsPreviewMuted(true);
        await video.play();
        setPlaybackNotice("Preview started muted because the browser blocked audio playback.");
      } catch {
        playbackIntentRef.current = false;
        setPlaybackNotice("Preview playback is blocked by the browser. Try again or reload the Studio.");
      }
    } finally {
      updatePreviewSeconds();
    }
  }, [clampVideoToDraftWindow, updatePreviewSeconds, validatePreviewCoverage]);

  const togglePreviewPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (!video.paused && !video.ended) {
      playbackIntentRef.current = false;
      video.pause();
      setPlaybackState("paused");
      setPlaybackNotice(null);
      updatePreviewSeconds();
      return;
    }

    void startPreviewPlayback();
  }, [startPreviewPlayback, updatePreviewSeconds]);

  const resumePreviewAfterMediaSwap = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !playbackIntentRef.current || !video.paused) {
      return;
    }

    video.muted = false;
    setIsPreviewMuted(false);
    try {
      await video.play();
      setPlaybackNotice(null);
    } catch {
      playbackIntentRef.current = false;
      setPlaybackNotice("The adjusted range is ready. Press Play to continue with sound.");
    }
  }, []);

  useEffect(() => {
    if (!isPreviewPlaying) {
      return undefined;
    }

    let animationFrame = 0;
    let lastSyncAt = 0;
    const syncPlayingPreview = (timestamp: number) => {
      if (timestamp - lastSyncAt >= 80) {
        lastSyncAt = timestamp;
        updatePreviewSeconds();
      }
      animationFrame = window.requestAnimationFrame(syncPlayingPreview);
    };

    animationFrame = window.requestAnimationFrame(syncPlayingPreview);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [isPreviewPlaying, updatePreviewSeconds]);

  useEffect(() => {
    if (!playbackRequest) {
      return;
    }

    const playbackTimer = window.setTimeout(() => {
      const video = videoRef.current;
      if (!video) {
        return;
      }

      if (playbackRequest.action === "pause") {
        playbackIntentRef.current = false;
        video.pause();
        setPlaybackState("paused");
        setPlaybackNotice(null);
        updatePreviewSeconds();
        return;
      }

      if (playbackRequest.action === "toggle") {
        togglePreviewPlayback();
        return;
      }

      void startPreviewPlayback();
    }, 0);

    return () => window.clearTimeout(playbackTimer);
  }, [playbackRequest, startPreviewPlayback, togglePreviewPlayback, updatePreviewSeconds]);

  const scrubPreview = useCallback((seconds: number) => {
    const durationSeconds = previewDurationSeconds ?? 0;
    seekPreviewTo(Math.max(0, Math.min(durationSeconds, seconds)));
  }, [previewDurationSeconds, seekPreviewTo]);

  return (
    <section id="clip-studio-preview" className="card clip-studio-preview-card stack-sm" tabIndex={-1}>
      <div className="section-heading-row">
        <div className="stack-sm">
          <p className="kicker">Preview</p>
          <h2>Live preview</h2>
        </div>
        <div className={styles.previewHeadingActions}>
          <button
            type="button"
            className="button tertiary"
            aria-pressed={showSafeZoneGuide}
            onClick={() => setShowSafeZoneGuide((current) => !current)}
          >
            {showSafeZoneGuide ? "Hide safe zones" : "Show safe zones"}
          </button>
          <StatusBadge tone={renderTone}>{renderLabel}</StatusBadge>
        </div>
      </div>

      <div className="clip-studio-preview-body">
        <div className="clip-studio-video-shell">
          <div
            ref={frameRef}
            className={`clip-studio-live-frame ${formatClassName[exportSettings.primaryFormat]} ${frameClassName[previewFramingMode]} ${
              brandingEnabled ? "branding-on" : "branding-off"
            } ${hasManualCropPreview ? "has-manual-crop" : ""} ${canonicalPlanAppliesToPreview ? styles.canonicalPlanApplied : ""} ${treatmentClassName} ${overlayDragState ? "is-dragging-overlay" : ""} ${backgroundStyleClass}`}
            style={previewStyle}
          >
            {canPreview && playbackSrc ? (
              <>
                {showTrueBlurBackdrop ? (
                  <video
                    ref={backdropVideoRef}
                    className={`clip-studio-live-backdrop ${styles.previewBackdropVideo}`}
                    preload="metadata"
                    playsInline
                    muted
                    tabIndex={-1}
                    src={playbackSrc}
                    aria-hidden="true"
                    onLoadedMetadata={() => syncBackdropVideo(true)}
                  />
                ) : null}
                <video
                  ref={videoRef}
                  className={`review-video clip-studio-video ${styles.previewForeground}`}
                  preload="auto"
                  playsInline
                  src={playbackSrc}
                  onLoadedMetadata={() => {
                    if (!validatePreviewCoverage()) {
                      return;
                    }
                    setPreviewErrorState(null);
                    updatePreviewSeconds();
                    syncBackdropVideo(true);
                  }}
                  onLoadedData={() => {
                    if (!validatePreviewCoverage()) {
                      return;
                    }
                    setPreviewErrorState(null);
                  }}
                  onCanPlay={() => {
                    if (!validatePreviewCoverage()) {
                      return;
                    }
                    setPreviewErrorState(null);
                    setPreviewReadySrc(playbackSrc);
                    setPlaybackState(videoRef.current && !videoRef.current.paused ? "playing" : "ready");
                    if (playbackIntentRef.current && videoRef.current?.paused) {
                      void resumePreviewAfterMediaSwap();
                    } else {
                      setPlaybackNotice(null);
                    }
                  }}
                  onError={() => {
                    if (
                      activePreviewSrc === sourcePreviewSrc &&
                      sourcePreviewSrc &&
                      previewSrc &&
                      previewSrc !== unavailablePreparedPreviewSrc &&
                      !sourcePrecisionRequired
                    ) {
                      setUnavailableSourcePreviewSrc(sourcePreviewSrc);
                      setPreviewErrorState(null);
                      setPreviewReadySrc(null);
                      setIsPreviewPlaying(false);
                      setPlaybackState("loading");
                      setPlaybackNotice("The sermon source is unavailable, so Studio is loading the prepared clip instead.");
                      return;
                    }

                    if (
                      activePreviewSrc === previewSrc &&
                      previewSrc &&
                      sourcePreviewSrc &&
                      sourcePreviewSrc !== unavailableSourcePreviewSrc
                    ) {
                      setUnavailablePreparedPreviewSrc(previewSrc);
                      setPreviewErrorState(null);
                      setPreviewReadySrc(null);
                      setIsPreviewPlaying(false);
                      setPlaybackState("loading");
                      setPlaybackNotice("The prepared preview is unavailable, so Studio is loading the sermon source instead.");
                      return;
                    }

                    setPreviewErrorState({
                      src: activePreviewSrc ?? "",
                      message: "Preview media could not be loaded. Check the source video or retry the preview.",
                    });
                    setPreviewReadySrc(null);
                    setIsPreviewPlaying(false);
                    setPlaybackState("error");
                  }}
                  onWaiting={() => {
                    setPlaybackState("waiting");
                    setPlaybackNotice("Buffering the preview. Playback will continue automatically.");
                  }}
                  onStalled={() => {
                    setPlaybackState("stalled");
                    setPlaybackNotice("The preview connection paused. Retrying the video stream…");
                  }}
                  onPlaying={() => {
                    playbackIntentRef.current = true;
                    setPlaybackState("playing");
                    setPlaybackNotice(null);
                  }}
                  onTimeUpdate={() => {
                    clampVideoToDraftWindow();
                    updatePreviewSeconds();
                    syncBackdropVideo();
                  }}
                  onSeeking={() => {
                    updatePreviewSeconds();
                    syncBackdropVideo(true);
                  }}
                  onSeeked={() => {
                    clampVideoToDraftWindow();
                    updatePreviewSeconds();
                    syncBackdropVideo(true);
                  }}
                  onPlay={() => {
                    playbackIntentRef.current = true;
                    clampVideoToDraftWindow();
                    updatePreviewSeconds();
                    syncBackdropVideo(true);
                  }}
                  onPause={() => {
                    setPlaybackState("paused");
                    updatePreviewSeconds();
                    syncBackdropVideo(true);
                  }}
                  onEnded={() => {
                    playbackIntentRef.current = false;
                    setPlaybackState("ready");
                    clampVideoToDraftWindow();
                    updatePreviewSeconds();
                    syncBackdropVideo(true);
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
                        setUnavailableSourcePreviewSrc(null);
                        setUnavailablePreparedPreviewSrc(null);
                        setPreviewReadySrc(null);
                        setPlaybackState("loading");
                        setPlaybackNotice(null);
                        setRetryNonce((current) => current + 1);
                      }}
                    >
                      Retry preview
                    </button>
                  </div>
                ) : null}
                {!previewError && (!previewMediaReady || previewBuffering) ? (
                  <div className="clip-studio-preview-error is-loading" role="status">
                    <strong>{previewBuffering ? "Buffering preview" : "Loading preview media"}</strong>
                    <span>
                      {playbackState === "stalled"
                        ? "The connection paused briefly. The Studio is retrying the stream."
                        : previewBuffering
                          ? "Playback will continue automatically as soon as enough video is ready."
                          : "The Studio is loading enough video to start smoothly."}
                    </span>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        setPreviewReadySrc(null);
                        setPlaybackState("loading");
                        setPlaybackNotice(null);
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
                title={sourcePrecisionUnavailable ? "Full sermon source required" : "Preview not available yet"}
                description={sourcePrecisionUnavailable
                  ? "Studio cannot safely preview this adjusted range with the shorter prepared clip. Retry after the full sermon source is available."
                  : unavailableDescription ?? "Clip preview is not available yet. Review timing and captions, then render to generate a playable preview."}
              />
            )}

            {previewMediaReady && brandingEnabled && brandingConfig.backgroundStyle !== "NONE" ? (
              <div className="clip-studio-live-brand-tint" aria-hidden="true" />
            ) : null}

            {showSafeZoneGuide ? (
              <div className={styles.safeZoneOverlay} style={safeZoneStyle} aria-hidden="true">
                <div className={styles.safeZoneFrame}>
                  <span>{PLATFORM_PRESET_LABELS[exportSettings.platformPreset]} safe area</span>
                </div>
              </div>
            ) : null}

            {previewMediaReady && showLogo && logoSrc ? (
              <div className={`clip-studio-live-watermark has-logo logo-placement-${lowerThirdPlacement.toLowerCase()}`}>
                <Image src={logoSrc} alt={`${churchName || "Church"} logo`} width={68} height={68} unoptimized />
              </div>
            ) : previewMediaReady && showWatermark ? (
              <div className="clip-studio-live-watermark">{(churchName || "Church").slice(0, 2).toUpperCase()}</div>
            ) : null}

            {previewMediaReady && showTimedIntro ? (
              <div className="clip-studio-live-brand-slate clip-studio-live-brand-slate-intro">
                {churchName || sermonTitle || "Sermon Clip"}
              </div>
            ) : null}

            {previewMediaReady && showLowerThird ? (
              <div className={`clip-studio-live-lower-third brand-placement-${lowerThirdPlacement.toLowerCase()}`}>
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
                }${showLowerThird && lowerThirdPlacement === "TOP" && hookOverlay.position === "top" ? " avoids-top-brand-rail" : ""}`}
                style={hookAppearanceStyle}
                onPointerDown={(event) => startOverlayDrag(event, "hook")}
                onPointerMove={moveOverlayDrag}
                onPointerUp={endOverlayDrag}
                onPointerCancel={endOverlayDrag}
                title="Drag hook overlay"
              >
                {captionDesign.typography.textCase === "uppercase"
                  ? hookOverlay.text.toUpperCase()
                  : captionDesign.typography.textCase === "lowercase"
                    ? hookOverlay.text.toLowerCase()
                    : hookOverlay.text}
              </div>
            ) : null}

            {previewMediaReady && captionPreviewText ? (
              <div
                key={editPreview.captionRevealMode === "single-word" ? `${activeCaptionCue?.index ?? "cue"}-${captionDisplayText}` : "caption"}
                className={`clip-studio-live-caption ${styles.designedCaption} ${captionDesign.highlighting.reducedMotion ? styles.reducedMotion : ""} ${captionStyle.className} caption-position-${editPreview.captionPosition} caption-size-${editPreview.captionAppearance.fontScale} caption-reveal-${editPreview.captionRevealMode}`}
                style={captionAppearanceStyle}
                data-max-lines={editPreview.captionAppearance.maxLines}
                onPointerDown={(event) => startOverlayDrag(event, "caption")}
                onPointerMove={moveOverlayDrag}
                onPointerUp={endOverlayDrag}
                onPointerCancel={endOverlayDrag}
                onKeyDown={handleCaptionOverlayKeyDown}
                tabIndex={0}
                role="button"
                aria-roledescription="draggable caption overlay"
                aria-label="Caption position. Drag to move, or use the arrow keys to nudge within the safe area."
                title="Drag captions, or use arrow keys to nudge"
              >
                <span aria-label={captionDisplayText}>
                  {captionWords.map((word, index) => (
                    <span
                      key={`${word}-${index}`}
                      aria-hidden="true"
                      className={[
                        "clip-studio-live-caption-word",
                        styles.designWord,
                        index === activeCaptionWordIndex ? "is-active" : "",
                        index === activeCaptionWordIndex ? styles.designWordActive : "",
                      ].filter(Boolean).join(" ")}
                    >
                      {word}
                    </span>
                  ))}
                </span>
              </div>
            ) : null}

            {previewMediaReady && showTimedOutro ? (
              <div className="clip-studio-live-brand-slate clip-studio-live-brand-slate-outro">
                <strong>{churchName || "Keep the message going"}</strong>
                <span>Reflect · Share · Invite</span>
              </div>
            ) : null}
          </div>

          {canPreview && playbackSrc ? (
            <div className="stack-sm">
              <div className="clip-studio-player-controls" aria-label="Live preview playback controls">
                <button type="button" className="button secondary" onClick={togglePreviewPlayback}>
                  {isPreviewPlaying ? "Pause" : "Play"}
                </button>
                <button
                  type="button"
                  className="button tertiary"
                  aria-label={isPreviewMuted ? "Turn preview sound on" : "Mute preview"}
                  aria-pressed={isPreviewMuted}
                  onClick={() => {
                    const video = videoRef.current;
                    if (!video) {
                      return;
                    }
                    const nextMuted = !video.muted;
                    video.muted = nextMuted;
                    setIsPreviewMuted(nextMuted);
                    if (!nextMuted) {
                      setPlaybackNotice(null);
                    }
                  }}
                >
                  {isPreviewMuted ? "Sound on" : "Mute"}
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
                  {BRANDING_PRESET_LABELS[brandingConfig.preset]}
                </span>
              ) : null}
              {speechCleanupPreviewPlan.enabled ? <span>Dead Air Removed</span> : null}
              {editPreview.brollLayer.enabled && editPreview.brollLayer.cards.length > 0 ? <span>B-roll On</span> : null}
              {exportSettings.manualCropKeyframes.length > 1 ? (
                <span>{exportSettings.manualCropKeyframes.length}-point frame motion</span>
              ) : null}
              <span
                className={styles.framingPlanChip}
                data-framing-state={framingPreview.state.toLowerCase()}
              >
                {framingPreview.statusLabel}
              </span>
            </div>
            {protectsPreparedVisualLayers && !hasManualCropPreview ? (
              <p className="clip-studio-preview-truth-note">
                Full-frame fit protects captions and artwork from being cropped in this format.
              </p>
            ) : (
              <p
                className={`clip-studio-preview-truth-note ${styles.framingPlanMessage}`}
                data-framing-state={framingPreview.state.toLowerCase()}
                role="status"
                aria-live="polite"
              >
                {framingPreviewMessage}
              </p>
            )}
            {brandingEnabled && (brandingConfig.introEnabled || brandingConfig.outroEnabled) ? (
              <p className="clip-studio-preview-truth-note">
                Timed brand cards use the same opening and closing windows in preview and preparation.
              </p>
            ) : null}
            {lowerThirdMovedForCaptions ? (
              <p className="clip-studio-preview-truth-note">
                The brand rail moves away from the caption position, so both remain visible in the final video.
              </p>
            ) : null}
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
