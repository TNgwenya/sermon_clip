"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_INTRO_DURATION_SECONDS,
  DEFAULT_OUTRO_DURATION_SECONDS,
  normalizeBrandingDurationSeconds,
  type ClipBrandingConfig,
} from "@/lib/clipBranding";
import type {
  BrollLayerConfig,
  CaptionAppearanceSettings,
  CaptionPosition,
  HookOverlayConfig,
  SpeechCleanupSettings,
} from "@/lib/clipStudio";
import type { ExportSettings } from "@/lib/clipExportSettings";
import type { SpeechCleanupAudioSilenceEvent } from "@/lib/clipStudioPreviewTimeline";
import type { SpeechCleanupEdits } from "@/lib/speechCleanupPlan";

export type ClipStudioEditPreview = {
  startLabel: string;
  endLabel: string;
  durationLabel: string;
  startSeconds: number | null;
  endSeconds: number | null;
  durationSeconds: number | null;
  title: string;
  editorialHook: string;
  mainCaption: string;
  shortCaption: string;
  platformCaption: string;
  onVideoCaptionText: string;
  captionCues: Array<{
    index: number;
    startSeconds: number;
    endSeconds: number;
    text: string;
  }>;
  applyCaptionsToClip: boolean;
  captionStylePresetId: string;
  captionPosition: CaptionPosition;
  captionAppearance: CaptionAppearanceSettings;
  hookOverlay: HookOverlayConfig;
  brollLayer: BrollLayerConfig;
  speechCleanup: SpeechCleanupSettings;
  speechCleanupEdits: SpeechCleanupEdits | null;
  audioSilenceEvents: SpeechCleanupAudioSilenceEvent[];
  audioSilenceAnalyzed: boolean;
  hashtags: string;
  isTimingValid: boolean;
};

export type ClipStudioPreviewClock = {
  currentSeconds: number;
  durationSeconds: number | null;
  isPlaying: boolean;
};

type ClipStudioPreviewContextValue = {
  exportSettings: ExportSettings;
  brandingConfig: ClipBrandingConfig;
  editPreview: ClipStudioEditPreview;
  previewClock: ClipStudioPreviewClock;
  seekRequest: { seconds: number; requestId: number } | null;
  playbackRequest: { requestId: number } | null;
  churchName: string;
  sermonTitle: string;
  preacherName: string;
  isDraftDirty: boolean;
  markDraftSaved: () => void;
  updateExportSettings: (settings: ExportSettings) => void;
  updateBrandingConfig: (config: ClipBrandingConfig) => void;
  updateEditPreview: (preview: ClipStudioEditPreview) => void;
  updatePreviewClock: (clock: ClipStudioPreviewClock) => void;
  seekPreviewTo: (seconds: number) => void;
  requestPreviewPlayback: () => void;
};

const ClipStudioPreviewContext = createContext<ClipStudioPreviewContextValue | null>(null);

type ClipStudioPreviewProviderProps = {
  initialExportSettings: ExportSettings;
  initialBrandingConfig: ClipBrandingConfig;
  initialEditPreview: ClipStudioEditPreview;
  churchName: string;
  sermonTitle: string;
  preacherName: string;
  children: ReactNode;
};

function sameExportSettings(a: ExportSettings, b: ExportSettings): boolean {
  return (
    a.platformPreset === b.platformPreset &&
    a.primaryFormat === b.primaryFormat &&
    a.framingMode === b.framingMode &&
    a.framingPersonality === b.framingPersonality &&
    a.backgroundMode === b.backgroundMode &&
    a.selectedFormats.length === b.selectedFormats.length &&
    a.selectedFormats.every((format, index) => format === b.selectedFormats[index]) &&
    a.manualCropKeyframes.length === b.manualCropKeyframes.length &&
    a.manualCropKeyframes.every((keyframe, index) => {
      const otherKeyframe = b.manualCropKeyframes[index];
      return (
        otherKeyframe !== undefined &&
        keyframe.timeSeconds === otherKeyframe.timeSeconds &&
        keyframe.centerX === otherKeyframe.centerX &&
        keyframe.centerY === otherKeyframe.centerY &&
        keyframe.zoom === otherKeyframe.zoom
      );
    })
  );
}

function sameBrandingConfig(a: ClipBrandingConfig, b: ClipBrandingConfig): boolean {
  return (
    a.enabled === b.enabled &&
    a.preset === b.preset &&
    a.showChurchName === b.showChurchName &&
    a.showSermonTitle === b.showSermonTitle &&
    a.showPreacherName === b.showPreacherName &&
    a.watermarkEnabled === b.watermarkEnabled &&
    a.lowerThirdEnabled === b.lowerThirdEnabled &&
    a.introEnabled === b.introEnabled &&
    a.outroEnabled === b.outroEnabled &&
    normalizeBrandingDurationSeconds(a.introDurationSeconds, DEFAULT_INTRO_DURATION_SECONDS) ===
      normalizeBrandingDurationSeconds(b.introDurationSeconds, DEFAULT_INTRO_DURATION_SECONDS) &&
    normalizeBrandingDurationSeconds(a.outroDurationSeconds, DEFAULT_OUTRO_DURATION_SECONDS) ===
      normalizeBrandingDurationSeconds(b.outroDurationSeconds, DEFAULT_OUTRO_DURATION_SECONDS) &&
    a.backgroundStyle === b.backgroundStyle &&
    a.themeColor === b.themeColor
  );
}

