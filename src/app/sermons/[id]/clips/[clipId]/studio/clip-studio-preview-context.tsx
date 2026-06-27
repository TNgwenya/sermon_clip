"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

import type { ClipBrandingConfig } from "@/lib/clipBranding";
import type { HookOverlayConfig } from "@/lib/clipStudio";
import type { ExportSettings } from "@/lib/clipExportSettings";

export type ClipStudioEditPreview = {
  startLabel: string;
  endLabel: string;
  durationLabel: string;
  startSeconds: number | null;
  endSeconds: number | null;
  durationSeconds: number | null;
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
  hookOverlay: HookOverlayConfig;
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
  churchName: string;
  sermonTitle: string;
  preacherName: string;
  updateExportSettings: (settings: ExportSettings) => void;
  updateBrandingConfig: (config: ClipBrandingConfig) => void;
  updateEditPreview: (preview: ClipStudioEditPreview) => void;
  updatePreviewClock: (clock: ClipStudioPreviewClock) => void;
  seekPreviewTo: (seconds: number) => void;
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
    a.backgroundMode === b.backgroundMode &&
    a.selectedFormats.length === b.selectedFormats.length &&
    a.selectedFormats.every((format, index) => format === b.selectedFormats[index])
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
    a.hookOverlay.enabled === b.hookOverlay.enabled &&
    a.hookOverlay.text === b.hookOverlay.text &&
    a.hookOverlay.position === b.hookOverlay.position &&
    a.hookOverlay.startSeconds === b.hookOverlay.startSeconds &&
    a.hookOverlay.durationSeconds === b.hookOverlay.durationSeconds &&
    a.hookOverlay.animation === b.hookOverlay.animation &&
    a.hookOverlay.size === b.hookOverlay.size &&
    a.hookOverlay.bold === b.hookOverlay.bold &&
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

  const value = useMemo(
    () => ({
      exportSettings,
      brandingConfig,
      editPreview,
      previewClock,
      seekRequest,
      churchName,
      sermonTitle,
      preacherName,
      updateExportSettings,
      updateBrandingConfig,
      updateEditPreview,
      updatePreviewClock,
      seekPreviewTo,
    }),
    [
      brandingConfig,
      churchName,
      editPreview,
      exportSettings,
      preacherName,
      previewClock,
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