function sameEditPreview(a: ClipStudioEditPreview, b: ClipStudioEditPreview): boolean {
  return (
    a.startLabel === b.startLabel &&
    a.endLabel === b.endLabel &&
    a.durationLabel === b.durationLabel &&
    a.startSeconds === b.startSeconds &&
    a.endSeconds === b.endSeconds &&
    a.durationSeconds === b.durationSeconds &&
    a.title === b.title &&
    a.editorialHook === b.editorialHook &&
    a.mainCaption === b.mainCaption &&
    a.shortCaption === b.shortCaption &&
    a.platformCaption === b.platformCaption &&
    a.onVideoCaptionText === b.onVideoCaptionText &&
    a.captionCues.length === b.captionCues.length &&
    a.captionCues.every((cue, index) => {
      const otherCue = b.captionCues[index];
      return (
        otherCue !== undefined &&
        cue.index === otherCue.index &&
        cue.startSeconds === otherCue.startSeconds &&
        cue.endSeconds === otherCue.endSeconds &&
        cue.text === otherCue.text
      );
    }) &&
    a.applyCaptionsToClip === b.applyCaptionsToClip &&
    a.captionStylePresetId === b.captionStylePresetId &&
    a.captionPosition === b.captionPosition &&
    a.captionAppearance.fontScale === b.captionAppearance.fontScale &&
    a.captionAppearance.maxLines === b.captionAppearance.maxLines &&
    a.captionAppearance.uppercase === b.captionAppearance.uppercase &&
    a.captionAppearance.verticalOffset === b.captionAppearance.verticalOffset &&
    a.hookOverlay.enabled === b.hookOverlay.enabled &&
    a.hookOverlay.text === b.hookOverlay.text &&
    a.hookOverlay.position === b.hookOverlay.position &&
    a.hookOverlay.startSeconds === b.hookOverlay.startSeconds &&
    a.hookOverlay.durationSeconds === b.hookOverlay.durationSeconds &&
    a.hookOverlay.animation === b.hookOverlay.animation &&
    a.hookOverlay.size === b.hookOverlay.size &&
    a.hookOverlay.bold === b.hookOverlay.bold &&
    a.brollLayer.enabled === b.brollLayer.enabled &&
    a.brollLayer.cards.length === b.brollLayer.cards.length &&
    a.brollLayer.cards.every((card, index) => {
      const otherCard = b.brollLayer.cards[index];
      return (
        otherCard !== undefined &&
        card.id === otherCard.id &&
        card.enabled === otherCard.enabled &&
        card.text === otherCard.text &&
        card.label === otherCard.label &&
        card.startSeconds === otherCard.startSeconds &&
        card.durationSeconds === otherCard.durationSeconds &&
        card.tone === otherCard.tone &&
        card.position === otherCard.position
      );
    }) &&
    a.speechCleanup.removeDeadAir === b.speechCleanup.removeDeadAir &&
    a.speechCleanup.tightenLongPauses === b.speechCleanup.tightenLongPauses &&
    a.speechCleanup.flagFillerWords === b.speechCleanup.flagFillerWords &&
    a.speechCleanup.intensity === b.speechCleanup.intensity &&
    JSON.stringify(a.speechCleanupEdits) === JSON.stringify(b.speechCleanupEdits) &&
    a.audioSilenceEvents.length === b.audioSilenceEvents.length &&
    a.audioSilenceEvents.every((event, index) => {
      const otherEvent = b.audioSilenceEvents[index];
      return (
        otherEvent !== undefined &&
        event.startSeconds === otherEvent.startSeconds &&
        event.endSeconds === otherEvent.endSeconds &&
        event.durationSeconds === otherEvent.durationSeconds
      );
    }) &&
    a.audioSilenceAnalyzed === b.audioSilenceAnalyzed &&
    a.hashtags === b.hashtags &&
    a.isTimingValid === b.isTimingValid
  );
}

function samePreviewClock(a: ClipStudioPreviewClock, b: ClipStudioPreviewClock): boolean {
  return (
    Math.abs(a.currentSeconds - b.currentSeconds) < 0.05 &&
    a.durationSeconds === b.durationSeconds &&
    a.isPlaying === b.isPlaying
  );
}

function buildCompositionKey({
  exportSettings,
  brandingConfig,
  editPreview,
}: {
  exportSettings: ExportSettings;
  brandingConfig: ClipBrandingConfig;
  editPreview: ClipStudioEditPreview;
}): string {
  // Audio analysis hydrates after first paint and improves preview accuracy,
  // but it is not a user-authored composition change. Normalize those fields
  // so a completed background review never creates a false unsaved-draft state.
  const compositionEditPreview = {
    ...editPreview,
    audioSilenceEvents: [],
    audioSilenceAnalyzed: false,
  };

  return JSON.stringify({ exportSettings, brandingConfig, editPreview: compositionEditPreview });
}

export function ClipStudioPreviewProvider({
  initialExportSettings,
  initialBrandingConfig,
  initialEditPreview,
  churchName,
  sermonTitle,
  preacherName,
  children,
}: ClipStudioPreviewProviderProps) {
  const [exportSettings, setExportSettings] = useState(initialExportSettings);
  const [brandingConfig, setBrandingConfig] = useState(initialBrandingConfig);
  const [editPreview, setEditPreview] = useState(initialEditPreview);
  const [previewClock, setPreviewClock] = useState<ClipStudioPreviewClock>({
    currentSeconds: 0,
    durationSeconds: null,
    isPlaying: false,
  });
  const [seekRequest, setSeekRequest] = useState<{ seconds: number; requestId: number } | null>(null);
  const [playbackRequest, setPlaybackRequest] = useState<{ requestId: number } | null>(null);
  const currentCompositionKey = useMemo(
    () => buildCompositionKey({ exportSettings, brandingConfig, editPreview }),
    [brandingConfig, editPreview, exportSettings],
  );
  const latestCompositionKeyRef = useRef(currentCompositionKey);
  const [savedCompositionKey, setSavedCompositionKey] = useState(() =>
    buildCompositionKey({
      exportSettings: initialExportSettings,
      brandingConfig: initialBrandingConfig,
      editPreview: initialEditPreview,
    }),
  );
  const [draftTrackingReady, setDraftTrackingReady] = useState(false);
  const isDraftDirty = draftTrackingReady && currentCompositionKey !== savedCompositionKey;

  useEffect(() => {
    latestCompositionKeyRef.current = currentCompositionKey;
  }, [currentCompositionKey]);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setSavedCompositionKey(latestCompositionKeyRef.current);
        setDraftTrackingReady(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, []);

  useEffect(() => {
    if (!isDraftDirty) {
      return undefined;
    }

    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isDraftDirty]);

  useEffect(() => {
    if (!isDraftDirty) {
      return undefined;
    }

    function confirmStudioNavigation(event: MouseEvent) {
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) {
        return;
      }

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) {
        return;
      }

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) {
        return;
      }

      const confirmed = window.confirm("This Clip Studio draft has unsaved changes. Leave without preparing the final video?");
      if (!confirmed) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    document.addEventListener("click", confirmStudioNavigation, true);
    return () => document.removeEventListener("click", confirmStudioNavigation, true);
  }, [isDraftDirty]);

  const markDraftSaved = useCallback(() => {
    setSavedCompositionKey(currentCompositionKey);
    setDraftTrackingReady(true);
  }, [currentCompositionKey]);

  const updateExportSettings = useCallback((settings: ExportSettings) => {
    setExportSettings((current) => (sameExportSettings(current, settings) ? current : settings));
  }, []);

  const updateBrandingConfig = useCallback((config: ClipBrandingConfig) => {
    setBrandingConfig((current) => (sameBrandingConfig(current, config) ? current : config));
  }, []);

  const updateEditPreview = useCallback((preview: ClipStudioEditPreview) => {
    setEditPreview((current) => (sameEditPreview(current, preview) ? current : preview));
  }, []);

  const updatePreviewClock = useCallback((clock: ClipStudioPreviewClock) => {
    setPreviewClock((current) => (samePreviewClock(current, clock) ? current : clock));
  }, []);

  const seekPreviewTo = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds)) {
      return;
    }

    setSeekRequest((current) => ({
      seconds: Math.max(0, seconds),
      requestId: (current?.requestId ?? 0) + 1,
    }));
  }, []);

  const requestPreviewPlayback = useCallback(() => {
    setPlaybackRequest((current) => ({
      requestId: (current?.requestId ?? 0) + 1,
    }));
  }, []);

  const value = useMemo(
    () => ({
      exportSettings,
      brandingConfig,
      editPreview,
      previewClock,
      seekRequest,
      playbackRequest,
      churchName,
      sermonTitle,
      preacherName,
      isDraftDirty,
      markDraftSaved,
      updateExportSettings,
      updateBrandingConfig,
      updateEditPreview,
      updatePreviewClock,
      seekPreviewTo,
      requestPreviewPlayback,
    }),
    [
      brandingConfig,
      churchName,
      editPreview,
      exportSettings,
      isDraftDirty,
      markDraftSaved,
      playbackRequest,
      preacherName,
      previewClock,
      requestPreviewPlayback,
      seekPreviewTo,
      seekRequest,
      sermonTitle,
      updateBrandingConfig,
      updateEditPreview,
      updateExportSettings,
      updatePreviewClock,
    ],
  );

  return <ClipStudioPreviewContext.Provider value={value}>{children}</ClipStudioPreviewContext.Provider>;
}

export function useClipStudioPreview() {
  const value = useContext(ClipStudioPreviewContext);
  if (!value) {
    throw new Error("useClipStudioPreview must be used inside ClipStudioPreviewProvider");
  }

  return value;
}
